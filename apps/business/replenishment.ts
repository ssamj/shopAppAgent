import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { randomUUID } from "node:crypto";
import { BusinessError, requireCondition as check } from "../../shared/db.ts";
import type { KnowledgeSource } from "../../shared/knowledge.ts";
import {
  replenishmentRuleSchema,
  type ReplenishmentRule,
  type ReplenishmentRow,
  type ReplenishmentReport,
} from "../../shared/replenishment.ts";
import {
  type Capability,
  type Context,
  result,
  object,
  id,
  money,
} from "./contracts.ts";
import {
  embed,
  cosine,
  EMBEDDING_ID,
  EMBEDDING_DIMENSIONS,
} from "./knowledge/embedding.ts";
import { hash } from "./knowledge/corpus.ts";
import { fingerprint } from "../../shared/security.ts";

export function validateRulePackage(p: any) {
  check(
    p && p.active,
    "RULE_UNAVAILABLE",
    "补货规则未启用或不存在，本次检查已停止",
  );
  check(
    Value.Check(replenishmentRuleSchema, p.rule) &&
      p.rule.target >= p.rule.triggerBelow,
    "RULE_INVALID",
    "补货规则参数无效",
  );
  check(
    p.embedding_model === EMBEDDING_ID && p.dimensions === EMBEDDING_DIMENSIONS,
    "RULE_INDEX_INVALID",
    "补货规则索引与模型不一致",
  );
  check(
    Array.isArray(p.sections) && p.sections.length > 0,
    "RULE_INCOMPLETE",
    "补货规则缺少必要条款",
  );
  const raw = p.sections.map((s: any) => {
    check(
      typeof s.section === "string" &&
        typeof s.text === "string" &&
        s.contentHash === hash(s.text),
      "RULE_INCOMPLETE",
      "补货规则条款损坏或缺失",
    );
    return { section: s.section, text: s.text };
  });
  check(
    fingerprint({
      title: p.title,
      version: p.version,
      rule: p.rule,
      sections: raw,
    }) === p.content_hash,
    "RULE_INCOMPLETE",
    "补货规则版本与完整条款不匹配",
  );
  return p;
}
async function loadRule(c: Context, ref: string) {
  return validateRulePackage(
    (
      await c.db.query(
        "SELECT * FROM business.replenishment_rules WHERE id=$1",
        [ref],
      )
    ).rows[0],
  );
}
export function ruleSources(p: any): KnowledgeSource[] {
  return p.sections.map((s: any) => ({
    id: `${p.id}/${hash(s.section).slice(0, 12)}`,
    documentId: p.id,
    title: p.title,
    section: s.section,
    version: p.version,
    indexVersion: p.content_hash,
    productIds: [],
    scope: "general",
    origin: "teaching",
    text: s.text,
    contentHash: s.contentHash,
  }));
}

