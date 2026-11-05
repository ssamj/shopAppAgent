<script setup lang="ts">
import { computed, ref } from "vue";
import { GitBranch, Check, CircleAlert } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { workflowLabels, type Workflow } from "../../../../shared/workflows";
import { currency } from "@/lib/api";
const props = defineProps<{task: Workflow; disabled: boolean}>();
const emit = defineEmits<{signal: [id: string, version: number, decision: "approve" | "cancel", eventId: string]}>();
const eventId = ref(crypto.randomUUID());
const canDecide = computed(() => ["waiting_review", "waiting_confirmation"].includes(props.task.status));
const nodeNames = ["分析补货", "建议审核", "准备采购", "采购确认", "查验完成"];
const stage = computed(() => props.task.status === "completed" ? 5 : props.task.status === "waiting_review" ? 1 : props.task.status === "waiting_confirmation" ? 3 : props.task.node === "reconcile" ? 4 : props.task.node === "prepare" ? 2 : 0);
function send(decision: "approve" | "cancel") {
  emit("signal", props.task.id, props.task.version, decision, eventId.value);
  eventId.value = crypto.randomUUID();
}
</script>
<template>
  <section class="rounded-xl border bg-background p-4 space-y-4" data-workflow-card :data-workflow-status="task.status" aria-label="补货采购任务">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-2"><GitBranch class="size-4 text-primary" aria-hidden="true" /><h3 class="font-semibold">补货采购任务</h3></div>
      <span class="rounded-full bg-secondary px-3 py-1 text-xs" role="status">{{workflowLabels[task.status] || task.status}}</span>
    </header>
    <ol class="grid grid-cols-5 gap-2 text-center text-xs" aria-label="任务流程">
      <li v-for="(label,index) in nodeNames" :key="label" :class="['rounded-lg px-1 py-3 leading-5', index < stage ? 'bg-primary/10 text-primary' : index === stage ? 'bg-secondary font-semibold' : 'bg-muted/50 text-muted-foreground']">
        <Check v-if="index < stage" class="mx-auto mb-1 size-3.5" aria-hidden="true" />{{label}}
      </li>
    </ol>
    <p class="text-sm leading-6">{{task.status === 'waiting_review' ? '分析结果与任务进度已保存。同意建议后继续准备采购草稿，创建采购单仍需你确认。' : task.status === 'waiting_confirmation' ? '采购草稿已准备，请在采购确认卡核对数量与金额。确认完成后，任务将继续查询实际单据。' : task.status === 'completed' ? (task.data.purchaseId ? '已创建并查询实际采购单，整项任务已完成。' : '本次检查无需补货，任务已完成。') : task.status === 'failed' ? '任务在当前节点停止，已保存实际进度与失败原因。' : task.status === 'cancelled' ? '任务已取消，不再继续执行。' : '正在根据已保存的进度执行当前步骤。'}}</p>
    <div v-if="task.data.report" class="flex flex-wrap gap-x-5 gap-y-2 rounded-lg bg-muted/40 px-3 py-3 text-sm">
      <span>建议第 {{task.data.reportRevision}} 版</span><span>{{task.data.report.units}} 件</span><span>{{currency(task.data.report.amount)}}</span>
    </div>
    <p v-if="task.data.invalidation" class="text-sm text-amber-700">此前审核依据已失效，当前建议需要重新审核。</p>
    <p v-if="task.data.purchaseId" class="text-sm font-medium">实际采购单：{{task.data.purchaseId}}</p>
    <p v-if="task.error_code" class="flex items-center gap-2 text-sm text-destructive"><CircleAlert class="size-4" aria-hidden="true" />{{task.error_code}}</p>
    <div v-if="canDecide" class="flex flex-wrap gap-3">
      <Button v-if="task.status === 'waiting_review'" class="min-h-11" :disabled="disabled" @click="send('approve')">同意建议，准备采购草稿</Button>
      <Button variant="outline" class="min-h-11" :disabled="disabled" @click="send('cancel')">取消任务</Button>
    </div>
    <details class="border-t pt-3 text-xs leading-6 text-muted-foreground"><summary class="cursor-pointer focus-visible:outline-2">查看任务进度</summary>
      <p class="mt-2">已保存 {{task.runs?.length || 0}} 次执行记录</p>
      <ol><li v-for="entry in task.events" :key="entry.id">{{entry.detail.detail || ({created:'任务建立','node-started':'开始执行节点','review-approve':'建议审核通过','review-cancel':'任务取消','purchase-confirmed':'采购确认完成','node-failed':'节点执行失败'} as Record<string,string>)[entry.kind] || entry.kind}}<span v-if="entry.detail.node"> · {{workflowLabels[entry.detail.node]}}</span></li></ol>
    </details>
  </section>
</template>
