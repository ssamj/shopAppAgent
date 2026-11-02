import { Type, type Static } from "@sinclair/typebox";

export const replenishmentRuleSchema = Type.Object(
  {
    eligibleStatus: Type.Literal("上架"),
    inventoryBasis: Type.Literal("availablePlusIncoming"),
    incomingStatus: Type.Literal("待到货"),
    triggerBelow: Type.Integer({ minimum: 1, maximum: 10000 }),
    target: Type.Integer({ minimum: 1, maximum: 10000 }),
    output: Type.Literal("reviewOnly"),
  },
  { additionalProperties: false },
);
export type ReplenishmentRule = Static<typeof replenishmentRuleSchema>;
export const auditRowSchema = Type.Object(
  {
    skuId: Type.String(),
    productId: Type.String(),
    name: Type.String(),
    color: Type.String(),
    size: Type.String(),
    status: Type.String(),
    supplierId: Type.String(),
    supplier: Type.String(),
    stock: Type.Integer(),
    reserved: Type.Integer(),
    available: Type.Integer(),
    incoming: Type.Integer(),
    position: Type.Integer(),
    cost: Type.Integer(),
    quantity: Type.Integer(),
    amount: Type.Integer(),
    reason: Type.String(),
  },
  { additionalProperties: false },
);
export type ReplenishmentRow = Static<typeof auditRowSchema>;
export const replenishmentReportSchema = Type.Object(
  {
    id: Type.String(),
    state: Type.Union([Type.Literal("待审核"), Type.Literal("无需补货")]),
    capturedAt: Type.String(),
    checkedAt: Type.String(),
    totalSkus: Type.Integer(),
    eligibleSkus: Type.Integer(),
    suggestedSkus: Type.Integer(),
    units: Type.Integer(),
    amount: Type.Integer(),
    rule: replenishmentRuleSchema,
    ruleTitle: Type.String(),
    ruleVersion: Type.String(),
    audit: Type.Array(auditRowSchema),
    suppliers: Type.Array(
      Type.Object(
        {
          id: Type.String(),
          name: Type.String(),
          units: Type.Integer(),
          amount: Type.Integer(),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type ReplenishmentReport = Static<typeof replenishmentReportSchema>;
