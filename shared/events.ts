export type ProgressType =
  | "workflow-updated"
  | "plan-updated"
  | "run-started"
  | "analysis-started"
  | "analysis-summary"
  | "tool-started"
  | "tool-completed"
  | "tool-failed"
  | "confirmation-required"
  | "run-completed"
  | "run-failed"
  | "action-started"
  | "action-completed"
  | "action-failed"
  | "action-cancelled";
export interface ProgressEvent {
  id: string;
  conversationId: string;
  runId: string | null;
  type: ProgressType;
  title: string;
  detail: string;
  occurredAt: string;
  step?: number;
  toolId?: string;
  actionId?: string;
  durationMs?: number;
  count?: number;
  streaming?: boolean;
  plan?: import("./planning.ts").TaskPlanState;
}
export type ProgressInput = Omit<ProgressEvent, "id" | "occurredAt">;
