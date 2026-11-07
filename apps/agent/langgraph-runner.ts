import type pg from "pg";
import { Command } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { BusinessError, transaction, requireCondition as check } from "../../shared/db.ts";
import type { Identity } from "../../shared/security.ts";
import type { Workflow } from "../../shared/workflows.ts";
import { progress } from "./events.ts";
import { workflowEvent } from "./workflow-store.ts";
import { workflowExecution } from "./workflow-execution.ts";
import { replenishmentNodes } from "./workflows/replenishment.ts";
import { replenishmentGraph, type GraphState, type ResumeSignal } from "./langgraph-workflow.ts";

export function databaseGraph(pool: pg.Pool) {
  const handlers = replenishmentNodes(pool);
  const load = async (id: string) => {
    const task = (await pool.query("SELECT * FROM agent.workflows WHERE id=$1 AND engine='langgraph'", [id])).rows[0] as Workflow | undefined;
    check(task?.status === "running", "WORKFLOW_STATE_CONFLICT", "任务未处于合法执行状态");
    check(task.name === "replenishment_purchase", "WORKFLOW_NODE_INVALID", "任务没有注册图定义");
    return task;
  };
  return replenishmentGraph(new PostgresSaver(pool, undefined, {schema: "agent_graph"}), {
    execute: async (node, state) => {
      const task = await load(state.taskId);
      const identity = (await pool.query('SELECT id,name,role,customer_id AS "customerId" FROM agent.accounts WHERE id=$1', [task.account_id])).rows[0] as Identity;
      check(identity?.role === "admin", "FORBIDDEN", "该账号不能继续此任务");
      await workflowEventInTransaction(pool, task, "node-started", {node, engine: "langgraph"});
      const input = {...task, node, data: state.data};
      const result = await handlers[node](input, identity, workflowExecution(pool, input, identity));
      await transaction(pool, async db => {
        const saved = (await db.query("UPDATE agent.workflows SET status=$2,node=$3,data=$4,version=version+1,updated_at=now() WHERE id=$1 AND version=$5 AND status='running' RETURNING *",
          [task.id, result.status === "ready" ? "running" : result.status, result.node || node, JSON.stringify(result.data), task.version])).rows[0];
        check(saved, "WORKFLOW_VERSION_CONFLICT", "图节点执行期间任务状态已变化");
        await workflowEvent(db, saved, "node-completed", {node, status: result.status, detail: result.detail, engine: "langgraph"});
      });
      await progress(pool, {conversationId: task.conversation_id, runId: null, type: "workflow-updated", title: "任务进度已保存", detail: result.detail});
      return result;
    },
    authorize: async (state: GraphState, kind, input: unknown) => {
      const signal = input as ResumeSignal | null;
      check(signal && signal.kind === kind && signal.taskId === state.taskId && Number.isInteger(signal.version), "GRAPH_SIGNAL_INVALID", "图恢复信号不合法");
      const task = await load(state.taskId);
      check(task.version === signal.version, "WORKFLOW_VERSION_CONFLICT", "图恢复信号版本已变化");
      if (kind === "review") {
        const event = (await pool.query("SELECT detail FROM agent.workflow_events WHERE workflow_id=$1 AND version=$2 AND kind='review-approve' AND dedupe_key=$3", [task.id, task.version, signal.eventId])).rows[0];
        check(task.node === "prepare" && event?.detail.reportId === state.data.report.id && task.data.report.id === state.data.report.id, "GRAPH_APPROVAL_MISMATCH", "恢复信号不属于本次已审核报告");
      } else {
        const action = (await pool.query("SELECT * FROM agent.actions WHERE id=$1 AND account_id=$2", [signal.actionId, task.account_id])).rows[0];
        const event = (await pool.query("SELECT 1 FROM agent.workflow_events WHERE workflow_id=$1 AND version=$2 AND kind='purchase-confirmed' AND dedupe_key=$3", [task.id, task.version, "action:" + signal.actionId])).rowCount;
        check(task.node === "reconcile" && signal.actionId === state.data.actionId && task.data.actionId === signal.actionId && action?.state === "completed" && action.result?.referenceId && event, "GRAPH_CONFIRMATION_MISSING", "缺少本次实际采购确认结果");
      }
    },
  });
}

async function workflowEventInTransaction(pool: pg.Pool, task: Workflow, kind: string, detail: unknown) {
  await transaction(pool, db => workflowEvent(db, task, kind, detail));
}

