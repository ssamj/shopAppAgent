<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from "vue";
import {
  ArrowUp,
  Plus,
  MessageSquare,
  ShoppingBag,
  Package,
  Users,
  Truck,
  Warehouse,
  Wallet,
  RotateCcw,
  Settings2,
  LogOut,
  ChevronRight,
  PanelLeft,
  Check,
  LoaderCircle,
  CircleAlert,
  ArrowUpRight,
  SlidersHorizontal,
  Sparkles,
  ArrowLeft,
  ClipboardList,
  X,
  CheckCheck,
} from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import ResultCard from "@/components/ResultCard.vue";
import ExecutionTrace from "@/components/ExecutionTrace.vue";
import ThinkingIndicator from "@/components/ThinkingIndicator.vue";
import { streamProgress, type ProgressEvent } from "@/lib/events";
import { api, currency, time, type BusinessCard } from "@/lib/api";
const props = defineProps<{ channel: "admin" | "shop" }>();
const isShop = computed(() => props.channel === "shop");
const user = ref<any>(null),
  initializing = ref(true),
  login = reactive({ login: isShop.value ? "zhixia" : "qihe", password: "" }),
  loginBusy = ref(false);
const conversations = ref<any[]>([]),
  conversationId = ref(""),
  messages = ref<any[]>([]),
  actions = ref<any[]>([]),
  calls = ref<any[]>([]),
  runs = ref<any[]>([]);
const draft = ref(""),
  busy = ref(false),
  operationBusy = ref(false),
  error = ref(""),
  success = ref(""),
  mobileMenu = ref(false),
  scrollRef = ref<HTMLElement>();
const shopSection = ref("products_search");
const catalog = ref<BusinessCard | null>(null),
  overview = ref<BusinessCard | null>(null),
  settings = ref<any>(null),
  settingsOpen = ref(false),
  settingsTab = ref("prompts"),
  promptRole = ref("admin"),
  promptDraft = ref("");
const form = reactive({
  open: false,
  type: "",
  title: "",
  row: {} as any,
  product: null as BusinessCard | null,
  addresses: [] as any[],
  skuId: "",
  quantity: 1,
  addressId: "",
  carrier: "",
  tracking: "",
  reason: "",
  approve: "yes",
});
let poll: ReturnType<typeof setTimeout> | undefined;
let streamController: AbortController | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let snapshotTimer: ReturnType<typeof setTimeout> | undefined;
let streamConversation = "";
let reconnectAttempts = 0;
const progressEvents = ref<ProgressEvent[]>([]);
const streamState = ref("idle");
const submitting = ref(false);
let snapshotRequest = 0;
let scope = 0;
let disposed = false;
const pending = computed(() =>
  actions.value.filter((a) => a.state === "pending" || a.state === "executing"),
);
const pendingReplyRun = computed(() =>
  runs.value.find(
    (run) =>
      run.status === "running" &&
      !messages.value.some(
        (message) => message.role === "assistant" && message.run_id === run.id,
      ),
  ),
);
const waitingForReply = computed(
  () => busy.value && (submitting.value || Boolean(pendingReplyRun.value)),
);
function stopProgress() {
  streamController?.abort();
  streamController = undefined;
  clearTimeout(reconnectTimer);
  clearTimeout(snapshotTimer);
  streamConversation = "";
  streamState.value = "idle";
  reconnectAttempts = 0;
}
function mergeProgress(incoming: ProgressEvent[]) {
  const map = new Map(progressEvents.value.map((event) => [event.id, event]));
  for (const event of incoming) map.set(event.id, event);
  progressEvents.value = [...map.values()].sort((a, b) =>
    BigInt(a.id) < BigInt(b.id) ? -1 : 1,
  );
}
function connectProgress(id: string) {
  if (
    streamConversation === id &&
    streamController &&
    !streamController.signal.aborted
  )
    return;
  stopProgress();
  streamConversation = id;
  const token = scope;
  const connect = () => {
    if (disposed || scope !== token || conversationId.value !== id) return;
    const controller = new AbortController();
    streamController = controller;
    streamState.value = reconnectAttempts ? "reconnecting" : "connecting";
    const cursor = progressEvents.value.at(-1)?.id || "0";
    void streamProgress(
      props.channel,
      id,
      cursor,
      controller.signal,
      (event) => {
        if (disposed || scope !== token || conversationId.value !== id) return;
        mergeProgress([event]);
        if (
          [
            "run-started",
            "tool-started",
            "tool-completed",
            "tool-failed",
            "confirmation-required",
            "run-completed",
            "run-failed",
            "action-completed",
            "action-failed",
            "action-cancelled",
          ].includes(event.type)
        ) {
          clearTimeout(snapshotTimer);
          snapshotTimer = setTimeout(() => {
            void refresh(id, token).catch(fail);
          }, 60);
        }
      },
      () => {
        if (scope !== token) return;
        streamState.value = "connected";
        reconnectAttempts = 0;
        void refresh(id, token).catch(fail);
      },
    ).then(
      () => reconnect(),
      (e) => {
        if (e.status === 401 || e.status === 404) {
          streamState.value = "unavailable";
          fail(new Error("实时进度会话已失效，请重新登录或打开对话"));
          return;
        }
        reconnect();
      },
    );
    function reconnect() {
      if (
        controller.signal.aborted ||
        disposed ||
        scope !== token ||
        conversationId.value !== id
      )
        return;
      streamState.value = "reconnecting";
      reconnectAttempts++;
      reconnectTimer = setTimeout(
        connect,
        Math.min(1000 * 2 ** Math.min(reconnectAttempts - 1, 4), 15000),
      );
    }
  };
  connect();
}
function resumeProgress() {
  if (document.visibilityState === "visible" && conversationId.value) {
    stopProgress();
    connectProgress(conversationId.value);
  }
}
const modules = [
  {
    name: "客户",
    icon: Users,
    query: "查看客户档案",
    cap: "customers_list",
    args: {},
  },
  {
    name: "商品",
    icon: ShoppingBag,
    query: "查看在售商品",
    cap: "products_search",
    args: {},
  },
  {
    name: "订单",
    icon: ClipboardList,
    query: "查看待发货订单",
    cap: "orders_list",
    args: { status: "待发货" },
  },
  {
    name: "采购",
    icon: Truck,
    query: "查看采购订单",
    cap: "purchases_list",
    args: {},
  },
  {
    name: "供应商",
    icon: Package,
    query: "查看供应商档案",
    cap: "suppliers_list",
    args: {},
  },
  {
    name: "售后",
    icon: RotateCcw,
    query: "查看售后申请",
    cap: "aftersales_list",
    args: {},
  },
  {
    name: "仓库",
    icon: Warehouse,
    query: "查看低库存商品",
    cap: "inventory_list",
    args: { lowOnly: true },
  },
  {
    name: "财务",
    icon: Wallet,
    query: "查看今天收支",
    cap: "finance_summary",
    args: {},
  },
];
const suggestions = computed(() =>
  isShop.value
    ? [
        "推荐 400 元以内的通勤针织衫",
        "我想看秋冬连衣裙",
        "查看我的订单",
        "查看我的收货地址",
      ]
    : [
        "看看今天有哪些事情要处理",
        "哪些规格需要补货？",
        "查一下待审核的售后申请",
        "汇总本月销售收款和采购支出",
      ],
);
const statusLabel = (status: string) =>
  ({
    running: "执行中",
    succeeded: "已完成",
    failed: "未完成",
    awaiting_confirmation: "待确认",
  })[status] || status;
