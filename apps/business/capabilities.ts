import { Type } from "@sinclair/typebox";
import { randomUUID } from "node:crypto";
import { config } from "../../shared/config.ts";
import { knowledgeCapability } from "./knowledge/search.ts";
import { replenishmentCapabilities, validateReplenishmentPurchase } from "./replenishment.ts";
import { requireCondition as check } from "../../shared/db.ts";
import {
  type Capability,
  type Context,
  type Result,
  result,
  object,
  noInput,
  queryInput,
  idInput,
  id,
  text,
  money,
} from "./contracts.ts";
const both = ["customer", "admin"] as const;
const admin = ["admin"] as const;
const capabilities: Capability[] = [];
if (config().knowledge?.enabled) capabilities.push(knowledgeCapability);
if (config().replenishment?.enabled) capabilities.push(...replenishmentCapabilities);
function add(
  name: string,
  module: string,
  label: string,
  description: string,
  roles: readonly ("customer" | "admin")[],
  write: boolean,
  input: any,
  execute: Capability["execute"],
) {
  capabilities.push({
    name,
    module,
    label,
    description,
    roles: [...roles],
    write,
    input,
    execute,
  });
}
const q = (ctx: Context, sql: string, values: any[] = []) =>
  ctx.db.query(sql, values);
const datedQueryInput = object({
  ...queryInput.properties,
  from: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
  to: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
});
function checkDateRange(a: { from?: string; to?: string }) {
  for (const value of [a.from, a.to]) {
    if (!value) continue;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    const year = Number(match?.[1]), month = Number(match?.[2]), day = Number(match?.[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] || 0;
    check(match && year > 0 && day >= 1 && day <= days, "INVALID_DATE", "请输入有效的日期");
  }
  check(!a.from || !a.to || a.from <= a.to, "INVALID_DATE_RANGE", "开始日期不能晚于结束日期");
}
const newId = (prefix: string) =>
  `${prefix}${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replaceAll("-", "")}${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
const detail = (
  title: string,
  fields: Record<string, any>,
  referenceId?: string,
) =>
  result(title, [], [], {
    view: "detail",
    referenceId,
    details: Object.entries(fields).map(([label, value]) => ({ label, value })),
  });
const dates = `to_char(o.created_at AT TIME ZONE 'Asia/Shanghai','MM-DD HH24:MI') as created`;
async function order(ctx: Context, id: string) {
  const r = (
    await q(
      ctx,
      "SELECT o.*,c.name as customer FROM business.orders o JOIN business.customers c ON c.id=o.customer_id WHERE o.id=$1 FOR UPDATE OF o",
      [id],
    )
  ).rows[0];
  check(
    r &&
      (ctx.identity.role === "admin" ||
        r.customer_id === ctx.identity.customerId),
    "ORDER_NOT_FOUND",
    "没有找到可访问的订单",
  );
  return r;
}
async function orderItems(ctx: Context, id: string) {
  return (
    await q(
      ctx,
      "SELECT i.*,p.image FROM business.order_items i LEFT JOIN business.skus s ON s.id=i.sku_id LEFT JOIN business.products p ON p.id=s.product_id WHERE i.order_id=$1 ORDER BY i.sku_id",
      [id],
    )
  ).rows;
}
async function aftersale(ctx: Context, id: string) {
  const s = (
    await q(ctx, "SELECT * FROM business.aftersales WHERE id=$1 FOR UPDATE", [
      id,
    ])
  ).rows[0];
  check(
    s &&
      (ctx.identity.role === "admin" ||
        s.customer_id === ctx.identity.customerId),
    "AFTERSALE_NOT_FOUND",
    "没有找到可访问的售后单",
  );
  return s;
}
const itemInput = Type.Array(
  object({ skuId: id, quantity: Type.Integer({ minimum: 1, maximum: 200 }) }),
  { minItems: 1, maxItems: 20 },
);
async function skuItems(
  ctx: Context,
  items: { skuId: string; quantity: number }[],
  purchase = false,
) {
  check(
    new Set(items.map((x) => x.skuId)).size === items.length,
    "DUPLICATE_SKU",
    "同一规格请合并为一行",
  );
  const values = [];
  for (const item of [...items].sort((a, b) =>
    a.skuId.localeCompare(b.skuId),
  )) {
    const s = (
      await q(
        ctx,
        "SELECT s.*,p.name,p.price,p.status,p.supplier_id FROM business.skus s JOIN business.products p ON p.id=s.product_id WHERE s.id=$1 FOR UPDATE OF s,p",
        [item.skuId],
      )
    ).rows[0];
    check(s, "SKU_NOT_FOUND", "商品规格不存在");
    if (!purchase) {
      check(s.status === "上架", "PRODUCT_UNAVAILABLE", `${s.name}当前未上架`);
      check(
        s.stock - s.reserved >= item.quantity,
        "INSUFFICIENT_STOCK",
        `${s.name} ${s.color} ${s.size} 可用库存不足`,
      );
    }
    values.push({ ...s, quantity: item.quantity });
  }
  return values;
}
const itemColumns = [
  { key: "name", label: "商品" },
  { key: "color", label: "颜色" },
  { key: "size", label: "尺码" },
  { key: "quantity", label: "数量" },
  { key: "price", label: "单价", format: "money" },
];
function itemsResult(
  title: string,
  items: any[],
  fields: Record<string, any>,
  referenceId?: string,
) {
  return result(
    title,
    items.map((s) => ({
      skuId: s.sku_id || s.id,
      name: s.name,
      color: s.color,
      size: s.size,
      quantity: s.quantity,
      price: s.price,
      image: s.image || null,
    })),
    itemColumns,
    {
      view: "detail",
      referenceId,
      details: Object.entries(fields).map(([label, value]) => ({
        label,
        value,
      })),
    },
  );
}

add(
  "products_search",
  "products",
  "查询商品",
  "按商品名称、类别或面料的单个关键词查询，属于连续文本匹配，不支持空格分隔多个条件；口语裙子可用裙，通勤等场合应结合返回的商品描述判断。价格以分为单位。顾客查询自动只看上架商品，无需传status；状态仅支持上架、下架。选款、修改预算或排除颜色后推荐，需要本轮重新查询。colors/sizes只表示规格范围，available是商品合计库存，不能证明具体颜色或尺码有货；这类需求应以products_detail为依据。空结果表示未匹配，不代表缺货，可如实告知或由模型决定是否调整查询。",
  both,
  false,
  object({
    ...queryInput.properties,
    status: Type.Optional(Type.Union([Type.Literal("上架"), Type.Literal("下架")])),
    maxPrice: Type.Optional(Type.Integer({ minimum: 1 })),
  }),
  async (a, c) => {
    const r = await q(
      c,
      `SELECT p.id,p.name,p.category,p.description,p.material,p.image,p.status,p.price,string_agg(DISTINCT s.color,' / ') as colors,string_agg(DISTINCT s.size,' / ') as sizes,sum(s.stock-s.reserved)::int as available FROM business.products p JOIN business.skus s ON s.product_id=p.id WHERE ($1='' OR p.name ILIKE $2 OR p.category ILIKE $2 OR p.material ILIKE $2) AND ($3::int IS NULL OR p.price<=$3) AND ($4 OR p.status='上架') AND ($6='' OR p.status=$6) GROUP BY p.id ORDER BY p.id LIMIT $5`,
      [
        a.query || "",
        `%${a.query || ""}%`,
        a.maxPrice || null,
        c.identity.role === "admin",
        a.limit || 12,
        a.status || "",
      ],
    );
    return result(
      "商品目录",
      r.rows,
      [
        { key: "name", label: "商品" },
        { key: "category", label: "品类" },
        { key: "price", label: "售价", format: "money" },
        { key: "available", label: "可售库存" },
      ],
      { view: "products" },
    );
  },
);
add(
  "products_detail",
  "products",
  "查看商品规格",
  "获取指定商品的全部颜色尺码 SKU、售价、可用库存。按已明确的尺码或具体颜色推荐，或询问具体规格是否有货时，需要本轮取得此依据，不能使用搜索的合计库存或历史回复代替。会话已保存的有效规格条件同样适用，即使最新消息没有重复该条件；应先核对满足已知条件的候选，再推荐，不能把已明确的规格核对推迟到下次提问。候选商品确实为空时可依据空搜索结果告知未匹配，无须编造商品ID查详情。常规推荐先核对两三款候选。下单或补货前调用。",
  both,
  false,
  idInput,
  async (a, c) => {
    const p = (
      await q(
        c,
        "SELECT p.*,s.name as supplier FROM business.products p JOIN business.suppliers s ON s.id=p.supplier_id WHERE p.id=$1 AND ($2 OR p.status='上架')",
        [a.id, c.identity.role === "admin"],
      )
    ).rows[0];
    check(p, "PRODUCT_NOT_FOUND", "商品不存在或已下架");
    const rows = (
      await q(
        c,
        'SELECT id as "skuId",color,size,stock-reserved as available FROM business.skus WHERE product_id=$1 ORDER BY color,size',
        [a.id],
      )
    ).rows.map((s) => ({
      ...s,
      price: p.price,
      ...(c.identity.role === "admin" ? { supplierId: p.supplier_id } : {}),
    }));
    return result(
      p.name,
      rows,
      [
        { key: "color", label: "颜色" },
        { key: "size", label: "尺码" },
        { key: "price", label: "售价", format: "money" },
        { key: "available", label: "可售库存" },
      ],
      {
        view: "detail",
        referenceId: p.id,
        details: [
          { label: "面料", value: p.material },
          { label: "款式", value: p.description },
          { label: "状态", value: p.status },
          ...(c.identity.role === "admin"
            ? [{ label: "供应商", value: p.supplier }]
            : []),
        ],
      },
    );
  },
);
add(
  "products_update",
  "products",
  "调整商品",
  "调整商品售价或上下架；价格单位为分。",
  admin,
  true,
  object({
    id,
    price: Type.Optional(Type.Integer({ minimum: 100, maximum: 10000000 })),
    status: Type.Optional(
      Type.Union([Type.Literal("上架"), Type.Literal("下架")]),
    ),
  }),
  async (a, c) => {
    check(
      a.price !== undefined || a.status !== undefined,
      "NO_CHANGE",
      "请提供新的售价或上下架状态",
    );
    const p = (
      await q(c, "SELECT * FROM business.products WHERE id=$1 FOR UPDATE", [
        a.id,
      ])
    ).rows[0];
    check(p, "PRODUCT_NOT_FOUND", "商品不存在");
    if (!c.preview)
      await q(
        c,
        "UPDATE business.products SET price=COALESCE($1,price),status=COALESCE($2,status) WHERE id=$3",
        [a.price ?? null, a.status ?? null, a.id],
      );
    return detail(
      "调整商品",
      {
        商品: p.name,
        原售价: money(p.price),
        新售价: money(a.price ?? p.price),
        状态: a.status ?? p.status,
      },
      p.id,
    );
  },
);
add(
  "customers_list",
  "customers",
  "查询客户",
  "按姓名或手机号查客户资料、会员等级。",
  admin,
  false,
  queryInput,
  async (a, c) =>
    result(
      "客户档案",
      (
        await q(
          c,
          "SELECT id,name,phone,level,notes FROM business.customers WHERE name ILIKE $1 OR phone ILIKE $1 ORDER BY id LIMIT $2",
          [`%${a.query || ""}%`, a.limit || 30],
        )
      ).rows,
      [
        { key: "name", label: "客户" },
        { key: "phone", label: "联系电话" },
        { key: "level", label: "会员等级" },
        { key: "notes", label: "偏好备注" },
      ],
    ),
);
add(
  "customers_update",
  "customers",
  "维护客户资料",
  "修改客户姓名、会员等级或偏好备注。",
  admin,
  true,
  object({
    id,
    name: Type.Optional(text(30)),
    level: Type.Optional(
      Type.Union(
        ["普通会员", "银卡会员", "金卡会员"].map((x) => Type.Literal(x)),
      ),
    ),
    notes: Type.Optional(Type.String({ maxLength: 300 })),
  }),
  async (a, c) => {
    const row = (
      await q(c, "SELECT * FROM business.customers WHERE id=$1 FOR UPDATE", [
        a.id,
      ])
    ).rows[0];
    check(row, "CUSTOMER_NOT_FOUND", "客户不存在");
    check(
      a.name !== undefined || a.level !== undefined || a.notes !== undefined,
      "NO_CHANGE",
      "请提供需要更新的内容",
    );
    if (!c.preview)
      await q(
        c,
        "UPDATE business.customers SET name=COALESCE($1,name),level=COALESCE($2,level),notes=COALESCE($3,notes) WHERE id=$4",
        [a.name ?? null, a.level ?? null, a.notes ?? null, a.id],
      );
    return detail(
      "维护客户资料",
      {
        姓名: a.name ?? row.name,
        会员等级: a.level ?? row.level,
        备注: a.notes ?? row.notes,
      },
      row.id,
    );
  },
);
add(
  "customers_addresses",
  "customers",
  "查询收货地址",
  "客户查询自己的收货地址；管理员须指定 customerId。",
  both,
  false,
  object({ customerId: Type.Optional(id) }),
  async (a, c) => {
    const customerId =
      c.identity.role === "customer" ? c.identity.customerId : a.customerId;
    check(customerId, "CUSTOMER_REQUIRED", "请先指定客户");
    return result(
      "收货地址",
      (
        await q(
          c,
          'SELECT id,recipient,phone,address,is_default as "isDefault" FROM business.addresses WHERE customer_id=$1 ORDER BY is_default DESC,id',
          [customerId],
        )
      ).rows,
      [
        { key: "recipient", label: "收件人" },
        { key: "phone", label: "联系电话" },
        { key: "address", label: "收货地址" },
      ],
    );
  },
);
add(
  "customers_address_save",
  "customers",
  "新增收货地址",
  "保存当前客户的新收货地址。",
  both,
  true,
  object({
    customerId: Type.Optional(id),
    recipient: text(30),
    phone: Type.String({ pattern: "^1[0-9]{10}$" }),
    address: text(200),
  }),
  async (a, c) => {
    const customerId =
      c.identity.role === "customer" ? c.identity.customerId : a.customerId;
    check(customerId, "CUSTOMER_REQUIRED", "请先指定客户");
    check(
      (await q(c, "SELECT 1 FROM business.customers WHERE id=$1", [customerId]))
        .rowCount,
      "CUSTOMER_NOT_FOUND",
      "客户不存在",
    );
    const newAddressId = newId("DZ");
    if (!c.preview)
      await q(
        c,
        "INSERT INTO business.addresses(id,customer_id,recipient,phone,address) VALUES($1,$2,$3,$4,$5)",
        [newAddressId, customerId, a.recipient, a.phone, a.address],
      );
    return detail(
      "新增收货地址",
      { 收件人: a.recipient, 联系电话: a.phone, 地址: a.address },
      c.preview ? undefined : newAddressId,
    );
  },
);
add(
  "orders_list",
  "orders",
  "查询订单",
  "查询销售订单，可按订单号、客户名、状态和下单日期 from/to 筛选；返回匹配总数和限量明细。客户仅能查自己的订单。",
  both,
  false,
  datedQueryInput,
  async (a, c) => {
    checkDateRange(a);
    const found = (
      await q(
        c,
        `SELECT o.id,o.status,o.total,c.name as customer,${dates},string_agg(i.name||' · '||i.color||' '||i.size,'、' ORDER BY i.sku_id) as products,jsonb_agg(jsonb_build_object('skuId',i.sku_id,'name',i.name,'color',i.color,'size',i.size,'quantity',i.quantity,'price',i.price,'image',p.image) ORDER BY i.sku_id) as items,COUNT(*) OVER()::int as match_count FROM business.orders o JOIN business.customers c ON c.id=o.customer_id JOIN business.order_items i ON i.order_id=o.id LEFT JOIN business.skus s ON s.id=i.sku_id LEFT JOIN business.products p ON p.id=s.product_id WHERE ($1::text IS NULL OR o.customer_id=$1) AND ($2='' OR o.status=$2) AND (o.id ILIKE $3 OR c.name ILIKE $3 OR EXISTS (SELECT 1 FROM business.order_items match_item WHERE match_item.order_id=o.id AND match_item.name ILIKE $3)) AND ($5::date IS NULL OR (o.created_at AT TIME ZONE 'Asia/Shanghai')::date >= $5::date) AND ($6::date IS NULL OR (o.created_at AT TIME ZONE 'Asia/Shanghai')::date <= $6::date) GROUP BY o.id,c.name ORDER BY o.created_at DESC LIMIT $4`,
        [
          c.identity.role === "customer" ? c.identity.customerId : null,
          a.status || "",
          `%${a.query || ""}%`,
          a.limit || 20,
          a.from || null,
          a.to || null,
        ],
      )
    ).rows;
    const total = found[0]?.match_count || 0;
    const rows = found.map(({ match_count, ...row }) => row);
    return result("销售订单", rows, [
      { key: "id", label: "订单号" },
      { key: "products", label: "商品" },
      { key: "customer", label: "客户" },
      { key: "total", label: "金额", format: "money" },
      { key: "status", label: "状态" },
      { key: "created", label: "下单时间" },
    ], { summary: `符合条件共 ${total} 笔，本次显示 ${rows.length} 笔` });
  },
);
add(
  "orders_detail",
  "orders",
  "查看订单详情",
  "查看订单商品、收货地址和物流信息。",
  both,
  false,
  idInput,
  async (a, c) => {
    const o = await order(c, a.id);
    return itemsResult(
      "订单详情",
      await orderItems(c, a.id),
      {
        订单号: o.id,
        客户: o.customer,
        状态: o.status,
        总金额: money(o.total),
        收货人: o.address.recipient,
        收货地址: o.address.address,
        物流: o.carrier ? `${o.carrier} ${o.tracking}` : "尚未发货",
      },
      o.id,
    );
  },
);
add(
  "orders_create",
  "orders",
  "创建订单",
  "按已选 SKU 和数量准备订单。先查询商品规格和收货地址。管理员代客下单需 customerId。",
  both,
  true,
  object({ items: itemInput, addressId: id, customerId: Type.Optional(id) }),
  async (a, c) => {
    const customerId =
      c.identity.role === "customer" ? c.identity.customerId : a.customerId;
    check(customerId, "CUSTOMER_REQUIRED", "请指定客户");
    const address = (
      await q(
        c,
        "SELECT recipient,phone,address FROM business.addresses WHERE id=$1 AND customer_id=$2",
        [a.addressId, customerId],
      )
    ).rows[0];
    check(address, "ADDRESS_NOT_FOUND", "收货地址不属于当前客户");
    const items = await skuItems(c, a.items);
    const total = items.reduce((n, s) => n + s.price * s.quantity, 0);
    const orderId = newId("XS");
    if (!c.preview) {
      await q(
        c,
        "INSERT INTO business.orders(id,customer_id,status,total,address) VALUES($1,$2,'待付款',$3,$4)",
        [orderId, customerId, total, address],
      );
      for (const s of items) {
        await q(
          c,
          "INSERT INTO business.order_items(order_id,sku_id,name,color,size,price,quantity) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [orderId, s.id, s.name, s.color, s.size, s.price, s.quantity],
        );
        await q(
          c,
          "UPDATE business.skus SET reserved=reserved+$1 WHERE id=$2",
          [s.quantity, s.id],
        );
      }
    }
    return itemsResult(
      c.preview ? "确认订单" : "订单已创建",
      items,
      {
        应付金额: money(total),
        收件人: address.recipient,
        收货地址: address.address,
        ...(!c.preview ? { 订单号: orderId, 状态: "待付款" } : {}),
      },
      c.preview ? undefined : orderId,
    );
  },
);
add(
  "orders_pay",
  "orders",
  "登记订单付款",
  "登记待付款订单的收款，进入待发货状态。",
  both,
  true,
  idInput,
  async (a, c) => {
    const o = await order(c, a.id);
    check(
      o.status === "待付款",
      "INVALID_ORDER_STATE",
      "仅待付款订单可以登记付款",
    );
    if (!c.preview) {
      await q(
        c,
        "UPDATE business.orders SET status='待发货',updated_at=now() WHERE id=$1",
        [o.id],
      );
      await q(
        c,
        "INSERT INTO business.ledger(type,direction,amount,reference,counterparty) VALUES('销售收款','收入',$1,$2,$3)",
        [o.total, o.id, o.customer],
      );
    }
    return detail(
      "订单付款",
      {
        订单号: o.id,
        金额: money(o.total),
        客户: o.customer,
        付款后状态: "待发货",
      },
      o.id,
    );
  },
);
add(
  "orders_cancel",
  "orders",
  "取消订单",
  "取消待付款订单并释放库存占用。已付款订单需走售后。",
  both,
  true,
  idInput,
  async (a, c) => {
    const o = await order(c, a.id);
    check(
      o.status === "待付款",
      "INVALID_ORDER_STATE",
      "仅待付款订单可取消；已付款订单请申请售后",
    );
    if (!c.preview) {
      for (const i of await orderItems(c, o.id))
        await q(
          c,
          "UPDATE business.skus SET reserved=reserved-$1 WHERE id=$2",
          [i.quantity, i.sku_id],
        );
      await q(
        c,
        "UPDATE business.orders SET status='已取消',updated_at=now() WHERE id=$1",
        [o.id],
      );
    }
    return detail(
      "取消订单",
      { 订单号: o.id, 释放库存: "整单商品", 金额: money(o.total) },
      o.id,
    );
  },
);
add(
  "orders_ship",
  "warehouse",
  "订单发货",
  "整单出库发货，必须填写真实业务输入的承运商和运单号。",
  admin,
  true,
  object({
    id,
    carrier: text(40),
    tracking: Type.String({
      minLength: 6,
      maxLength: 50,
      pattern: "^[A-Za-z0-9-]+$",
    }),
  }),
  async (a, c) => {
    const o = await order(c, a.id);
    check(o.status === "待发货", "INVALID_ORDER_STATE", "仅待发货订单可以发货");
    check(
      !(
        await q(
          c,
          "SELECT 1 FROM business.aftersales WHERE order_id=$1 AND status<>'已拒绝'",
          [o.id],
        )
      ).rowCount,
      "ACTIVE_AFTERSALE",
      "订单有进行中的售后，请先处理售后",
    );
    if (!c.preview) {
      for (const i of await orderItems(c, o.id)) {
        await q(
          c,
          "UPDATE business.skus SET stock=stock-$1,reserved=reserved-$1 WHERE id=$2",
          [i.quantity, i.sku_id],
        );
        await q(
          c,
          "INSERT INTO business.inventory_movements(sku_id,quantity,type,reference) VALUES($1,$2,'销售出库',$3)",
          [i.sku_id, -i.quantity, o.id],
        );
      }
      await q(
        c,
        "UPDATE business.orders SET status='已发货',carrier=$1,tracking=$2,updated_at=now() WHERE id=$3",
        [a.carrier, a.tracking, o.id],
      );
    }
    return detail(
      "订单发货",
      {
        订单号: o.id,
        快递公司: a.carrier,
        运单号: a.tracking,
        收货人: o.address.recipient,
      },
      o.id,
    );
  },
);
add(
  "orders_receive",
  "orders",
  "确认收货",
  "将已发货订单确认完成。",
  both,
  true,
  idInput,
  async (a, c) => {
    const o = await order(c, a.id);
    check(
      o.status === "已发货",
      "INVALID_ORDER_STATE",
      "订单当前不是已发货状态",
    );
    if (!c.preview)
      await q(
        c,
        "UPDATE business.orders SET status='已完成',updated_at=now() WHERE id=$1",
        [o.id],
      );
    return detail("确认收货", { 订单号: o.id, 金额: money(o.total) }, o.id);
  },
);
add(
  "inventory_list",
  "warehouse",
  "查询库存",
  "按商品关键词查询各规格的现货、占用和可售库存，可仅查询低于安全库存的规格。",
  admin,
  false,
  object({ ...queryInput.properties, lowOnly: Type.Optional(Type.Boolean()) }),
  async (a, c) => {
    const rows = (
      await q(
        c,
        `SELECT s.id as "skuId",p.id as "productId",p.name,s.color,s.size,s.stock,s.reserved,s.stock-s.reserved as available,s.reorder_point as "reorderPoint",s.cost,p.supplier_id as "supplierId",v.name as supplier FROM business.skus s JOIN business.products p ON p.id=s.product_id JOIN business.suppliers v ON v.id=p.supplier_id WHERE (p.name ILIKE $1 OR s.id ILIKE $1) AND (NOT $2 OR s.stock-s.reserved<s.reorder_point) ORDER BY s.stock-s.reserved,s.id LIMIT $3`,
        [`%${a.query || ""}%`, a.lowOnly || false, a.limit || 50],
      )
    ).rows;
    return result(
      a.lowOnly ? "待补货规格" : "仓库库存",
      rows,
      [
        { key: "name", label: "商品" },
        { key: "color", label: "颜色" },
        { key: "size", label: "尺码" },
        { key: "stock", label: "现货" },
        { key: "reserved", label: "已占用" },
        { key: "available", label: "可售" },
        { key: "reorderPoint", label: "安全库存" },
        { key: "supplier", label: "供应商" },
      ],
      {
        references: rows.map((row) => ({
          id: row.skuId,
          kind: "SKU",
          label: `${row.name} ${row.color} ${row.size}`,
          relatedIds: { productId: row.productId, supplierId: row.supplierId },
        })),
      },
    );
  },
);
add(
  "inventory_movements",
  "warehouse",
  "查询出入库流水",
  "查询商品出入库流水和关联单据。",
  admin,
  false,
  queryInput,
  async (a, c) =>
    result(
      "出入库流水",
      (
        await q(
          c,
          "SELECT m.id::text,p.name,s.color,s.size,m.type,m.quantity,m.reference,to_char(m.created_at AT TIME ZONE 'Asia/Shanghai','MM-DD HH24:MI') as created FROM business.inventory_movements m JOIN business.skus s ON s.id=m.sku_id JOIN business.products p ON p.id=s.product_id WHERE p.name ILIKE $1 OR m.reference ILIKE $1 ORDER BY m.created_at DESC,m.id DESC LIMIT $2",
          [`%${a.query || ""}%`, a.limit || 30],
        )
      ).rows,
      [
        { key: "name", label: "商品" },
        { key: "color", label: "颜色" },
        { key: "size", label: "尺码" },
        { key: "type", label: "业务类型" },
        { key: "quantity", label: "数量" },
        { key: "reference", label: "关联单号" },
        { key: "created", label: "时间" },
      ],
    ),
);
add(
  "suppliers_list",
  "suppliers",
  "查询供应商",
  "按名称查询供应商联系方式、交货周期。",
  admin,
  false,
  queryInput,
  async (a, c) =>
    result(
      "供应商档案",
      (
        await q(
          c,
          'SELECT id,name,contact,phone,city,lead_days as "leadDays",notes FROM business.suppliers WHERE name ILIKE $1 ORDER BY id LIMIT $2',
          [`%${a.query || ""}%`, a.limit || 30],
        )
      ).rows,
      [
        { key: "name", label: "供应商" },
        { key: "contact", label: "联系人" },
        { key: "phone", label: "联系电话" },
        { key: "city", label: "城市" },
        { key: "leadDays", label: "交货天数" },
      ],
    ),
);
add(
  "suppliers_update",
  "suppliers",
  "维护供应商",
  "修改供应商联系人、电话或交货天数。",
  admin,
  true,
  object({
    id,
    contact: Type.Optional(text(30)),
    phone: Type.Optional(text(30)),
    leadDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 90 })),
  }),
  async (a, c) => {
    const s = (
      await q(c, "SELECT * FROM business.suppliers WHERE id=$1 FOR UPDATE", [
        a.id,
      ])
    ).rows[0];
    check(s, "SUPPLIER_NOT_FOUND", "供应商不存在");
    check(
      a.contact !== undefined ||
        a.phone !== undefined ||
        a.leadDays !== undefined,
      "NO_CHANGE",
      "请提供需要修改的信息",
    );
    if (!c.preview)
      await q(
        c,
        "UPDATE business.suppliers SET contact=COALESCE($1,contact),phone=COALESCE($2,phone),lead_days=COALESCE($3,lead_days) WHERE id=$4",
        [a.contact ?? null, a.phone ?? null, a.leadDays ?? null, a.id],
      );
    return detail(
      "维护供应商",
      {
        供应商: s.name,
        联系人: a.contact ?? s.contact,
        电话: a.phone ?? s.phone,
        交货天数: a.leadDays ?? s.lead_days,
      },
      s.id,
    );
  },
);
add(
  "purchases_list",
  "purchases",
  "查询采购单",
  "查看采购状态、供应商、到货与付款情况。status 只用于到货状态（待到货、已入库）；查询未付款采购单使用 paid=false，已付款使用 paid=true，不要把付款状态传入 status。",
  admin,
  false,
  object({
    ...queryInput.properties,
    status: Type.Optional(Type.Union([Type.Literal("待到货"), Type.Literal("已入库")])),
    paid: Type.Optional(Type.Boolean()),
  }),
  async (a, c) =>
    result(
      "采购订单",
      (
        await q(
          c,
          "SELECT p.id,s.name as supplier,p.status,p.total,p.paid,to_char(p.created_at AT TIME ZONE 'Asia/Shanghai','MM-DD HH24:MI') as created FROM business.purchase_orders p JOIN business.suppliers s ON s.id=p.supplier_id WHERE (p.id ILIKE $1 OR s.name ILIKE $1) AND ($2='' OR p.status=$2) AND ($4::boolean IS NULL OR p.paid=$4) ORDER BY p.created_at DESC LIMIT $3",
          [`%${a.query || ""}%`, a.status || "", a.limit || 30, a.paid ?? null],
        )
      ).rows,
      [
        { key: "id", label: "采购单号" },
        { key: "supplier", label: "供应商" },
        { key: "total", label: "采购金额", format: "money" },
        { key: "status", label: "到货状态" },
        { key: "paid", label: "已付款", format: "boolean" },
        { key: "created", label: "创建时间" },
      ],
    ),
);
add(
  "purchases_detail",
  "purchases",
  "查看采购明细",
  "查看采购商品规格、数量和采购单价。",
  admin,
  false,
  idInput,
  async (a, c) => {
    const p = (
      await q(
        c,
        "SELECT p.*,s.name as supplier FROM business.purchase_orders p JOIN business.suppliers s ON s.id=p.supplier_id WHERE p.id=$1",
        [a.id],
      )
    ).rows[0];
    check(p, "PURCHASE_NOT_FOUND", "采购单不存在");
    const items = (
      await q(
        c,
        "SELECT i.sku_id,p.name,s.color,s.size,i.quantity,i.cost as price FROM business.purchase_items i JOIN business.skus s ON s.id=i.sku_id JOIN business.products p ON p.id=s.product_id WHERE i.purchase_id=$1",
        [a.id],
      )
    ).rows;
    return itemsResult(
      "采购明细",
      items,
      {
        采购单号: p.id,
        供应商: p.supplier,
        状态: p.status,
        采购金额: money(p.total),
        付款状态: p.paid ? "已付款" : "未付款",
      },
      p.id,
    );
  },
);
add(
  "purchases_create",
  "purchases",
  "创建采购单",
  "创建单一供应商的采购订单，采购价取自 SKU，数量由用户确认。",
  admin,
  true,
  object({
    supplierId: id,
    items: itemInput,
    note: Type.Optional(Type.String({ maxLength: 300 })),
    replenishmentSnapshotId: Type.Optional(id),
  }),
  async (a, c) => {
    const supplier = (
      await q(c, "SELECT * FROM business.suppliers WHERE id=$1", [a.supplierId])
    ).rows[0];
    check(supplier, "SUPPLIER_NOT_FOUND", "供应商不存在");
    const items = await skuItems(c, a.items, true);
    check(
      items.every((s) => s.supplier_id === a.supplierId),
      "SUPPLIER_MISMATCH",
      "所选商品不属于同一供应商，请分开采购",
    );
    if (a.replenishmentSnapshotId) {
      check(config().replenishment?.enabled, "FEATURE_DISABLED", "补货功能未启用");
      await validateReplenishmentPurchase(c, a.replenishmentSnapshotId, a.supplierId, a.items);
    }
    const total = items.reduce((n, s) => n + s.cost * s.quantity, 0);
    const purchaseId = newId("CG");
    if (!c.preview) {
      await q(
        c,
        "INSERT INTO business.purchase_orders(id,supplier_id,status,total,note) VALUES($1,$2,'待到货',$3,$4)",
        [purchaseId, a.supplierId, total, a.note || ""],
      );
      for (const s of items)
        await q(
          c,
          "INSERT INTO business.purchase_items(purchase_id,sku_id,cost,quantity) VALUES($1,$2,$3,$4)",
          [purchaseId, s.id, s.cost, s.quantity],
        );
    }
    return itemsResult(
      c.preview ? "确认采购" : "采购单已创建",
      items.map((s) => ({ ...s, price: s.cost })),
      {
        供应商: supplier.name,
        采购金额: money(total),
        预计交货: `${supplier.lead_days} 天`,
        备注: a.note || "",
        ...(!c.preview ? { 采购单号: purchaseId } : {}),
      },
      c.preview ? undefined : purchaseId,
    );
  },
);
add(
  "purchases_receive",
  "warehouse",
  "采购到货入库",
  "整张采购单到货入库，增加现货库存。",
  admin,
  true,
  idInput,
  async (a, c) => {
    const p = (
      await q(
        c,
        "SELECT * FROM business.purchase_orders WHERE id=$1 FOR UPDATE",
        [a.id],
      )
    ).rows[0];
    check(p, "PURCHASE_NOT_FOUND", "采购单不存在");
    check(p.status === "待到货", "INVALID_PURCHASE_STATE", "采购单已经入库");
    const items = (
      await q(
        c,
        "SELECT * FROM business.purchase_items WHERE purchase_id=$1 ORDER BY sku_id",
        [p.id],
      )
    ).rows;
    if (!c.preview) {
      for (const s of items) {
        await q(c, "UPDATE business.skus SET stock=stock+$1 WHERE id=$2", [
          s.quantity,
          s.sku_id,
        ]);
        await q(
          c,
          "INSERT INTO business.inventory_movements(sku_id,quantity,type,reference) VALUES($1,$2,'采购入库',$3)",
          [s.sku_id, s.quantity, p.id],
        );
      }
      await q(
        c,
        "UPDATE business.purchase_orders SET status='已入库',received_at=now() WHERE id=$1",
        [p.id],
      );
    }
    return detail(
      "采购到货入库",
      {
        采购单号: p.id,
        入库数量: items.reduce((n, s) => n + s.quantity, 0),
        仓库: "杭州中心仓",
      },
      p.id,
    );
  },
);
add(
  "purchases_pay",
  "finance",
  "登记采购付款",
  "登记采购付款并记入支出台账。",
  admin,
  true,
  idInput,
  async (a, c) => {
    const p = (
      await q(
        c,
        "SELECT p.*,s.name as supplier FROM business.purchase_orders p JOIN business.suppliers s ON s.id=p.supplier_id WHERE p.id=$1 FOR UPDATE OF p",
        [a.id],
      )
    ).rows[0];
    check(p, "PURCHASE_NOT_FOUND", "采购单不存在");
    check(!p.paid, "ALREADY_PAID", "采购单已经付款");
    if (!c.preview) {
      await q(c, "UPDATE business.purchase_orders SET paid=true WHERE id=$1", [
        p.id,
      ]);
      await q(
        c,
        "INSERT INTO business.ledger(type,direction,amount,reference,counterparty) VALUES('采购付款','支出',$1,$2,$3)",
        [p.total, p.id, p.supplier],
      );
    }
    return detail(
      "采购付款",
      { 采购单号: p.id, 供应商: p.supplier, 付款金额: money(p.total) },
      p.id,
    );
  },
);
add(
  "aftersales_list",
  "aftersales",
  "查询售后",
  "查询售后申请、处理状态和退款金额。",
  both,
  false,
  queryInput,
  async (a, c) =>
    result(
      "售后服务",
      (
        await q(
          c,
          "SELECT a.id,a.order_id as \"orderId\",c.name as customer,a.reason,a.status,a.amount FROM business.aftersales a JOIN business.customers c ON c.id=a.customer_id WHERE ($1::text IS NULL OR a.customer_id=$1) AND ($2='' OR a.status=$2) AND (a.id ILIKE $3 OR a.order_id ILIKE $3 OR c.name ILIKE $3) ORDER BY a.created_at DESC LIMIT $4",
          [
            c.identity.role === "customer" ? c.identity.customerId : null,
            a.status || "",
            `%${a.query || ""}%`,
            a.limit || 30,
          ],
        )
      ).rows,
      [
        { key: "id", label: "售后单号" },
        { key: "orderId", label: "原订单" },
        { key: "customer", label: "客户" },
        { key: "reason", label: "申请原因" },
        { key: "amount", label: "退款金额", format: "money" },
        { key: "status", label: "状态" },
      ],
    ),
);
add(
  "aftersales_apply",
  "aftersales",
  "申请售后",
  "对已付款订单申请整单退货退款，需要说明原因。",
  both,
  true,
  object({ orderId: id, reason: text(300) }),
  async (a, c) => {
    const o = await order(c, a.orderId);
    check(
      ["待发货", "已发货", "已完成"].includes(o.status),
      "INVALID_ORDER_STATE",
      "该订单当前不能申请退货退款",
    );
    check(
      !(
        await q(c, "SELECT 1 FROM business.aftersales WHERE order_id=$1", [
          o.id,
        ])
      ).rowCount,
      "AFTERSALE_EXISTS",
      "订单已有售后申请，请查询进度",
    );
    const saleId = newId("SH");
    if (!c.preview)
      await q(
        c,
        "INSERT INTO business.aftersales(id,order_id,customer_id,reason,status,amount) VALUES($1,$2,$3,$4,'待审核',$5)",
        [saleId, o.id, o.customer_id, a.reason, o.total],
      );
    return detail(
      "申请售后",
      {
        订单号: o.id,
        申请原因: a.reason,
        退款金额: money(o.total),
        处理方式: "整单退货退款",
      },
      c.preview ? undefined : saleId,
    );
  },
);
add(
  "aftersales_review",
  "aftersales",
  "审核售后",
  "审核待处理售后，通过或拒绝。通过后根据订单是否发货进入待退货或待退款。",
  admin,
  true,
  object({ id, approve: Type.Boolean() }),
  async (a, c) => {
    const initial = (
      await q(c, "SELECT order_id FROM business.aftersales WHERE id=$1", [a.id])
    ).rows[0];
    check(initial, "AFTERSALE_NOT_FOUND", "售后单不存在");
    const o = await order(c, initial.order_id);
    const s = await aftersale(c, a.id);
    check(s.status === "待审核", "INVALID_AFTERSALE_STATE", "售后单已审核");
    const next = a.approve
      ? o.status === "待发货"
        ? "待退款"
        : "待退货"
      : "已拒绝";
    if (!c.preview)
      await q(
        c,
        "UPDATE business.aftersales SET status=$1,updated_at=now() WHERE id=$2",
        [next, s.id],
      );
    return detail(
      "审核售后",
      {
        售后单号: s.id,
        原订单: s.order_id,
        审核结果: a.approve ? "通过" : "拒绝",
        后续状态: next,
        退款金额: money(s.amount),
      },
      s.id,
    );
  },
);
add(
  "aftersales_receive",
  "warehouse",
  "退货收货入库",
  "确认整单退货已收货，恢复库存并进入待退款。",
  admin,
  true,
  idInput,
  async (a, c) => {
    const s = await aftersale(c, a.id);
    check(
      s.status === "待退货",
      "INVALID_AFTERSALE_STATE",
      "售后当前不是待退货状态",
    );
    if (!c.preview) {
      for (const i of await orderItems(c, s.order_id)) {
        await q(c, "UPDATE business.skus SET stock=stock+$1 WHERE id=$2", [
          i.quantity,
          i.sku_id,
        ]);
        await q(
          c,
          "INSERT INTO business.inventory_movements(sku_id,quantity,type,reference) VALUES($1,$2,'退货入库',$3)",
          [i.sku_id, i.quantity, s.id],
        );
      }
      await q(
        c,
        "UPDATE business.aftersales SET status='待退款',updated_at=now() WHERE id=$1",
        [s.id],
      );
    }
    return detail(
      "退货收货",
      {
        售后单号: s.id,
        原订单: s.order_id,
        入库仓库: "杭州中心仓",
        后续状态: "待退款",
      },
      s.id,
    );
  },
);
add(
  "aftersales_refund",
  "finance",
  "办理售后退款",
  "对待退款售后完成退款登记，更新订单与退款台账。",
  admin,
  true,
  idInput,
  async (a, c) => {
    const initial = (
      await q(c, "SELECT order_id FROM business.aftersales WHERE id=$1", [a.id])
    ).rows[0];
    check(initial, "AFTERSALE_NOT_FOUND", "售后单不存在");
    const o = await order(c, initial.order_id);
    const s = await aftersale(c, a.id);
    check(
      s.status === "待退款",
      "INVALID_AFTERSALE_STATE",
      "请先审核售后并完成必要的退货收货",
    );
    if (!c.preview) {
      if (o.status === "待发货")
        for (const i of await orderItems(c, o.id))
          await q(
            c,
            "UPDATE business.skus SET reserved=reserved-$1 WHERE id=$2",
            [i.quantity, i.sku_id],
          );
      await q(
        c,
        "UPDATE business.aftersales SET status='已退款',updated_at=now() WHERE id=$1",
        [s.id],
      );
      await q(
        c,
        "UPDATE business.orders SET status='已退款',updated_at=now() WHERE id=$1",
        [o.id],
      );
      await q(
        c,
        "INSERT INTO business.ledger(type,direction,amount,reference,counterparty) VALUES('售后退款','支出',$1,$2,$3)",
        [s.amount, s.id, o.customer],
      );
    }
    return detail(
      "售后退款",
      {
        售后单号: s.id,
        原订单: o.id,
        退款金额: money(s.amount),
        客户: o.customer,
      },
      s.id,
    );
  },
);
add(
  "finance_summary",
  "finance",
  "查询收支汇总",
  "汇总指定日期的销售收款、售后退款、采购支出及净收支；询问金额合计时优先使用此能力，日期格式 YYYY-MM-DD，不传则当天。",
  admin,
  false,
  object({
    from: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
    to: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
  }),
  async (a, c) => {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const from = a.from || today,
      to = a.to || today;
    checkDateRange({ from, to });
    const rows = (
      await q(
        c,
        "SELECT type,COALESCE(sum(amount),0)::int as amount,count(*)::int as count FROM business.ledger WHERE (created_at AT TIME ZONE 'Asia/Shanghai')::date BETWEEN $1::date AND $2::date GROUP BY type",
        [from, to],
      )
    ).rows;
    const total = (type: string) =>
      rows.find((r) => r.type === type)?.amount || 0;
    return result(
      "收支汇总",
      [
        { name: "销售收款", amount: total("销售收款") },
        { name: "采购付款", amount: total("采购付款") },
        { name: "售后退款", amount: total("售后退款") },
        {
          name: "净收支",
          amount: total("销售收款") - total("采购付款") - total("售后退款"),
        },
      ],
      [
        { key: "name", label: "项目" },
        { key: "amount", label: "金额", format: "money" },
      ],
      { view: "metrics", summary: `${from} 至 ${to} · 人民币` },
    );
  },
);
add(
  "finance_ledger",
  "finance",
  "查询收支流水",
  "查看收款、付款和退款的单据流水明细，可用 status 筛选业务类型或收支方向，用 from/to 筛选日期。结果限量，金额合计使用收支汇总。",
  admin,
  false,
  datedQueryInput,
  async (a, c) => {
    checkDateRange(a);
    return result(
      "收支流水",
      (
        await q(
          c,
          "SELECT id::text,type,direction,amount,reference,counterparty,to_char(created_at AT TIME ZONE 'Asia/Shanghai','MM-DD HH24:MI') as created FROM business.ledger WHERE (reference ILIKE $1 OR counterparty ILIKE $1 OR type ILIKE $1) AND ($3='' OR type ILIKE $3 OR direction ILIKE $3) AND ($4::date IS NULL OR (created_at AT TIME ZONE 'Asia/Shanghai')::date >= $4::date) AND ($5::date IS NULL OR (created_at AT TIME ZONE 'Asia/Shanghai')::date <= $5::date) ORDER BY created_at DESC,id DESC LIMIT $2",
          [`%${a.query || ""}%`, a.limit || 30, a.status ? `%${a.status}%` : "", a.from || null, a.to || null],
        )
      ).rows,
      [
        { key: "type", label: "业务类型" },
        { key: "direction", label: "收支" },
        { key: "amount", label: "金额", format: "money" },
        { key: "counterparty", label: "往来对象" },
        { key: "reference", label: "关联单据" },
        { key: "created", label: "时间" },
      ],
      { summary: `流水明细最多显示 ${a.limit || 30} 条；金额合计请查询收支汇总` },
    );
  },
);
add(
  "dashboard_summary",
  "operations",
  "经营概览",
  "查询待发货、低库存、待审核售后、待到货采购数量。",
  admin,
  false,
  noInput,
  async (_a, c) => {
    const r = (
      await q(
        c,
        "SELECT (SELECT count(*)::int FROM business.orders WHERE status='待发货') as pending_orders,(SELECT count(*)::int FROM business.skus WHERE stock-reserved<reorder_point) as low_stock,(SELECT count(*)::int FROM business.aftersales WHERE status='待审核') as pending_aftersales,(SELECT count(*)::int FROM business.purchase_orders WHERE status='待到货') as pending_purchases",
      )
    ).rows[0];
    return result(
      "经营概览",
      [
        { name: "待发货订单", value: r.pending_orders },
        { name: "待补货规格", value: r.low_stock },
        { name: "待审核售后", value: r.pending_aftersales },
        { name: "待到货采购", value: r.pending_purchases },
      ],
      [
        { key: "name", label: "事项" },
        { key: "value", label: "数量" },
      ],
      { view: "metrics" },
    );
  },
);
export { capabilities };

add(
  "customers_create",
  "customers",
  "新增客户",
  "建立客户档案，姓名与手机号必填；手机号已有档案时提示重复。",
  admin,
  true,
  object({
    name: text(30),
    phone: Type.String({ pattern: "^1[0-9]{10}$" }),
    notes: Type.Optional(Type.String({ maxLength: 300 })),
  }),
  async (a, c) => {
    await q(c, "SELECT pg_advisory_xact_lock(hashtext($1))", [
      `customer:${a.phone}`,
    ]);
    check(
      !(
        await q(c, "SELECT 1 FROM business.customers WHERE phone=$1", [a.phone])
      ).rowCount,
      "CUSTOMER_EXISTS",
      "该手机号已有客户档案，请查询后维护",
    );
    const customerId = newId("KH");
    if (!c.preview)
      await q(
        c,
        "INSERT INTO business.customers(id,name,phone,notes) VALUES($1,$2,$3,$4)",
        [customerId, a.name, a.phone, a.notes || ""],
      );
    return detail(
      "新增客户",
      {
        姓名: a.name,
        联系电话: a.phone,
        会员等级: "普通会员",
        备注: a.notes || "",
      },
      c.preview ? undefined : customerId,
    );
  },
);
add(
  "suppliers_create",
  "suppliers",
  "新增供应商",
  "建立供应商档案，需要名称、联系人、电话、城市和交货天数。",
  admin,
  true,
  object({
    name: text(80),
    contact: text(30),
    phone: text(30),
    city: text(30),
    leadDays: Type.Integer({ minimum: 1, maximum: 90 }),
    notes: Type.Optional(Type.String({ maxLength: 300 })),
  }),
  async (a, c) => {
    await q(c, "SELECT pg_advisory_xact_lock(hashtext($1))", [
      `supplier:${a.name}`,
    ]);
    check(
      !(await q(c, "SELECT 1 FROM business.suppliers WHERE name=$1", [a.name]))
        .rowCount,
      "SUPPLIER_EXISTS",
      "同名供应商已存在",
    );
    const supplierId = newId("GY");
    if (!c.preview)
      await q(
        c,
        "INSERT INTO business.suppliers(id,name,contact,phone,city,lead_days,notes) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          supplierId,
          a.name,
          a.contact,
          a.phone,
          a.city,
          a.leadDays,
          a.notes || "",
        ],
      );
    return detail(
      "新增供应商",
      {
        供应商: a.name,
        联系人: a.contact,
        联系电话: a.phone,
        城市: a.city,
        交货天数: a.leadDays,
      },
      c.preview ? undefined : supplierId,
    );
  },
);
add(
  "products_create",
  "products",
  "新增商品",
  "建立女装商品与颜色尺码规格，售价和采购价单位为分。创建时库存为零，通过采购入库增加库存。",
  admin,
  true,
  object({
    name: text(80),
    category: Type.Union(
      ["针织衫", "裤装", "连衣裙", "衬衫", "外套", "半裙"].map((x) =>
        Type.Literal(x),
      ),
    ),
    description: text(400),
    material: text(120),
    season: text(30),
    supplierId: id,
    price: Type.Integer({ minimum: 100, maximum: 1000000 }),
    skus: Type.Array(
      object({
        color: text(30),
        size: text(20),
        cost: Type.Integer({ minimum: 100, maximum: 1000000 }),
      }),
      { minItems: 1, maxItems: 30 },
    ),
  }),
  async (a, c) => {
    const supplier = (
      await q(c, "SELECT name FROM business.suppliers WHERE id=$1", [
        a.supplierId,
      ])
    ).rows[0];
    check(supplier, "SUPPLIER_NOT_FOUND", "供应商不存在");
    check(
      new Set(a.skus.map((s: any) => `${s.color}|${s.size}`)).size ===
        a.skus.length,
      "DUPLICATE_SKU",
      "颜色和尺码组合不能重复",
    );
    const productId = newId("SP");
    const picture = (
      {
        针织衫: "knit",
        裤装: "pants",
        连衣裙: "dress",
        衬衫: "shirt",
        外套: "coat",
        半裙: "skirt",
      } as Record<string, string>
    )[a.category];
    if (!c.preview) {
      await q(
        c,
        "INSERT INTO business.products(id,name,category,description,material,season,image,price,supplier_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          productId,
          a.name,
          a.category,
          a.description,
          a.material,
          a.season,
          `/products/${picture}.svg`,
          a.price,
          a.supplierId,
        ],
      );
      for (const [i, s] of a.skus.entries())
        await q(
          c,
          "INSERT INTO business.skus(id,product_id,color,size,cost) VALUES($1,$2,$3,$4,$5)",
          [`${productId}-${i + 1}`, productId, s.color, s.size, s.cost],
        );
    }
    return result(
      "新增商品",
      a.skus.map((s: any) => ({ color: s.color, size: s.size, cost: s.cost })),
      [
        { key: "color", label: "颜色" },
        { key: "size", label: "尺码" },
        { key: "cost", label: "采购价", format: "money" },
      ],
      {
        view: "detail",
        referenceId: c.preview ? undefined : productId,
        details: [
          { label: "商品名称", value: a.name },
          { label: "供应商", value: supplier.name },
          { label: "售价", value: money(a.price) },
          { label: "初始库存", value: 0 },
        ],
      },
    );
  },
);
