import {taskPlanSchema} from "../../shared/planning.ts";
// Optional provider-side constraints for tool-only workflow nodes. Runtime and business validation remain authoritative.
export function workflowResponseFormat(tools: {name: string; input: unknown}[]) {
  const compactPlan = JSON.parse(JSON.stringify(taskPlanSchema));
  delete compactPlan.properties.steps.items.properties.description;
  delete compactPlan.properties.steps.items.properties.expectedOutput;
  return {type: "json_schema", json_schema: {name: "workflow_node_action", strict: true, schema: {
    type: "object", additionalProperties: false, required: ["analysisSummary", "message", "calls"],
    properties: {
      analysisSummary: {type: "string", maxLength: 600}, message: {type: "string"},
      calls: {type: "array", minItems: 1, maxItems: 1, items: {anyOf: tools.map(t => ({
        type: "object", additionalProperties: false, required: ["name", "arguments"],
        properties: {name: {type: "string", enum: [t.name]}, arguments: t.input, stepId: {type: "string"}},
      }))}},
      plan: compactPlan,
    },
  }}};
}
