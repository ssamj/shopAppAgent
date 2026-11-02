<script setup lang="ts">
import { computed } from "vue";
import { currency, type BusinessCard } from "@/lib/api";
import KnowledgeResults from "./KnowledgeResults.vue";
const props = defineProps<{ card: BusinessCard }>();
const report = computed(() => props.card.replenishment!);
const exceptions = computed(() =>
  report.value.audit.filter(
    (r) => r.quantity === 0 && r.available < report.value.rule.triggerBelow,
  ),
);
</script>
<template>
  <section
    class="overflow-hidden rounded-xl border bg-background"
    data-replenishment-report
    aria-label="智能补货单"
  >
    <header
      class="flex flex-wrap items-center justify-between gap-3 border-b bg-primary/5 px-4 py-4"
    >
      <div>
        <p class="text-xs text-muted-foreground">规则驱动 · 全量检查</p>
        <h3 class="mt-1 text-lg font-semibold">智能补货单</h3>
      </div>
      <span class="rounded-full bg-secondary px-3 py-1 text-sm font-medium">{{
        report.state
      }}</span>
    </header>
    <div class="space-y-4 p-4">
      <dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <dt class="text-xs text-muted-foreground">检查规格</dt>
          <dd class="mt-1 text-xl font-semibold">{{ report.totalSkus }}</dd>
        </div>
        <div>
          <dt class="text-xs text-muted-foreground">需补规格</dt>
          <dd class="mt-1 text-xl font-semibold">{{ report.suggestedSkus }}</dd>
        </div>
        <div>
          <dt class="text-xs text-muted-foreground">建议件数</dt>
          <dd class="mt-1 text-xl font-semibold">{{ report.units }}</dd>
        </div>
        <div>
          <dt class="text-xs text-muted-foreground">预计金额</dt>
          <dd class="mt-1 text-xl font-semibold">
            {{ currency(report.amount) }}
          </dd>
        </div>
      </dl>
      <p class="rounded-lg bg-muted/50 px-3 py-3 text-sm leading-6">
        可用 + 在途 &lt; {{ report.rule.triggerBelow }} 件时，补到
        {{ report.rule.target }} 件。下架规格排除。
      </p>
      <p v-if="!report.suppliers.length" class="py-2 text-sm">
        本次检查无需补货，完整检查记录保留在下方。
      </p>
      <section
        v-for="group in report.suppliers"
        :key="group.id"
        class="space-y-2"
      >
        <div class="flex flex-wrap justify-between gap-2 text-sm">
          <h4 class="font-semibold">{{ group.name }}</h4>
          <span>{{ group.units }} 件 · {{ currency(group.amount) }}</span>
        </div>
        <article
          v-for="row in report.audit.filter(
            (r) => r.supplierId === group.id && r.quantity > 0,
          )"
          :key="row.skuId"
          class="rounded-lg border p-3"
          data-replenishment-item
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-sm font-medium">{{ row.name }}</p>
              <p class="mt-1 text-xs text-muted-foreground">
                {{ row.color }} / {{ row.size }}
              </p>
            </div>
            <strong class="shrink-0 text-primary"
              >补 {{ row.quantity }} 件</strong
            >
          </div>
          <p class="mt-2 text-sm">
            可用 {{ row.available }} + 在途 {{ row.incoming }} =
            {{ row.position }} 件
          </p>
          <p class="mt-1 text-xs leading-6 text-muted-foreground">
            {{ row.reason }} · {{ report.rule.target }} − {{ row.position }} =
            {{ row.quantity }} 件 · {{ currency(row.amount) }}
          </p>
        </article>
      </section>
      <details
        v-if="exceptions.length"
        class="rounded-lg border px-3"
        data-replenishment-exclusions
      >
        <summary
          class="cursor-pointer py-3 text-sm font-medium focus-visible:outline-2"
        >
          库存偏低但未补货 · {{ exceptions.length }} 个规格
        </summary>
        <div
          v-for="row in exceptions"
          :key="row.skuId"
          class="border-t py-3 text-sm leading-6"
        >
          <strong>{{ row.name }} · {{ row.color }} / {{ row.size }}</strong>
          <p>
            可用 {{ row.available }} + 在途 {{ row.incoming }} =
            {{ row.position }} 件
          </p>
          <p class="text-muted-foreground">{{ row.reason }}</p>
        </div>
      </details>
      <KnowledgeResults :sources="card.sources || []" />
      <details class="rounded-lg border px-3">
        <summary class="cursor-pointer py-3 text-sm focus-visible:outline-2">
          查看全部 {{ report.totalSkus }} 个规格检查记录
        </summary>
        <div class="max-h-64 overflow-auto">
          <p
            v-for="row in report.audit"
            :key="row.skuId"
            class="border-t py-2 text-xs leading-6"
          >
            {{ row.name }} · {{ row.color }} / {{ row.size }} ｜ 可用
            {{ row.available }} · 在途 {{ row.incoming }} · 建议
            {{ row.quantity }} ｜ {{ row.reason }}
          </p>
        </div>
      </details>
      <p class="text-xs leading-6 text-muted-foreground">
        {{ report.ruleTitle }} v{{ report.ruleVersion }} ·
        教学示例规则。结果仅供审核，未创建采购订单。按本次快照计算，后续采购前仍需重新核对。
      </p>
    </div>
  </section>
</template>
