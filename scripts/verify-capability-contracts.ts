import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Value } from "@sinclair/typebox/value";
import { resultSchema } from "../apps/business/contracts.ts";
import { config } from "../shared/config.ts";

const headers = { "x-service-key": config().internalSecret };
async function read(path: string) {
  const response = await fetch(`http://127.0.0.1:3181${path}`, { headers });
  assert.equal(response.status, 200);
  return await response.json() as any;
}
const registry = await read("/internal/capabilities");
const live = await read("/internal/openapi");
const saved = JSON.parse(readFileSync("docs/business-openapi.json", "utf8"));
function normalizeSchema(value: any): any {
  if (Array.isArray(value)) return value.map(normalizeSchema);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    key === "const" ? ["enum", [item]] : [key, normalizeSchema(item)],
  ));
}
assert.ok(registry.length > 0);
assert.equal(new Set(registry.map((c: any) => c.name)).size, registry.length);
for (const cap of registry) {
  const operation = live.paths[`/v1/${cap.module}/${cap.name}`]?.post;
  assert.ok(operation, `${cap.name} 缺少 HTTP 接口`);
  assert.equal(operation.operationId, cap.name);
  assert.deepEqual(normalizeSchema(operation.requestBody.content["application/json"].schema.properties.arguments), normalizeSchema(cap.input), `${cap.name} 的参数定义不一致`);
  for (const code of ["400", "401", "403", "409", "500"]) {
    const error = operation.responses[code]?.content?.["application/json"]?.schema;
    assert.ok(error?.properties?.code && error?.properties?.message, `${cap.name} 缺少 ${code} 错误合同`);
  }
}
assert.deepEqual(saved, live, "已导出的 OpenAPI 合同与运行中的服务不一致");

async function invoke(module: string, name: string, args: unknown, identity: unknown, mode = "read") {
  const response = await fetch(`http://127.0.0.1:3181/v1/${module}/${name}`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ arguments: args, identity, mode }),
  });
  return { status: response.status, body: await response.json() as any };
}
const admin = { id: "U001", name: "店长", role: "admin", customerId: null };
const customer = { id: "U002", name: "顾客", role: "customer", customerId: "C001" };
const result = await invoke("orders", "orders_list", { limit: 1 }, admin);
assert.equal(result.status, 200);
assert.ok(typeof result.body.requestId === "string" && Value.Check(resultSchema, result.body.data));
const preview = await invoke("orders", "orders_create", { items: [{ skuId: "P004-2-M", quantity: 1 }], addressId: "A001" }, customer, "preview");
assert.equal(preview.status, 200);
assert.equal(preview.body.data.title, "确认订单");
assert.equal(preview.body.data.referenceId, undefined);
assert.equal(preview.body.data.rows[0].skuId, "P004-2-M");
assert.ok(Value.Check(resultSchema, preview.body.data));
const unauthorized = await fetch("http://127.0.0.1:3181/v1/orders/orders_list", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ arguments: {}, identity: admin, mode: "read" }),
});
assert.equal(unauthorized.status, 401);
const unauthorizedBody = await unauthorized.json() as any;
assert.equal(unauthorizedBody.code, "UNAUTHORIZED");
assert.equal(typeof unauthorizedBody.message, "string");
for (const args of [{ items: [], addressId: "A001" }, { items: [{ skuId: "P004-2-M", quantity: "1" }], addressId: "A001" }, { items: [{ skuId: "P004-2-M", quantity: 1, extra: true }], addressId: "A001" }]) {
  const invalid = await invoke("orders", "orders_create", args, customer, "preview");
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, "INVALID_ARGUMENTS");
  assert.equal(typeof invalid.body.message, "string");
}
const forbidden = await invoke("finance", "finance_summary", {}, customer);
assert.equal(forbidden.status, 403);
assert.equal(forbidden.body.code, "FORBIDDEN");
console.log(JSON.stringify({ capabilities: registry.length, checked: ["能力目录与所有 HTTP 参数合同一致", "成功与错误响应合同完整", "导出文档与运行服务一致", "下单预览和非法参数校验", "服务身份与财务权限校验", "成功响应通过标准结果校验"] }));
