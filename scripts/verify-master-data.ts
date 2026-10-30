import assert from "node:assert/strict";
import pg from "pg";
import { Value } from "@sinclair/typebox/value";
import { config } from "../shared/config.ts";
import { capabilities } from "../apps/business/capabilities.ts";
import type { Identity } from "../shared/security.ts";
const db = new pg.Client(config().database);
await db.connect();
const identity: Identity = {
  id: "U001",
  name: "陈念",
  role: "admin",
  customerId: null,
};
const checks = [];
try {
  await db.query("BEGIN");
  async function execute(name: string, args: any) {
    const cap = capabilities.find((c) => c.name === name)!;
    assert.ok(Value.Check(cap.input, args));
    return cap.execute(args, { db: db as any, identity, preview: false });
  }
  const customer = await execute("customers_create", {
    name: "温以宁",
    phone: "13800002999",
    notes: "偏爱纯棉面料",
  });
  assert.ok(customer.referenceId);
  checks.push("新增客户档案");
  const supplier = await execute("suppliers_create", {
    name: "宁波素帛服饰有限公司",
    contact: "余清",
    phone: "13800001999",
    city: "宁波",
    leadDays: 6,
  });
  assert.ok(supplier.referenceId);
  checks.push("新增供应商档案");
  const product = await execute("products_create", {
    name: "细纹棉质立领衬衫",
    category: "衬衫",
    description: "纯棉细纹面料，简洁立领与直身剪裁。",
    material: "100% 棉",
    season: "四季",
    supplierId: supplier.referenceId,
    price: 26900,
    skus: [{ color: "本白色", size: "M", cost: 10500 }],
  });
  const row = (
    await db.query("SELECT stock FROM business.skus WHERE product_id=$1", [
      product.referenceId,
    ])
  ).rows[0];
  assert.equal(row.stock, 0);
  checks.push("新增商品与规格，初始库存为零");
  console.log(
    JSON.stringify({
      passed: checks.length,
      checks,
      persistence: "rolled_back",
    }),
  );
} finally {
  await db.query("ROLLBACK");
  await db.end();
}
