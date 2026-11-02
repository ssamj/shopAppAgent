import { Type, type TSchema } from "@sinclair/typebox";
import type pg from "pg";
import type { Identity } from "../../shared/security.ts";
import { sourceSchema, type KnowledgeSource } from "../../shared/knowledge.ts";
import {
  replenishmentReportSchema,
  type ReplenishmentReport,
} from "../../shared/replenishment.ts";
export type Cell = string | number | boolean | null;
export type RowValue = Cell | Record<string, Cell>[];
export interface Result {
  title: string;
  view:
    | "products"
    | "table"
    | "detail"
    | "metrics"
    | "knowledge"
    | "replenishment";
  replenishment?: ReplenishmentReport;
  sources?: KnowledgeSource[];
  knowledge?: {
    indexVersion: string;
    coverage: { productId: string; retrieved: number }[];
  };
  referenceId?: string;
  summary?: string;
  columns: { key: string; label: string; format?: string }[];
  rows: Record<string, RowValue>[];
  details: { label: string; value: Cell }[];
  references?: {
    id: string;
    kind: string;
    label: string;
    relatedIds?: Record<string, string>;
  }[];
}
export interface Context {
  db: pg.PoolClient;
  identity: Identity;
  preview: boolean;
  prepared?: unknown;
}
export interface Capability {
  name: string;
  module: string;
  label: string;
  description: string;
  roles: Identity["role"][];
  write: boolean;
  input: TSchema;
  evidenceKind?: "knowledge";
  planRequired?: boolean;
  completesPlan?: boolean;
  referenceInputs?: string[];
  prepareRead?: (args: any) => Promise<unknown>;
  execute: (args: any, ctx: Context) => Promise<Result>;
}
export const cell = Type.Union([
  Type.String(),
  Type.Number(),
  Type.Boolean(),
  Type.Null(),
]);
export const resultSchema = Type.Object(
  {
    title: Type.String(),
    view: Type.Union(
      [
        "products",
        "table",
        "detail",
        "metrics",
        "knowledge",
        "replenishment",
      ].map((x) => Type.Literal(x)),
    ),
    sources: Type.Optional(Type.Array(sourceSchema)),
    replenishment: Type.Optional(replenishmentReportSchema),
    knowledge: Type.Optional(
      Type.Object(
        {
          indexVersion: Type.String(),
          coverage: Type.Array(
            Type.Object(
              {
                productId: Type.String(),
                retrieved: Type.Integer({ minimum: 0 }),
              },
              { additionalProperties: false },
            ),
          ),
        },
        { additionalProperties: false },
      ),
    ),
    referenceId: Type.Optional(Type.String()),
    references: Type.Optional(
      Type.Array(
        Type.Object(
          {
            id: Type.String(),
            kind: Type.String(),
            label: Type.String(),
            relatedIds: Type.Optional(
              Type.Record(Type.String(), Type.String()),
            ),
          },
          { additionalProperties: false },
        ),
      ),
    ),
    summary: Type.Optional(Type.String()),
    columns: Type.Array(
      Type.Object(
        {
          key: Type.String(),
          label: Type.String(),
          format: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
    ),
    rows: Type.Array(
      Type.Record(
        Type.String(),
        Type.Union([cell, Type.Array(Type.Record(Type.String(), cell))]),
      ),
    ),
    details: Type.Array(
      Type.Object(
        { label: Type.String(), value: cell },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export const id = Type.String({ minLength: 1, maxLength: 80 });
export const text = (max = 120) =>
  Type.String({ minLength: 1, maxLength: max });
export const queryInput = Type.Object(
  {
    query: Type.Optional(Type.String({ maxLength: 80 })),
    status: Type.Optional(Type.String({ maxLength: 20 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
  },
  { additionalProperties: false },
);
export const idInput = Type.Object({ id }, { additionalProperties: false });
export const object = (properties: Record<string, TSchema>) =>
  Type.Object(properties, { additionalProperties: false });
export const noInput = object({});
export function result(
  title: string,
  rows: Record<string, RowValue>[] = [],
  columns: Result["columns"] = [],
  extra: Partial<Result> = {},
): Result {
  return { title, view: "table", rows, columns, details: [], ...extra };
}
export const money = (cents: number) => `¥${(cents / 100).toFixed(2)}`;
