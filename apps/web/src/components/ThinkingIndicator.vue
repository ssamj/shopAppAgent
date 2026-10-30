<script setup lang="ts">
import { Sparkles } from "lucide-vue-next";
</script>

<template>
  <div class="py-1" role="status" aria-label="栖禾正在思考中，请稍候">
    <div
      class="inline-flex items-center gap-2.5 rounded-2xl rounded-tl-md border border-primary/10 bg-secondary/60 px-3.5 py-3"
    >
      <span
        class="flex size-7 shrink-0 items-center justify-center rounded-full bg-card text-primary"
        aria-hidden="true"
        ><Sparkles class="size-4"
      /></span>
      <span class="text-sm text-secondary-foreground" aria-hidden="true"
        >栖禾正在思考中<span class="thinking-dots" aria-hidden="true"
          ><span>.</span><span>.</span><span>.</span></span
        ></span
      >
    </div>
  </div>
</template>

<style scoped>
.thinking-dots {
  display: inline-flex;
  gap: 2px;
  padding-left: 3px;
}
.thinking-dots > span {
  display: inline-block;
  font-weight: 700;
  animation: thinking-dot 1.4s ease-in-out infinite;
}
.thinking-dots > span:nth-child(2) {
  animation-delay: 0.16s;
}
.thinking-dots > span:nth-child(3) {
  animation-delay: 0.32s;
}
@keyframes thinking-dot {
  0%,
  60%,
  100% {
    opacity: 0.35;
    transform: translateY(0);
  }
  30% {
    opacity: 1;
    transform: translateY(-3px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .thinking-dots > span {
    animation: none;
    opacity: 1;
  }
}
</style>
