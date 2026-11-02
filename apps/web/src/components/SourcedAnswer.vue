<script setup lang="ts">
import { ref } from "vue";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type {
  KnowledgeSource,
  SourcedAnswer,
} from "../../../../shared/knowledge";
const props = defineProps<{ answer: SourcedAnswer }>();
const active = ref<{ source: KnowledgeSource } | null>(null);
function open(sourceId: string) {
  const source = props.answer.sources.find((s) => s.id === sourceId);
  if (source) active.value = { source };
}
const number = (id: string) =>
  props.answer.sources.findIndex((s) => s.id === id) + 1;
</script>
<template>
  <div class="mb-4 space-y-4" data-sourced-answer>
    <div v-for="(block, i) in answer.blocks" :key="i" class="min-w-0">
      <p class="text-sm conversation-text">{{ block.text }}</p>
      <div v-if="block.citations.length" class="mt-1 flex flex-wrap gap-2">
        <button
          v-for="citation in block.citations"
          :key="citation.sourceId"
          type="button"
          class="min-h-11 rounded-md border bg-muted/40 px-3 text-xs text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          :aria-label="`来源 ${number(citation.sourceId)}：查看护理原文`"
          @click="open(citation.sourceId)"
        >
          来源 {{ number(citation.sourceId) }} · 查看原文
        </button>
      </div>
    </div>
    <p class="text-xs text-muted-foreground">
      依据为教学样例商品资料，不代表真实商品洗标。
    </p>
  </div>
  <Dialog
    :open="Boolean(active)"
    @update:open="
      (value) => {
        if (!value) active = null;
      }
    "
  >
    <DialogContent
      v-if="active"
      class="max-h-[85dvh] overflow-y-auto sm:max-w-xl"
      data-source-dialog
    >
      <DialogHeader>
        <DialogTitle class="pr-6 leading-7">{{
          active.source.title
        }}</DialogTitle>
        <DialogDescription
          >{{ active.source.section }} · 版本 {{ active.source.version }} ·
          教学示例资料</DialogDescription
        >
      </DialogHeader>
      <div class="space-y-4 text-sm leading-7">
        <div>
          <p class="mb-2 font-medium">条款原文</p>
          <blockquote
            class="rounded-md border-l-4 border-primary bg-muted/50 px-4 py-3 whitespace-pre-wrap break-words"
          >
            {{ active.source.text }}
          </blockquote>
        </div>
        <p class="text-xs leading-6 text-muted-foreground">
          {{
            active.source.scope === "product"
              ? "适用范围：标题所示商品。"
              : "适用范围：通用解释，不能替代具体商品说明。"
          }}这里保留回答生成时的原文版本。
        </p>
      </div>
    </DialogContent>
  </Dialog>
</template>