// One SQL statement reads the complete catalogue and the incoming aggregate from the same statement snapshot.
export async function inventorySnapshot(c: Context) {
  const rows = (
    await c.db
      .query(`SELECT s.id AS "skuId",p.id AS "productId",p.name,s.color,s.size,p.status,
    v.id AS "supplierId",v.name AS supplier,s.stock,s.reserved,(s.stock-s.reserved)::int AS available,s.cost,
    COALESCE(i.incoming,0)::int AS incoming
    FROM business.skus s JOIN business.products p ON p.id=s.product_id JOIN business.suppliers v ON v.id=p.supplier_id
    LEFT JOIN (SELECT pi.sku_id,sum(pi.quantity) AS incoming FROM business.purchase_items pi
      JOIN business.purchase_orders po ON po.id=pi.purchase_id WHERE po.status='待到货' GROUP BY pi.sku_id) i ON i.sku_id=s.id
    ORDER BY s.id LIMIT 5001`)
  ).rows;
  check(
    rows.length <= 5000,
    "CATALOGUE_LIMIT",
    "目录超过本次支持的5000个规格，未生成不完整补货单",
  );
  return rows;
}
export function calculateReplenishment(
  rows: any[],
  rule: ReplenishmentRule,
): ReplenishmentRow[] {
  check(
    Value.Check(replenishmentRuleSchema, rule) &&
      rule.target >= rule.triggerBelow,
    "RULE_INVALID",
    "补货规则无效",
  );
  check(
    new Set(rows.map((r) => r.skuId)).size === rows.length,
    "SNAPSHOT_INVALID",
    "库存快照包含重复规格",
  );
  return rows.map((row) => {
    check(
      row.skuId &&
        row.supplierId &&
        [row.stock, row.reserved, row.available, row.incoming, row.cost].every(
          Number.isSafeInteger,
        ) &&
        row.stock >= 0 &&
        row.reserved >= 0 &&
        row.reserved <= row.stock &&
        row.available === row.stock - row.reserved &&
        row.incoming >= 0 &&
        row.cost > 0,
      "SNAPSHOT_INVALID",
      "库存、在途或成本依据无效，不能按零处理",
    );
    const position = row.available + row.incoming;
    const eligible = row.status === rule.eligibleStatus;
    const quantity =
      eligible && position < rule.triggerBelow ? rule.target - position : 0;
    const reason = !eligible
      ? "下架排除"
      : quantity > 0
        ? "覆盖量低于触发线"
        : row.available < rule.triggerBelow && row.incoming > 0
          ? "在途已覆盖"
          : "库存覆盖充足";
    const amount = row.cost * quantity;
    check(
      Number.isSafeInteger(position) && Number.isSafeInteger(amount),
      "CALCULATION_LIMIT",
      "计算超过安全数值范围",
    );
    return { ...row, position, quantity, amount, reason };
  });
}
async function loadSnapshot(c: Context, ref: string) {
  const s = (
    await c.db.query(
      "SELECT * FROM business.replenishment_snapshots WHERE id=$1 AND actor_id=$2 AND created_at>now()-interval '30 minutes' FOR UPDATE",
      [ref, c.identity.id],
    )
  ).rows[0];
  check(s, "SNAPSHOT_UNAVAILABLE", "补货快照不存在、不属于当前账号或已过期");
  const p = await loadRule(c, s.rule_id);
  check(
    p.content_hash === s.rule_hash,
    "RULE_CHANGED",
    "补货规则已变化，请重新发起检查",
  );
  check(
    snapshotHash(s.snapshot) === s.snapshot_hash,
    "SNAPSHOT_INVALID",
    "补货快照校验失败",
  );
  return { s, p };
}
function stableRows(rows: any[]) {
  return rows.map((r) => ({
    skuId: r.skuId,
    productId: r.productId,
    name: r.name,
    color: r.color,
    size: r.size,
    status: r.status,
    supplierId: r.supplierId,
    supplier: r.supplier,
    stock: r.stock,
    reserved: r.reserved,
    available: r.available,
    cost: r.cost,
    incoming: r.incoming,
  }));
}
// JSONB changes object-key order; canonicalize business fields before hashing/comparing.
export const snapshotHash = (rows: any[]) =>
  hash(JSON.stringify(stableRows(rows)));
