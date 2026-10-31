import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { database } from "../shared/db.ts";
import { prepare } from "../apps/agent/actions.ts";
import { invoke } from "../apps/agent/business.ts";
import { parseDecision } from "../apps/agent/model.ts";
import type { Identity } from "../shared/security.ts";

// This suite creates purchase orders. An explicitly configured isolated database is required.
assert.ok(
  process.env.QIHE_CONFIG_PATH && process.env.QIHE_ALLOW_WRITE_TESTS === "1",
  "Use a separate test config and QIHE_ALLOW_WRITE_TESTS=1",
);
assert.ok(
  process.env.QIHE_TEST_PASSWORD,
  "Set the isolated account password via QIHE_TEST_PASSWORD",
);
const base = `http://127.0.0.1:${process.env.QIHE_AGENT_PORT || 3180}/api`;
const login = await fetch(base + "/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json", "x-client": "admin" },
  body: JSON.stringify({
    login: process.env.QIHE_TEST_LOGIN || "qihe",
    password: process.env.QIHE_TEST_PASSWORD,
  }),
});
assert.equal(login.status, 200);
const identity = (await login.json()) as Identity;
const headers = {
  "content-type": "application/json",
  "x-client": "admin",
  cookie: login.headers.get("set-cookie")!.split(";")[0],
};
const pool = database("agent"),
  business = database("business");
