import { Type } from "@sinclair/typebox";
import { BusinessError } from "../../../shared/db.ts";
import type { KnowledgeSource } from "../../../shared/knowledge.ts";
import { type Capability, type Context, result } from "../contracts.ts";
import {
  embed,
  cosine,
  EMBEDDING_ID,
  EMBEDDING_DIMENSIONS,
} from "./embedding.ts";
import { hash } from "./corpus.ts";

export interface KnowledgeQuery {
  query: string;
  productIds: string[];
  limitPerProduct?: number;
  includeGeneral?: boolean;
}
export async function searchKnowledge(a: KnowledgeQuery, c: Context) {
  const products = (
    await c.db.query(
      "SELECT id FROM business.products WHERE id=ANY($1::text[]) AND ($2 OR status='上架')",
      [a.productIds, c.identity.role === "admin"],
    )
  ).rows;
  if (products.length !== a.productIds.length)
    throw new BusinessError(
      "PRODUCT_NOT_FOUND",
      "商品不存在或当前身份不可查看",
      404,
    );
  const index = (
    await c.db.query(
      "SELECT id,embedding_model,dimensions FROM business.knowledge_indexes WHERE active",
    )
  ).rows[0];
  if (!index)
    throw new BusinessError(
      "KNOWLEDGE_INDEX_UNAVAILABLE",
      "商品知识索引尚未准备，本次检索未完成",
      503,
    );
  if (
    index.embedding_model !== EMBEDDING_ID ||
    index.dimensions !== EMBEDDING_DIMENSIONS
  )
    throw new BusinessError(
      "KNOWLEDGE_INDEX_INCOMPATIBLE",
      "知识索引与当前向量模型不一致，请重新建立索引",
      503,
    );
  const queryVector = c.prepared as number[];
  if (
    !Array.isArray(queryVector) ||
    queryVector.length !== EMBEDDING_DIMENSIONS
  )
    throw new BusinessError("EMBEDDING_INVALID", "知识查询向量无效", 503);
  const rows = (
    await c.db.query(
      `SELECT ch.*,d.title,d.version,d.product_ids,d.scope,d.origin FROM business.knowledge_chunks ch
     JOIN business.knowledge_documents d ON d.index_id=ch.index_id AND d.id=ch.document_id
     WHERE ch.index_id=$1 AND (d.audience='public' OR $2)
     AND ((d.scope='product' AND d.product_ids && $3::text[]) OR ($4 AND d.scope='general'))`,
      [
        index.id,
        c.identity.role === "admin",
        a.productIds,
        a.includeGeneral === true,
      ],
    )
  ).rows;
  const ranked = rows
    .map((row) => {
      if (row.content_hash !== hash(row.content))
        throw new BusinessError(
          "KNOWLEDGE_INDEX_INVALID",
          "知识片段内容与索引不一致",
          503,
        );
      return { row, score: cosine(queryVector, row.embedding) };
    })
    .sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id));
  const selected = new Map<string, (typeof ranked)[number]>();
  const coverage = a.productIds.map((productId) => {
    const hits = ranked
      .filter(
        (x) =>
          x.row.scope === "product" && x.row.product_ids.includes(productId),
      )
      .slice(0, a.limitPerProduct ?? 3);
    hits.forEach((x) => selected.set(x.row.id, x));
    return { productId, retrieved: hits.length };
  });
  if (a.includeGeneral)
    ranked
      .filter((x) => x.row.scope === "general")
      .slice(0, 2)
      .forEach((x) => selected.set(x.row.id, x));
  const sources: KnowledgeSource[] = [...selected.values()].map(({ row }) => ({
    id: `${index.id}/${row.id}`,
    documentId: row.document_id,
    title: row.title,
    section: row.section,
    version: row.version,
    indexVersion: index.id,
    productIds: row.product_ids,
    scope: row.scope,
    origin: row.origin,
    text: row.content,
    contentHash: row.content_hash,
  }));
  return result(
    "商品护理资料",
    sources.map((s) => ({ title: s.title, section: s.section })),
    [],
    {
      view: "knowledge",
      sources,
      knowledge: { indexVersion: index.id, coverage },
      summary:
        "教学示例资料；以下为检索候选，不保证回答了当前问题。逐项核对原文，缺少依据时明确说明；通用资料不能证明具体款式的护理要求。",
    },
  );
}

export const knowledgeCapability: Capability = {
  name: "knowledge_search",
  module: "knowledge",
  label: "查询商品护理资料",
  write: false,
  roles: ["customer", "admin"],
  evidenceKind: "knowledge",
  description:
    "根据问题检索商品说明、护理条件和术语解释。咨询具体款式的洗涤、干燥、护理负担或性能依据时，本轮需取得此资料，不能凭成分、历史回复或常识作确定结论。先用商品查询确认ID；比较时提供全部待比较商品ID，按商品分别返回候选。不同问法由你理解并提出query。查询成功不代表资料足够；相关片段也可能没有答案。只读，不查询价格库存，不承诺效果。",
  input: Type.Object(
    {
      query: Type.String({ minLength: 1, maxLength: 300 }),
      productIds: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), {
        minItems: 1,
        maxItems: 3,
        uniqueItems: true,
      }),
      limitPerProduct: Type.Optional(Type.Integer({ minimum: 1, maximum: 3 })),
      includeGeneral: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
  prepareRead: async (args: KnowledgeQuery) =>
    (await embed([args.query], "query"))[0],
  execute: searchKnowledge,
};
