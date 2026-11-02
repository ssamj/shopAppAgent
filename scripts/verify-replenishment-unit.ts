import assert from "node:assert/strict";
import {
  calculateReplenishment,
  validateRulePackage,
} from "../apps/business/replenishment.ts";
import {
  acceptPlan,
  beginPlanStep,
  assertPlanComplete,
} from "../apps/agent/planning.ts";
import type { ReplenishmentRule } from "../shared/replenishment.ts";
const rule: ReplenishmentRule = {
  eligibleStatus: "上架",
  inventoryBasis: "availablePlusIncoming",
  incomingStatus: "待到货",
  triggerBelow: 5,
  target: 10,
  output: "reviewOnly",
};
const base = {
  skuId: "A",
  productId: "P1",
  name: "教学商品",
  color: "米色",
  size: "M",
  status: "上架",
  supplierId: "S1",
  supplier: "供应商",
  stock: 2,
  reserved: 0,
  available: 2,
  incoming: 0,
  cost: 1000,
};
let count = 0;
const test = (name: string, fn: () => void) => {
  fn();
  count++;
  console.log(`PASS ${name}`);
};
test("same stock, different incoming", () => {
  const rows = calculateReplenishment(
    [base, { ...base, skuId: "B", incoming: 8 }],
    rule,
  );
  assert.equal(rows[0].quantity, 8);
  assert.equal(rows[1].quantity, 0);
  assert.equal(rows[1].reason, "在途已覆盖");
});
test("off shelf excluded", () =>
  assert.equal(
    calculateReplenishment([{ ...base, status: "下架" }], rule)[0].quantity,
    0,
  ));
test("reserved stock and boundary", () => {
  assert.equal(
    calculateReplenishment(
      [{ ...base, stock: 5, reserved: 1, available: 4 }],
      rule,
    )[0].quantity,
    6,
  );
  assert.equal(
    calculateReplenishment([{ ...base, stock: 5, available: 5 }], rule)[0]
      .quantity,
    0,
  );
});
test("changed policy affects computation", () =>
  assert.equal(
    calculateReplenishment([base], { ...rule, triggerBelow: 3, target: 12 })[0]
      .quantity,
    10,
  ));
test("missing data never becomes zero", () =>
  assert.throws(
    () => calculateReplenishment([{ ...base, incoming: undefined }], rule),
    /依据无效/,
  ));
test("duplicate rows rejected", () =>
  assert.throws(() => calculateReplenishment([base, base], rule), /重复/));
test("empty catalogue is valid", () =>
  assert.deepEqual(calculateReplenishment([], rule), []));
test("invalid rule rejected", () =>
  assert.throws(
    () => calculateReplenishment([base], { ...rule, target: 1 }),
    /规则无效/,
  ));
test("incomplete policy rejected", () =>
  assert.throws(() => validateRulePackage({ active: true, rule }), /索引/));
const tools = [
  { name: "read", write: false, planRequired: true },
  {
    name: "report",
    write: false,
    planRequired: true,
    completesPlan: true,
    referenceInputs: ["snapshotId"],
  },
];
const proposal = {
  title: "检查",
  sourceIds: ["source"],
  steps: [
    { id: "a", title: "查询", capability: "read", dependsOn: [] },
    { id: "b", title: "出单", capability: "report", dependsOn: ["a"] },
  ],
};
test("unknown source rejected", () =>
  assert.throws(() => acceptPlan(proposal, tools, new Set()), /未取得/));
test("forward or cyclic dependency rejected", () =>
  assert.throws(
    () =>
      acceptPlan(
        {
          ...proposal,
          steps: [
            { ...proposal.steps[0], dependsOn: ["b"] },
            proposal.steps[1],
          ],
        },
        tools,
        new Set(["source"]),
      ),
    /依赖/,
  ));
test("dependency and reference enforcement", () => {
  const p = acceptPlan(proposal, tools, new Set(["source"]));
  assert.throws(
    () =>
      beginPlanStep(
        p,
        { name: "report", stepId: "b", arguments: { snapshotId: "x" } },
        tools[1],
        new Set(["x"]),
        "t",
      ),
    /前置/,
  );
  const s = beginPlanStep(
    p,
    { name: "read", stepId: "a", arguments: {} },
    tools[0],
    new Set(),
    "t1",
  )!;
  s.status = "completed";
  assert.throws(
    () =>
      beginPlanStep(
        p,
        { name: "report", stepId: "b", arguments: { snapshotId: "x" } },
        tools[1],
        new Set(),
        "t",
      ),
    /本次运行/,
  );
  assert.throws(() => assertPlanComplete(p), /尚未/);
  const final = beginPlanStep(
    p,
    { name: "report", stepId: "b", arguments: { snapshotId: "x" } },
    tools[1],
    new Set(["x"]),
    "t2",
  )!;
  final.status = "completed";
  assertPlanComplete(p);
});
console.log(JSON.stringify({ passed: count }));