const report: any = {
  mode: "isolated-real-business-api-with-explicit-inputs-no-model",
  checks: [],
  startedAt: new Date().toISOString(),
};
async function request(path: string) {
  const r = await fetch(base + path, { method: "POST", headers, body: "{}" });
  return { status: r.status, body: (await r.json()) as any };
}
async function conversation() {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO agent.conversations(id,account_id,title) VALUES($1,$2,'[隔离验证]采购草稿')",
    [id, identity.id],
  );
  return id;
}
async function state(id: string) {
  return (await pool.query("SELECT * FROM agent.actions WHERE id=$1", [id]))
    .rows[0];
}
async function purchaseCount() {
  return (
    await business.query(
      "SELECT count(*)::int AS n FROM business.purchase_orders",
    )
  ).rows[0].n;
}
try {
  const row = (
    await invoke(
      "inventory_list",
      { limit: 1, lowOnly: true },
      identity,
      "read",
    )
  ).rows[0];
  assert.ok(row, "Seed an isolated low-stock fixture");
  const args = {
    supplierId: row.supplierId,
    items: [{ skuId: row.skuId, quantity: 10 }],
    note: "隔离验证",
  };
  const conv = await conversation(),
    before = await purchaseCount();
  const v1 = await prepare(pool, conv, identity, "purchases_create", args);
  assert.equal(await purchaseCount(), before);
  const v2 = await prepare(
    pool,
    conv,
    identity,
    "purchases_create",
    { items: [{ skuId: row.skuId, quantity: 5 }] },
    { actionId: v1.id, version: 1 },
  );
  const revised = await state(v2.id);
  assert.equal(revised.arguments.items[0].quantity, 5);
  assert.equal(revised.arguments.supplierId, args.supplierId);
  assert.equal(revised.arguments.note, args.note);
  assert.equal((await state(v1.id)).state, "superseded");
  assert.equal(revised.draft_id, v1.id);
  assert.equal(revised.revision, 2);
  assert.equal(await purchaseCount(), before);
  assert.equal((await request(`/actions/${v1.id}/confirm`)).status, 409);
  const first = await request(`/actions/${v2.id}/confirm`);
  assert.equal(first.status, 200);
  const duplicate = await request(`/actions/${v2.id}/confirm`);
  assert.equal(duplicate.status, 200);
  assert.deepEqual(first.body, duplicate.body);
  const items = (
    await business.query(
      "SELECT quantity FROM business.purchase_items WHERE purchase_id=$1",
      [first.body.referenceId],
    )
  ).rows;
  assert.deepEqual(
    items.map((x) => x.quantity),
    [5],
  );
  assert.equal(await purchaseCount(), before + 1);
  await assert.rejects(
    prepare(
      pool,
      conv,
      identity,
      "purchases_create",
      { items: [{ skuId: row.skuId, quantity: 2 }] },
      { actionId: v2.id, version: 2 },
    ),
    (e: any) => e.code === "DRAFT_UNAVAILABLE",
  );
  report.checks.push({
    name: "10-to-5, unchanged fields, no pre-confirm write, stale card blocked, exact purchase quantity, duplicate confirm, completed revision blocked",
    passed: true,
  });
  const conv2 = await conversation(),
    invalid = await prepare(pool, conv2, identity, "purchases_create", args);
  await assert.rejects(
    prepare(
      pool,
      conv2,
      identity,
      "purchases_create",
      { items: [{ skuId: row.skuId, quantity: 0 }] },
      { actionId: invalid.id, version: 1 },
    ),
  );
  assert.equal((await state(invalid.id)).state, "revision_failed");
  assert.equal((await request(`/actions/${invalid.id}/confirm`)).status, 409);
  const repaired = await prepare(
    pool,
    conv2,
    identity,
    "purchases_create",
    { items: [{ skuId: row.skuId, quantity: 3 }] },
    { actionId: invalid.id, version: 1 },
  );
  assert.equal(repaired.revision, 2);
  report.checks.push({
    name: "invalid quantity fails closed, explicit later revision succeeds",
    passed: true,
  });
  const conv3 = await conversation(),
    race = await prepare(pool, conv3, identity, "purchases_create", args);
  const attempts = await Promise.allSettled(
    [5, 6].map((quantity) =>
      prepare(
        pool,
        conv3,
        identity,
        "purchases_create",
        { items: [{ skuId: row.skuId, quantity }] },
        { actionId: race.id, version: 1 },
      ),
    ),
  );
  assert.equal(attempts.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM agent.actions WHERE supersedes_id=$1",
        [race.id],
      )
    ).rows[0].n,
    1,
  );
  report.checks.push({
    name: "concurrent revisions have one successor",
    passed: true,
  });
  const conv4 = await conversation(),
    competing = await prepare(pool, conv4, identity, "purchases_create", args);
  const raceBefore = await purchaseCount();
  const both = await Promise.allSettled([
    prepare(
      pool,
      conv4,
      identity,
      "purchases_create",
      { items: [{ skuId: row.skuId, quantity: 5 }] },
      { actionId: competing.id, version: 1 },
    ),
    request(`/actions/${competing.id}/confirm`),
  ]);
  const changed = both[0].status === "fulfilled",
    committed =
      both[1].status === "fulfilled" && (both[1].value as any).status === 200;
  assert.notEqual(changed, committed);
  assert.equal(await purchaseCount(), raceBefore + (committed ? 1 : 0));
  report.checks.push({
    name: "revision versus confirmation has one winner",
    passed: true,
    winner: changed ? "revision" : "confirmation",
  });
  const conv5 = await conversation(),
    guarded = await prepare(pool, conv5, identity, "purchases_create", args);
  await assert.rejects(
    prepare(
      pool,
      conv5,
      { ...identity, id: "U002" },
      "purchases_create",
      {},
      { actionId: guarded.id, version: 1 },
    ),
  );
  await assert.rejects(
    prepare(
      pool,
      conv5,
      identity,
      "purchases_create",
      {},
      { actionId: guarded.id, version: 9 },
    ),
    (e: any) => e.code === "DRAFT_VERSION_CONFLICT",
  );
  await assert.rejects(
    prepare(pool, conv5, identity, "purchases_create", args),
    (e: any) => e.code === "DRAFT_TARGET_REQUIRED",
  );
  const run = randomUUID();
  await pool.query(
    "INSERT INTO agent.runs(id,conversation_id,status,prompt_version,model) VALUES($1,$2,'running',1,'fixture')",
    [run, conv5],
  );
  assert.equal((await request(`/actions/${guarded.id}/confirm`)).status, 409);
  await pool.query("UPDATE agent.runs SET status='succeeded' WHERE id=$1", [
    run,
  ]);
  for (const revision of [
    { actionId: guarded.id, version: 0 },
    { actionId: "bad", version: 1 },
    { actionId: guarded.id, version: 1, extra: true },
  ])
    assert.throws(() =>
      parseDecision(
        JSON.stringify({
          message: "",
          calls: [{ name: "purchases_create", arguments: {}, revision }],
        }),
      ),
    );
  report.checks.push({
    name: "ownership, version, duplicate draft, busy run and revision schema guards",
    passed: true,
  });
  report.status = "passed";
} finally {
  report.finishedAt = new Date().toISOString();
  mkdirSync("output", { recursive: true });
  writeFileSync(
    "output/action-revisions-verification.json",
    JSON.stringify(report, null, 2),
  );
  await pool.end();
  await business.end();
}
console.log(JSON.stringify({ status: report.status, checks: report.checks }));
