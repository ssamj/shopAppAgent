import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { config } from "../shared/config.ts";
import { database } from "../shared/db.ts";
import { createWorkflow, signalWorkflow, listWorkflows, continueAfterAction } from "../apps/agent/workflow-store.ts";
import { transaction } from "../shared/db.ts";
import {decide} from "../apps/agent/model.ts";
import {localWorkflowTools} from "../apps/agent/workflow-tools.ts";
import { approvedPurchase, assertApprovedArguments } from "../apps/agent/workflows/replenishment.ts";
const cfg = config();
assert.ok(cfg.database.database.includes("episode07") && process.env.QIHE_ALLOW_WRITE_TESTS === "1", "Explicit isolated episode07 configuration required");
const pool = database("agent"), checks: string[] = [], taskIds: string[] = [];
const identity = {id: "U001", name: "隔离测试店长", role: "admin" as const, customerId: null};
const check = async (name: string, action: () => any) => { await action(); checks.push(name); };
async function fixture() {
  const conversationId = randomUUID();
  await pool.query("INSERT INTO agent.conversations(id,account_id) VALUES($1,$2)", [conversationId, identity.id]);
  const task = await createWorkflow(pool, conversationId, identity, "replenishment_purchase", "明确标注的存储夹具，不调用模型或业务写入");
  taskIds.push(task.id); return task;
}
try {
  const originalFetch = globalThis.fetch;
  const validContent = JSON.stringify({analysisSummary:"查询确认结果",message:"",calls:[{name:"purchases_detail",arguments:{id:"fixture"}}]});
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({choices:[{message:{content:validContent},finish_reason:"stop"}]}),{headers:{"content-type":"application/json"}});
    await check("完整JSON模型响应保持原值", async () => assert.equal((await decide([],undefined,{type:"json_schema"},false)).calls[0].arguments.id,"fixture"));
    globalThis.fetch = async () => new Response(JSON.stringify({choices:[{message:{content:validContent}}]}),{headers:{"content-type":"application/json"}});
    await check("缺少完成标记明确失败", () => assert.rejects(decide([],undefined,{type:"json_schema"},false)));
    globalThis.fetch = async () => new Response(JSON.stringify({choices:[{message:{content:'{"calls":'},finish_reason:"stop"}]}),{headers:{"content-type":"application/json"}});
    await check("坏JSON不被自动修补", () => assert.rejects(decide([],undefined,{type:"json_schema"},false)));
  } finally { globalThis.fetch=originalFetch; }
  const report = {id: "snapshot-fixture", audit: [{skuId: "sku-a", quantity: 8}], suppliers: [{id: "supplier-a"}]};
  await check("未注册流程在建立任务前被拒绝", () => assert.rejects(localWorkflowTools(pool,randomUUID(),identity)[0].execute({workflow:"unregistered"})));
  const expected = approvedPurchase(report);
  await check("审核明细必须完全一致", () => assert.doesNotThrow(() => assertApprovedArguments({...expected}, expected)));
  await check("修改数量被拒绝", () => assert.throws(() => assertApprovedArguments({...expected,items:[{skuId:"sku-a",quantity:9}]}, expected)));
  await check("旧引用被拒绝", () => assert.throws(() => assertApprovedArguments({...expected,replenishmentSnapshotId:"old"}, expected)));
  await check("首版范围拒绝多供应商", () => assert.throws(() => approvedPurchase({...report,suppliers:[{id:"a"},{id:"b"}]})));
  const task = await fixture();
  await check("建立任务同时保存待办", async () => assert.equal((await pool.query("SELECT count(*)::int n FROM agent.workflow_jobs WHERE workflow_id=$1", [task.id])).rows[0].n, 1));
  await check("尚未等待审核时不能批准", () => assert.rejects(signalWorkflow(pool, task.id, identity, {version:1,decision:"approve",eventId:randomUUID()})));
  await pool.query("UPDATE agent.workflows SET status='waiting_review',data=$2 WHERE id=$1", [task.id, JSON.stringify({report:{id:"report-fixture"}})]);
  const eventId = randomUUID();
  const input = {version:1,decision:"approve" as const,eventId};
  await check("同一审核并发仅推进一次", async () => { const out = await Promise.all([signalWorkflow(pool,task.id,identity,input),signalWorkflow(pool,task.id,identity,input)]); assert.equal(out[0].version,2);assert.equal(out[1].version,2);assert.equal((await pool.query("SELECT count(*)::int n FROM agent.workflow_jobs WHERE workflow_id=$1 AND version=2",[task.id])).rows[0].n,1); });
  await check("同一审核标识不能改决定", () => assert.rejects(signalWorkflow(pool,task.id,identity,{...input,decision:"cancel"})));
  await check("过时审核版本被拒绝", () => assert.rejects(signalWorkflow(pool,task.id,identity,{...input,eventId:randomUUID()})));
  await check("跨账号隔离", async () => {assert.equal((await listWorkflows(pool,task.conversation_id,"U002")).length,0);await assert.rejects(signalWorkflow(pool,task.id,{...identity,id:"U002"},{...input,eventId:randomUUID()}));});
  const saved = (await listWorkflows(pool,task.conversation_id,identity.id))[0];
  await check("重新加载保留任务节点与审核记录", () => {assert.equal(saved.node,"prepare"); assert.ok(saved.events?.some(x=>x.kind==="review-approve"));});
  const cancelled = await fixture();
  await pool.query("UPDATE agent.workflows SET status='waiting_review' WHERE id=$1",[cancelled.id]);
  await check("取消后不能继续", async () => {await signalWorkflow(pool,cancelled.id,identity,{version:1,decision:"cancel",eventId:randomUUID()});await assert.rejects(signalWorkflow(pool,cancelled.id,identity,{version:2,decision:"approve",eventId:randomUUID()}));});
  const linked = await fixture();
  await pool.query("UPDATE agent.workflows SET status='waiting_confirmation',data=$2 WHERE id=$1",[linked.id,JSON.stringify({actionId:"action-fixture"})]);
  await check("操作完成通知和续跑待办事务去重", async () => {await transaction(pool,db=>continueAfterAction(db,"action-fixture"));await transaction(pool,db=>continueAfterAction(db,"action-fixture"));const row=(await pool.query("SELECT * FROM agent.workflows WHERE id=$1",[linked.id])).rows[0];assert.equal(row.node,"reconcile");assert.equal(row.version,2);assert.equal((await pool.query("SELECT count(*)::int n FROM agent.workflow_jobs WHERE workflow_id=$1 AND version=2",[linked.id])).rows[0].n,1);});
  console.log(JSON.stringify({status:"passed",checks:checks.length}));
} finally {
  await pool.query("UPDATE agent.workflows SET status='cancelled' WHERE id=ANY($1::uuid[])",[taskIds]);
  await pool.query("UPDATE agent.workflow_jobs SET status='failed',finished_at=now() WHERE workflow_id=ANY($1::uuid[]) AND status='pending'",[taskIds]);
  mkdirSync("output",{recursive:true});writeFileSync("output/workflow-storage-verification.json",JSON.stringify({isolated:true,modelFixtures:true,checks,taskIds},null,2));
  await pool.end();
}
