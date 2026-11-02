import { Value } from "@sinclair/typebox/value";
import { createHash } from "node:crypto";
import { BusinessError } from "../../shared/db.ts";
import {
  answerBlocksSchema,
  type AnswerBlock,
  type KnowledgeSource,
  type SourcedAnswer,
} from "../../shared/knowledge.ts";

export function validateSourcedAnswer(
  blocks: AnswerBlock[] | undefined,
  visibleSources: KnowledgeSource[],
  required: boolean,
): SourcedAnswer | null {
  if (!blocks) {
    if (required)
      throw new BusinessError(
        "ANSWER_SOURCES_REQUIRED",
        "本次资料回答缺少可核对的引用结构，处理已停止",
        502,
      );
    return null;
  }
  if (!Value.Check(answerBlocksSchema, blocks))
    throw new BusinessError("ANSWER_INVALID", "资料回答格式无效", 502);
  const sources = new Map(visibleSources.map((s) => [s.id, s]));
  const used = new Map<string, KnowledgeSource>();
  for (const block of blocks) {
    if (
      !block.text.trim() ||
      (block.kind !== "limitation" && !block.citations.length)
    )
      throw new BusinessError(
        "ANSWER_SOURCE_MISSING",
        "资料结论没有引用依据，处理已停止",
        502,
      );
    const covered = new Set<string>();
    for (const citation of block.citations) {
      const source = sources.get(citation.sourceId);
      if (!source)
        throw new BusinessError(
          "ANSWER_SOURCE_INVALID",
          "回答引用了本轮未取得的资料，处理已停止",
          502,
        );
      if (
        source.contentHash !==
        createHash("sha256").update(source.text).digest("hex")
      )
        throw new BusinessError(
          "ANSWER_SOURCE_INVALID",
          "回答引用的资料内容校验失败",
          502,
        );
      if (source.scope === "product")
        source.productIds.forEach((id) => covered.add(id));
      used.set(source.id, source);
    }
    if (
      block.kind !== "limitation" &&
      block.productIds.some((id) => !covered.has(id))
    ) {
      console.error(
        JSON.stringify({
          event: "answer_product_source_mismatch",
          kind: block.kind,
          declaredProducts: block.productIds,
          citedProducts: [...covered],
        }),
      );
      throw new BusinessError(
        "ANSWER_PRODUCT_SOURCE_MISMATCH",
        "商品结论没有对应款式的资料，处理已停止",
        502,
      );
    }
  }
  return { blocks, sources: [...used.values()] };
}
