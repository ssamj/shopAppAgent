<script setup lang="ts">
import { computed } from "vue";
import { MapPin, Truck, ShoppingBag } from "lucide-vue-next";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import StatusBadge from "@/components/StatusBadge.vue";
import { currency, type BusinessCard } from "@/lib/api";
const props = defineProps<{ card: BusinessCard; channel: string }>();
const fields = computed(() =>
  Object.fromEntries(props.card.details.map((d) => [d.label, d.value])),
);
const quantity = computed(() =>
  props.card.rows.reduce((n, r) => n + Number(r.quantity || 0), 0),
);
</script>

<template>
  <Card class="order-detail min-w-0 gap-0 overflow-hidden py-0 shadow-none">
    <CardHeader
      class="order-detail-heading relative gap-0 overflow-hidden border-b px-4 py-5 sm:px-6 sm:py-6"
    >
      <div class="flex flex-wrap items-start justify-between gap-x-5 gap-y-3">
        <div>
          <p class="mb-2 text-[10px] font-medium tracking-[.22em] opacity-65">
            QI HE / ORDER DETAILS
          </p>
          <div class="flex flex-wrap items-center gap-3">
            <CardTitle
              class="text-2xl font-semibold tracking-tight sm:text-[28px]"
              >订单详情</CardTitle
            ><StatusBadge v-if="fields['状态']" :status="fields['状态']" />
          </div>
          <p class="mt-2 font-mono text-[11px] opacity-65">
            {{ fields["订单号"] || card.referenceId }}
          </p>
        </div>
        <div class="min-w-0 sm:text-right">
          <p class="text-xs opacity-70">
            {{ fields["状态"] === "待付款" ? "待付金额" : "订单金额" }}
          </p>
          <p
            class="mt-1 text-[32px] font-semibold leading-none tracking-tight tabular-nums sm:text-[40px]"
          >
            {{ fields["总金额"] }}
          </p>
        </div>
      </div>
    </CardHeader>
    <CardContent class="p-0">
      <div class="grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section class="min-w-0 px-4 py-4 sm:px-6 sm:py-5">
          <div class="mb-4 flex items-center justify-between">
            <h3 class="text-sm font-semibold">商品明细</h3>
            <span class="text-xs text-muted-foreground"
              >共 {{ quantity }} 件</span
            >
          </div>
          <div class="divide-y divide-border/70">
            <div
              v-for="(item, index) in card.rows"
              :key="item.skuId || index"
              class="flex gap-3 py-4 first:pt-0 last:pb-0 sm:gap-4"
            >
              <div
                class="flex h-[120px] w-24 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted"
              >
                <img
                  v-if="item.image"
                  :src="item.image"
                  :alt="item.name"
                  width="96"
                  height="120"
                  class="h-full w-full object-cover"
                  loading="lazy"
                />
                <ShoppingBag
                  v-else
                  class="size-7 text-muted-foreground/50"
                  aria-hidden="true"
                />
              </div>
              <div class="flex min-w-0 flex-1 flex-col justify-between py-0.5">
                <div>
                  <h4 class="text-[15px] font-medium leading-6">
                    {{ item.name }}
                  </h4>
                  <p
                    class="mt-2 inline-flex rounded bg-muted px-2 py-1 text-xs text-muted-foreground"
                  >
                    {{ item.color }} / {{ item.size }} 码
                  </p>
                </div>
                <div class="mt-3 flex items-baseline justify-between gap-2">
                  <span class="text-lg font-semibold tabular-nums">{{
                    currency(item.price)
                  }}</span
                  ><span class="text-xs text-muted-foreground"
                    >× {{ item.quantity }}</span
                  >
                </div>
              </div>
            </div>
          </div>
        </section>
        <section
          class="space-y-5 border-t bg-muted/15 px-4 py-4 sm:px-6 sm:py-5 lg:border-t-0 lg:border-l"
        >
          <div class="flex gap-3">
            <MapPin
              class="mt-0.5 size-4 shrink-0 text-primary"
              aria-hidden="true"
            />
            <div class="min-w-0">
              <h3 class="text-xs text-muted-foreground">收货信息</h3>
              <p class="mt-2 text-sm font-medium">{{ fields["收货人"] }}</p>
              <p class="mt-1 text-[13px] leading-6 text-muted-foreground">
                {{ fields["收货地址"] }}
              </p>
            </div>
          </div>
          <div class="flex gap-3 border-t border-border/70 pt-4">
            <Truck
              class="mt-0.5 size-4 shrink-0 text-primary"
              aria-hidden="true"
            />
            <div class="min-w-0">
              <h3 class="text-xs text-muted-foreground">物流信息</h3>
              <p class="mt-2 break-words text-[13px] leading-6">
                {{ fields["物流"] }}
              </p>
            </div>
          </div>
          <p
            v-if="channel === 'admin' && fields['客户']"
            class="border-t border-border/70 pt-3 text-xs text-muted-foreground"
          >
            客户档案<span class="ml-3 font-medium text-foreground">{{
              fields["客户"]
            }}</span>
          </p>
        </section>
      </div>
    </CardContent>
  </Card>
</template>
