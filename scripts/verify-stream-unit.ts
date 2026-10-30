import assert from "node:assert/strict";
import { readSSE } from "../shared/sse.ts";
import { decide, partialSummary } from "../apps/agent/model.ts";
function bytes(text: string, step = 1) {
  const source = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < source.length; i += step)
        controller.enqueue(source.slice(i, i + step));
      controller.close();
    },
  });
}
const frames: any[] = [];
await readSSE(
  bytes(
    ": heartbeat\r\nid: 12\r\nevent: analysis-summary\r\ndata: 中文分析\r\ndata: 第二行\r\n\r\nid: 13\ndata: done\n\ndata: truncated",
  ),
  (frame) => {
    frames.push(frame);
  },
);
assert.deepEqual(frames, [
  { id: "12", event: "analysis-summary", data: "中文分析\n第二行" },
  { id: "13", event: undefined, data: "done" },
]);
assert.equal(
  partialSummary('{"analysisSummary":"先核对\\"订单\\"和\\u5e93\\u5b58'),
  '先核对"订单"和库存',
);
assert.equal(
  partialSummary('{"analysisSummary":"已核对","message":"不应提前展示"}'),
  "已核对",
);
assert.equal(partialSummary('{"message":"analysisSummary 不在第一字段"}'), "");
const originalFetch = globalThis.fetch;
try {
  const content = JSON.stringify({
    analysisSummary: "先核对待发货订单，再查看低库存规格。",
    message: "查询已完成。",
    calls: [],
  });
  globalThis.fetch = async (_url, init) => {
    assert.equal(JSON.parse(String(init?.body)).stream, true);
    const events = [...content]
      .map(
        (c) =>
          `data: ${JSON.stringify({ choices: [{ delta: { content: c, reasoning_content: "private" } }] })}\r\n\r\n`,
      )
      .join("");
    return new Response(
      bytes(
        events +
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        3,
      ),
      { headers: { "content-type": "text/event-stream" } },
    );
  };
  const summaries: string[] = [];
  const result = await decide(
    [{ role: "user", content: "查询订单" }],
    async (summary) => {
      summaries.push(summary);
    },
  );
  assert.equal(result.message, "查询已完成。");
  assert.equal(summaries.at(-1), "先核对待发货订单，再查看低库存规格。");
  assert.ok(summaries.every((summary) => !summary.includes("private")));
  globalThis.fetch = async () =>
    new Response(
      bytes(
        'data: {"choices":[{"delta":{"content":"{\\\"analysisSummary\\\":\\\"只收到一半"}}]}\n\n',
      ),
      { headers: { "content-type": "text/event-stream" } },
    );
  await assert.rejects(decide([]), { code: "MODEL_STREAM_INTERRUPTED" });
  console.log(
    "PASS: UTF-8/chunk boundaries, CRLF, multiline, incomplete frames, summary parsing, model stream, interrupted stream, private-field exclusion",
  );
} finally {
  globalThis.fetch = originalFetch;
}
