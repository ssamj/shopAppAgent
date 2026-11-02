import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  readCorpus,
  splitSections,
} from "../apps/business/knowledge/corpus.ts";
import { cosine } from "../apps/business/knowledge/embedding.ts";
import { validateSourcedAnswer } from "../apps/agent/citations.ts";
import { compactResult } from "../apps/agent/context.ts";
import { parseDecision } from "../apps/agent/model.ts";
import { result } from "../apps/business/contracts.ts";
import type { AnswerBlock, KnowledgeSource } from "../shared/knowledge.ts";
const text = "本款可装洗衣袋轻柔机洗。不可滚筒烘干。";
const source: KnowledgeSource = {
  id: "current/chunk",
  documentId: "doc",
  title: "教学商品说明",
  section: "洗涤与干燥",
  version: "1",
  indexVersion: "current",
  productIds: ["P009"],
  scope: "product",
  origin: "teaching",
  text,
  contentHash: createHash("sha256").update(text).digest("hex"),
};
const block: AnswerBlock = {
  kind: "fact",
  text: "本款不能滚筒烘干。",
  productIds: ["P009"],
  citations: [{ sourceId: source.id }],
};
let checks = 0;
function check(name: string, fn: () => void) {
  fn();
  checks++;
  console.log(name);
}
const fails = (fn: () => unknown, code: string) =>
  assert.throws(fn, (e: any) => e.code === code);
check("real citation and immutable snapshot", () => {
  const a = validateSourcedAnswer([block], [source], true)!;
  assert.equal(a.sources[0].text, text);
  assert.equal(a.blocks[0].text, block.text);
});
check("knowledge requires structured answer", () =>
  fails(
    () => validateSourcedAnswer(undefined, [source], true),
    "ANSWER_SOURCES_REQUIRED",
  ),
);
check("unretrieved and historical source rejected", () =>
  fails(
    () => validateSourcedAnswer([block], [], true),
    "ANSWER_SOURCE_INVALID",
  ),
);
check("model cannot supply or replace source text", () =>
  fails(
    () =>
      validateSourcedAnswer(
        [
          { ...block, citations: [{ sourceId: source.id, quote: "可以烘干" }] },
        ] as any,
        [source],
        true,
      ),
    "ANSWER_INVALID",
  ),
);
check("wrong product rejected", () =>
  fails(
    () =>
      validateSourcedAnswer(
        [{ ...block, productIds: ["P001"] }],
        [source],
        true,
      ),
    "ANSWER_PRODUCT_SOURCE_MISMATCH",
  ),
);
check("general source cannot prove product claim", () =>
  fails(
    () =>
      validateSourcedAnswer(
        [block],
        [{ ...source, scope: "general", productIds: [] }],
        true,
      ),
    "ANSWER_PRODUCT_SOURCE_MISMATCH",
  ),
);
check("unsourced recommendation rejected", () =>
  fails(
    () =>
      validateSourcedAnswer(
        [{ ...block, kind: "advice", citations: [] }],
        [source],
        true,
      ),
    "ANSWER_SOURCE_MISSING",
  ),
);
check("tampered source rejected", () =>
  fails(
    () =>
      validateSourcedAnswer(
        [block],
        [{ ...source, contentHash: "wrong" }],
        true,
      ),
    "ANSWER_SOURCE_INVALID",
  ),
);
check("no information is a valid limitation", () =>
  assert.equal(
    validateSourcedAnswer(
      [
        {
          kind: "limitation",
          text: "本轮资料没有提供对应试验，无法保证。",
          productIds: ["P009"],
          citations: [],
        },
      ],
      [],
      true,
    )!.sources.length,
    0,
  ),
);
check("ordinary response unaffected", () =>
  assert.equal(validateSourcedAnswer(undefined, [], false), null),
);
check("truncated sources cannot be cited", () => {
  const r = result("资料", [], [], { sources: [source] });
  const compact = JSON.parse(compactResult(r, 180));
  assert.ok(!compact.sources?.length);
  fails(
    () => validateSourcedAnswer([block], compact.sources || [], true),
    "ANSWER_SOURCE_INVALID",
  );
});
check("structured final and duplicate prose validation", () => {
  assert.equal(
    parseDecision(
      JSON.stringify({ message: "", calls: [], answerBlocks: [block] }),
    ).answerBlocks!.length,
    1,
  );
  fails(
    () =>
      parseDecision(
        JSON.stringify({
          message: "另写无引用结论",
          calls: [],
          answerBlocks: [block],
        }),
      ),
    "MODEL_RESULT_INVALID",
  );
  fails(
    () =>
      parseDecision(
        JSON.stringify({
          message: "",
          calls: [{ name: "some_tool", arguments: {} }],
          answerBlocks: [block],
        }),
      ),
    "MODEL_RESULT_INVALID",
  );
});
check("whole clauses and exceptions retained", () =>
  assert.equal(
    splitSections(
      "# 资料\n## 条款\n允许机洗，但必须使用洗衣袋。\n不可烘干。",
    )[0].text,
    "允许机洗，但必须使用洗衣袋。\n不可烘干。",
  ),
);
check("oversized clauses rejected, not silently truncated", () =>
  assert.throws(() => splitSections("## 条款\n" + "字".repeat(901))),
);
check("corpus has product and general sources", () => {
  const docs = readCorpus();
  assert.ok(docs.some((d) => d.productIds.includes("P001")));
  assert.ok(docs.some((d) => d.productIds.includes("P009")));
  assert.ok(docs.some((d) => d.audience === "admin"));
});
check("cosine rejects broken vectors", () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  fails(() => cosine([0, 0], [1, 0]), "KNOWLEDGE_INDEX_INVALID");
  fails(() => cosine([NaN], [1]), "KNOWLEDGE_INDEX_INVALID");
});
console.log(JSON.stringify({ status: "passed", checks }));
