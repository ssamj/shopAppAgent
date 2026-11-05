import { randomUUID } from "node:crypto";
import type pg from "pg";
import { BusinessError, transaction, requireCondition as check } from "../../shared/db.ts";
import type { Identity } from "../../shared/security.ts";
import type { Workflow } from "../../shared/workflows.ts";
import { config } from "../../shared/config.ts";
import { progress } from "./events.ts";
import { workflowEvent, enqueue } from "./workflow-store.ts";
import { run, type RunScope } from "./runtime.ts";
import { replenishmentNodes } from "./workflows/replenishment.ts";


export function startWorkflowWorker(pool: pg.Pool) {
  const handlers = new Map([["replenishment_purchase", replenishmentNodes(pool)]]);
  let stopped = false, active = false;
  async function tick() {
    if (stopped || active) return;
    active = true;
    try {
      const claimed = await transaction(pool, async db => {
        const row = (await db.query(`SELECT j.id AS job_id,w.* FROM agent.workflow_jobs j JOIN agent.workflows w ON w.id=j.workflow_id
          WHERE j.status='pending' AND w.status='ready' AND j.version=w.version
          AND NOT EXISTS(SELECT 1 FROM agent.runs r WHERE r.conversation_id=w.conversation_id AND r.status='running')
          ORDER BY j.created_at LIMIT 1 FOR UPDATE OF j,w SKIP LOCKED`)).rows[0];
        if (!row) return;
        await db.query("UPDATE agent.workflow_jobs SET status='running' WHERE id=$1", [row.job_id]);
        await db.query("UPDATE agent.workflows SET status='running',updated_at=now() WHERE id=$1", [row.id]);
        await workflowEvent(db, row, "node-started", {node: row.node});
        return row as Workflow & {job_id: string};
      });
      if (!claimed) return;
      const task = claimed;
      try {
        const jobCount = (await pool.query("SELECT count(*)::int n FROM agent.workflow_jobs WHERE workflow_id=$1", [task.id])).rows[0].n;
        check(jobCount <= 12, "WORKFLOW_STEP_LIMIT", "任务节点次数已达到上限，请检查已有结果");
        const identity = (await pool.query('SELECT id,name,role,customer_id AS "customerId" FROM agent.accounts WHERE id=$1', [task.account_id])).rows[0] as Identity;
        check(identity?.role === "admin", "FORBIDDEN", "该账号不能继续此任务");
        const handler = handlers.get(task.name)?.[task.node];
        check(handler, "WORKFLOW_NODE_INVALID", "没有注册此执行节点");
        const execute = async (scope: RunScope) => {
          const prompt = (await pool.query("SELECT content,version FROM agent.prompts WHERE role=$1", [identity.role])).rows[0];
          const runId = randomUUID();
          await transaction(pool, async db => {
            await db.query("INSERT INTO agent.runs(id,conversation_id,status,prompt_version,model) VALUES($1,$2,'running',$3,$4)", [runId, task.conversation_id, prompt.version, config().model.model]);
            await db.query("INSERT INTO agent.workflow_runs(run_id,workflow_id,node) VALUES($1,$2,$3)", [runId, task.id, task.node]);
          });
          await run(pool, runId, task.conversation_id, identity, prompt, {...scope, recordDecision: async decision => {
            await pool.query("UPDATE agent.workflow_runs SET decisions=decisions || $2::jsonb WHERE run_id=$1", [runId, JSON.stringify([decision])]);
          }});
          const state = (await pool.query("SELECT status,error_code FROM agent.runs WHERE id=$1", [runId])).rows[0];
          check(state.status === "succeeded", state.error_code || "WORKFLOW_RUN_FAILED", "节点执行失败，请查看实际调用记录");
          const message = (await pool.query("SELECT cards FROM agent.messages WHERE run_id=$1 AND role='assistant' ORDER BY created_at DESC LIMIT 1", [runId])).rows[0];
          const action = (await pool.query("SELECT result FROM agent.tool_calls WHERE run_id=$1 AND status='awaiting_confirmation'", [runId])).rows[0];
          return {cards: message?.cards || [], actionId: action?.result?.actionId};
        };
        const result = await handler(task, identity, execute);
        await transaction(pool, async db => {
          const updated = await db.query("UPDATE agent.workflows SET status=$2,node=$3,data=$4,version=version+1,updated_at=now() WHERE id=$1 AND version=$5 AND status='running' RETURNING *", [task.id, result.status, result.node || task.node, JSON.stringify(result.data), task.version]);
          check(updated.rowCount, "WORKFLOW_VERSION_CONFLICT", "任务状态已变化");
          const next = updated.rows[0] as Workflow;
          await workflowEvent(db, next, "node-completed", {node: task.node, status: result.status, detail: result.detail});
          await db.query("UPDATE agent.workflow_jobs SET status='completed',finished_at=now() WHERE id=$1", [task.job_id]);
          if (next.status === "ready") await enqueue(db, next);
        });
        await progress(pool, {conversationId: task.conversation_id, runId: null, type: "workflow-updated", title: "任务进度已保存", detail: result.detail});
      } catch (error) {
        const code = error instanceof BusinessError ? error.code : "WORKFLOW_FAILED";
        await transaction(pool, async db => {
          await db.query("UPDATE agent.workflows SET status='failed',error_code=$2,version=version+1,updated_at=now() WHERE id=$1", [task.id, code]);
          await db.query("UPDATE agent.workflow_jobs SET status='failed',finished_at=now() WHERE id=$1", [task.job_id]);
          await workflowEvent(db, task, "node-failed", {node: task.node, code});
        });
        await progress(pool, {conversationId: task.conversation_id, runId: null, type: "workflow-updated", title: "任务未完成", detail: `当前节点已停止（${code}），实际进度保留。`});
      }
    } catch (error) { console.error(JSON.stringify({event: "workflow_worker_failed", code: (error as any).code || "FAILED"})); }
    finally { active = false; }
  }
  const timer = setInterval(() => void tick(), 600);
  return { stop: async () => { stopped = true; clearInterval(timer); while (active) await new Promise(r => setTimeout(r, 100)); } };
}
