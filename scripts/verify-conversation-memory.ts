import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { database } from "../shared/db.ts";
import { loadMemory, loadReferences } from "../apps/agent/memory.ts";

const pool = database("agent");
const base = "http://127.0.0.1:5180/api";
const password = readFileSync(".local/登录账号.txt", "utf8").match(
  /初始密码：([^\r\n]+)/,
)![1];
async function login(login: string, channel = "shop") {
  const r = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-client": channel },
    body: JSON.stringify({ login, password }),
  });
  assert.equal(r.status, 200);
  return {
    "content-type": "application/json",
    "x-client": channel,
    cookie: r.headers.get("set-cookie")!.split(";")[0],
  };
}
async function request(
  headers: Record<string, string>,
  path: string,
  body?: unknown,
) {
  const r = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value: any = await r.json();
  assert.ok(r.ok, `${r.status} ${JSON.stringify(value)}`);
  return value;
}
const reports: any[] = [];
const output = "output/conversation-memory-verification.json";
mkdirSync("output", { recursive: true });
function save(status: string) {
  writeFileSync(
    output,
    JSON.stringify({ at: new Date().toISOString(), status, reports }, null, 2),
  );
}
async function turn(
  headers: Record<string, string>,
  conversationId: string,
  message: string,
) {
  const start = Date.now();
  const { runId } = await request(
    headers,
    `/conversations/${conversationId}/messages`,
    { message },
  );
  for (;;) {
    if (Date.now() - start > 180000) throw new Error("Turn timed out");
    const snapshot = await request(headers, `/conversations/${conversationId}`);
    const run = snapshot.runs.find((row: any) => row.id === runId);
    if (run?.status !== "running") {
      assert.equal(
        run?.status,
        "succeeded",
        `${runId}: ${snapshot.messages.at(-1)?.content}`,
      );
      const memory = await request(
        headers,
        `/conversations/${conversationId}/memory`,
      );
      const calls = (
        await pool.query(
          "SELECT capability,arguments,status FROM agent.tool_calls WHERE run_id=$1 ORDER BY created_at,id",
          [runId],
        )
      ).rows;
      const report = {
        conversationId,
        runId,
        message,
        response: snapshot.messages.at(-1),
        calls,
        memory,
        context: run.context_stats,
        durationMs: Date.now() - start,
      };
      reports.push(report);
      save("running");
      assert.doesNotMatch(
        report.response.content,
        /历史业务卡片|历史对话数据|sourceMessageId|products_search|products_detail/,
        "Internal context metadata must not leak into UI replies",
      );
      console.log(
        JSON.stringify({
          message,
          calls: calls.map((c) => ({ name: c.capability, args: c.arguments })),
          durationMs: report.durationMs,
        }),
      );
      assert.ok(run.context_stats.length);
      assert.ok(run.context_stats.every((s: any) => s.characters <= 60000));
      return report;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
try {
  const shop = await login("zhixia"),
    other = await login("wanyu"),
    admin = await login("qihe", "admin");
  const { id } = await request(shop, "/conversations", {});
  let report = await turn(
    shop,
    id,
    "帮我找上班穿的裙子，500元以内，先给我看看商品。",
  );
  assert.equal(report.memory.facts.maxPriceCents.value, 50000);
  assert.ok(report.memory.facts.category && report.memory.facts.occasion);
  assert.ok(
    report.calls.some(
      (call) =>
        call.capability === "products_search" &&
        call.arguments.maxPrice === 50000,
    ),
  );
  assert.ok(
    report.memory.references.products.length >= 2,
    "Need two actual product cards for ordinal test",
  );

  report = await turn(shop, id, "不要黑色，其他要求保持不变。");
  assert.ok(
    report.calls.some((call) =>
      ["products_search", "products_detail"].includes(call.capability),
    ),
    "Updated product recommendation must use fresh business facts",
  );
  assert.equal(report.memory.facts.maxPriceCents.value, 50000);
  assert.ok(
    report.memory.facts.excludedColors.value.some((color: string) =>
      color.includes("黑"),
    ),
  );
  const secondProduct = report.memory.references.products[1];
  assert.ok(secondProduct, "Previous two-product list must remain available");
  report = await turn(shop, id, "刚才商品卡片里的第二款有M码吗？");
  assert.equal(
    report.memory.facts.size,
    undefined,
    "Availability question is not a confirmed size preference",
  );
  assert.ok(
    report.calls.some(
      (call) =>
        call.capability === "products_detail" &&
        call.arguments.id === secondProduct.id,
    ),
    "Ordinal must resolve to displayed second product",
  );

  report = await turn(
    shop,
    id,
    "我需要M码，预算改成300元，再按刚才的要求找找。",
  );
  assert.equal(report.memory.facts.maxPriceCents.value, 30000);
  assert.ok(
    report.memory.facts.excludedColors.value.some((color: string) =>
      color.includes("黑"),
    ),
  );
  assert.ok(
    report.calls.some(
      (call) =>
        call.capability === "products_search" &&
        call.arguments.maxPrice === 30000,
    ),
  );
  assert.ok(
    report.calls.some((call) => call.capability === "products_detail"),
    "Specific size availability must be refreshed from SKU details",
  );

  // Deterministic history pressure: insert only neutral test messages into THIS new test conversation.
  // These are explicitly fixtures, not claimed to be 20 live model turns.
  for (let i = 0; i < 10; i++) {
    await pool.query(
      "INSERT INTO agent.messages(id,conversation_id,role,content) VALUES($1,$2,'user',$3)",
      [randomUUID(), id, `谢谢，先不用操作。（验证用闲聊 ${i + 1}）`],
    );
    await pool.query(
      "INSERT INTO agent.messages(id,conversation_id,role,content) VALUES($1,$2,'assistant',$3)",
      [randomUUID(), id, "好的，有需要再告诉我。"],
    );
  }
  report = await turn(shop, id, "还是按刚才的选购要求推荐，请重新查一下商品。");
  assert.equal(report.memory.facts.maxPriceCents.value, 30000);
  assert.ok(report.memory.facts.occasion);
  assert.ok(
    ["M", "M码"].includes(report.memory.facts.size.value),
    "Model retains the expressed size without a code normalizer",
  );
  assert.ok(
    report.memory.facts.excludedColors.value.some((color: string) =>
      color.includes("黑"),
    ),
  );
  assert.ok(
    report.calls.some(
      (call) =>
        call.capability === "products_search" &&
        call.arguments.maxPrice === 30000,
    ),
  );
  assert.ok(report.context.every((s: any) => s.recentMessageCount === 12));
  assert.ok(
    report.calls.some((call) => call.capability === "products_detail"),
    "Long-history recommendations must refresh size-specific stock",
  );
  reports.push({
    check: "long-context",
    fixtureMessages: 20,
    recentWindow: 12,
    originalRequirementsOutsideWindow: true,
  });

  const persisted = await loadMemory(pool, id, "U002");
  assert.equal(persisted.facts.maxPriceCents?.value, 30000);
  await assert.rejects(loadMemory(pool, id, "U003"), { status: 404 });
  const denied = await fetch(`${base}/conversations/${id}/memory`, {
    headers: other,
  });
  assert.equal(denied.status, 404);
  const newChat = await request(shop, "/conversations", {});
  const otherChat = await request(other, "/conversations", {});
  assert.deepEqual(
    (await request(shop, `/conversations/${newChat.id}/memory`)).facts,
    {},
  );
  assert.deepEqual(
    (await request(other, `/conversations/${otherChat.id}/memory`)).facts,
    {},
  );
  reports.push({
    check: "isolation-and-persistence",
    conversationId: id,
    newConversationId: newChat.id,
    otherConversationId: otherChat.id,
    passed: true,
  });

  report = await turn(shop, id, "颜色不限了，尺码也先不限，预算还是300元。");
  assert.ok(
    !report.memory.facts.excludedColors ||
      report.memory.facts.excludedColors.value.length === 0,
  );
  assert.ok(
    !report.memory.facts.preferredColors ||
      report.memory.facts.preferredColors.value.length === 0,
  );
  assert.equal(report.memory.facts.size, undefined);
  assert.equal(report.memory.facts.maxPriceCents.value, 30000);

  report = await turn(
    shop,
    id,
    "忘掉之前的选购要求，这次给妈妈买外套。先问我需要什么，不要查询商品。",
  );
  assert.equal(report.memory.facts.maxPriceCents, undefined);
  assert.equal(report.memory.facts.occasion, undefined);
  assert.ok(String(report.memory.facts.recipient.value).includes("妈"));
  assert.deepEqual(report.memory.references.products, []);
  assert.equal(report.memory.references.focusedProduct, null);
  assert.equal(report.calls.length, 0);
  assert.equal(
    (await loadReferences(pool, id, "U003", null)).products.length,
    0,
  );

  const adminChat = await request(admin, "/conversations", {});
  report = await turn(
    admin,
    adminChat.id,
    "查询2026年10月28日的销售收款和退款合计。",
  );
  assert.ok(report.calls.some((call) => call.capability === "finance_summary"));
  reports.push({ check: "admin-query-regression", passed: true });
  save("passed");
  console.log(
    "PASS: live multi-turn shopping, corrections, ordinal IDs, long-context fixtures, persistence, isolation, reset, admin regression",
  );
} catch (error) {
  reports.push({
    error: error instanceof Error ? error.message : "Unknown failure",
  });
  save("failed");
  throw error;
} finally {
  await pool.end();
}
