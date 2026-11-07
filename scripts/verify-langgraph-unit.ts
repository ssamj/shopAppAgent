import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { MemorySaver, Command, type BaseCheckpointSaver } from "@langchain/langgraph";
import { replenishmentGraph, type GraphEffects, type GraphState } from "../apps/agent/langgraph-workflow.ts";
const checks: string[] = [];
const check = async (name: string, run: () => unknown) => {await run(); checks.push(name);};

export async function exerciseGraph(saver: BaseCheckpointSaver) {
  const calls: string[] = [], approvals: string[] = [];
  let stale = false;
  const effects: GraphEffects = {
    execute: async (node, state) => {
      calls.push(node);
      if (node === "analyze") return {status: "waiting_review", data: {report: {id: randomUUID()}, reportRevision: (state.data.reportRevision || 0) + 1}, detail: "明确标注的图路由夹具"};
      if (node === "prepare") return stale
        ? {status: "ready", node: "analyze", data: state.data, detail: "夹具：依据已变化"}
        : {status: "waiting_confirmation", data: {...state.data, actionId: "fixture-action"}, detail: "夹具：待确认"};
      return {status: "completed", data: {...state.data, purchaseId: "fixture-purchase"}, detail: "夹具：完成"};
    },
    authorize: async (state, kind, signal: any) => {
      assert.equal(signal.kind, kind); assert.equal(signal.taskId, state.taskId); approvals.push(kind);
    },
  };
  let graph = replenishmentGraph(saver, effects);
  const taskId = randomUUID(), options = {configurable: {thread_id: taskId}, durability: "sync" as const};
  await graph.invoke({taskId, data: {}, outcome: "", steps: 0}, options);
  await check("分析后图确实等待审核，采购准备尚未执行", async () => {assert.deepEqual(calls, ["analyze"]); assert.deepEqual((await graph.getState(options)).next, ["review"]);});
  graph = replenishmentGraph(saver, effects);
  await graph.invoke(new Command({resume: {kind: "review", taskId}}), options);
  await check("重建图后恢复同一检查点，分析不会重跑", async () => {assert.deepEqual(calls, ["analyze", "prepare"]); assert.deepEqual((await graph.getState(options)).next, ["confirmation"]);});
  await graph.invoke(new Command({resume: {kind: "confirmation", taskId}}), options);
  await check("第二次等待恢复后才查询结果并结束", async () => {assert.deepEqual(calls, ["analyze", "prepare", "reconcile"]); assert.deepEqual(approvals, ["review", "confirmation"]); assert.equal((await graph.getState(options)).values.data.purchaseId, "fixture-purchase"); assert.deepEqual((await graph.getState(options)).next, []);});
  const other = randomUUID(), next = {configurable: {thread_id: other}};
  stale = true;
  await graph.invoke({taskId: other, data: {}, outcome: "", steps: 0}, next);
  await graph.invoke(new Command({resume: {kind: "review", taskId: other}}), next);
  await check("依据变化通过图分支重新分析并再次等待审核", async () => {const s = await graph.getState(next); assert.deepEqual(s.next, ["review"]); assert.equal(s.values.data.reportRevision, 2);});
  await check("两个任务的检查点彼此隔离", async () => {assert.equal((await graph.getState(options)).values.data.purchaseId, "fixture-purchase"); assert.equal((await graph.getState(next)).values.data.purchaseId, undefined);});
  await check("错误审核信号明确失败", () => assert.rejects(graph.invoke(new Command({resume: {kind: "confirmation", taskId: other}}), next)));
  let failures = 0;
  const failure = replenishmentGraph(saver, {...effects, execute: async () => {failures++; throw Error("EXPLICIT_FIXTURE_FAILURE");}});
  await check("节点失败不隐藏重试也不伪造成功", async () => {await assert.rejects(failure.invoke({taskId: randomUUID(), data: {}, steps: 0, outcome: ""}, {configurable: {thread_id: randomUUID()}}), /EXPLICIT_FIXTURE_FAILURE/); assert.equal(failures, 1);});
  const noNeed = replenishmentGraph(saver, {...effects, execute: async () => ({status: "completed", data: {report: {units: 0}}, detail: "夹具：无需补货"})});
  const noNeedOptions = {configurable: {thread_id: randomUUID()}};
  await noNeed.invoke({taskId: randomUUID(), data: {}, steps: 0, outcome: ""}, noNeedOptions);
  await check("无需补货正常结束且不进入人工审核", async () => assert.deepEqual((await noNeed.getState(noNeedOptions)).next, []));
  const invalid = replenishmentGraph(saver, {...effects, execute: async () => ({status: "unregistered-state", data: {}, detail: "夹具"})});
  await check("非法节点结果拒绝进入后续步骤", () => assert.rejects(invalid.invoke({taskId: randomUUID(), data: {}, steps: 0, outcome: ""}, {configurable: {thread_id: randomUUID()}})));
  await check("业务节点次数有明确上限", () => assert.rejects(graph.invoke({taskId: randomUUID(), data: {}, steps: 12, outcome: ""}, {configurable: {thread_id: randomUUID()}})));
  return checks;
}

if (import.meta.url === new URL(process.argv[1], "file:///").href || process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/verify-langgraph-unit.ts")) {
  await exerciseGraph(new MemorySaver());
  mkdirSync("output", {recursive: true});
  writeFileSync("output/langgraph-unit-verification.json", JSON.stringify({status: "passed", fixtureEffects: true, realLangGraph: true, checks}, null, 2));
  console.log(JSON.stringify({status: "passed", checks: checks.length}));
}
