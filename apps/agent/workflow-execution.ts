import { randomUUID } from "node:crypto";
import type pg from "pg";
import { transaction, requireCondition as check } from "../../shared/db.ts";
import { config } from "../../shared/config.ts";
import type { Workflow } from "../../shared/workflows.ts";
import type { Identity } from "../../shared/security.ts";
import { run, type RunScope } from "./runtime.ts";

// Both orchestration engines use the existing model/tool loop and its business checks.
export function workflowExecution(pool: pg.Pool, task: Workflow, identity: Identity) {
  return async (scope: RunScope) => {
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
}
