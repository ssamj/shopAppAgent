import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { config } from "../shared/config.ts";
import { fingerprint, type Identity } from "../shared/security.ts";
import { invoke } from "../apps/agent/business.ts";
import pg from "pg";
const identity: Identity = {
  id: "U002",
  name: "林知夏",
  role: "customer",
  customerId: "C001",
};
const db = new pg.Client(config().database);
await db.connect();
const checks = [];
try {
  const s = (
    await db.query(
      "SELECT stock,reserved FROM business.skus WHERE id='P001-1-M'",
    )
  ).rows[0];
  const available = s.stock - s.reserved;
  assert.ok(available > 0);
  const args = {
    items: [{ skuId: "P001-1-M", quantity: available }],
    addressId: "A001",
  };
  const preview = await invoke("orders_create", args, identity, "preview");
  const committed = await Promise.allSettled([
    invoke(
      "orders_create",
      args,
      identity,
      "commit",
      randomUUID(),
      fingerprint(preview),
    ),
    invoke(
      "orders_create",
      args,
      identity,
      "commit",
      randomUUID(),
      fingerprint(preview),
    ),
  ]);
  const successes = committed.filter(
    (r): r is PromiseFulfilledResult<any> => r.status === "fulfilled",
  );
  assert.equal(successes.length, 1);
  const id = successes[0].value.referenceId;
  const cancelPreview = await invoke(
    "orders_cancel",
    { id },
    identity,
    "preview",
  );
  await invoke(
    "orders_cancel",
    { id },
    identity,
    "commit",
    randomUUID(),
    fingerprint(cancelPreview),
  );
  const restored = (
    await db.query(
      "SELECT stock,reserved FROM business.skus WHERE id='P001-1-M'",
    )
  ).rows[0];
  assert.deepEqual(restored, s);
  checks.push("并发争抢相同库存仅一个订单成功，取消后库存恢复");
  const smallArgs = {
    items: [{ skuId: "P001-1-M", quantity: 1 }],
    addressId: "A001",
  };
  const smallPreview = await invoke(
    "orders_create",
    smallArgs,
    identity,
    "preview",
  );
  const commandId = randomUUID();
  const repeated = await Promise.all([
    invoke(
      "orders_create",
      smallArgs,
      identity,
      "commit",
      commandId,
      fingerprint(smallPreview),
    ),
    invoke(
      "orders_create",
      smallArgs,
      identity,
      "commit",
      commandId,
      fingerprint(smallPreview),
    ),
  ]);
  assert.equal(repeated[0].referenceId, repeated[1].referenceId);
  const repeatId = repeated[0].referenceId!;
  const repeatCancel = await invoke(
    "orders_cancel",
    { id: repeatId },
    identity,
    "preview",
  );
  await invoke(
    "orders_cancel",
    { id: repeatId },
    identity,
    "commit",
    randomUUID(),
    fingerprint(repeatCancel),
  );
  checks.push("同一幂等键并发提交返回同一订单");
  const currentPrice = (
    await db.query("SELECT price FROM business.products WHERE id='P001'")
  ).rows[0].price;
  await db.query("BEGIN");
  await db.query(
    "UPDATE business.products SET price=price+100 WHERE id='P001'",
  );
  // 变化校验在同一事务内通过业务执行器验证，回滚后不改变商品售价。
  const { capabilities } = await import("../apps/business/capabilities.ts");
  const cap = capabilities.find((c) => c.name === "orders_create")!;
  const changed = await cap.execute(smallArgs, {
    db: db as any,
    identity,
    preview: true,
  });
  assert.notEqual(fingerprint(changed), fingerprint(smallPreview));
  await db.query("ROLLBACK");
  assert.equal(
    (await db.query("SELECT price FROM business.products WHERE id='P001'"))
      .rows[0].price,
    currentPrice,
  );
  checks.push("价格变化会改变确认摘要，事务回滚保持原价");
  writeFileSync(
    "output/concurrency-verification.json",
    JSON.stringify({ at: new Date().toISOString(), checks }, null, 2),
  );
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} finally {
  await db.end();
}
