<script setup lang="ts">
import { computed, ref } from "vue";
import { ShoppingBag, ArrowUpRight } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import StatusBadge from "@/components/StatusBadge.vue";
import { currency } from "@/lib/api";
const props = defineProps<{
  rows: Record<string, any>[];
  disabled?: boolean;
}>();
const emit = defineEmits<{
  action: [name: string, row: Record<string, any>];
}>();
const selected = ref("all");
const filters = [
  { value: "all", label: "全部", statuses: [] },
  { value: "payment", label: "待付款", statuses: ["待付款"] },
  {
    value: "ongoing",
    label: "进行中",
    statuses: ["待发货", "已发货", "售后中"],
  },
  {
    value: "closed",
    label: "已结束",
    statuses: ["已完成", "已取消", "已退款"],
  },
];
const groups = computed(() =>
  filters.map((f) => ({
    ...f,
    rows: props.rows.filter(
      (r) => f.value === "all" || f.statuses.includes(r.status),
    ),
  })),
);
function items(row: Record<string, any>) {
  if (Array.isArray(row.items) && row.items.length) return row.items;
  // Older conversation snapshots predate structured order items.
  return String(row.products || "订单商品")
    .split("、")
    .map((product) => {
      const [name, specification] = product.split(" · ");
      return { name, specification };
    });
}
function count(row: Record<string, any>) {
  return Array.isArray(row.items)
    ? row.items.reduce((n: number, i: any) => n + Number(i.quantity), 0)
    : null;
}
</script>

<template>
  <Tabs v-model="selected" class="gap-3">
    <TabsList
      class="h-12 w-full rounded-xl bg-muted/80 p-1"
      aria-label="筛选订单状态"
    >
      <TabsTrigger
        v-for="group in groups"
        :key="group.value"
        :value="group.value"
        class="min-h-11 gap-1 px-1.5 text-xs data-[state=active]:bg-card data-[state=active]:text-primary"
      >
        {{ group.label
        }}<span class="text-[10px] tabular-nums opacity-65">{{
          group.rows.length
        }}</span>
      </TabsTrigger>
    </TabsList>
    <TabsContent
      v-for="group in groups"
      :key="group.value"
      :value="group.value"
      class="space-y-3 outline-none"
    >
      <article
        v-for="row in group.rows"
        :key="row.id"
        class="order-list-card overflow-hidden rounded-xl border bg-card"
      >
        <div
          class="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5"
        >
          <span class="text-xs text-muted-foreground"
            >{{ row.created }} 下单</span
          >
          <StatusBadge :status="row.status" />
        </div>
        <div class="space-y-3 px-4 pt-3.5">
          <div
            v-for="(item, index) in items(row)"
            :key="item.skuId || index"
            class="flex gap-3"
          >
            <div
              class="flex h-20 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted"
            >
              <img
                v-if="item.image"
                :src="item.image"
                :alt="item.name"
                class="h-full w-full object-cover"
                width="64"
                height="80"
                loading="lazy"
              />
              <ShoppingBag
                v-else
                class="size-6 text-muted-foreground/60"
                aria-hidden="true"
              />
            </div>
            <div class="min-w-0 flex-1 py-0.5">
              <h3 class="text-sm font-medium leading-6">{{ item.name }}</h3>
              <p class="mt-1 text-xs text-muted-foreground">
                {{
                  item.specification ||
                  [item.color, item.size ? `${item.size} 码` : ""]
                    .filter(Boolean)
                    .join(" / ")
                }}
              </p>
              <div
                v-if="item.quantity"
                class="mt-2 flex items-center justify-between text-xs text-muted-foreground"
              >
                <span>{{ currency(item.price) }}</span
                ><span>× {{ item.quantity }}</span>
              </div>
            </div>
          </div>
        </div>
        <div class="px-4 pb-3 pt-3">
          <div
            class="mb-3 flex flex-wrap items-baseline justify-end gap-x-2 gap-y-1"
          >
            <span class="text-xs text-muted-foreground"
              ><template v-if="count(row)">共 {{ count(row) }} 件 · </template
              >{{ row.status === "待付款" ? "待付" : "订单金额" }}</span
            >
            <span class="text-xl font-semibold tracking-tight tabular-nums">{{
              currency(row.total)
            }}</span>
          </div>
          <div
            class="flex items-center justify-between gap-2 border-t border-border/60 pt-2.5"
          >
            <Button
              variant="ghost"
              size="sm"
              class="-ml-2 h-11 px-2 text-xs text-muted-foreground"
              :disabled="disabled"
              @click="emit('action', 'orders_detail', row)"
              >详情<ArrowUpRight class="size-3.5"
            /></Button>
            <div class="flex flex-wrap justify-end gap-2">
              <Button
                v-if="row.status === '待付款'"
                variant="outline"
                class="h-11 px-3 text-xs"
                :disabled="disabled"
                @click="emit('action', 'orders_cancel', row)"
                >取消订单</Button
              >
              <Button
                v-if="['待发货', '已发货', '已完成'].includes(row.status)"
                variant="outline"
                class="h-11 px-3 text-xs"
                :disabled="disabled"
                @click="emit('action', 'aftersales_apply', row)"
                >申请售后</Button
              >
              <Button
                v-if="row.status === '待付款'"
                class="h-11 px-4 text-xs"
                :disabled="disabled"
                @click="emit('action', 'orders_pay', row)"
                >去付款</Button
              >
              <Button
                v-if="row.status === '已发货'"
                class="h-11 px-3 text-xs"
                :disabled="disabled"
                @click="emit('action', 'orders_receive', row)"
                >确认收货</Button
              >
              <span
                v-if="['已取消', '已退款'].includes(row.status)"
                class="font-mono text-[10px] text-muted-foreground"
                >{{ row.id }}</span
              >
            </div>
          </div>
        </div>
      </article>
      <div
        v-if="!group.rows.length"
        class="rounded-xl border border-dashed bg-card/60 px-5 py-9 text-center"
      >
        <ShoppingBag class="mx-auto mb-3 size-7 text-muted-foreground/60" />
        <p class="text-sm text-muted-foreground">
          当前查询结果中暂无{{ group.label }}订单
        </p>
        <Button variant="link" class="mt-2 h-11" @click="selected = 'all'"
          >查看全部订单</Button
        >
      </div>
    </TabsContent>
  </Tabs>
</template>
