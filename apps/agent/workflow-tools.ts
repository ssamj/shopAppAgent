import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type pg from "pg";
import type { Identity } from "../../shared/security.ts";
import { config } from "../../shared/config.ts";
import { requireCondition as check } from "../../shared/db.ts";
import type { Definition } from "./business.ts";
import type { Result } from "../business/contracts.ts";
import { createWorkflow } from "./workflow-store.ts";
export const workflowCatalog = [{ name: "replenishment_purchase", description: "按公司规则分析补货，等待建议审核，审核通过才准备单供应商采购草稿，用户确认写入以后继续查询实际采购并收尾。用户明确提出审核后继续采购时使用；只要建议单时沿用只读补货工具。" }];
export function localWorkflowTools(pool: pg.Pool, conversationId: string, identity: Identity) {
  if (!config().workflows?.enabled || identity.role !== "admin") return [];
  const input = Type.Object({ workflow: Type.String({ enum: workflowCatalog.map(x => x.name) }) }, { additionalProperties: false });
  const definition: Definition = { name: "workflow_start", module: "agent", label: "建立补货采购任务", description: "启动持久业务任务，后续工具调用和人工等待由任务推进。返回建立状态后结束当前运行，不再自行执行后续步骤。可用流程：" + JSON.stringify(workflowCatalog), roles: ["admin"], write: false, input };
  return [{ definition, handoff: true, execute: async (args: Record<string, unknown>): Promise<Result> => {
    check(Value.Check(input, args) && workflowCatalog.some(item => item.name === args.workflow), "INVALID_ARGUMENTS", "工作流参数不合法");
    const message = (await pool.query("SELECT content FROM agent.messages WHERE conversation_id=$1 AND role='user' ORDER BY created_at DESC,id DESC LIMIT 1", [conversationId])).rows[0];
    check(message, "WORKFLOW_SOURCE_MISSING", "缺少当前用户任务");
    const task = await createWorkflow(pool, conversationId, identity, args.workflow as string, message.content);
    return { title: "补货采购任务已建立", view: "detail", columns: [], rows: [], details: [{label: "状态", value: "开始分析补货，随后等待建议审核"}], referenceId: task.id, summary: "已建立补货采购任务。先生成建议供你审核，同意后再准备采购草稿；创建采购单仍需你确认。" };
  }}];
}
