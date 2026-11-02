import { Type, type Static } from "@sinclair/typebox";
import { BusinessError } from "../../shared/db.ts";

export const evidenceRequirementsSchema = Type.Array(
  Type.Object(
    {
      anyOf: Type.Array(
        Type.Object(
          {
            capability: Type.String({ minLength: 1, maxLength: 80 }),
            outcome: Type.Union([
              Type.Literal("success"),
              Type.Literal("empty"),
            ]),
          },
          { additionalProperties: false },
        ),
        { minItems: 1, maxItems: 8 },
      ),
    },
    { additionalProperties: false },
  ),
  { maxItems: 8 },
);
export type EvidenceRequirements = Static<typeof evidenceRequirementsSchema>;
export interface EvidenceTool {
  name: string;
  write: boolean;
  description?: string;
  evidenceKind?: "knowledge";
  planRequired?: boolean;
  completesPlan?: boolean;
  referenceInputs?: string[];
}
export interface ToolEvidence {
  capability: string;
  empty: boolean;
}

export function validateEvidenceRequirements(
  requirements: EvidenceRequirements,
  tools: EvidenceTool[],
) {
  const readable = new Set(
    tools.filter((tool) => !tool.write).map((tool) => tool.name),
  );
  if (
    requirements.some((group) =>
      group.anyOf.some((item) => !readable.has(item.capability)),
    )
  )
    throw new BusinessError(
      "EVIDENCE_REQUIREMENT_INVALID",
      "所需查询依据包含不可用的能力，本次处理已停止",
      502,
    );
}

export function assertEvidence(
  requirements: EvidenceRequirements,
  evidence: ToolEvidence[],
) {
  const complete = requirements.every((group) =>
    group.anyOf.some((required) =>
      evidence.some(
        (actual) =>
          actual.capability === required.capability &&
          (required.outcome === "success" || actual.empty),
      ),
    ),
  );
  if (!complete)
    throw new BusinessError(
      "EVIDENCE_MISSING",
      "尚未取得本次回答所需的查询依据，本次处理已停止",
      502,
    );
}