async function checked(c: Context, ref: string) {
  const { s, p } = await loadSnapshot(c, ref);
  check(s.assessment, "ASSESSMENT_MISSING", "尚未计算补货结果");
  const current = await inventorySnapshot(c);
  check(
    snapshotHash(current) === snapshotHash(s.snapshot),
    "BUSINESS_CHANGED",
    "库存、在途或成本已变化，请重新发起补货检查",
  );
  const calculated = calculateReplenishment(s.snapshot, p.rule);
  check(
    hash(
      JSON.stringify(
        calculated.map((r) => [r.skuId, r.quantity, r.amount, r.reason]),
      ),
    ) ===
      hash(
        JSON.stringify(
          s.assessment.map((r: any) => [
            r.skuId,
            r.quantity,
            r.amount,
            r.reason,
          ]),
        ),
      ),
    "ASSESSMENT_INVALID",
    "补货计算结果与依据不一致",
  );
  return { s, p, calculated };
}
const columns = [
  { key: "name", label: "商品" },
  { key: "color", label: "颜色" },
  { key: "size", label: "尺码" },
  { key: "available", label: "可用" },
  { key: "incoming", label: "在途" },
  { key: "quantity", label: "建议补货" },
  { key: "reason", label: "依据" },
];
const common = {
  module: "replenishment",
  roles: ["admin"] as "admin"[],
  write: false,
};
const planned = {
  ...common,
  planRequired: true,
  referenceInputs: ["snapshotId"],
};
export const replenishmentCapabilities: Capability[] = [
  {
    ...common,
    name: "replenishment_rules_search",
    label: "检索完整补货规则",
    evidenceKind: "knowledge",
    description:
      "按公司规则生成智能补货单时，首先用自然语言检索补货规则。返回相关规则包的完整条款、版本、policyRef、ruleHash和已维护的结构化规则。只读、管理员使用。后续必须基于本轮规则提出plan，再查询全量快照、计算、复核、出建议单；不能采用历史默认安全库存两倍建议代替本次规则。",
    input: object({ query: Type.String({ minLength: 1, maxLength: 300 }) }),
    prepareRead: async (a) => (await embed([a.query], "query"))[0],
    execute: async (a, c) => {
      const packs = (
        await c.db.query(
          "SELECT * FROM business.replenishment_rules WHERE active ORDER BY id",
        )
      ).rows.map(validateRulePackage);
      check(
        packs.length,
        "RULE_UNAVAILABLE",
        "没有已启用的补货规则，本次检查已停止",
      );
      const ranked = packs
        .map((p) => ({
          p,
          score: Math.max(
            ...p.sections.map((s: any) =>
              cosine(c.prepared as number[], s.embedding),
            ),
          ),
        }))
        .sort((a, b) => b.score - a.score);
      // A single maintained daily policy is supported. Multiple active policies require an explicit selection design.
      check(
        ranked.length === 1,
        "RULE_AMBIGUOUS",
        "存在多个适用规则包，需先明确规则范围，不能按相似度擅自裁决",
      );
      const p = ranked[0].p;
      return result("日常补货规则 · 完整条款", [], [], {
        view: "knowledge",
        referenceId: p.id,
        sources: ruleSources(p),
        details: [
          { label: "policyRef", value: p.id },
          { label: "ruleHash", value: p.content_hash },
          { label: "rule", value: JSON.stringify(p.rule) },
        ],
        summary:
          "虚构教学资料。向量检索定位条款后返回同版本完整规则包；结构化参数由资料维护者配套维护。只生成待审核建议，不授权采购。",
      });
    },
  },
  {
    ...common,
    planRequired: true,
    referenceInputs: ["policyRef"],
    name: "replenishment_snapshot",
    label: "查询全量库存与在途",
    description:
      "依据本轮规则包，读取全目录最多5000个SKU及全部待到货采购汇总，保存同一SQL时点的只读技术快照。返回snapshotId供后续计算；不按商品列表的50条限制截断，也无需用户指定商品。",
    input: object({
      policyRef: id,
      ruleHash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    }),
    execute: async (a, c) => {
      const p = await loadRule(c, a.policyRef);
      check(p.content_hash === a.ruleHash, "RULE_CHANGED", "规则版本不匹配");
      const rows = await inventorySnapshot(c),
        ref = randomUUID();
      await c.db.query(
        "INSERT INTO business.replenishment_snapshots(id,actor_id,rule_id,rule_hash,snapshot,snapshot_hash,state) VALUES($1,$2,$3,$4,$5,$6,'captured')",
        [
          ref,
          c.identity.id,
          p.id,
          p.content_hash,
          JSON.stringify(rows),
          snapshotHash(rows),
        ],
      );
      return result("全量库存与在途快照", [], [], {
        referenceId: ref,
        details: [
          { label: "snapshotId", value: ref },
          { label: "已检查规格", value: rows.length },
          {
            label: "数据范围",
            value: "全目录，包含下架规格；库存与在途同一时点",
          },
        ],
        summary:
          "完整记录保存在快照内，后续按快照计算；当前卡片不是限量商品清单。",
      });
    },
  },
  {
    ...planned,
    name: "replenishment_calculate",
    label: "按规则计算补货",
    description:
      "使用snapshotId和规则包中的完整rule计算全量SKU；rule必须逐字段一致，不能放宽阈值。结果包含需补、在途覆盖、下架排除及无需补货。金额由业务程序计算。",
    input: object({ snapshotId: id, rule: replenishmentRuleSchema }),
    execute: async (a, c) => {
      const { s, p } = await loadSnapshot(c, a.snapshotId);
      check(
        s.state === "captured",
        "INVALID_STATE",
        "补货快照已计算，请按计划继续或重新发起",
      );
      check(
        Object.keys(p.rule).every((k) => a.rule[k] === p.rule[k]),
        "RULE_MISMATCH",
        "提出的补货条件与规则包不一致，已停止",
      );
      const audit = calculateReplenishment(s.snapshot, p.rule);
      await c.db.query(
        "UPDATE business.replenishment_snapshots SET assessment=$1,state='calculated' WHERE id=$2",
        [JSON.stringify(audit), s.id],
      );
      const candidates = audit.filter((r) => r.quantity > 0),
        units = candidates.reduce((n, r) => n + r.quantity, 0);
      return result(
        "补货计算已完成",
        audit
          .filter(
            (r) =>
              r.quantity > 0 ||
              r.reason === "在途已覆盖" ||
              r.reason === "下架排除",
          )
          .slice(0, 8),
        columns,
        {
          referenceId: s.id,
          details: [
            { label: "检查规格", value: audit.length },
            { label: "建议补货规格", value: candidates.length },
            { label: "建议件数", value: units },
          ],
          summary: "展示最多8条计算示例；完整计算已保存，需复核后才能出单。",
        },
      );
    },
  },
  {
    ...planned,
    name: "replenishment_verify",
    label: "复核规则、数量与业务变化",
    description:
      "对已计算snapshotId重新核对全部业务快照、规则版本和逐规格计算。数据变化立即失败；成功后才允许出单。",
    input: object({ snapshotId: id }),
    execute: async (a, c) => {
      const { s, calculated } = await checked(c, a.snapshotId);
      check(s.state === "calculated", "INVALID_STATE", "尚未处于待复核状态");
      await c.db.query(
        "UPDATE business.replenishment_snapshots SET state='verified',checked_at=now() WHERE id=$1",
        [s.id],
      );
      return result("补货结果复核通过", [], [], {
        referenceId: s.id,
        details: [
          { label: "已复核规格", value: calculated.length },
          {
            label: "检查内容",
            value: "规则完整性、全量库存及在途、数量和金额",
          },
        ],
      });
    },
  },
  {
    ...planned,
    name: "replenishment_report",
    label: "生成待审核智能补货单",
    completesPlan: true,
    description:
      "只在snapshotId已复核后生成待审核建议单，出单前再次检查变化；无需补货也形成完整检查结果。按供应商分组，保留全部排除原因和规则原文。不是采购订单，不创建采购、不增库存、不付款。此能力完成计划。",
    input: object({ snapshotId: id }),
    execute: async (a, c) => {
      const { s, p, calculated: audit } = await checked(c, a.snapshotId);
      check(s.state === "verified", "INVALID_STATE", "补货结果未完成复核");
      const rows = audit.filter((r) => r.quantity > 0),
        suppliers = new Map<
          string,
          { id: string; name: string; units: number; amount: number }
        >();
      for (const row of rows) {
        const group = suppliers.get(row.supplierId) || {
          id: row.supplierId,
          name: row.supplier,
          units: 0,
          amount: 0,
        };
        group.units += row.quantity;
        group.amount += row.amount;
        suppliers.set(row.supplierId, group);
      }
      const report: ReplenishmentReport = {
        id: s.id,
        state: rows.length ? "待审核" : "无需补货",
        capturedAt: s.created_at.toISOString(),
        checkedAt: new Date().toISOString(),
        totalSkus: audit.length,
        eligibleSkus: audit.filter((r) => r.status === p.rule.eligibleStatus)
          .length,
        suggestedSkus: rows.length,
        units: rows.reduce((n, r) => n + r.quantity, 0),
        amount: rows.reduce((n, r) => n + r.amount, 0),
        rule: p.rule,
        ruleTitle: p.title,
        ruleVersion: p.version,
        audit,
        suppliers: [...suppliers.values()],
      };
      await c.db.query(
        "UPDATE business.replenishment_snapshots SET state='issued',checked_at=now() WHERE id=$1",
        [s.id],
      );
      return result("智能补货单", rows, columns, {
        view: "replenishment",
        referenceId: s.id,
        replenishment: report,
        sources: ruleSources(p),
        details: [
          { label: "状态", value: report.state },
          { label: "检查规格", value: report.totalSkus },
          { label: "建议件数", value: report.units },
          { label: "预计金额", value: money(report.amount) },
        ],
        summary:
          "规则与实时数据核对后生成的建议单，等待人工审核；未创建采购订单。",
      });
    },
  },
];
