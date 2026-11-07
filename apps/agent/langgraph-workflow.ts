import { Annotation, StateGraph, START, END, interrupt, type BaseCheckpointSaver } from "@langchain/langgraph";
import { requireCondition as check } from "../../shared/db.ts";
import type { NodeResult } from "./workflows/replenishment.ts";

const State = Annotation.Root({
  taskId: Annotation<string>(),
  data: Annotation<Record<string, any>>(),
  outcome: Annotation<string>(),
  steps: Annotation<number>(),
});
export type GraphState = typeof State.State;
export type ResumeSignal = {kind: "review" | "confirmation"; taskId: string; version: number; eventId?: string; actionId?: string};
export interface GraphEffects {
  execute(node: "analyze" | "prepare" | "reconcile", state: GraphState): Promise<NodeResult>;
  authorize(state: GraphState, kind: ResumeSignal["kind"], signal: unknown): Promise<void>;
}

export function replenishmentGraph(checkpointer: BaseCheckpointSaver, effects: GraphEffects) {
  const execute = (node: "analyze" | "prepare" | "reconcile") => async (state: GraphState) => {
    check(state.steps < 12, "WORKFLOW_STEP_LIMIT", "任务业务节点次数已达到上限");
    const result = await effects.execute(node, state);
    check(node === "analyze" ? ["waiting_review", "completed"].includes(result.status)
      : node === "prepare" ? ["ready", "waiting_confirmation"].includes(result.status)
      : result.status === "completed", "GRAPH_RESULT_INVALID", "节点结果不能进入后续图节点");
    return {data: result.data, outcome: result.status, steps: state.steps + 1};
  };
  return new StateGraph(State)
    .addNode("analyze", execute("analyze"))
    .addNode("review", async state => {
      // This node restarts on resume: keep all side effects out of the interrupt node.
      const signal = interrupt({kind: "review", taskId: state.taskId, reportId: state.data.report.id, reportRevision: state.data.reportRevision});
      await effects.authorize(state, "review", signal);
      return {};
    })
    .addNode("prepare", execute("prepare"))
    .addNode("confirmation", async state => {
      const signal = interrupt({kind: "confirmation", taskId: state.taskId, actionId: state.data.actionId});
      await effects.authorize(state, "confirmation", signal);
      return {};
    })
    .addNode("reconcile", execute("reconcile"))
    .addEdge(START, "analyze")
    .addConditionalEdges("analyze", state => state.outcome === "completed" ? END : "review", [END, "review"])
    .addEdge("review", "prepare")
    .addConditionalEdges("prepare", state => state.outcome === "ready" ? "analyze" : "confirmation", ["analyze", "confirmation"])
    .addEdge("confirmation", "reconcile")
    .addEdge("reconcile", END)
    .compile({checkpointer});
}