function fail(e: unknown) {
  error.value = e instanceof Error ? e.message : "请求未完成";
}
async function scrollDown() {
  await nextTick();
  const container = scrollRef.value;
  if (!container) return;
  const targets = container.querySelectorAll(
    pending.value.length ? "[data-action-id]" : "[data-message-id]",
  );
  const target = targets.item(targets.length - 1);
  if (target)
    container.scrollTop +=
      target.getBoundingClientRect().top -
      container.getBoundingClientRect().top -
      20;
}
async function loadHome() {
  const responses = await Promise.allSettled([
    api<BusinessCard>(props.channel, "/business/query", {
      capability: isShop.value ? "products_search" : "dashboard_summary",
      arguments: isShop.value ? { limit: 50 } : {},
    }),
    api<any[]>(props.channel, "/conversations"),
  ]);
  for (const [index, r] of responses.entries()) {
    if (r.status === "fulfilled") {
      if (index === 0) {
        if (isShop.value) catalog.value = r.value as BusinessCard;
        else overview.value = r.value as BusinessCard;
      } else conversations.value = r.value as any[];
    } else fail(r.reason);
  }
}
async function loginNow() {
  loginBusy.value = true;
  error.value = "";
  try {
    user.value = await api(props.channel, "/auth/login", login);
    await loadHome();
  } catch (e) {
    fail(e);
  } finally {
    loginBusy.value = false;
  }
}
async function logout() {
  try {
    await api(props.channel, "/auth/logout", {});
    clearTimeout(poll);
    scope++;
    user.value = null;
    resetConversation();
  } catch (e) {
    fail(e);
  }
}
function resetConversation() {
  stopProgress();
  progressEvents.value = [];
  conversationId.value = "";
  messages.value = [];
  actions.value = [];
  calls.value = [];
  runs.value = [];
  busy.value = false;
  draft.value = "";
  shopSection.value = "products_search";
  mobileMenu.value = false;
  clearTimeout(poll);
  scope++;
}
async function newConversation() {
  if (busy.value) return;
  resetConversation();
  error.value = "";
  await loadHome();
}
async function ensureConversation() {
  if (!conversationId.value) {
    const c = await api(props.channel, "/conversations", {});
    conversationId.value = c.id;
    conversations.value.unshift(c);
    connectProgress(c.id);
  }
  return conversationId.value;
}
async function refresh(id = conversationId.value, token = scope) {
  if (!id) return;
  const sequence = ++snapshotRequest;
  const snapshot = await api(props.channel, `/conversations/${id}`);
  if (
    disposed ||
    token !== scope ||
    id !== conversationId.value ||
    sequence !== snapshotRequest
  )
    return;
  clearTimeout(poll);
  const before = messages.value.length;
  messages.value = snapshot.messages;
  actions.value = snapshot.actions;
  calls.value = snapshot.calls;
  runs.value = snapshot.runs;
  mergeProgress(snapshot.events || []);
  busy.value =
    submitting.value || runs.value.some((r) => r.status === "running");
  if (before !== messages.value.length) await scrollDown();
  if (actions.value.some((a) => a.state === "executing"))
    poll = setTimeout(
      () =>
        refresh(id, token).catch((e) => {
          fail(e);
          busy.value = false;
        }),
      1200,
    );
}
async function selectConversation(c: any) {
  if (busy.value) return;
  stopProgress();
  progressEvents.value = [];
  clearTimeout(poll);
  scope++;
  conversationId.value = c.id;
  mobileMenu.value = false;
  error.value = "";
  try {
    await refresh();
    connectProgress(c.id);
    await scrollDown();
  } catch (e) {
    fail(e);
  }
}
async function send(text = draft.value) {
  if (!text.trim() || busy.value || operationBusy.value) return;
  error.value = "";
  busy.value = true;
  submitting.value = true;
  try {
    const id = await ensureConversation();
    draft.value = "";
    await api(props.channel, `/conversations/${id}/messages`, {
      message: text.trim(),
    });
    await refresh();
    conversations.value = await api(props.channel, "/conversations");
  } catch (e) {
    draft.value = text;
    busy.value = false;
    fail(e);
  } finally {
    submitting.value = false;
    busy.value = runs.value.some((r) => r.status === "running");
  }
}
async function quickQuery(cap: string, args: Record<string, unknown> = {}) {
  if (busy.value || operationBusy.value) return;
  error.value = "";
  operationBusy.value = true;
  mobileMenu.value = false;
  try {
    const id = await ensureConversation();
    await api(props.channel, "/business/query", {
      capability: cap,
      arguments: cap === "products_search" ? { limit: 50, ...args } : args,
      conversationId: id,
    });
    await refresh();
    await scrollDown();
    if (
      isShop.value &&
      ["products_search", "orders_list", "aftersales_list"].includes(cap)
    )
      shopSection.value = cap;
  } catch (e) {
    fail(e);
  } finally {
    operationBusy.value = false;
  }
}
async function act(name: string, row: any) {
  if (busy.value || operationBusy.value) return;
  error.value = "";
  try {
    if (["orders_detail", "purchases_detail"].includes(name)) {
      await quickQuery(name, { id: row.id });
      return;
    }
    if (name === "product" || name === "buy_sku") {
      operationBusy.value = true;
      const productId = name === "product" ? row.id : row.skuId.split("-")[0];
      const detail = await api<BusinessCard>(props.channel, "/business/query", {
        capability: "products_detail",
        arguments: { id: productId },
      });
      const address = isShop.value
        ? await api<BusinessCard>(props.channel, "/business/query", {
            capability: "customers_addresses",
            arguments: {},
          })
        : null;
      Object.assign(form, {
        open: true,
        type: "buy",
        title: detail.title,
        product: detail,
        row,
        addresses: address?.rows || [],
        skuId: name === "buy_sku" ? row.skuId : "",
        quantity: 1,
        addressId: address?.rows[0]?.id || "",
      });
      return;
    }
    if (
      [
        "orders_ship",
        "aftersales_apply",
        "aftersales_review",
        "purchases_create",
      ].includes(name)
    ) {
      Object.assign(form, {
        open: true,
        type: name,
        title: (
          {
            orders_ship: "填写发货信息",
            aftersales_apply: "申请售后",
            aftersales_review: "审核售后",
            purchases_create: "采购补货",
          } as Record<string, string>
        )[name],
        row,
        quantity: 10,
        carrier: "顺丰速运",
        tracking: "",
        reason: "",
        approve: "yes",
      });
      return;
    }
    await prepareAction(name, { id: row.id });
  } catch (e) {
    fail(e);
  } finally {
    operationBusy.value = false;
  }
}
async function prepareAction(capability: string, args: any) {
  const id = await ensureConversation();
  await api(props.channel, "/actions/prepare", {
    capability,
    arguments: args,
    conversationId: id,
  });
  await refresh();
  await scrollDown();
}
async function submitForm() {
  operationBusy.value = true;
  error.value = "";
  try {
    if (form.type === "buy") {
      if (!form.skuId || !form.addressId)
        throw new Error("请选择颜色尺码与收货地址");
      await prepareAction("orders_create", {
        items: [{ skuId: form.skuId, quantity: Number(form.quantity) }],
        addressId: form.addressId,
      });
    } else if (form.type === "orders_ship") {
      if (!form.carrier.trim() || !form.tracking.trim())
        throw new Error("请填写快递公司和运单号");
      await prepareAction("orders_ship", {
        id: form.row.id,
        carrier: form.carrier.trim(),
        tracking: form.tracking.trim(),
      });
    } else if (form.type === "aftersales_apply") {
      if (!form.reason.trim()) throw new Error("请填写申请原因");
      await prepareAction("aftersales_apply", {
        orderId: form.row.id,
        reason: form.reason.trim(),
      });
    } else if (form.type === "aftersales_review")
      await prepareAction("aftersales_review", {
        id: form.row.id,
        approve: form.approve === "yes",
      });
    else if (form.type === "purchases_create")
      await prepareAction("purchases_create", {
        supplierId: form.row.supplierId,
        items: [{ skuId: form.row.skuId, quantity: Number(form.quantity) }],
      });
    form.open = false;
  } catch (e) {
    fail(e);
  } finally {
    operationBusy.value = false;
  }
}
async function confirmAction(id: string, cancel = false) {
  operationBusy.value = true;
  error.value = "";
  try {
    await api(
      props.channel,
      `/actions/${id}/${cancel ? "cancel" : "confirm"}`,
      {},
    );
    await refresh();
    await loadHome();
    await scrollDown();
  } catch (e) {
    fail(e);
    await refresh().catch(() => {});
  } finally {
    operationBusy.value = false;
  }
}
async function openSettings() {
  error.value = "";
  try {
    settings.value = await api(props.channel, "/settings");
    settingsOpen.value = true;
    loadPrompt();
  } catch (e) {
    fail(e);
  }
}
function loadPrompt() {
  promptDraft.value =
    settings.value?.prompts.find((p: any) => p.role === promptRole.value)
      ?.content || "";
  success.value = "";
}
async function savePrompt() {
  operationBusy.value = true;
  success.value = "";
  error.value = "";
  try {
    const p = settings.value.prompts.find(
      (p: any) => p.role === promptRole.value,
    );
    await api(
      props.channel,
      "/settings/prompt",
      { role: p.role, content: promptDraft.value, version: p.version },
      "PUT",
    );
    settings.value = await api(props.channel, "/settings");
    success.value = "编排已保存，下一次对话请求生效。";
  } catch (e) {
    fail(e);
  } finally {
    operationBusy.value = false;
  }
}
function onKeydown(event: KeyboardEvent) {
  if (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing &&
    !isShop.value
  ) {
    event.preventDefault();
    void send();
  }
}
onMounted(async () => {
  window.addEventListener("online", resumeProgress);
  document.addEventListener("visibilitychange", resumeProgress);
  try {
    user.value = await api(props.channel, "/auth/me");
    await loadHome();
  } catch (e) {
    if ((e as any).code !== "LOGIN_REQUIRED") fail(e);
  } finally {
    initializing.value = false;
  }
});
onUnmounted(() => {
  disposed = true;
  stopProgress();
  window.removeEventListener("online", resumeProgress);
  document.removeEventListener("visibilitychange", resumeProgress);
  clearTimeout(poll);
  scope++;
});
</script>

