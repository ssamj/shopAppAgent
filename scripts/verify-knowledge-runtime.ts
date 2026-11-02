import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { database } from "../shared/db.ts";
import { config } from "../shared/config.ts";
import { run } from "../apps/agent/runtime.ts";
import type { KnowledgeSource } from "../shared/knowledge.ts";

if (
  !process.env.QIHE_CONFIG_PATH ||
  !config().database.database.includes("episode05")
)
  throw Error("Use the isolated episode05 config");
const pool = database("agent"),
  originalFetch = globalThis.fetch,
  reports: any[] = [];
let scenario = "",
  decisions = 0;
globalThis.fetch = async (input, init) => {
  if (!String(input).endsWith("/chat/completions"))
    return originalFetch(input, init);
  const request = JSON.parse(String(init?.body));
  let payload: any;
  if (request.messages[0].content.includes("只整理当前会话"))
    payload = {
      summary: "仅做商品资料验证",
      evidenceRequirements: [
        { anyOf: [{ capability: "knowledge_search", outcome: "success" }] },
      ],
      reset: null,
      changes: [],
    };
  else {
    decisions++;
    const message = request.messages.at(-1).content;
    if (decisions === 1)
      payload = {
        analysisSummary: "查询对应商品资料。",
        message: "",
        calls: [
          {
            name: "knowledge_search",
            arguments: {
              query: "洗涤方式",
              productIds: ["P009"],
              limitPerProduct: scenario === "invalid-tool-input" ? 0 : 1,
            },
          },
        ],
      };
    else if (scenario === "unstructured-answer")
      payload = {
        analysisSummary: "资料已返回。",
        message: "不附来源的确定结论。",
        calls: [],
      };
    else {
      const tool = JSON.parse(message.slice(message.indexOf('{"title":'))),
        source = tool.sources[0] as KnowledgeSource;
      payload = {
        analysisSummary: "根据资料回答。",
        message: "",
        calls: [],
        answerBlocks: [
          {
            kind: scenario === "valid-limitation" ? "limitation" : "fact",
            text:
              scenario === "valid-limitation"
                ? "本轮资料没有该项试验，无法保证。"
                : "模型夹具中的待校验结论。",
            productIds: [scenario === "wrong-product" ? "P001" : "P009"],
            citations:
              scenario === "valid-limitation"
                ? []
                : [
                    {
                      sourceId:
                        scenario === "forged-source"
                          ? "not-retrieved"
                          : source.id,
                      ...(scenario === "altered-quote"
                        ? { quote: "资料中不存在的句子" }
                        : {}),
                    },
                  ],
          },
        ],
      };
    }
  }
  return new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(payload) }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
};
try {
  const prompt = (
    await pool.query(
      "SELECT content,version FROM agent.prompts WHERE role='customer'",
    )
  ).rows[0];
  for (const [name, expected] of [
    ["forged-source", "ANSWER_SOURCE_INVALID"],
    ["altered-quote", "MODEL_RESULT_INVALID"],
    ["wrong-product", "ANSWER_PRODUCT_SOURCE_MISMATCH"],
    ["unstructured-answer", "ANSWER_SOURCES_REQUIRED"],
    ["invalid-tool-input", "INVALID_ARGUMENTS"],
    ["valid-limitation", null],
  ] as const) {
    scenario = name;
    decisions = 0;
    const id = randomUUID(),
      runId = randomUUID();
    await pool.query(
      "INSERT INTO agent.conversations(id,account_id,title) VALUES($1,'U002','[夹具]引用边界验证')",
      [id],
    );
    await pool.query(
      "INSERT INTO agent.runs(id,conversation_id,status,prompt_version,model) VALUES($1,$2,'running',$3,'explicit-fixture')",
      [runId, id, prompt.version],
    );
    await pool.query(
      "INSERT INTO agent.messages(id,conversation_id,role,content,run_id) VALUES($1,$2,'user','请查询商品P009的资料，本轮为显式模型夹具验证。',$3)",
      [randomUUID(), id, runId],
    );
    await run(
      pool,
      runId,
      id,
      { id: "U002", name: "演示顾客", role: "customer", customerId: "C001" },
      prompt,
    );
    const state = (
      await pool.query("SELECT status,error_code FROM agent.runs WHERE id=$1", [
        runId,
      ])
    ).rows[0];
    const messages = (
      await pool.query(
        "SELECT content,answer FROM agent.messages WHERE run_id=$1 AND role='assistant'",
        [runId],
      )
    ).rows;
    const calls = (
      await pool.query(
        "SELECT capability,status FROM agent.tool_calls WHERE run_id=$1",
        [runId],
      )
    ).rows;
    assert.equal(state.status, expected ? "failed" : "succeeded");
    assert.equal(state.error_code, expected);
    assert.equal(messages.length, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].capability, "knowledge_search");
    if (expected) {
      assert.equal(messages[0].answer, null);
      assert.ok(!messages[0].content.includes("模型夹具中的待校验结论"));
    }
    reports.push({
      name,
      expected,
      ...state,
      modelDecisions: decisions,
      toolCalls: calls.length,
      runId,
      conversationId: id,
    });
    console.log(`${name}: ${state.status} ${state.error_code || ""}`);
  }
  mkdirSync("output", { recursive: true });
  writeFileSync(
    "output/knowledge-runtime-verification.json",
    JSON.stringify(
      {
        status: "passed",
        model: "explicit fixture",
        retrieval: "real business API and local embeddings",
        automaticRetries: 0,
        reports,
      },
      null,
      2,
    ),
  );
} finally {
  globalThis.fetch = originalFetch;
  await pool.end();
}
