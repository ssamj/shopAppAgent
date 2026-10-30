import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import pg from "pg";
import { config } from "../shared/config.ts";
const origin = "http://127.0.0.1:3180/api";
const password = readFileSync(".local/登录账号.txt", "utf8").match(
  /初始密码：([^\r\n]+)/,
)![1];
const checks: string[] = [];
async function session(channel: string, login: string) {
  const r = await fetch(`${origin}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-client": channel },
    body: JSON.stringify({ login, password }),
  });
  assert.equal(r.status, 200);
  const cookie = r.headers.get("set-cookie")!.split(";")[0];
  return {
    channel,
    cookie,
    request: async (path: string, body?: any, expected = 200) => {
      const res = await fetch(`${origin}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "content-type": "application/json",
          "x-client": channel,
          cookie,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = (await res.json()) as any;
      assert.equal(res.status, expected, `${path}: ${JSON.stringify(data)}`);
      return data;
    },
  };
}
const admin = await session("admin", "qihe"),
  customer = await session("shop", "zhixia"),
  other = await session("shop", "wanyu");
const customerConversation = await customer.request("/conversations", {});
const adminConversation = await admin.request("/conversations", {});
async function query(s: typeof admin, name: string, args: any = {}) {
  return s.request("/business/query", { capability: name, arguments: args });
}
async function command(
  s: typeof admin,
  name: string,
  args: any,
  conversationId: string,
) {
  const action = await s.request("/actions/prepare", {
    capability: name,
    arguments: args,
    conversationId,
  });
  const result = await s.request(`/actions/${action.id}/confirm`, {});
  return { action, result };
}
const db = new pg.Client(config().database);
await db.connect();
try {
  const catalogue = await query(customer, "products_search");
  assert.equal(catalogue.rows.length, 12);
  checks.push("12 款商品可查询");
  await customer.request(
    "/business/query",
    { capability: "finance_ledger", arguments: {} },
    403,
  );
  await other.request(
    `/conversations/${customerConversation.id}`,
    undefined,
    404,
  );
  checks.push("客户权限与会话隔离");
  const original = (
    await db.query(
      "SELECT stock,reserved FROM business.skus WHERE id='P005-1-M'",
    )
  ).rows[0];
  const created = await command(
    customer,
    "orders_create",
    { items: [{ skuId: "P005-1-M", quantity: 1 }], addressId: "A001" },
    customerConversation.id,
  );
  const orderId = created.result.referenceId;
  assert.ok(orderId);
  const repeat = await customer.request(
    `/actions/${created.action.id}/confirm`,
    {},
  );
  assert.equal(repeat.referenceId, orderId);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM business.orders WHERE id=$1",
        [orderId],
      )
    ).rows[0].n,
    1,
  );
  checks.push("下单确认及重复确认幂等");
  await other.request(
    "/business/query",
    { capability: "orders_detail", arguments: { id: orderId } },
    400,
  );
  checks.push("其他客户不能读取订单");
  const pay = await command(
    customer,
    "orders_pay",
    { id: orderId },
    customerConversation.id,
  );
  assert.equal(pay.result.referenceId, orderId);
  await command(
    admin,
    "orders_ship",
    { id: orderId, carrier: "顺丰速运", tracking: `SF${Date.now()}` },
    adminConversation.id,
  );
  await command(
    customer,
    "orders_receive",
    { id: orderId },
    customerConversation.id,
  );
  assert.equal(
    (
      await db.query("SELECT status FROM business.orders WHERE id=$1", [
        orderId,
      ])
    ).rows[0].status,
    "已完成",
  );
  checks.push("订单付款、发货、收货闭环");
  const sale = await command(
    customer,
    "aftersales_apply",
    { orderId, reason: "上身偏宽松，申请整单退货退款" },
    customerConversation.id,
  );
  const saleId = sale.result.referenceId;
  await command(
    admin,
    "aftersales_review",
    { id: saleId, approve: true },
    adminConversation.id,
  );
  await admin.request(
    "/actions/prepare",
    {
      capability: "aftersales_refund",
      arguments: { id: saleId },
      conversationId: adminConversation.id,
    },
    400,
  );
  checks.push("退款前必须完成退货收货");
  await command(
    admin,
    "aftersales_receive",
    { id: saleId },
    adminConversation.id,
  );
  await command(
    admin,
    "aftersales_refund",
    { id: saleId },
    adminConversation.id,
  );
  const restored = (
    await db.query(
      "SELECT stock,reserved FROM business.skus WHERE id='P005-1-M'",
    )
  ).rows[0];
  assert.deepEqual(restored, original);
  checks.push("退货退款恢复库存且收支匹配");
  const before = (
    await db.query("SELECT stock FROM business.skus WHERE id='P003-2-M'")
  ).rows[0].stock;
  const purchase = await command(
    admin,
    "purchases_create",
    {
      supplierId: "S003",
      items: [{ skuId: "P003-2-M", quantity: 12 }],
      note: "通勤西裤常规补单",
    },
    adminConversation.id,
  );
  const purchaseId = purchase.result.referenceId;
  await command(
    admin,
    "purchases_receive",
    { id: purchaseId },
    adminConversation.id,
  );
  await command(
    admin,
    "purchases_pay",
    { id: purchaseId },
    adminConversation.id,
  );
  assert.equal(
    (await db.query("SELECT stock FROM business.skus WHERE id='P003-2-M'"))
      .rows[0].stock,
    before + 12,
  );
  checks.push("采购、入库、付款闭环");
  await customer.request(
    "/actions/prepare",
    {
      capability: "orders_create",
      arguments: {
        items: [{ skuId: "P001-1-M", quantity: 200 }],
        addressId: "A001",
      },
      conversationId: customerConversation.id,
    },
    400,
  );
  checks.push("库存不足阻止建单");
  const action = await admin.request("/actions/prepare", {
    capability: "products_update",
    arguments: { id: "P012", price: 29900 },
    conversationId: adminConversation.id,
  });
  await admin.request(`/actions/${action.id}/cancel`, {});
  await admin.request(`/actions/${action.id}/confirm`, {}, 409);
  checks.push("取消确认卡后不能执行");
  const invariant = (
    await db.query(
      "SELECT s.id FROM business.skus s LEFT JOIN (SELECT sku_id,sum(quantity) as n FROM business.inventory_movements GROUP BY sku_id) m ON m.sku_id=s.id WHERE s.stock<>COALESCE(m.n,0) OR s.reserved<0 OR s.reserved>s.stock",
    )
  ).rows;
  assert.equal(invariant.length, 0);
  checks.push("全部 SKU 现货与出入库流水一致");
  const reservations = (
    await db.query(
      "SELECT s.id FROM business.skus s LEFT JOIN (SELECT i.sku_id,sum(i.quantity) AS n FROM business.order_items i JOIN business.orders o ON o.id=i.order_id WHERE o.status IN ('待付款','待发货') GROUP BY i.sku_id) r ON r.sku_id=s.id WHERE s.reserved<>COALESCE(r.n,0)",
    )
  ).rows;
  assert.equal(reservations.length, 0);
  checks.push("全部 SKU 占用与未发货订单一致");
  const finance = await query(admin, "finance_summary", {
    from: "2026-10-01",
    to: "2026-10-31",
  });
  assert.equal(finance.rows.length, 4);
  checks.push("收支汇总按上海日期查询");
  const businessDb = new pg.Client(config().businessDatabase);
  await businessDb.connect();
  try {
    await assert.rejects(
      () => businessDb.query("SELECT * FROM agent.accounts"),
      (e: any) => e.code === "42501",
    );
  } finally {
    await businessDb.end();
  }
  const agentDb = new pg.Client(config().agentDatabase);
  await agentDb.connect();
  try {
    await assert.rejects(
      () => agentDb.query("SELECT * FROM business.orders"),
      (e: any) => e.code === "42501",
    );
  } finally {
    await agentDb.end();
  }
  checks.push("业务与智能体数据库账号权限隔离");
  mkdirSync("output", { recursive: true });
  writeFileSync(
    "output/verification.json",
    JSON.stringify(
      { at: new Date().toISOString(), checks, orderId, purchaseId, saleId },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} finally {
  await db.end();
}