<template>
  <div v-if="initializing" class="flex h-dvh items-center justify-center">
    <LoaderCircle class="size-6 animate-spin text-muted-foreground" /><span
      class="sr-only"
      >加载中</span
    >
  </div>
  <main
    v-else-if="!user"
    class="flex min-h-dvh items-center justify-center bg-muted/35 p-5"
  >
    <div class="w-full max-w-sm">
      <div class="mb-8 flex items-center justify-center gap-3">
        <div
          class="flex size-10 items-center justify-center rounded-xl bg-primary text-lg font-semibold text-primary-foreground"
        >
          栖
        </div>
        <span class="text-lg font-semibold tracking-wide"
          >栖禾
          <span
            class="ml-1 text-xs font-normal tracking-[.15em] text-muted-foreground"
            >QI HE</span
          ></span
        >
      </div>
      <Card
        ><CardHeader class="text-center"
          ><CardTitle class="text-xl">{{
            isShop ? "欢迎来到栖禾" : "登录经营工作台"
          }}</CardTitle
          ><CardDescription>{{
            isShop
              ? "让日常穿搭，多一点从容。"
              : "把日常经营，交给一次清晰的对话。"
          }}</CardDescription></CardHeader
        ><CardContent
          ><form id="login-form" class="space-y-4" @submit.prevent="loginNow">
            <div class="space-y-2">
              <Label for="account">账号</Label
              ><Input
                id="account"
                v-model="login.login"
                autocomplete="username"
                required
              />
            </div>
            <div class="space-y-2">
              <Label for="password">密码</Label
              ><Input
                id="password"
                v-model="login.password"
                type="password"
                autocomplete="current-password"
                required
              />
            </div>
            <p v-if="error" role="alert" class="text-sm text-destructive">
              {{ error }}
            </p>
            <Button type="submit" class="h-11 w-full" :disabled="loginBusy"
              ><LoaderCircle
                v-if="loginBusy"
                class="size-4 animate-spin"
              />登录</Button
            >
          </form></CardContent
        ><CardFooter class="justify-center border-t pt-5"
          ><a
            :href="isShop ? '/admin' : '/shop'"
            class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >{{ isShop ? "经营工作台" : "前往栖禾商城"
            }}<ArrowUpRight class="size-3" /></a></CardFooter
      ></Card>
    </div>
  </main>
  <div v-else class="flex h-dvh min-h-0 overflow-hidden bg-background">
    <aside
      v-if="!isShop"
      class="brand-sidebar hidden w-56 shrink-0 flex-col border-r lg:flex"
    >
      <div class="flex h-16 items-center gap-3 border-b px-5">
        <span
          class="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
          >栖</span
        >
        <div>
          <div class="text-sm font-semibold">栖禾女装</div>
          <div class="text-[11px] text-muted-foreground">经营工作台</div>
        </div>
      </div>
      <div class="px-3 pt-4">
        <Button
          variant="outline"
          class="w-full justify-start bg-background"
          :disabled="busy"
          @click="newConversation"
          ><Plus class="size-4" />新建对话<span
            class="ml-auto text-xs text-muted-foreground"
            >⌘</span
          ></Button
        >
      </div>
      <div class="px-3 pt-6">
        <p class="mb-2 px-2 text-[11px] font-medium text-muted-foreground">
          业务空间
        </p>
        <div class="grid grid-cols-2 gap-1">
          <Button
            v-for="m in modules"
            :key="m.name"
            variant="ghost"
            size="sm"
            class="h-10 justify-start px-2.5 font-normal"
            :disabled="busy || operationBusy"
            @click="quickQuery(m.cap, m.args)"
            ><component :is="m.icon" class="size-4 text-muted-foreground" />{{
              m.name
            }}</Button
          >
        </div>
      </div>
      <Separator class="my-5" />
      <div class="min-h-0 flex-1 overflow-y-auto px-3 scrollbar-thin">
        <p class="mb-2 px-2 text-[11px] font-medium text-muted-foreground">
          最近对话
        </p>
        <Button
          v-for="c in conversations"
          :key="c.id"
          :variant="conversationId === c.id ? 'secondary' : 'ghost'"
          class="mb-1 h-9 w-full justify-start px-2.5 text-xs font-normal"
          :disabled="busy"
          @click="selectConversation(c)"
          ><MessageSquare class="size-3.5 shrink-0" /><span class="truncate">{{
            c.title
          }}</span></Button
        >
        <p
          v-if="!conversations.length"
          class="px-2 py-3 text-xs leading-6 text-muted-foreground"
        >
          从一个业务问题开始，<br />对话会保存在这里。
        </p>
      </div>
      <div class="border-t p-3">
        <Button
          variant="ghost"
          class="w-full justify-start text-sm font-normal"
          @click="openSettings"
          ><SlidersHorizontal class="size-4" />智能体设置</Button
        >
        <div class="mt-2 flex items-center gap-2 rounded-lg px-2 py-2">
          <span
            class="flex size-8 items-center justify-center rounded-full bg-secondary text-xs"
            >{{ user.name.slice(-2) }}</span
          >
          <div class="min-w-0 flex-1">
            <div class="text-xs font-medium">{{ user.name }}</div>
            <div class="text-[10px] text-muted-foreground">
              店长 · 杭州中心仓
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            class="size-8"
            aria-label="退出登录"
            @click="logout"
            ><LogOut class="size-3.5"
          /></Button>
        </div>
      </div>
    </aside>
    <div class="flex min-w-0 flex-1 flex-col">
      <header
        class="brand-bar flex h-16 shrink-0 items-center justify-between gap-3 border-b px-4 sm:px-6"
      >
        <div class="flex min-w-0 items-center gap-3">
          <Button
            v-if="!isShop"
            variant="ghost"
            size="icon"
            class="size-11 lg:hidden"
            aria-label="打开业务导航"
            @click="mobileMenu = true"
            ><PanelLeft class="size-5" /></Button
          ><span
            v-if="isShop"
            class="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
            >栖</span
          >
          <div>
            <h1 class="text-sm font-semibold">
              {{ isShop ? "栖禾女装" : "业务助手" }}
            </h1>
            <p class="mt-0.5 text-[11px] text-muted-foreground">
              {{
                isShop ? "日常有质感，穿着有自己" : "客户 · 商品 · 订单 · 经营"
              }}
            </p>
          </div>
        </div>
        <div class="flex items-center gap-1 sm:gap-3">
          <Badge
            v-if="!isShop"
            variant="outline"
            class="hidden gap-1.5 font-normal sm:inline-flex"
            ><span
              class="size-1.5 rounded-full bg-emerald-600"
            />服务已连接</Badge
          ><a
            v-if="!isShop"
            href="/shop"
            target="_blank"
            rel="noopener"
            class="hidden items-center gap-1 text-xs text-muted-foreground hover:text-foreground sm:flex"
            >商城入口<ArrowUpRight class="size-3.5" /></a
          ><Button
            v-if="isShop"
            variant="ghost"
            size="icon"
            class="size-11"
            aria-label="查看会话与账号"
            @click="mobileMenu = true"
            ><Users class="size-4" /></Button
          ><Button
            v-if="isShop"
            variant="ghost"
            size="icon"
            class="size-11"
            :disabled="busy"
            aria-label="新建对话"
            @click="newConversation"
            ><Plus class="size-5"
          /></Button>
        </div>
      </header>
      <div class="flex min-h-0 flex-1">
        <section
          class="flex min-w-0 flex-1 flex-col"
          :class="isShop ? 'bg-muted/20' : ''"
        >
          <div
            v-if="isShop"
            class="flex shrink-0 items-center justify-center border-b bg-card px-3 py-2"
          >
            <div
              class="grid w-full max-w-3xl grid-cols-3 gap-1 rounded-xl bg-muted/70 p-1"
            >
              <Button
                :variant="
                  shopSection === 'products_search' ? 'secondary' : 'ghost'
                "
                size="sm"
                class="h-11 rounded-lg text-xs"
                :class="
                  shopSection === 'products_search'
                    ? 'bg-card text-primary shadow-xs'
                    : 'text-muted-foreground'
                "
                :aria-pressed="shopSection === 'products_search'"
                :disabled="busy || operationBusy"
                @click="quickQuery('products_search')"
                ><ShoppingBag class="size-3.5" />挑选衣服</Button
              ><Button
                :variant="shopSection === 'orders_list' ? 'secondary' : 'ghost'"
                size="sm"
                class="h-11 rounded-lg text-xs"
                :class="
                  shopSection === 'orders_list'
                    ? 'bg-card text-primary shadow-xs'
                    : 'text-muted-foreground'
                "
                :aria-pressed="shopSection === 'orders_list'"
                :disabled="busy || operationBusy"
                @click="quickQuery('orders_list')"
                ><Package class="size-3.5" />我的订单</Button
              ><Button
                :variant="
                  shopSection === 'aftersales_list' ? 'secondary' : 'ghost'
                "
                size="sm"
                class="h-11 rounded-lg text-xs"
                :class="
                  shopSection === 'aftersales_list'
                    ? 'bg-card text-primary shadow-xs'
                    : 'text-muted-foreground'
                "
                :aria-pressed="shopSection === 'aftersales_list'"
                :disabled="busy || operationBusy"
                @click="quickQuery('aftersales_list')"
                ><RotateCcw class="size-3.5" />售后服务</Button
              >
            </div>
          </div>
          <div
            ref="scrollRef"
            class="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin"
          >
            <div
              class="mx-auto w-full px-3 py-4 sm:px-6 sm:py-5"
              :class="isShop ? 'max-w-3xl' : 'max-w-6xl'"
            >
              <div v-if="!messages.length && !pending.length && !busy">
                <div
                  v-if="isShop"
                  class="shop-welcome relative mb-4 flex min-h-48 items-center overflow-hidden rounded-2xl px-5 py-6 sm:min-h-56 sm:px-7"
                >
                  <div class="relative z-10 max-w-[67%]">
                    <span
                      class="season-tag inline-flex rounded-sm px-2 py-1 text-[10px] font-semibold tracking-[.12em]"
                      >栖禾 · 秋冬衣橱</span
                    >
                    <h2
                      class="mt-3 text-[28px] font-semibold leading-tight tracking-tight sm:text-4xl"
                    >
                      把喜欢，<br />穿成日常。
                    </h2>
                    <p class="mt-3 text-xs leading-5 opacity-75">
                      {{ user.name }}，一起选件适合你的。
                    </p>
                  </div>
                  <div
                    v-if="catalog?.rows[0]"
                    class="shop-welcome-art absolute -right-5 top-7 h-44 w-32 overflow-hidden rounded-t-full border-4 border-white/20 sm:right-8 sm:h-52 sm:w-44"
                    aria-hidden="true"
                  >
                    <img
                      :src="catalog.rows[0].image"
                      alt=""
                      class="h-full w-full object-cover"
                    />
                  </div>
                  <span
                    class="absolute bottom-3 right-4 text-[10px] tracking-[.22em] opacity-60"
                    >QI HE / COLLECTION</span
                  >
                </div>
                <div v-else class="mb-5 pt-3 sm:pt-5">
                  <div
                    class="mb-5 flex size-11 items-center justify-center rounded-xl border border-primary/15 bg-secondary text-primary"
                  >
                    <ShoppingBag v-if="isShop" class="size-5" /><Sparkles
                      v-else
                      class="size-5"
                    />
                  </div>
                  <p class="mb-2 text-xs text-muted-foreground">
                    {{ isShop ? "栖禾 · 秋冬衣橱" : "栖禾 · 日常经营" }}
                  </p>
                  <h2 class="text-2xl font-semibold tracking-tight sm:text-3xl">
                    {{
                      isShop
                        ? `${user.name}，今天想怎么穿？`
                        : `${user.name}，今天从哪件事开始？`
                    }}
                  </h2>
                  <p
                    class="mt-3 max-w-lg text-sm leading-7 text-muted-foreground"
                  >
                    {{
                      isShop
                        ? "说说你的场合和偏好，一起找到舒服又适合自己的那一件。"
                        : "查订单、看库存、安排补货，或把一个经营问题交给我。"
                    }}
                  </p>
                </div>
                <div
                  v-if="!isShop && overview"
                  class="mb-7 grid grid-cols-2 gap-3 xl:grid-cols-4"
                >
                  <button
                    v-for="(m, i) in overview.rows"
                    :key="m.name"
                    class="rounded-xl border bg-card p-4 text-left transition-colors hover:bg-accent"
                    :disabled="operationBusy"
                    @click="
                      quickQuery(
                        [
                          'orders_list',
                          'inventory_list',
                          'aftersales_list',
                          'purchases_list',
                        ][i],
                        [
                          { status: '待发货' },
                          { lowOnly: true },
                          { status: '待审核' },
                          { status: '待到货' },
                        ][i],
                      )
                    "
                  >
                    <div
                      class="flex items-center justify-between gap-2 text-xs text-muted-foreground"
                    >
                      <span>{{ m.name }}</span
                      ><ChevronRight class="size-3.5" />
                    </div>
                    <div
                      class="mt-3 text-2xl font-semibold tabular-nums text-primary"
                    >
                      {{ m.value }}
                    </div>
                  </button>
                </div>
                <div v-if="isShop" class="mb-5 grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    class="h-12 justify-between bg-card px-3 text-xs"
                    @click="send(suggestions[0])"
                    >400 元内通勤穿搭<ArrowUpRight class="size-3.5"
                  /></Button>
                  <Button
                    variant="outline"
                    class="h-12 justify-between bg-card px-3 text-xs"
                    @click="send(suggestions[1])"
                    >秋冬连衣裙推荐<ArrowUpRight class="size-3.5"
                  /></Button>
                </div>
                <div v-else class="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Button
                    v-for="s in suggestions"
                    :key="s"
                    variant="outline"
                    class="h-auto min-h-11 justify-between gap-2 bg-background px-3 py-3 text-left text-xs font-normal whitespace-normal"
                    @click="send(s)"
                    ><span>{{ s }}</span
                    ><ArrowUpRight
                      class="size-3.5 shrink-0 text-muted-foreground"
                  /></Button>
                </div>
                <ResultCard
                  v-if="isShop && catalog"
                  :card="{ ...catalog, title: '秋冬精选' }"
                  :channel="channel"
                  :disabled="operationBusy"
                  @action="act"
                />
                <div
                  v-if="!isShop"
                  class="mt-8 flex items-start gap-3 border-t pt-5 text-xs leading-6 text-muted-foreground"
                >
                  <CheckCheck class="mt-1 size-4 shrink-0" />
                  <p>
                    查询直接查看结果。下单、采购、发货和退款会先展示明细，由你确认后提交。
                  </p>
                </div>
              </div>
              <div
                class="space-y-5"
                aria-live="polite"
                aria-relevant="additions"
              >
                <article
                  v-for="message in messages"
                  :key="message.id"
                  :data-message-id="message.id"
                  class="min-w-0"
                >
                  <template v-if="message.role === 'user'">
                    <div class="ml-8 flex justify-end">
                      <div
                        class="max-w-[90%] rounded-2xl rounded-tr-md bg-secondary px-4 py-3 text-sm conversation-text"
                      >
                        {{ message.content }}
                      </div>
                    </div>
                  </template>
                  <template v-else>
                    <ExecutionTrace
                      v-if="!isShop"
                      :events="
                        progressEvents.filter(
                          (event) =>
                            message.run_id && event.runId === message.run_id,
                        )
                      "
                      :timestamp="time(message.created_at)"
                      :connection="streamState" />
                    <div v-else class="mb-2 flex items-center gap-2">
                      <span
                        class="flex size-6 items-center justify-center rounded-md border bg-background"
                        ><Sparkles class="size-3" /></span
                      ><span class="text-xs font-medium">栖禾顾问</span
                      ><span class="text-[10px] text-muted-foreground">{{
                        time(message.created_at)
                      }}</span>
                    </div>
                    <p
                      v-if="
                        !(
                          isShop &&
                          ['查询订单', '查看订单详情', '查询商品'].includes(
                            message.content?.trim(),
                          )
                        )
                      "
                      class="mb-3 text-sm conversation-text"
                    >
                      {{ message.content }}
                    </p>
                    <div class="space-y-3">
                      <ResultCard
                        v-for="(card, i) in message.cards"
                        :key="i"
                        :card="card"
                        :channel="channel"
                        :disabled="busy || operationBusy"
                        @action="act"
                      /></div
                  ></template>
                </article>
                <template v-if="waitingForReply">
                  <ThinkingIndicator v-if="isShop" />
                  <ExecutionTrace
                    v-else
                    :events="
                      progressEvents.filter(
                        (event) => event.runId === pendingReplyRun?.id,
                      )
                    "
                    running
                    :connection="streamState"
                  />
                </template>
                <div
                  v-for="action in pending"
                  :key="action.id"
                  :data-action-id="action.id"
                  class="space-y-3 rounded-xl border-2 border-primary/20 bg-background p-3 sm:p-4"
                >
                  <div class="flex items-center justify-between gap-3">
                    <span class="flex items-center gap-2 text-sm font-medium"
                      ><ClipboardList class="size-4" />请确认这项操作</span
                    ><Badge variant="secondary">{{
                      action.state === "executing" ? "提交中" : "待确认"
                    }}</Badge>
                  </div>
                  <ResultCard
                    :card="action.preview"
                    :channel="channel"
                    compact
                  />
                  <p class="text-xs text-muted-foreground">
                    确认后将更新对应业务记录。
                  </p>
                  <div class="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      :disabled="operationBusy || action.state === 'executing'"
                      @click="confirmAction(action.id, true)"
                      >取消</Button
                    ><Button
                      :disabled="operationBusy || action.state === 'executing'"
                      @click="confirmAction(action.id)"
                      ><LoaderCircle
                        v-if="operationBusy || action.state === 'executing'"
                        class="size-4 animate-spin"
                      /><Check v-else class="size-4" />确认提交</Button
                    >
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div
            class="shrink-0 border-t border-border/60 bg-background/95 px-3 pb-3 pt-2 sm:px-6"
            style="padding-bottom: max(0.75rem, env(safe-area-inset-bottom))"
          >
            <div class="mx-auto" :class="isShop ? 'max-w-3xl' : 'max-w-6xl'">
              <div
                v-if="error"
                role="alert"
                class="mb-3 flex items-start justify-between gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive"
              >
                <span class="flex gap-2"
                  ><CircleAlert class="size-4 shrink-0" />{{ error }}</span
                ><button
                  aria-label="关闭错误提示"
                  class="p-1"
                  @click="error = ''"
                >
                  <X class="size-3.5" />
                </button>
              </div>
              <form
                class="rounded-xl border bg-card p-2 shadow-xs focus-within:ring-2 focus-within:ring-ring/25"
                :class="isShop ? 'shop-composer flex items-end gap-2' : ''"
                @submit.prevent="send()"
              >
                <Textarea
                  v-model="draft"
                  :placeholder="
                    isShop
                      ? '聊穿搭，查订单，随时问我…'
                      : '告诉我你想处理的业务…'
                  "
                  aria-label="输入业务需求"
                  :rows="isShop ? 1 : 2"
                  class="max-h-32 min-h-11 resize-none border-0 px-2 py-2.5 shadow-none focus-visible:ring-0"
                  :class="isShop ? 'flex-1 text-base sm:text-sm' : ''"
                  :disabled="busy"
                  @keydown="onKeydown"
                />
                <div
                  class="flex items-center justify-between"
                  :class="isShop ? 'shrink-0' : 'px-1 pt-1'"
                >
                  <span
                    v-if="!isShop"
                    class="px-1 text-[11px] text-muted-foreground"
                    >{{
                      isShop
                        ? "栖禾，陪你找到适合自己的穿搭。"
                        : "查询 · 分析 · 办理"
                    }}</span
                  ><Button
                    type="submit"
                    size="icon"
                    class="size-11 rounded-lg"
                    :disabled="!draft.trim() || busy || operationBusy"
                    aria-label="发送消息"
                    ><LoaderCircle
                      v-if="busy"
                      class="size-4 animate-spin" /><ArrowUp
                      v-else
                      class="size-4"
                  /></Button>
                </div>
              </form>
              <p
                v-if="!isShop"
                class="mt-2 text-center text-[10px] text-muted-foreground"
              >
                Enter 发送 · Shift + Enter 换行
              </p>
            </div>
          </div>
        </section>
        <aside
          v-if="!isShop"
          class="hidden w-56 shrink-0 flex-col border-l bg-muted/15 px-4 py-5 2xl:flex"
        >
          <div class="mb-5 flex items-center gap-2 text-xs font-medium">
            <ClipboardList class="size-4" />办理记录
          </div>
          <div
            v-if="!calls.length"
            class="rounded-lg border border-dashed p-4 text-xs leading-6 text-muted-foreground"
          >
            开始对话后，你可以在这里查看查询与办理进度。
          </div>
          <div class="min-h-0 flex-1 space-y-5 overflow-y-auto scrollbar-thin">
            <div v-for="call in calls" :key="call.id" class="flex gap-2.5">
              <span class="mt-0.5"
                ><LoaderCircle
                  v-if="call.status === 'running'"
                  class="size-3.5 animate-spin" /><CircleAlert
                  v-else-if="call.status === 'failed'"
                  class="size-3.5 text-destructive" /><Check
                  v-else
                  class="size-3.5 text-muted-foreground"
              /></span>
              <div>
                <div class="text-xs font-medium">{{ call.label }}</div>
                <div class="mt-1 text-[10px] text-muted-foreground">
                  {{ statusLabel(call.status)
                  }}<span v-if="call.duration_ms">
                    · {{ (call.duration_ms / 1000).toFixed(1) }} 秒</span
                  >
                </div>
              </div>
            </div>
          </div>
          <div
            class="mt-4 border-t pt-4 text-[11px] leading-6 text-muted-foreground"
          >
            {{
              pending.length
                ? `${pending.length} 项操作等待你确认`
                : "业务变更均会留存办理记录。"
            }}
          </div>
        </aside>
      </div>
    </div>
  </div>

  <Dialog v-model:open="mobileMenu"
    ><DialogContent class="max-h-[85dvh] max-w-sm overflow-y-auto"
      ><DialogHeader
        ><DialogTitle>{{ isShop ? "我的栖禾" : "业务空间" }}</DialogTitle
        ><DialogDescription
          >{{ user?.name }} ·
          {{ isShop ? "栖禾会员" : "店铺管理" }}</DialogDescription
        ></DialogHeader
      >
      <div v-if="!isShop" class="grid grid-cols-2 gap-2">
        <Button
          v-for="m in modules"
          :key="m.name"
          variant="outline"
          :disabled="busy"
          @click="quickQuery(m.cap, m.args)"
          ><component :is="m.icon" class="size-4" />{{ m.name }}</Button
        >
      </div>
      <Button variant="outline" :disabled="busy" @click="newConversation"
        ><Plus class="size-4" />新建对话</Button
      >
      <div class="space-y-1">
        <Button
          v-for="c in conversations"
          :key="c.id"
          variant="ghost"
          class="w-full justify-start"
          :disabled="busy"
          @click="selectConversation(c)"
          ><MessageSquare class="size-4" /><span class="truncate">{{
            c.title
          }}</span></Button
        >
      </div>
      <Button
        v-if="!isShop"
        variant="outline"
        @click="
          mobileMenu = false;
          openSettings();
        "
        ><Settings2 class="size-4" />智能体设置</Button
      ><Button variant="ghost" @click="logout"
        ><LogOut class="size-4" />退出登录</Button
      ></DialogContent
    ></Dialog
  >
  <Dialog v-model:open="form.open"
    ><DialogContent
      class="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
      :class="isShop ? 'shop-sheet' : ''"
      ><DialogHeader
        ><DialogTitle>{{ form.title }}</DialogTitle
        ><DialogDescription>{{
          form.type === "buy"
            ? "选择适合自己的颜色和尺码。"
            : "核对业务信息后，继续生成确认明细。"
        }}</DialogDescription></DialogHeader
      >
      <form id="operation-form" class="space-y-5" @submit.prevent="submitForm">
        <template v-if="form.type === 'buy' && form.product"
          ><div
            v-if="isShop && form.row.image"
            class="flex items-center gap-4 rounded-xl bg-muted/65 p-3"
          >
            <img
              :src="form.row.image"
              :alt="form.title"
              width="72"
              height="90"
              class="h-[90px] w-[72px] rounded-md object-cover"
            />
            <div>
              <p class="text-[10px] tracking-[.18em] text-muted-foreground">
                QI HE / COLLECTION
              </p>
              <p class="mt-2 text-2xl font-semibold text-primary">
                {{ currency(form.product.rows[0]?.price) }}
              </p>
              <p class="mt-1 text-xs text-muted-foreground">
                选好颜色与尺码，开启新的穿搭。
              </p>
            </div>
          </div>
          <dl class="space-y-2 text-xs text-muted-foreground">
            <div
              v-for="d in form.product.details.filter(
                (d) => !isShop || d.label !== '状态',
              )"
              :key="d.label"
            >
              {{ d.label }}：{{ d.value }}
            </div>
          </dl>
          <template v-if="isShop"
            ><div class="space-y-2">
              <Label>颜色与尺码</Label>
              <div class="grid grid-cols-2 gap-2">
                <Button
                  v-for="sku in form.product.rows"
                  :key="sku.skuId"
                  type="button"
                  :variant="form.skuId === sku.skuId ? 'default' : 'outline'"
                  class="h-auto min-h-11 justify-between gap-2 px-3 py-3 text-xs"
                  :disabled="sku.available < 1"
                  :aria-pressed="form.skuId === sku.skuId"
                  @click="form.skuId = sku.skuId"
                  ><span>{{ sku.color }} / {{ sku.size }}</span
                  ><span class="text-[10px] opacity-70">{{
                    sku.available < 1 ? "售罄" : `余 ${sku.available}`
                  }}</span></Button
                >
              </div>
            </div>
            <div class="grid grid-cols-2 items-end gap-4">
              <div class="space-y-2">
                <Label for="quantity">数量</Label
                ><Input
                  id="quantity"
                  v-model="form.quantity"
                  type="number"
                  min="1"
                  max="200"
                  required
                />
              </div>
              <p class="pb-2 text-right text-lg font-semibold">
                {{
                  currency(
                    (form.product.rows[0]?.price || 0) * Number(form.quantity),
                  )
                }}
              </p>
            </div>
            <div class="space-y-2">
              <Label for="address">收货地址</Label
              ><select
                id="address"
                v-model="form.addressId"
                class="h-11 w-full min-w-0 rounded-md border bg-background px-3 text-sm"
                required
              >
                <option value="" disabled>请选择收货地址</option>
                <option v-for="a in form.addresses" :key="a.id" :value="a.id">
                  {{ a.recipient }} · {{ a.address }}
                </option>
              </select>
              <p
                v-if="!form.addresses.length"
                class="text-xs text-muted-foreground"
              >
                请在对话中提供收件人、联系电话和地址，先新增收货地址。
              </p>
            </div></template
          ><ResultCard v-else :card="form.product" :channel="channel"
        /></template>
        <template v-if="form.type === 'orders_ship'"
          ><div class="rounded-lg bg-muted px-3 py-2 text-xs">
            订单：{{ form.row.id }}
          </div>
          <div class="space-y-2">
            <Label for="carrier">快递公司</Label
            ><Input id="carrier" v-model="form.carrier" required />
          </div>
          <div class="space-y-2">
            <Label for="tracking">运单号</Label
            ><Input
              id="tracking"
              v-model="form.tracking"
              required
              minlength="6"
              placeholder="填写包裹运单号"
            /></div
        ></template>
        <template v-if="form.type === 'aftersales_apply'"
          ><div class="rounded-lg bg-muted p-3 text-sm">
            订单 {{ form.row.id }}
            <div class="mt-1 text-xs text-muted-foreground">
              整单退款金额 {{ currency(form.row.total) }}
            </div>
          </div>
          <div class="space-y-2">
            <Label for="reason">申请原因</Label
            ><Textarea
              id="reason"
              v-model="form.reason"
              placeholder="请告诉我们需要退货的原因"
              required
              maxlength="300"
            /></div
        ></template>
        <template v-if="form.type === 'aftersales_review'"
          ><div class="rounded-lg bg-muted p-3 text-sm">
            <p>{{ form.row.reason }}</p>
            <p class="mt-2 text-xs text-muted-foreground">
              退款金额 {{ currency(form.row.amount) }}
            </p>
          </div>
          <div class="space-y-2">
            <Label for="approve">审核结果</Label
            ><select
              id="approve"
              v-model="form.approve"
              class="h-11 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="yes">审核通过</option>
              <option value="no">拒绝申请</option>
            </select>
          </div></template
        >
        <template v-if="form.type === 'purchases_create'"
          ><div class="rounded-lg bg-muted p-3 text-sm">
            <p>
              {{ form.row.name }} · {{ form.row.color }} / {{ form.row.size }}
            </p>
            <p class="mt-2 text-xs text-muted-foreground">
              {{ form.row.supplier }} · 采购单价 {{ currency(form.row.cost) }}
            </p>
          </div>
          <div class="space-y-2">
            <Label for="purchase-quantity">采购数量</Label
            ><Input
              id="purchase-quantity"
              v-model="form.quantity"
              type="number"
              min="1"
              max="200"
              required
            />
          </div>
          <p class="text-right text-sm">
            合计
            <strong>{{
              currency(Number(form.quantity) * form.row.cost)
            }}</strong>
          </p></template
        >
        <p v-if="error" role="alert" class="text-sm text-destructive">
          {{ error }}
        </p>
      </form>
      <DialogFooter
        ><Button
          variant="outline"
          :disabled="operationBusy"
          @click="form.open = false"
          >返回</Button
        ><Button
          v-if="form.type !== 'buy' || isShop"
          type="submit"
          form="operation-form"
          :disabled="operationBusy"
          ><LoaderCircle
            v-if="operationBusy"
            class="size-4 animate-spin" />核对并继续<ChevronRight
            v-if="!operationBusy"
            class="size-4" /></Button></DialogFooter></DialogContent
  ></Dialog>
  <Dialog v-model:open="settingsOpen"
    ><DialogContent class="max-h-[90dvh] overflow-y-auto sm:max-w-3xl"
      ><DialogHeader
        ><DialogTitle>智能体设置</DialogTitle
        ><DialogDescription
          >维护业务编排与查看当前可用能力。</DialogDescription
        ></DialogHeader
      ><Tabs v-model="settingsTab"
        ><TabsList
          ><TabsTrigger value="prompts">业务编排</TabsTrigger
          ><TabsTrigger value="capabilities">能力目录</TabsTrigger
          ><TabsTrigger value="model">模型连接</TabsTrigger></TabsList
        ><TabsContent value="prompts" class="space-y-4 pt-3"
          ><div class="space-y-2">
            <Label for="prompt-role">适用入口</Label
            ><select
              id="prompt-role"
              v-model="promptRole"
              class="h-10 w-full rounded-md border bg-background px-3 text-sm"
              @change="loadPrompt"
            >
              <option value="admin">后台经营助手</option>
              <option value="customer">商城购物顾问</option>
            </select>
          </div>
          <div class="space-y-2">
            <Label for="prompt-content">编排提示词</Label
            ><Textarea
              id="prompt-content"
              v-model="promptDraft"
              class="min-h-72 text-sm leading-7"
            />
          </div>
          <p v-if="success" role="status" class="text-sm text-emerald-700">
            {{ success }}
          </p>
          <p v-if="error" role="alert" class="text-sm text-destructive">
            {{ error }}
          </p>
          <Button :disabled="operationBusy" @click="savePrompt"
            >保存编排</Button
          ></TabsContent
        ><TabsContent value="capabilities" class="divide-y"
          ><div v-for="c in settings?.capabilities" :key="c.name" class="py-3">
            <div class="flex items-center gap-2 text-sm font-medium">
              {{ c.label
              }}<Badge variant="outline" class="font-normal">{{
                c.write ? "确认后办理" : "查询"
              }}</Badge>
            </div>
            <p class="mt-1 text-xs leading-6 text-muted-foreground">
              {{ c.description }}
            </p>
          </div></TabsContent
        ><TabsContent value="model"
          ><div class="my-4 rounded-lg border p-4">
            <div class="mb-2 text-xs text-muted-foreground">当前模型</div>
            <p class="text-sm font-medium">{{ settings?.model }}</p>
            <p class="mt-4 text-xs leading-6 text-muted-foreground">
              连接配置由服务端管理。每次办理记录会保存所用模型和编排版本。
            </p>
          </div></TabsContent
        ></Tabs
      ></DialogContent
    ></Dialog
  >
</template>
