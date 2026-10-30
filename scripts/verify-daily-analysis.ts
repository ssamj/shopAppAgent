import assert from "node:assert/strict";
import pg from "pg";
import { Value } from "@sinclair/typebox/value";
import { capabilities } from "../apps/business/capabilities.ts";
import { config } from "../shared/config.ts";
import type { Identity } from "../shared/security.ts";

const db = new pg.Client(config().businessDatabase);
await db.connect();
const admin: Identity = { id: "U001", name: "店长", role: "admin", customerId: null };
const checks: string[] = [];
try {
  await db.query("BEGIN TRANSACTION READ ONLY");
  async function query(name: string, args: Record<string, unknown>, identity = admin) {
    const capability = capabilities.find((item) => item.name === name)!;
    assert.ok(Value.Check(capability.input, args), `${name} 参数不符合接口约定`);
    return capability.execute(args, { db: db as any, identity, preview: false });
  }

  const receipts = await query("finance_ledger", { status: "收款", limit: 50 });
  assert.ok(receipts.rows.length > 0);
  assert.ok(receipts.rows.every((row) => String(row.type).includes("收款")), "流水必须按收款筛选");
  const refunds = await query("finance_ledger", { status: "退款", limit: 50 });
  assert.ok(refunds.rows.length > 0);
  assert.ok(refunds.rows.every((row) => String(row.type).includes("退款")), "流水必须按退款筛选");
  checks.push("流水按收款和退款分别筛选");

  const from = "2026-10-28", to = "2026-10-28";
  const expectedFinance = (await db.query(
    "SELECT type, COUNT(*)::int AS count, COALESCE(SUM(amount),0)::int AS amount FROM business.ledger WHERE (created_at AT TIME ZONE 'Asia/Shanghai')::date BETWEEN $1::date AND $2::date AND type IN ('销售收款','售后退款') GROUP BY type",
    [from, to],
  )).rows;
  for (const [status, type] of [["收款", "销售收款"], ["退款", "售后退款"]]) {
    const actual = await query("finance_ledger", { status, from, to, limit: 50 });
    const expected = expectedFinance.find((row) => row.type === type);
    assert.ok(expected && expected.count > 0, `${type}测试日期应有流水`);
    assert.equal(actual.rows.length, expected.count);
    assert.equal(actual.rows.reduce((sum, row) => sum + Number(row.amount), 0), expected.amount);
    assert.ok(actual.rows.every((row) => row.type === type && String(row.created).startsWith("10-28")));
  }
  const summary = await query("finance_summary", { from, to });
  for (const expected of expectedFinance) {
    assert.equal(summary.rows.find((row) => row.name === expected.type)?.amount, expected.amount);
  }
  checks.push("上海时间范围内的流水与收支汇总一致");

  const expectedOrders = (await db.query(
    "SELECT COUNT(*)::int AS count FROM business.orders o WHERE o.status='待发货' AND (o.created_at AT TIME ZONE 'Asia/Shanghai')::date BETWEEN $1::date AND $2::date AND EXISTS (SELECT 1 FROM business.order_items i WHERE i.order_id=o.id)",
    [from, to],
  )).rows[0].count;
  const datedOrders = await query("orders_list", { status: "待发货", from, to, limit: 50 });
  assert.equal(datedOrders.rows.length, expectedOrders);
  assert.ok(datedOrders.rows.every((row) => String(row.created).startsWith("10-28")));
  assert.match(datedOrders.summary || "", new RegExp(`共 ${expectedOrders} 笔`));
  const allOrders = (await db.query("SELECT COUNT(*)::int AS count FROM business.orders o WHERE o.status='待发货' AND EXISTS (SELECT 1 FROM business.order_items i WHERE i.order_id=o.id)")).rows[0].count;
  assert.ok(allOrders > 1);
  const limitedOrders = await query("orders_list", { status: "待发货", limit: 1 });
  assert.equal(limitedOrders.rows.length, 1);
  assert.match(limitedOrders.summary || "", new RegExp(`共 ${allOrders} 笔`));
  checks.push("订单按下单日期筛选并返回完整总数，列表限量不影响总数");

  const customerId = (await db.query("SELECT customer_id FROM business.orders LIMIT 1")).rows[0].customer_id;
  const customer: Identity = { id: "test-customer", name: "顾客", role: "customer", customerId };
  const expectedCustomer = (await db.query("SELECT COUNT(*)::int AS count FROM business.orders o WHERE o.customer_id=$1 AND EXISTS (SELECT 1 FROM business.order_items i WHERE i.order_id=o.id)", [customerId])).rows[0].count;
  const customerOrders = await query("orders_list", { limit: 50 }, customer);
  assert.match(customerOrders.summary || "", new RegExp(`共 ${expectedCustomer} 笔`));
  assert.equal(customerOrders.rows.length, Math.min(expectedCustomer, 50));
  checks.push("顾客订单仍限定为本人范围");

  for (const capability of ["orders_list", "finance_ledger"]) {
    await assert.rejects(() => query(capability, { from: "2026-10-29", to: "2026-10-28" }), (error: any) => error.code === "INVALID_DATE_RANGE");
  }
  checks.push("非法日期区间返回明确业务错误");
  for (const capability of ["orders_list", "finance_ledger", "finance_summary"]) {
    await assert.rejects(() => query(capability, { from: "2026-02-30", to: "2026-02-30" }), (error: any) => error.code === "INVALID_DATE");
    await assert.rejects(() => query(capability, { from: "2025-02-29", to: "2025-02-29" }), (error: any) => error.code === "INVALID_DATE");
    await query(capability, { from: "2024-02-29", to: "2024-02-29" });
  }
  checks.push("非法日历日期明确报错，闰日正确接受");

  async function liveQuery(module: string, name: string, args: Record<string, unknown>) {
    const response = await fetch(`http://127.0.0.1:3181/v1/${module}/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-service-key": config().internalSecret },
      body: JSON.stringify({ arguments: args, identity: admin, mode: "read" }),
    });
    return { status: response.status, body: await response.json() as any };
  }
  const liveRefunds = await liveQuery("finance", "finance_ledger", { status: "退款", from, to });
  assert.equal(liveRefunds.status, 200);
  assert.equal(liveRefunds.body.data.rows.length, expectedFinance.find((row) => row.type === "售后退款").count);
  assert.ok(liveRefunds.body.data.rows.every((row: any) => row.type === "售后退款" && row.created.startsWith("10-28")));
  const liveOrders = await liveQuery("orders", "orders_list", { status: "待发货", from, to, limit: 1 });
  assert.equal(liveOrders.status, 200);
  assert.match(liveOrders.body.data.summary, new RegExp(`共 ${expectedOrders} 笔`));
  const badRange = await liveQuery("orders", "orders_list", { from: "2026-10-29", to: "2026-10-28" });
  assert.equal(badRange.status, 400);
  assert.equal(badRange.body.code, "INVALID_DATE_RANGE");
  const badDate = await liveQuery("finance", "finance_summary", { from: "2026-02-30", to: "2026-02-30" });
  assert.equal(badDate.status, 400);
  assert.equal(badDate.body.code, "INVALID_DATE");
  checks.push("重启后的业务 API 接收日期参数并执行实际筛选");
  console.log(JSON.stringify({ passed: checks.length, checks }));
} finally {
  await db.query("ROLLBACK");
  await db.end();
}
