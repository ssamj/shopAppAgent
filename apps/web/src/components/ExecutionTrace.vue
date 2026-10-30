<script setup lang="ts">
import { computed, ref, watch, nextTick, useId } from "vue";
import {
  BrainCircuit,
  ChevronDown,
  Check,
  LoaderCircle,
  CircleAlert,
  CirclePause,
  Sparkles,
} from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import type { ProgressEvent } from "@/lib/events";
const props = defineProps<{
  events: ProgressEvent[];
  running?: boolean;
  connection?: string;
  timestamp?: string;
}>();
const expanded = ref(Boolean(props.running)),
  body = ref<HTMLElement>();
const contentId = useId();
const terminal = computed(() =>
  [...props.events]
    .reverse()
    .find((e) => e.type === "run-completed" || e.type === "run-failed"),
);
const active = computed(() => Boolean(props.running) && !terminal.value);
watch(active, (running) => {
  expanded.value = running;
});
const steps = computed(() => {
  const map = new Map<
    string,
    ProgressEvent & { state: string; kind: string }
  >();
  for (const event of props.events) {
    if (
      event.type === "run-started" ||
      event.type === "run-completed" ||
      event.type === "run-failed"
    )
      continue;
    const kind = event.type.startsWith("analysis") ? "analysis" : "tool";
    const priorActionKey =
      event.actionId &&
      [...map.entries()].find(
        ([, value]) => value.actionId === event.actionId,
      )?.[0];
    const key =
      kind === "analysis"
        ? `analysis-${event.runId}-${event.step}`
        : priorActionKey || event.toolId || event.actionId || event.id;
    let state = event.type.endsWith("failed")
      ? "failed"
      : event.type === "confirmation-required"
        ? "waiting"
        : event.type.endsWith("started") || event.streaming
          ? "running"
          : "done";
    if (
      !props.running &&
      terminal.value?.type === "run-failed" &&
      state === "running"
    )
      state = "failed";
    map.set(key, { ...event, state, kind });
  }
  return [...map.values()];
});
const duration = (ms?: number) =>
  ms === undefined
    ? ""
    : ms < 1000
      ? `${ms} ms`
      : `${(ms / 1000).toFixed(1)} 秒`;
watch(
  () => props.events.at(-1)?.id,
  async () => {
    const nearBottom =
      !body.value ||
      body.value.scrollHeight - body.value.scrollTop - body.value.clientHeight <
        70;
    await nextTick();
    if (body.value && nearBottom)
      body.value.scrollTop = body.value.scrollHeight;
  },
);
</script>

<template>
  <section class="mb-2 min-w-0" aria-label="业务助手回复">
    <div class="flex min-h-8 flex-wrap items-center gap-2">
      <span
        class="flex size-6 items-center justify-center rounded-md border bg-background"
        ><Sparkles class="size-3"
      /></span>
      <span class="text-xs font-medium">业务助手</span>
      <span v-if="timestamp" class="text-[10px] text-muted-foreground">{{
        timestamp
      }}</span>
      <Button
        v-if="events.length || running"
        variant="ghost"
        class="h-8 gap-1.5 px-2 text-xs font-normal text-muted-foreground hover:text-primary"
        :aria-expanded="expanded"
        :aria-controls="contentId"
        @click="expanded = !expanded"
      >
        <LoaderCircle v-if="active" class="size-3 animate-spin" />
        <span>{{ expanded ? "收起推理" : "展开推理" }}</span>
        <ChevronDown
          class="size-3 transition-transform"
          :class="expanded ? 'rotate-180' : ''"
        />
      </Button>
    </div>
    <div
      v-if="expanded"
      :id="contentId"
      ref="body"
      class="mt-2 max-h-80 overflow-y-auto rounded-lg border border-primary/10 bg-secondary/20 px-3 py-3 scrollbar-thin sm:px-4"
      role="region"
      aria-label="推理过程"
    >
      <p v-if="!steps.length" class="py-1 text-xs text-muted-foreground">
        已接收请求，正在准备分析。
      </p>
      <ol class="space-y-0">
        <li
          v-for="(step, index) in steps"
          :key="`${step.kind}-${step.toolId || step.actionId || step.step}`"
          class="relative flex gap-3 pb-4 last:pb-0"
        >
          <span
            v-if="index < steps.length - 1"
            class="absolute top-6 bottom-0 left-[9px] border-l border-primary/15"
            aria-hidden="true"
          />
          <span
            class="relative z-10 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-primary"
            :class="step.state === 'failed' ? 'text-destructive' : ''"
            ><LoaderCircle
              v-if="step.state === 'running'"
              class="size-3 animate-spin" /><CircleAlert
              v-else-if="step.state === 'failed'"
              class="size-3" /><CirclePause
              v-else-if="step.state === 'waiting'"
              class="size-3" /><BrainCircuit
              v-else-if="step.kind === 'analysis'"
              class="size-3" /><Check v-else class="size-3"
          /></span>
          <div class="min-w-0 flex-1">
            <div
              class="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5"
            >
              <span class="text-xs font-semibold leading-5">{{
                step.title
              }}</span
              ><span
                v-if="step.durationMs !== undefined && !step.streaming"
                class="text-[10px] tabular-nums text-muted-foreground"
                >{{ duration(step.durationMs) }}</span
              >
            </div>
            <p
              class="mt-1 whitespace-pre-wrap break-words text-xs leading-6 text-muted-foreground"
            >
              {{ step.detail
              }}<span
                v-if="step.streaming && running"
                class="ml-1 inline-block h-3 w-0.5 animate-pulse bg-primary"
                aria-hidden="true"
              />
            </p>
          </div>
        </li>
      </ol>
      <p
        v-if="terminal?.type === 'run-failed'"
        class="mt-3 border-t pt-3 text-xs leading-6 text-destructive"
      >
        {{ terminal.detail }}
      </p>
      <p
        v-if="active && connection !== 'connected'"
        role="status"
        class="mt-3 border-t pt-3 text-xs text-muted-foreground"
      >
        {{
          connection === "reconnecting"
            ? "实时连接暂时中断，正在续接已保存的进度…"
            : "正在连接实时进度…"
        }}
      </p>
    </div>
  </section>
</template>
