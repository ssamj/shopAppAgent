import { Type, type Static } from "@sinclair/typebox";

export const sourceSchema = Type.Object(
  {
    id: Type.String(),
    documentId: Type.String(),
    title: Type.String(),
    section: Type.String(),
    version: Type.String(),
    indexVersion: Type.String(),
    productIds: Type.Array(Type.String()),
    scope: Type.Union([Type.Literal("product"), Type.Literal("general")]),
    origin: Type.Literal("teaching"),
    text: Type.String(),
    contentHash: Type.String(),
  },
  { additionalProperties: false },
);
export type KnowledgeSource = Static<typeof sourceSchema>;

export const answerBlockSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("fact"),
      Type.Literal("advice"),
      Type.Literal("limitation"),
    ]),
    text: Type.String({ minLength: 1, maxLength: 1200 }),
    productIds: Type.Array(Type.String(), { maxItems: 3, uniqueItems: true }),
    citations: Type.Array(
      Type.Object(
        {
          sourceId: Type.String({ minLength: 1 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 8 },
    ),
  },
  { additionalProperties: false },
);
export const answerBlocksSchema = Type.Array(answerBlockSchema, {
  minItems: 1,
  maxItems: 8,
});
export type AnswerBlock = Static<typeof answerBlockSchema>;
export interface SourcedAnswer {
  blocks: AnswerBlock[];
  sources: KnowledgeSource[];
}
