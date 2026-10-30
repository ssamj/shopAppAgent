import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { database } from "../shared/db.ts";
import {
  loadMemory,
  loadReferences,
  updateMemory,
} from "../apps/agent/memory.ts";
import { buildContext } from "../apps/agent/context.ts";
import { result } from "../apps/business/contracts.ts";

// All fixtures are rolled back. Model transport is stubbed; no external model or business writes.
const pool = database("agent"),
  client = await pool.connect();
const db = { query: client.query.bind(client) } as unknown as pg.Pool;
const originalFetch = globalThis.fetch;
let answer: unknown;
const tools = [
  { name: "products_search", write: false },
  { name: "products_detail", write: false },
];
let modelCalls = 0;
globalThis.fetch = async () => {
  modelCalls++;
  return new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(answer) }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
};
try {
  await client.query("BEGIN");
  const conversationId = randomUUID(),
    runId = randomUUID();
  await client.query(
    "INSERT INTO agent.conversations(id,account_id,title) VALUES($1,'U002','[回滚验证夹具]会话记忆')",
    [conversationId],
  );
  await client.query(
    "INSERT INTO agent.runs(id,conversation_id,status,prompt_version,model) VALUES($1,$2,'running',1,'test-fixture')",
    [runId, conversationId],
  );
  let sequence = 0;
  async function message(
    role: string,
    content: string,
    cards: unknown[] = [],
    run: string | null = null,
  ) {
    const id = randomUUID();
    await client.query(
      "INSERT INTO agent.messages(id,conversation_id,role,content,cards,run_id,created_at) VALUES($1,$2,$3,$4,$5,$6,now()+($7::int * interval '1 millisecond'))",
      [
        id,
        conversationId,
        role,
        content,
        JSON.stringify(cards),
        run,
        sequence++,
      ],
    );
    return id;
  }
  const first = await message("user", "预算500元");
  answer = {
    evidenceRequirements: [],
    summary: "预算500元",
    reset: null,
    changes: [
      {
        key: "maxPriceCents",
        value: 50000,
        sourceMessageId: first,
        quote: "预算500元",
      },
    ],
  };
  const initial = await updateMemory(db, conversationId, "U002", tools);
  assert.equal(initial.facts.maxPriceCents?.value, 50000);
  assert.deepEqual(await loadMemory(db, conversationId, "U002"), initial);
  await assert.rejects(updateMemory(db, conversationId, "U003", tools), {
    status: 404,
  });

  const second = await message("user", "预算改成300元");
  answer = {
    evidenceRequirements: [],
    summary: "预算300元",
    reset: null,
    changes: [
      {
        key: "maxPriceCents",
        value: 30000,
        sourceMessageId: "wrong-source",
        quote: "预算改成300元",
      },
    ],
  };
  const callsBeforeInvalid = modelCalls;
  await assert.rejects(updateMemory(db, conversationId, "U002", tools), {
    code: "MEMORY_SOURCE_INVALID",
  });
  assert.equal(
    modelCalls - callsBeforeInvalid,
    1,
    "Invalid extraction fails without model retry",
  );
  assert.deepEqual(
    await loadMemory(db, conversationId, "U002"),
    initial,
    "Failed extraction must not advance watermark or overwrite memory",
  );
  answer = {
    evidenceRequirements: [],
    summary: "预算300元",
    reset: null,
    changes: [
      {
        key: "maxPriceCents",
        value: 30000,
        sourceMessageId: second,
        quote: "预算改成300元",
      },
    ],
  };
  const corrected = await updateMemory(db, conversationId, "U002", tools);
  assert.equal(corrected.lastUserMessageId, second);
  assert.equal(corrected.facts.maxPriceCents?.value, 30000);
  const excluded = await message("user", "不要黑色");
  answer = {
    summary: "预算300元，不要黑色",
    evidenceRequirements: [
      { anyOf: [{ capability: "products_search", outcome: "success" }] },
    ],
    reset: null,
    changes: [
      {
        key: "excludedColors",
        value: ["黑色"],
        sourceMessageId: excluded,
        quote: "不要黑色",
      },
    ],
  };
  const colorContext = await buildContext(
    db,
    conversationId,
    runId,
    { id: "U002", name: "验证顾客", role: "customer", customerId: "C001" },
    { content: "验证", version: 1 },
    tools,
  );
  assert.deepEqual(
    colorContext.evidenceRequirements,
    (answer as any).evidenceRequirements,
  );
  const size = await message("user", "我需要M码");
  answer = {
    summary: "预算300元，不要黑色，需要M码",
    evidenceRequirements: [
      {
        anyOf: [
          { capability: "products_detail", outcome: "success" },
          { capability: "products_search", outcome: "empty" },
        ],
      },
    ],
    reset: null,
    changes: [
      { key: "size", value: "M", sourceMessageId: size, quote: "我需要M码" },
    ],
  };
  const sizeContext = await buildContext(
    db,
    conversationId,
    runId,
    { id: "U002", name: "验证顾客", role: "customer", customerId: "C001" },
    { content: "验证", version: 1 },
    tools,
  );
  assert.deepEqual(
    sizeContext.evidenceRequirements,
    (answer as any).evidenceRequirements,
    "Context carries validated model requirements without field-specific routing",
  );

  const cards = [
    {
      ...result("夹具商品", [
        { id: "fixture-P1", name: "夹具甲" },
        { id: "fixture-P2", name: "夹具乙" },
      ]),
      capability: "products_search",
    },
  ];
  const listId = await message(
    "assistant",
    "夹具回复：历史售价99.77元，M码有888件",
    cards,
  );
  const historical = await buildContext(
    db,
    conversationId,
    runId,
    { id: "U002", name: "验证顾客", role: "customer", customerId: "C001" },
    { content: "验证", version: 1 },
    tools,
  );
  assert.ok(
    !historical.messages.some(
      (m) => m.content.includes("99.77") || m.content.includes("888件"),
    ),
    "Historical product prose must not reintroduce stale price/stock",
  );
  await message("assistant", "夹具详情", [
    {
      ...result("夹具乙", [], [], { referenceId: "fixture-P2" }),
      capability: "products_detail",
    },
  ]);
  let references = await loadReferences(db, conversationId, "U002", null);
  assert.deepEqual(
    references.products.map((p) => p.id),
    ["fixture-P1", "fixture-P2"],
  );
  assert.equal(references.sourceMessageId, listId);
  assert.equal(references.focusedProduct?.id, "fixture-P2");
  assert.deepEqual(
    (await loadReferences(db, conversationId, "U003", null)).products,
    [],
  );
  await message("assistant", "新一组夹具商品", [
    {
      ...result("夹具商品", [{ id: "fixture-P3", name: "夹具丙" }]),
      capability: "products_search",
    },
  ]);
  references = await loadReferences(db, conversationId, "U002", null);
  assert.equal(
    references.focusedProduct,
    null,
    "New list invalidates previous focused product",
  );
  await message("assistant", "空结果夹具", [
    { ...result("无匹配商品"), capability: "products_search" },
  ]);
  assert.deepEqual(
    (await loadReferences(db, conversationId, "U002", null)).products,
    [],
    "Empty result must not restore an older list",
  );

  const resetId = await message("user", "忘掉之前的选购要求", [], runId);
  answer = {
    evidenceRequirements: [],
    summary: "",
    reset: { sourceMessageId: resetId, quote: "忘掉之前的选购要求" },
    changes: [],
  };
  const reset = await updateMemory(db, conversationId, "U002", tools);
  assert.deepEqual(reset.facts, {});
  assert.deepEqual(
    (await loadReferences(db, conversationId, "U002", reset.resetMessageId))
      .products,
    [],
  );
  const context = await buildContext(
    db,
    conversationId,
    runId,
    { id: "U002", name: "验证顾客", role: "customer", customerId: "C001" },
    { content: "验证", version: 1 },
    tools,
  );
  assert.equal(
    context.recentMessageCount,
    1,
    "Reset removes pre-reset history from model context",
  );
  assert.equal(context.messages.at(-1)?.pinned, true);
  assert.ok(!context.messages.some((m) => m.content.includes("夹具乙")));
  console.log(
    "PASS: transactional persistence, ownership, fail-fast without retry, watermark protection, exact product order, fresh-list focus, empty results, reset boundary",
  );
} finally {
  globalThis.fetch = originalFetch;
  await client.query("ROLLBACK");
  client.release();
  await pool.end();
}
