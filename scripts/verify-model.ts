import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
const base = "http://127.0.0.1:3180/api";
const password = readFileSync(".local/登录账号.txt", "utf8").match(
  /初始密码：([^\r\n]+)/,
)![1];
const results = [];
for (const [channel, login, message] of [
  ["shop", "zhixia", "推荐两件 400 元以内的通勤针织衫，告诉我面料和价格。"],
  ["admin", "qihe", "查看待发货订单，并找出需要补货的规格。"],
]) {
  const loginResponse = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-client": channel },
    body: JSON.stringify({ login, password }),
  });
  assert.equal(loginResponse.status, 200);
  const cookie = loginResponse.headers.get("set-cookie")!.split(";")[0];
  const headers = {
    "content-type": "application/json",
    "x-client": channel,
    cookie,
  };
  const conversation = (await (
    await fetch(`${base}/conversations`, {
      method: "POST",
      headers,
      body: "{}",
    })
  ).json()) as any;
  const response = await fetch(
    `${base}/conversations/${conversation.id}/messages`,
    { method: "POST", headers, body: JSON.stringify({ message }) },
  );
  assert.equal(response.status, 202);
  let snapshot: any;
  const started = Date.now();
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    snapshot = await (
      await fetch(`${base}/conversations/${conversation.id}`, { headers })
    ).json();
    if (snapshot.runs[0]?.status !== "running") break;
  }
  const run = snapshot.runs[0];
  console.log(
    JSON.stringify({
      channel,
      status: run?.status,
      seconds: Math.round((Date.now() - started) / 1000),
      calls: snapshot.calls?.map((c: any) => ({
        label: c.label,
        status: c.status,
      })),
      reply: snapshot.messages.at(-1)?.content,
    }),
  );
  assert.equal(run.status, "succeeded");
  assert.ok(snapshot.calls.some((c: any) => c.status === "succeeded"));
  assert.ok(snapshot.messages.at(-1).cards.length);
  results.push({
    channel,
    conversationId: conversation.id,
    status: run.status,
    calls: snapshot.calls.map((c: any) => ({
      label: c.label,
      status: c.status,
    })),
    reply: snapshot.messages.at(-1).content,
  });
}
mkdirSync("output", { recursive: true });
writeFileSync(
  "output/model-verification.json",
  JSON.stringify({ at: new Date().toISOString(), results }, null, 2),
);
