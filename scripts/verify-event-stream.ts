import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { readSSE } from "../shared/sse.ts";
import type { ProgressEvent } from "../shared/events.ts";
const base = "http://127.0.0.1:5180/api";
const password = readFileSync(".local/登录账号.txt", "utf8").match(
  /初始密码：([^\r\n]+)/,
)![1];
async function login(channel: string, user: string) {
  const response = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-client": channel },
    body: JSON.stringify({ login: user, password }),
  });
  assert.equal(response.status, 200);
  return {
    "content-type": "application/json",
    "x-client": channel,
    cookie: response.headers.get("set-cookie")!.split(";")[0],
  };
}
async function request(
  headers: Record<string, string>,
  path: string,
  body?: any,
) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: any = await response.json();
  assert.ok(response.ok, JSON.stringify(data));
  return data;
}
async function collect(
  headers: Record<string, string>,
  id: string,
  afterId = "0",
  stop = (event: ProgressEvent) =>
    event.type === "run-completed" || event.type === "run-failed",
) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("SSE verification timeout")),
    120000,
  );
  const response = await fetch(`${base}/conversations/${id}/events/stream`, {
    method: "POST",
    headers: { ...headers, Accept: "text/event-stream" },
    body: JSON.stringify({ afterId }),
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type")!, /text\/event-stream/);
  const events: (ProgressEvent & { receivedAt: number })[] = [];
  let readyResolve: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });
  const done = readSSE(response.body!, (frame) => {
    const data = JSON.parse(frame.data);
    if (data.type === "stream-ready") {
      readyResolve();
      return;
    }
    events.push({ ...data, receivedAt: Date.now() });
    if (stop(data)) controller.abort();
  })
    .catch((error) => {
      if (
        !controller.signal.aborted ||
        controller.signal.reason?.message === "SSE verification timeout"
      )
        throw error;
    })
    .finally(() => clearTimeout(timeout));
  return { events, ready, done };
}
const admin = await login("admin", "qihe"),
  shop = await login("shop", "zhixia"),
  other = await login("shop", "wanyu");
const reports: any[] = [];
for (const [channel, headers, message, reconnect] of [
  ["admin", admin, "查看待发货订单，并找出需要补货的规格。", true],
  ["shop", shop, "推荐两件 400 元以内的通勤针织衫，说明面料和价格。", false],
] as const) {
  const conversation = await request(headers, "/conversations", {});
  const denied = await fetch(
    `${base}/conversations/${conversation.id}/events/stream`,
    { method: "POST", headers: other, body: "{}" },
  );
  assert.equal(denied.status, 404);
  const first = await collect(headers, conversation.id, "0", (event) =>
    reconnect
      ? event.type === "analysis-summary"
      : event.type === "run-completed" || event.type === "run-failed",
  );
  await first.ready;
  const started = Date.now();
  const accepted = await request(
    headers,
    `/conversations/${conversation.id}/messages`,
    { message },
  );
  assert.ok(accepted.runId);
  await first.done;
  let events = first.events;
  if (reconnect) {
    const continuation = await collect(
      headers,
      conversation.id,
      events.at(-1)!.id,
    );
    await continuation.done;
    events = [...events, ...continuation.events];
  }
  const snapshot = await request(headers, `/conversations/${conversation.id}`);
  assert.equal(
    snapshot.runs[0].status,
    "succeeded",
    JSON.stringify(snapshot.messages.at(-1)),
  );
  assert.equal(events.at(-1)?.type, "run-completed");
  assert.ok(events.some((e) => e.type === "analysis-summary" && e.streaming));
  assert.ok(
    events.some((e) => e.type === "analysis-summary" && e.streaming === false),
  );
  assert.ok(events.some((e) => e.type === "tool-started"));
  assert.ok(events.some((e) => e.type === "tool-completed"));
  assert.deepEqual(
    events.map((e) => e.id),
    snapshot.events.map((e: any) => e.id),
  );
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
  assert.ok(snapshot.messages.every((m: any) => m.run_id === accepted.runId));
  assert.ok(
    events.find((e) => e.type === "analysis-summary")!.receivedAt <
      events.at(-1)!.receivedAt,
  );
  const report = {
    channel,
    conversationId: conversation.id,
    eventCount: events.length,
    firstEventMs: events[0].receivedAt - started,
    firstAnalysisMs:
      events.find((e) => e.type === "analysis-summary")!.receivedAt - started,
    completedMs: events.at(-1)!.receivedAt - started,
    reconnectReplayVerified: reconnect,
    ownershipVerified: true,
  };
  reports.push(report);
  console.log(JSON.stringify(report));
}
const orders = await request(shop, "/business/query", {
  capability: "orders_list",
  arguments: { status: "待付款" },
});
assert.ok(
  orders.rows.length,
  "A pending order is needed for confirmation-only validation",
);
const target = orders.rows[0];
const conversation = await request(shop, "/conversations", {});
const stream = await collect(shop, conversation.id);
await stream.ready;
await request(shop, `/conversations/${conversation.id}/messages`, {
  message: `请帮我取消订单 ${target.id}，先准备取消确认。`,
});
await stream.done;
const snapshot = await request(shop, `/conversations/${conversation.id}`);
assert.equal(snapshot.runs[0].status, "succeeded");
assert.equal(snapshot.actions.length, 1);
assert.equal(snapshot.actions[0].state, "pending");
assert.ok(stream.events.some((e) => e.type === "confirmation-required"));
const unchanged = await request(shop, "/business/query", {
  capability: "orders_detail",
  arguments: { id: target.id },
});
assert.equal(
  unchanged.details.find((d: any) => d.label === "状态").value,
  "待付款",
);
await request(shop, `/actions/${snapshot.actions[0].id}/cancel`, {});
const cancelled = await request(shop, `/conversations/${conversation.id}`);
assert.equal(cancelled.events.at(-1).type, "action-cancelled");
reports.push({
  channel: "shop",
  conversationId: conversation.id,
  confirmationRequired: true,
  businessUnchangedBeforeConfirmation: true,
  cancellationEventVerified: true,
});
writeFileSync(
  "output/event-stream-verification.json",
  JSON.stringify({ at: new Date().toISOString(), reports }, null, 2),
);
console.log(
  "PASS: live model streaming for both roles, incremental analysis, Vite proxy, exact replay, isolation, confirmation boundary, cancellation event",
);
