<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowUpRight, ShoppingBag, PackageSearch } from "lucide-vue-next";
import { currency, type BusinessCard } from "@/lib/api";
import StatusBadge from "@/components/StatusBadge.vue";
import OrderList from "@/components/OrderList.vue";
import OrderDetail from "@/components/OrderDetail.vue";
import KnowledgeResults from "@/components/KnowledgeResults.vue";
import ReplenishmentCard from "@/components/ReplenishmentCard.vue";
const props = defineProps<{
  card: BusinessCard;
  channel: string;
  disabled?: boolean;
  compact?: boolean;
}>();
const emit = defineEmits<{
  action: [name: string, row: Record<string, any>];
}>();
function format(value: any, format?: string) {
  if (format === "money") return currency(value);
  if (format === "boolean" || typeof value === "boolean")
    return value ? "是" : "否";
  return value ?? "—";
}
function actions(row: Record<string, any>) {
  const cap = props.card.capability;
  if (cap === "orders_list")
    return [
      { name: "orders_detail", label: "详情" },
      ...(row.status === "待付款"
        ? [
            { name: "orders_pay", label: "付款" },
            { name: "orders_cancel", label: "取消" },
          ]
        : []),
      ...(row.status === "待发货" && props.channel === "admin"
        ? [{ name: "orders_ship", label: "发货" }]
        : []),
      ...(row.status === "已发货"
        ? [{ name: "orders_receive", label: "收货" }]
        : []),
      ...(["待发货", "已发货", "已完成"].includes(row.status)
        ? [{ name: "aftersales_apply", label: "售后" }]
        : []),
    ];
  if (cap === "inventory_list")
    return [{ name: "purchases_create", label: "补货" }];
  if (cap === "purchases_list")
    return [
      { name: "purchases_detail", label: "详情" },
      ...(row.status === "待到货"
        ? [{ name: "purchases_receive", label: "入库" }]
        : []),
      ...(!row.paid ? [{ name: "purchases_pay", label: "付款" }] : []),
    ];
  if (cap === "aftersales_list" && props.channel === "admin")
    return row.status === "待审核"
      ? [{ name: "aftersales_review", label: "审核" }]
      : row.status === "待退货"
        ? [{ name: "aftersales_receive", label: "收货" }]
        : row.status === "待退款"
          ? [{ name: "aftersales_refund", label: "退款" }]
          : [];
  if (cap === "products_detail" && props.channel === "shop")
    return [{ name: "buy_sku", label: "选购" }];
  return [];
}
</script>
<template>
  <ReplenishmentCard v-if="card.view === 'replenishment'" :card="card" />
  <KnowledgeResults
    v-else-if="card.view === 'knowledge'"
    :sources="card.sources || []"
  />
  <OrderDetail
    v-else-if="card.capability === 'orders_detail'"
    :card="card"
    :channel="channel"
  />
  <Card
    v-else
    class="business-result min-w-0 gap-0 overflow-hidden py-0 shadow-none"
    :class="
      card.capability === 'orders_list' && channel === 'shop'
        ? 'border-0 bg-transparent'
        : ''
    "
  >
    <CardHeader
      class="gap-1 px-4 py-3"
      :class="
        card.capability === 'orders_list' && channel === 'shop'
          ? 'px-0 pt-0 pb-3'
          : 'border-b bg-muted/30'
      "
      ><div class="flex items-center justify-between gap-3">
        <CardTitle
          :class="
            card.capability === 'orders_list' && channel === 'shop'
              ? 'text-xl font-semibold tracking-tight'
              : 'text-sm font-semibold'
          "
          >{{
            card.capability === "orders_list" && channel === "shop"
              ? "我的订单"
              : card.title
          }}</CardTitle
        ><Badge
          v-if="card.rows.length && card.view !== 'metrics'"
          variant="secondary"
          class="font-normal"
          >{{ card.rows.length }} 项</Badge
        >
      </div>
      <CardDescription v-if="card.summary" class="text-xs">{{
        card.summary
      }}</CardDescription></CardHeader
    >
    <CardContent
      class="px-4 py-3"
      :class="
        card.capability === 'orders_list' && channel === 'shop' ? 'p-0' : ''
      "
    >
      <dl
        v-if="card.details.length"
        class="mb-3 grid grid-cols-1 gap-x-6 gap-y-3 rounded-lg bg-muted/60 p-3 text-sm sm:grid-cols-2"
      >
        <div v-for="(field, i) in card.details" :key="i" class="min-w-0">
          <dt class="mb-1 text-xs text-muted-foreground">{{ field.label }}</dt>
          <dd class="break-words">{{ field.value }}</dd>
        </div>
      </dl>
      <div
        v-if="card.view === 'products'"
        class="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3"
      >
        <button
          v-for="p in card.rows"
          :key="p.id"
          class="group min-w-0 text-left"
          :disabled="disabled"
          @click="emit('action', 'product', p)"
        >
          <div
            class="relative mb-2.5 aspect-[4/5] overflow-hidden rounded-lg bg-muted"
          >
            <img
              :src="p.image"
              :alt="p.name"
              class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105 motion-reduce:transform-none"
              loading="lazy"
              width="320"
              height="400"
            /><span
              v-if="p.available <= 5"
              class="absolute bottom-2 left-2 rounded bg-background/95 px-2 py-1 text-[11px]"
              >库存不多</span
            ><span
              class="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-background/90"
              ><ArrowUpRight class="size-4"
            /></span>
          </div>
          <div class="line-clamp-2 text-[13px] font-medium leading-5">
            {{ p.name }}
          </div>
          <div class="mt-1 truncate text-xs text-muted-foreground">
            {{ p.colors }}
          </div>
          <div class="mt-2 flex items-center justify-between gap-2">
            <span class="text-base font-semibold tabular-nums">{{
              currency(p.price)
            }}</span
            ><ShoppingBag class="size-3.5 text-muted-foreground" />
          </div>
        </button>
      </div>
      <div v-else-if="card.view === 'metrics'" class="grid grid-cols-2 gap-4">
        <div
          v-for="(r, i) in card.rows"
          :key="i"
          class="rounded-lg border px-4 py-3"
        >
          <div class="text-xs text-muted-foreground">{{ r.name }}</div>
          <div class="mt-2 text-xl font-semibold tabular-nums">
            {{ r.amount !== undefined ? currency(r.amount) : r.value }}
          </div>
        </div>
      </div>
      <OrderList
        v-else-if="card.capability === 'orders_list' && channel === 'shop'"
        :rows="card.rows"
        :disabled="disabled || compact"
        @action="(name, row) => emit('action', name, row)"
      />
      <template v-else-if="card.rows.length">
        <div class="hidden sm:block">
          <Table
            ><TableHeader
              ><TableRow
                ><TableHead
                  v-for="column in card.columns"
                  :key="column.key"
                  class="h-9 text-xs whitespace-nowrap text-muted-foreground"
                  :class="column.format === 'money' ? 'text-right' : ''"
                  >{{ column.label }}</TableHead
                ><TableHead
                  v-if="card.rows.some((r) => actions(r).length)"
                  class="text-right text-xs"
                  >操作</TableHead
                ></TableRow
              ></TableHeader
            ><TableBody
              ><TableRow v-for="(row, i) in card.rows" :key="i"
                ><TableCell
                  v-for="column in card.columns"
                  :key="column.key"
                  class="max-w-64 py-2.5 text-[13px]"
                  :class="[
                    column.format === 'money' ? 'text-right font-medium' : '',
                    column.key === 'id'
                      ? 'font-mono text-[11px] text-muted-foreground'
                      : '',
                  ]"
                  ><StatusBadge
                    v-if="column.key === 'status'"
                    :status="row[column.key]"
                  />
                  <span
                    v-else-if="column.key === 'products' && row.items?.length"
                    class="flex items-center gap-2.5"
                  >
                    <img
                      v-if="row.items[0].image"
                      :src="row.items[0].image"
                      :alt="row.items[0].name"
                      width="36"
                      height="44"
                      class="h-11 w-9 shrink-0 rounded bg-muted object-cover"
                      loading="lazy"
                    />
                    <span class="min-w-0"
                      ><span class="block text-xs font-medium leading-5"
                        >{{ row.items[0].name
                        }}<span
                          v-if="row.items.length > 1"
                          class="ml-1 text-muted-foreground"
                          >等 {{ row.items.length }} 款</span
                        ></span
                      ><span class="block text-[11px] text-muted-foreground"
                        >{{ row.items[0].color }} /
                        {{ row.items[0].size }}</span
                      ></span
                    > </span
                  ><span
                    v-else
                    :class="
                      column.format === 'money'
                        ? 'whitespace-nowrap tabular-nums'
                        : ''
                    "
                    >{{ format(row[column.key], column.format) }}</span
                  ></TableCell
                ><TableCell
                  v-if="card.rows.some((r) => actions(r).length)"
                  class="text-right"
                  ><div class="flex justify-end gap-1">
                    <Button
                      v-for="a in actions(row)"
                      :key="a.name"
                      size="sm"
                      variant="ghost"
                      class="h-8 px-2 text-xs"
                      :disabled="disabled || compact"
                      @click="emit('action', a.name, row)"
                      >{{ a.label }}</Button
                    >
                  </div></TableCell
                ></TableRow
              ></TableBody
            ></Table
          >
        </div>
        <div class="divide-y sm:hidden">
          <div
            v-for="(row, i) in card.rows"
            :key="i"
            class="py-3 first:pt-0 last:pb-0"
          >
            <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
              <template v-for="column in card.columns" :key="column.key"
                ><dt class="text-muted-foreground">{{ column.label }}</dt>
                <dd class="break-all text-right">
                  <StatusBadge
                    v-if="column.key === 'status'"
                    :status="row[column.key]"
                  />
                  <span v-else>{{
                    format(row[column.key], column.format)
                  }}</span>
                </dd></template
              >
            </dl>
            <div
              v-if="actions(row).length"
              class="mt-3 flex flex-wrap justify-end gap-2"
            >
              <Button
                v-for="a in actions(row)"
                :key="a.name"
                variant="outline"
                size="sm"
                class="h-11"
                :disabled="disabled || compact"
                @click="emit('action', a.name, row)"
                >{{ a.label }}</Button
              >
            </div>
          </div>
        </div>
      </template>
      <div
        v-else-if="!card.details.length"
        class="flex flex-col items-center gap-2 py-6 text-muted-foreground"
      >
        <PackageSearch class="size-7" />
        <p class="text-sm">暂无符合条件的记录</p>
      </div>
    </CardContent>
  </Card>
</template>
