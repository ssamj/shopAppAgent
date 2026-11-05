import { randomUUID } from "node:crypto";
import type pg from "pg";
import { transaction, requireCondition as check } from "../../shared/db.ts";
import type { Identity } from "../../shared/security.ts";
import type { Workflow } from "../../shared/workflows.ts";
import { lockConversation } from "./actions.ts";

export async function workflowEvent(db: pg.PoolClient, task: Workflow, kind: string, detail: unknown = {}, key?: string) {
  await db.query("INSERT INTO agent.workflow_events(workflow_id,version,kind,detail,dedupe_key) VALUES($1,$2,$3,$4,$5)",
    [task.id, task.version, kind, JSON.stringify(detail), key || null]);
}
export async function enqueue(db: pg.PoolClient, task: Workflow) {
  await db.query("INSERT INTO agent.workflow_jobs(id,workflow_id,version,node) VALUES($1,$2,$3,$4) ON CONFLICT(workflow_id,version) DO NOTHING",
    [randomUUID(), task.id, task.version, task.node]);
}
export async function createWorkflow(pool: pg.Pool, conversationId: string, identity: Identity, name: string, goal: string) {
  return transaction(pool, async db => {
    await lockConversation(db, conversationId);
    const owned = await db.query("SELECT 1 FROM agent.conversations WHERE id=$1 AND account_id=$2", [conversationId, identity.id]);
    check(owned.rowCount && identity.role === "admin", "NOT_FOUND", "任务入口不存在");
    const task = (await db.query("INSERT INTO agent.workflows(id,conversation_id,account_id,name,goal,node,status) VALUES($1,$2,$3,$4,$5,'analyze','ready') RETURNING *",
      [randomUUID(), conversationId, identity.id, name, goal])).rows[0] as Workflow;
    await workflowEvent(db, task, "created", { goal });
    await enqueue(db, task);
    return task;
  });
}
export async function listWorkflows(pool: pg.Pool, conversationId: string, accountId: string) {
  const tasks = (await pool.query("SELECT * FROM agent.workflows WHERE conversation_id=$1 AND account_id=$2 ORDER BY created_at", [conversationId, accountId])).rows as Workflow[];
  for (const task of tasks) {
    task.events = (await pool.query("SELECT id::text,kind,version,detail,created_at FROM agent.workflow_events WHERE workflow_id=$1 ORDER BY id", [task.id])).rows;
    task.runs = (await pool.query("SELECT w.run_id,w.node,r.status FROM agent.workflow_runs w JOIN agent.runs r ON r.id=w.run_id WHERE workflow_id=$1 ORDER BY r.created_at", [task.id])).rows;
  }
  return tasks;
}
export async function signalWorkflow(pool: pg.Pool, id: string, identity: Identity, input: {version: number; decision: "approve" | "cancel"; eventId: string}) {
  return transaction(pool, async db => {
    const owner = (await db.query("SELECT conversation_id FROM agent.workflows WHERE id=$1 AND account_id=$2", [id, identity.id])).rows[0];
    check(owner, "NOT_FOUND", "任务不存在");
    await lockConversation(db, owner.conversation_id);
    const task = (await db.query("SELECT * FROM agent.workflows WHERE id=$1 AND account_id=$2 FOR UPDATE", [id, identity.id])).rows[0] as Workflow | undefined;
    check(task && identity.role === "admin", "NOT_FOUND", "任务不存在");
    const duplicate = (await db.query("SELECT detail FROM agent.workflow_events WHERE workflow_id=$1 AND dedupe_key=$2", [id, input.eventId])).rows[0];
    if (duplicate) {
      check(duplicate.detail.inputVersion === input.version && duplicate.detail.decision === input.decision, "SIGNAL_CONFLICT", "同一审核标识不能用于不同决定");
      return task;
    }
    check(task.version === input.version, "WORKFLOW_VERSION_CONFLICT", "任务版本已变化，请查看最新状态");
    check(input.decision === "approve" ? task.status === "waiting_review" : ["waiting_review", "waiting_confirmation"].includes(task.status), "WORKFLOW_STATE_CONFLICT", "当前任务不能接受该决定");
    if (input.decision === "cancel" && task.data.actionId) {
      const action = (await db.query("SELECT * FROM agent.actions WHERE id=$1 FOR UPDATE", [task.data.actionId])).rows[0];
      check(action && ["pending", "revision_failed"].includes(action.state), "ACTION_BUSY", "采购操作已推进，请先核对实际状态");
      await db.query("UPDATE agent.actions SET state='cancelled' WHERE id=$1", [action.id]);
    }
    task.status = input.decision === "approve" ? "ready" : "cancelled";
    if (input.decision === "approve") task.node = "prepare";
    task.version++;
    await db.query("UPDATE agent.workflows SET status=$2,node=$3,version=$4,updated_at=now() WHERE id=$1", [id, task.status, task.node, task.version]);
    await workflowEvent(db, task, "review-" + input.decision, { inputVersion: input.version, decision: input.decision, reportId: task.data.report?.id }, input.eventId);
    if (task.status === "ready") await enqueue(db, task);
    return task;
  });
}
// Called in the action completion transaction: persistence of the continuation does not depend on SSE delivery.
export async function continueAfterAction(db: pg.PoolClient, actionId: string) {
  const task = (await db.query("SELECT * FROM agent.workflows WHERE status='waiting_confirmation' AND data->>'actionId'=$1 FOR UPDATE", [actionId])).rows[0] as Workflow | undefined;
  if (!task) return;
  task.node = "reconcile"; task.status = "ready"; task.version++;
  await db.query("UPDATE agent.workflows SET node=$2,status=$3,version=$4,updated_at=now() WHERE id=$1", [task.id, task.node, task.status, task.version]);
  await workflowEvent(db, task, "purchase-confirmed", { actionId }, "action:" + actionId);
  await enqueue(db, task);
}
export async function stopAfterAction(pool: pg.Pool, actionId: string, status: "failed" | "cancelled") {
  await transaction(pool, async db => {
    const task = (await db.query("UPDATE agent.workflows SET status=$2,error_code=CASE WHEN $2='failed' THEN 'ACTION_FAILED' ELSE NULL END,version=version+1,updated_at=now() WHERE data->>'actionId'=$1 AND status='waiting_confirmation' RETURNING *", [actionId, status])).rows[0];
    if (task) await workflowEvent(db, task, "action-" + status, {actionId});
  });
}
