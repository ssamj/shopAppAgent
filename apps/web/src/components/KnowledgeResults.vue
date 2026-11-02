<script setup lang="ts">
import type { KnowledgeSource } from "../../../../shared/knowledge";
defineProps<{ sources: KnowledgeSource[] }>();
</script>
<template>
  <details
    class="rounded-xl border bg-muted/20 px-4 py-2 text-sm"
    data-knowledge-results
  >
    <summary
      class="min-h-11 cursor-pointer py-3 font-medium focus-visible:outline-2 focus-visible:outline-ring"
    >
      检索资料 · {{ sources.length }} 个片段
    </summary>
    <p class="mb-3 text-xs leading-6 text-muted-foreground">
      教学示例资料。相关片段不一定包含问题的答案，具体结论请结合回答及引用查看。
    </p>
    <p v-if="!sources.length" class="py-2">本次没有检索到可用资料。</p>
    <details v-for="source in sources" :key="source.id" class="border-t py-2">
      <summary
        class="cursor-pointer py-3 leading-6 focus-visible:outline-2 focus-visible:outline-ring"
      >
        {{ source.title }} · {{ source.section }}
      </summary>
      <p class="mb-2 text-xs text-muted-foreground">
        版本 {{ source.version }} ·
        {{ source.scope === "general" ? "通用解释" : "具体商品说明" }}
      </p>
      <p class="whitespace-pre-wrap break-words text-sm leading-7">
        {{ source.text }}
      </p>
    </details>
  </details>
</template>
