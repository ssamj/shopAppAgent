import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
import { config } from "../shared/config.ts";
const password = readFileSync(".local/登录账号.txt", "utf8").match(
  /初始密码：([^\r\n]+)/,
)![1];
const base = "http://127.0.0.1:3180/api";
const login = await fetch(`${base}/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-client": "shop" },
  body: JSON.stringify({ login: "zhixia", password }),
});
assert.equal(login.status, 200);
const headers = {
  "content-type": "application/json",
  "x-client": "shop",
  cookie: login.headers.get("set-cookie")!.split(";")[0],
};
async function request(path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.ok(response.ok);
  return response.json() as Promise<any>;
}
const db = new pg.Client(config().database);
await db.connect();
try {
  const before = (await db.query("SELECT count(*)::int n FROM business.orders"))
    .rows[0].n;
  const conversation = await request("/conversations", {});
  await request(`/conversations/${conversation.id}/messages`, {
    message:
      "我要买云感羊毛圆领针织衫，燕麦白 M 码 1 件，寄我的默认收货地址。请准备订单。",
  });
  let snapshot: any;
  const started = Date.now();
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 1200));
    snapshot = await request(`/conversations/${conversation.id}`);
    if (snapshot.runs[0]?.status !== "running") break;
  }
  assert.equal(snapshot.runs[0].status, "succeeded");
  assert.equal(snapshot.actions.length, 1);
  assert.equal(snapshot.actions[0].state, "pending");
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM business.orders")).rows[0].n,
    before,
  );
  await request(`/actions/${snapshot.actions[0].id}/cancel`, {});
  const result = {
    at: new Date().toISOString(),
    seconds: Math.round((Date.now() - started) / 1000),
    conversationId: conversation.id,
    status: snapshot.runs[0].status,
    calls: snapshot.calls.map((c: any) => ({
      label: c.label,
      status: c.status,
    })),
    orderCountUnchanged: true,
    reply: snapshot.messages.at(-1).content,
  };
  writeFileSync(
    "output/model-write-verification.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await db.end();
}