// The durable inbox only delivers task start / external decisions. Graph edges drive the business nodes.
export function startLangGraphWorker(pool: pg.Pool) {
  const graph = databaseGraph(pool);
  let stopped = false, active = false;
  async function tick() {
    if (stopped || active) return;
    active = true;
    const lease = await pool.connect();
    let task: (Workflow & {job_id: string}) | undefined, lockId: string | undefined;
    try {
      await lease.query("BEGIN");
      task = (await lease.query(`SELECT j.id AS job_id,w.* FROM agent.workflow_jobs j JOIN agent.workflows w ON w.id=j.workflow_id
        WHERE j.status='pending' AND w.status='ready' AND w.engine='langgraph' AND j.version=w.version
        AND NOT EXISTS(SELECT 1 FROM agent.runs r WHERE r.conversation_id=w.conversation_id AND r.status='running')
        ORDER BY j.created_at LIMIT 1 FOR UPDATE OF j,w SKIP LOCKED`)).rows[0];
      if (task) {
        const locked = (await lease.query("SELECT pg_try_advisory_lock(hashtextextended($1,99)) AS locked", [task.id])).rows[0].locked;
        if (locked) {
          lockId = task.id;
          await lease.query("UPDATE agent.workflow_jobs SET status='running' WHERE id=$1", [task.job_id]);
          await lease.query("UPDATE agent.workflows SET status='running',updated_at=now() WHERE id=$1", [task.id]);
        } else task = undefined;
      }
      await lease.query("COMMIT");
      if (!task) return;
      const options = {configurable: {thread_id: task.id}, recursionLimit: 50, durability: "sync" as const};
      const checkpoint = await graph.getState(options);
      if (!checkpoint.values.taskId) {
        check(task.node === "analyze", "GRAPH_CHECKPOINT_MISSING", "恢复任务缺少原图检查点");
        await graph.invoke({taskId: task.id, data: task.data, outcome: "", steps: 0}, options);
      } else {
        const kind = task.node === "prepare" ? "review" : task.node === "reconcile" ? "confirmation" : undefined;
        check(kind && checkpoint.next.includes(kind === "review" ? "review" : "confirmation"), "GRAPH_WAIT_MISMATCH", "图等待点与已保存的外部事件不一致");
        const signal: ResumeSignal = {kind, taskId: task.id, version: task.version};
        if (kind === "review") {
          signal.eventId = (await pool.query("SELECT dedupe_key FROM agent.workflow_events WHERE workflow_id=$1 AND version=$2 AND kind='review-approve'", [task.id, task.version])).rows[0]?.dedupe_key;
        } else signal.actionId = task.data.actionId;
        await graph.invoke(new Command({resume: signal}), options);
      }
      // invoke has drained synchronous checkpoint writes before this inbox item is acknowledged.
      await pool.query("UPDATE agent.workflow_jobs SET status='completed',finished_at=now() WHERE id=$1", [task.job_id]);
    } catch (error) {
      await lease.query("ROLLBACK");
      const code = error instanceof BusinessError ? error.code : "GRAPH_EXECUTION_FAILED";
      if (task && lockId) {
        await transaction(pool, async db => {
          const failed = (await db.query("UPDATE agent.workflows SET status='failed',error_code=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *", [task!.id, code])).rows[0];
          await db.query("UPDATE agent.workflow_jobs SET status='failed',finished_at=now() WHERE id=$1", [task!.job_id]);
          await workflowEvent(db, failed, "node-failed", {code, engine: "langgraph"});
        });
        await progress(pool, {conversationId: task.conversation_id, runId: null, type: "workflow-updated", title: "任务未完成", detail: `图执行已停止（${code}），请核对已有业务结果。`});
      }
      console.error(JSON.stringify({event: "langgraph_worker_failed", code}));
    } finally {
      try {
        if (lockId) await lease.query("SELECT pg_advisory_unlock(hashtextextended($1,99))", [lockId]);
      } finally {lease.release(); active = false;}
    }
  }
  const timer = setInterval(() => void tick().catch(error => {
    active = false;
    console.error(JSON.stringify({event: "langgraph_inbox_failed", code: error.code || "FAILED"}));
  }), 600);
  return {stop: async () => {stopped = true; clearInterval(timer); while (active) await new Promise(resolve => setTimeout(resolve, 100));}};
}
