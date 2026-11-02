import { Type, type Static } from "@sinclair/typebox";
export const taskPlanSchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 80 }),
    sourceIds: Type.Array(Type.String(), {
      minItems: 1,
      maxItems: 12,
      uniqueItems: true,
    }),
    steps: Type.Array(
      Type.Object(
        {
          id: Type.String({ pattern: "^[a-z][a-z0-9_-]{0,25}$" }),
          title: Type.String({ minLength: 1, maxLength: 60 }),
          description: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
          expectedOutput: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
          capability: Type.String({ minLength: 1, maxLength: 80 }),
          dependsOn: Type.Array(Type.String(), {
            maxItems: 6,
            uniqueItems: true,
          }),
        },
        { additionalProperties: false },
      ),
      { minItems: 2, maxItems: 6 },
    ),
  },
  { additionalProperties: false },
);
export type TaskPlan = Static<typeof taskPlanSchema>;
export type TaskPlanState = Omit<TaskPlan, "steps"> & {
  steps: (TaskPlan["steps"][number] & {
    status: "pending" | "running" | "completed" | "failed";
    toolId?: string;
  })[];
};
