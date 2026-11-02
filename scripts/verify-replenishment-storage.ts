import fs from "node:fs";
import pg from "pg";
import assert from "node:assert/strict";
import { config } from "../shared/config.ts";
import {
  replenishmentCapabilities,
  inventorySnapshot,
} from "../apps/business/replenishment.ts";
import type { Context } from "../apps/business/contracts.ts";
const cfg = config();
if (
  !cfg.database.database.includes("episode06") ||
  process.env.QIHE_ALLOW_WRITE_TESTS !== "1"
)
  throw Error("Use isolated episode06 database with QIHE_ALLOW_WRITE_TESTS=1");
const pool = new pg.Pool(cfg.database),
  db = await pool.connect();
const c: Context = {
  db,
  identity: { id: "U001", name: "教学店长", role: "admin", customerId: null },
  preview: true,
};
const reports: { name: string; status: string }[] = [];
const call = async (name: string, args: unknown, ctx = c) => {
  const cap = replenishmentCapabilities.find((t) => t.name === name)!;
  return cap.execute(args, ctx);
};
async function test(name: string, fn: () => Promise<void>) {
  await db.query("BEGIN");
  try {
    await fn();
    reports.push({ name, status: "passed" });
    console.log("PASS " + name);
  } finally {
    await db.query("ROLLBACK");
  }
}
async function start() {
  const p = (
    await db.query("SELECT * FROM business.replenishment_rules WHERE active")
  ).rows[0];
  const snap = await call("replenishment_snapshot", {
    policyRef: p.id,
    ruleHash: p.content_hash,
  });
  return { p, id: snap.referenceId! };
}
async function computed() {
  const s = await start();
  await call("replenishment_calculate", { snapshotId: s.id, rule: s.p.rule });
  return s;
}
try {
  await test("full catalogue and baseline report", async () => {
    const { id } = await computed();
    await call("replenishment_verify", { snapshotId: id });
    const r = (await call("replenishment_report", { snapshotId: id }))
      .replenishment!;
    assert.equal(r.totalSkus, 232);
    assert.equal(r.units, 17);
    assert.equal(r.amount, 294900);
    assert.equal(r.audit.find((r) => r.skuId === "P009-1-L")?.incoming, 8);
    assert.equal(
      r.audit.find((r) => r.skuId === "P023-1-L")?.reason,
      "下架排除",
    );
    assert.equal(r.audit.filter((r) => r.quantity > 0).length, 2);
  });
  await test("stock beyond first 50 is included", async () => {
    const rows = await inventorySnapshot(c);
    const last = rows.filter((r) => r.status === "上架").at(-1)!;
    await db.query("UPDATE business.skus SET stock=0,reserved=0 WHERE id=$1", [
      last.skuId,
    ]);
    const { id } = await computed();
    const state = (
      await db.query(
        "SELECT assessment FROM business.replenishment_snapshots WHERE id=$1",
        [id],
      )
    ).rows[0];
    assert.ok(
      state.assessment.find((r: any) => r.skuId === last.skuId).quantity > 0,
    );
  });
  await test("no replenishment is a complete result", async () => {
    await db.query("UPDATE business.skus SET stock=20,reserved=0");
    const { id } = await computed();
    await call("replenishment_verify", { snapshotId: id });
    const r = (await call("replenishment_report", { snapshotId: id }))
      .replenishment!;
    assert.equal(r.state, "无需补货");
    assert.equal(r.units, 0);
    assert.equal(r.amount, 0);
  });
  await test("multiple suppliers are grouped", async () => {
    const row = (
      await db.query(
        "SELECT s.id FROM business.skus s JOIN business.products p ON p.id=s.product_id WHERE p.supplier_id<>'S001' AND p.status='上架' AND NOT EXISTS(SELECT 1 FROM business.purchase_items i JOIN business.purchase_orders o ON o.id=i.purchase_id WHERE i.sku_id=s.id AND o.status='待到货') ORDER BY s.id LIMIT 1",
      )
    ).rows[0];
    await db.query("UPDATE business.skus SET stock=0,reserved=0 WHERE id=$1", [
      row.id,
    ]);
    const { id } = await computed();
    await call("replenishment_verify", { snapshotId: id });
    const r = (await call("replenishment_report", { snapshotId: id }))
      .replenishment!;
    assert.ok(r.suppliers.length >= 2);
    assert.equal(
      r.suppliers.reduce((n, s) => n + s.amount, 0),
      r.amount,
    );
  });
  await test("owner isolation", async () => {
    const { id, p } = await start();
    await assert.rejects(
      call(
        "replenishment_calculate",
        { snapshotId: id, rule: p.rule },
        { ...c, identity: { ...c.identity, id: "OTHER" } },
      ),
      /不属于/,
    );
  });
  await test("changed condition is rejected", async () => {
    const { id, p } = await start();
    await assert.rejects(
      call("replenishment_calculate", {
        snapshotId: id,
        rule: { ...p.rule, target: 11 },
      }),
      /不一致/,
    );
  });
  await test("missing policy section is rejected", async () => {
    const { p } = await start();
    await db.query(
      "UPDATE business.replenishment_rules SET sections=sections-0 WHERE id=$1",
      [p.id],
    );
    await assert.rejects(start(), /条款不匹配/);
  });
  await test("data changed before verification", async () => {
    const { id } = await computed();
    await db.query(
      "UPDATE business.skus SET stock=stock+1 WHERE id='P001-1-L'",
    );
    await assert.rejects(
      call("replenishment_verify", { snapshotId: id }),
      /已变化/,
    );
  });
  await test("data changed after verification", async () => {
    const { id } = await computed();
    await call("replenishment_verify", { snapshotId: id });
    await db.query(
      "UPDATE business.purchase_orders SET status='已入库' WHERE id='EP06-INCOMING'",
    );
    await assert.rejects(
      call("replenishment_report", { snapshotId: id }),
      /已变化/,
    );
  });
  await test("report cannot skip verification", async () => {
    const { id } = await computed();
    await assert.rejects(
      call("replenishment_report", { snapshotId: id }),
      /未完成复核/,
    );
  });
  await test("received orders not counted as incoming", async () => {
    await db.query(
      "UPDATE business.purchase_orders SET status='已入库' WHERE id='EP06-INCOMING'",
    );
    const { id } = await computed();
    const r = (
      await db.query(
        "SELECT assessment FROM business.replenishment_snapshots WHERE id=$1",
        [id],
      )
    ).rows[0].assessment.find((r: any) => r.skuId === "P009-1-L");
    assert.equal(r.incoming, 0);
    assert.equal(r.quantity, 8);
  });
  await test("tampered calculation rejected", async () => {
    const { id } = await computed();
    await db.query(
      "UPDATE business.replenishment_snapshots SET assessment=jsonb_set(assessment,'{0,quantity}','99') WHERE id=$1",
      [id],
    );
    await assert.rejects(
      call("replenishment_verify", { snapshotId: id }),
      /不一致/,
    );
  });
  const denied = await fetch(
    "http://127.0.0.1:3481/v1/replenishment/replenishment_snapshot",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-service-key": cfg.internalSecret,
      },
      body: JSON.stringify({
        arguments: {
          policyRef: "daily-replenishment-v1",
          ruleHash: "a".repeat(64),
        },
        identity: {
          id: "U002",
          name: "顾客",
          role: "customer",
          customerId: "C001",
        },
        mode: "read",
      }),
    },
  );
  assert.equal(denied.status, 403);
  reports.push({
    name: "customer denied by HTTP permission check",
    status: "passed",
  });
  fs.mkdirSync("output", { recursive: true });
  fs.writeFileSync(
    "output/replenishment-storage-verification.json",
    JSON.stringify(
      {
        status: "passed",
        transactionRollback: true,
        at: new Date().toISOString(),
        reports,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: reports.length }));
} finally {
  db.release();
  await pool.end();
}
