import assert from "node:assert/strict";
import { applyMemoryPatch, emptyMemory } from "../apps/agent/memory.ts";
import { boundContext, compactResult } from "../apps/agent/context.ts";
import {
  assertEvidence,
  validateEvidenceRequirements,
} from "../apps/agent/evidence.ts";
import { parseDecision } from "../apps/agent/model.ts";
import { result } from "../apps/business/contracts.ts";

const first = { id: "first", content: "找上班穿的裙子，预算500元，不要黑色" };
const initial = applyMemoryPatch(
  emptyMemory(),
  {
    evidenceRequirements: [],
    summary: "上班穿的裙子，500元以内，排除黑色",
    reset: null,
    changes: [
      {
        key: "maxPriceCents",
        value: 50000,
        sourceMessageId: first.id,
        quote: "预算500元",
      },
      {
        key: "excludedColors",
        value: ["黑色"],
        sourceMessageId: first.id,
        quote: "不要黑色",
      },
    ],
  },
  [first],
);
const second = { id: "second", content: "预算改成300元，颜色不限" };
const changed = applyMemoryPatch(
  initial,
  {
    evidenceRequirements: [],
    summary: "预算改为300元，颜色不限",
    reset: null,
    changes: [
      {
        key: "maxPriceCents",
        value: 30000,
        sourceMessageId: second.id,
        quote: "预算改成300元",
      },
      {
        key: "excludedColors",
        value: null,
        sourceMessageId: second.id,
        quote: "颜色不限",
      },
    ],
  },
  [second],
);
assert.equal(changed.facts.maxPriceCents?.value, 30000);
assert.equal(changed.facts.excludedColors, undefined);
assert.equal(
  initial.facts.maxPriceCents?.value,
  50000,
  "previous snapshot must be immutable",
);
assert.equal(changed.lastUserMessageId, second.id);
assert.equal(changed.facts.maxPriceCents?.sourceMessageId, second.id);
const sizeMessage = { id: "size", content: "我需要M码" };
const sized = applyMemoryPatch(
  changed,
  {
    evidenceRequirements: [],
    summary: "需要M码",
    reset: null,
    changes: [
      {
        key: "size",
        value: "M码",
        sourceMessageId: sizeMessage.id,
        quote: "M码",
      },
    ],
  },
  [sizeMessage],
);
assert.equal(
  sized.facts.size?.value,
  "M码",
  "Validated model values are not silently rewritten",
);
assert.equal(sized.facts.size?.quote, "M码");
for (const invalid of [
  {
    key: "maxPriceCents",
    value: 30000,
    sourceMessageId: "other-customer",
    quote: "预算改成300元",
  },
  {
    key: "maxPriceCents",
    value: 30000,
    sourceMessageId: second.id,
    quote: "伪造原文",
  },
  {
    key: "maxPriceCents",
    value: "300",
    sourceMessageId: second.id,
    quote: "预算改成300元",
  },
  {
    key: "role",
    value: "admin",
    sourceMessageId: second.id,
    quote: "预算改成300元",
  },
])
  assert.throws(() =>
    applyMemoryPatch(
      initial,
      {
        evidenceRequirements: [],
        summary: "",
        reset: null,
        changes: [invalid],
      },
      [second],
    ),
  );
const reset = { id: "reset", content: "忘掉之前的选购要求，这次给妈妈买外套" };
const cleared = applyMemoryPatch(
  changed,
  {
    evidenceRequirements: [],
    summary: "为妈妈选外套",
    reset: { sourceMessageId: reset.id, quote: "忘掉之前的选购要求" },
    changes: [
      {
        key: "maxPriceCents",
        value: 30000,
        sourceMessageId: second.id,
        quote: "预算改成300元",
      },
      {
        key: "category",
        value: "外套",
        sourceMessageId: reset.id,
        quote: "给妈妈买外套",
      },
    ],
  },
  [second, reset],
);
assert.equal(
  cleared.facts.maxPriceCents,
  undefined,
  "pre-reset patch must not resurrect a fact",
);
assert.equal(cleared.resetMessageId, reset.id);
const bounded = boundContext(
  [
    { role: "system", content: "rules", pinned: true },
    { role: "user", content: "memory", pinned: true },
    { role: "user", content: "old ".repeat(100) },
    { role: "user", content: "current", pinned: true },
    { role: "user", content: "latest result" },
  ],
  50,
);
assert.ok(bounded.chars <= 50);
assert.equal(bounded.dropped, 1);
assert.deepEqual(
  bounded.messages.map((message) => message.content),
  ["rules", "memory", "current", "latest result"],
);
assert.ok(bounded.messages.every((message) => !("pinned" in message)));
assert.throws(
  () =>
    boundContext(
      [{ role: "user", content: "x".repeat(100), pinned: true }],
      20,
    ),
  { code: "CONTEXT_LIMIT" },
);
const large = result(
  "列表",
  Array.from({ length: 100 }, (_, i) => ({
    id: `P${i}`,
    description: "衣服".repeat(60),
  })),
  [],
  { summary: "匹配总数100" },
);
const compact = compactResult(large, 1100);
assert.ok(compact.length <= 1100);
const parsed = JSON.parse(compact);
assert.equal(parsed.returnedRows, 100);
assert.equal(parsed.rows.length + parsed.omittedRows, 100);
assert.equal(parsed.rows[0].id, "P0");
assert.equal(parsed.summary, "匹配总数100");
assert.equal(large.rows.length, 100);
const requirements = [
  {
    anyOf: [
      { capability: "detail_read", outcome: "success" as const },
      { capability: "list_read", outcome: "empty" as const },
    ],
  },
];
validateEvidenceRequirements(requirements, [
  { name: "detail_read", write: false },
  { name: "list_read", write: false },
]);
assert.throws(
  () =>
    validateEvidenceRequirements(requirements, [
      { name: "detail_read", write: true },
    ]),
  { code: "EVIDENCE_REQUIREMENT_INVALID" },
);
assert.throws(() => assertEvidence(requirements, []), {
  code: "EVIDENCE_MISSING",
});
assert.throws(
  () =>
    assertEvidence(requirements, [{ capability: "list_read", empty: false }]),
  { code: "EVIDENCE_MISSING" },
);
assertEvidence(requirements, [{ capability: "detail_read", empty: false }]);
assertEvidence(requirements, [{ capability: "list_read", empty: true }]);
assertEvidence([], []);
assert.throws(
  () => parseDecision('```json\n{"message":"完成","calls":[]}\n```'),
  { code: "MODEL_RESULT_INVALID" },
);
assert.throws(() => parseDecision('{"message":"","calls":[]}'), {
  code: "MODEL_RESULT_INVALID",
});
assert.equal(
  parseDecision(
    JSON.stringify({
      message: "您指的是哪款？",
      calls: [],
      needsClarification: true,
    }),
  ).needsClarification,
  true,
);
assert.throws(
  () =>
    parseDecision(
      JSON.stringify({ message: "", calls: [], needsClarification: "true" }),
    ),
  { code: "MODEL_RESULT_INVALID" },
);
console.log(
  "PASS: source validation, typed patches, corrections, reset, immutability, context budget, pinned messages, valid JSON result compaction",
);
