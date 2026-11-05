export const workflowLabels: Record<string, string> = {
  analyze: "分析补货", prepare: "核对并准备采购", reconcile: "查验实际采购",
  waiting_review: "等待建议审核", waiting_confirmation: "等待采购确认",
  ready: "等待继续执行", running: "正在执行", completed: "任务已完成",
  cancelled: "任务已取消", failed: "任务未完成",
};
export interface Workflow {
  id: string; conversation_id: string; account_id: string; name: string; goal: string;
  node: string; status: string; version: number; error_code?: string;
  data: Record<string, any>; created_at: string; updated_at: string;
  events?: { id: string; kind: string; version: number; detail: any; created_at: string }[];
  runs?: { run_id: string; node: string; status: string }[];
}
