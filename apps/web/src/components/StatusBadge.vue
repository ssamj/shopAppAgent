<script setup lang="ts">
import { computed } from "vue";
import { Badge } from "@/components/ui/badge";
const props = defineProps<{ status: string }>();
const tone = computed(() => {
  if (["待付款", "待审核", "待退款"].includes(props.status)) return "attention";
  if (["待发货", "待到货", "待退货"].includes(props.status)) return "active";
  if (["已发货"].includes(props.status)) return "transit";
  if (["已完成", "已退款", "已入库", "上架"].includes(props.status))
    return "success";
  return "muted";
});
</script>

<template>
  <Badge
    variant="outline"
    class="status-badge shrink-0 gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium"
    :data-tone="tone"
  >
    <span
      class="size-1.5 rounded-full bg-current opacity-70"
      aria-hidden="true"
    />
    {{ status }}
  </Badge>
</template>
