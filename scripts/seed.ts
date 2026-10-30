import type pg from "pg";
import { applyCatalog20261030 } from "./catalog-data.ts";
export async function seed(db: pg.Client) {
  const suppliers = [
    [
      "S001",
      "杭州禾织服饰有限公司",
      "许嘉宁",
      "13800001261",
      "杭州",
      5,
      "针织与羊毛品类，周一至周六收单。",
    ],
    [
      "S002",
      "绍兴云帛服装有限公司",
      "沈清和",
      "13800001262",
      "绍兴",
      7,
      "梭织衬衫、连衣裙与半裙。",
    ],
    [
      "S003",
      "广州简序制衣有限公司",
      "吴晓棠",
      "13800001263",
      "广州",
      6,
      "通勤裤装与西装，常规款持续补单。",
    ],
  ];
  for (const s of suppliers)
    await db.query(
      "INSERT INTO business.suppliers VALUES($1,$2,$3,$4,$5,$6,$7)",
      s,
    );
  const customers = [
    [
      "C001",
      "林知夏",
      "13800002001",
      "银卡会员",
      "偏爱燕麦色和简洁通勤款，常穿 M 码。",
    ],
    ["C002", "周婉予", "13800002002", "金卡会员", "偏爱宽松版型，常穿 L 码。"],
    ["C003", "许安宁", "13800002003", "普通会员", "关注面料触感，常穿 S 码。"],
    ["C004", "宋以棠", "13800002004", "银卡会员", "喜欢针织叠穿和中性色。"],
    ["C005", "陈雨桐", "13800002005", "普通会员", "日常通勤，常穿 M 码。"],
    ["C006", "沈书禾", "13800002006", "金卡会员", "偏爱长裙与羊毛外套。"],
    ["C007", "江晚晴", "13800002007", "普通会员", "休闲与通勤混搭。"],
    ["C008", "陆清欢", "13800002008", "银卡会员", "常购衬衫和直筒裤。"],
  ];
  for (const c of customers)
    await db.query(
      "INSERT INTO business.customers(id,name,phone,level,notes) VALUES($1,$2,$3,$4,$5)",
      c,
    );
  const addresses = [
    "浙江省杭州市西湖区文新街道 清禾公寓 3 幢 502 室",
    "浙江省杭州市拱墅区和睦街道 云栖雅苑 2 幢 801 室",
    "江苏省苏州市工业园区星湖街 青禾里 6 幢 302 室",
    "上海市徐汇区田林街道 南庭公寓 5 幢 601 室",
  ];
  for (let i = 0; i < customers.length; i++)
    await db.query(
      "INSERT INTO business.addresses VALUES($1,$2,$3,$4,$5,true)",
      [
        `A00${i + 1}`,
        customers[i][0],
        customers[i][1],
        customers[i][2],
        addresses[i % addresses.length],
      ],
    );
  const products = [
    [
      "P001",
      "云感羊毛圆领针织衫",
      "针织衫",
      "细腻羊毛混纺，微落肩剪裁，适合秋冬通勤与日常叠穿。",
      "50% 羊毛 · 30% 腈纶 · 20% 锦纶",
      "秋冬",
      "knit",
      32900,
      13800,
      "S001",
      ["燕麦白", "烟灰色"],
    ],
    [
      "P002",
      "柔雾 V 领针织开衫",
      "针织衫",
      "略宽松的短款比例，贝壳质感纽扣，可单穿也可搭配衬衫。",
      "45% 羊毛 · 55% 棉",
      "秋冬",
      "cardigan",
      35900,
      15200,
      "S001",
      ["奶油白", "可可棕"],
    ],
    [
      "P003",
      "松弛感垂坠直筒西裤",
      "裤装",
      "中高腰直筒版型，前片压褶，面料垂顺，日常办公轻松搭配。",
      "68% 聚酯纤维 · 28% 粘纤 · 4% 氨纶",
      "四季",
      "pants",
      29900,
      11200,
      "S003",
      ["炭灰色", "燕麦色"],
    ],
    [
      "P004",
      "法式方领长袖连衣裙",
      "连衣裙",
      "收腰 A 字轮廓与方领设计，带里衬，适合通勤与周末约会。",
      "80% 粘纤 · 20% 锦纶",
      "秋冬",
      "dress",
      45900,
      19800,
      "S002",
      ["墨黑色", "栗子棕"],
    ],
    [
      "P005",
      "清风棉质通勤衬衫",
      "衬衫",
      "细支棉面料，经典领型与略宽松衣身，后背工字褶方便活动。",
      "100% 棉",
      "四季",
      "shirt",
      25900,
      9600,
      "S002",
      ["本白色", "浅蓝色"],
    ],
    [
      "P006",
      "双面呢短款羊毛外套",
      "外套",
      "短款直身剪裁，翻领与落肩设计，双面呢触感轻软。",
      "80% 羊毛 · 20% 锦纶",
      "秋冬",
      "coat",
      89900,
      40500,
      "S001",
      ["燕麦驼", "深灰色"],
    ],
    [
      "P007",
      "简序单排扣西装",
      "外套",
      "自然肩线，单排扣与后开衩，适合搭配同色系裤装。",
      "72% 聚酯纤维 · 24% 粘纤 · 4% 氨纶",
      "四季",
      "blazer",
      56900,
      23600,
      "S003",
      ["深咖色", "岩灰色"],
    ],
    [
      "P008",
      "暮色垂感 A 字半裙",
      "半裙",
      "中长款 A 字轮廓，侧拉链与后腰松紧，行走时自然垂落。",
      "60% 聚酯纤维 · 40% 粘纤",
      "秋冬",
      "skirt",
      28900,
      10800,
      "S002",
      ["巧克力色", "墨黑色"],
    ],
    [
      "P009",
      "轻暖半高领打底衫",
      "针织衫",
      "贴身但不紧绷，半高领包裹颈部，适合针织或外套内搭。",
      "48% 粘纤 · 30% 棉 · 22% 锦纶",
      "秋冬",
      "knit",
      16900,
      6200,
      "S001",
      ["米杏色", "墨黑色"],
    ],
    [
      "P010",
      "复古水洗直筒牛仔裤",
      "裤装",
      "中高腰直筒裤型，复古中蓝水洗，裤脚整洁，适合日常出行。",
      "99% 棉 · 1% 氨纶",
      "四季",
      "pants",
      31900,
      12600,
      "S003",
      ["复古蓝", "灰蓝色"],
    ],
    [
      "P011",
      "软糯绞花针织背心",
      "针织衫",
      "经典绞花纹理与 V 领设计，搭配衬衫或打底衫形成层次。",
      "35% 羊毛 · 40% 棉 · 25% 锦纶",
      "秋冬",
      "vest",
      22900,
      8800,
      "S001",
      ["奶茶色", "奶油白"],
    ],
    [
      "P012",
      "柔光缎面长袖衬衫",
      "衬衫",
      "低光泽垂感面料，利落小翻领，适合通勤和晚间聚会。",
      "97% 聚酯纤维 · 3% 氨纶",
      "四季",
      "shirt",
      29900,
      11500,
      "S002",
      ["香槟色", "雾粉色"],
    ],
  ] as const;
  for (const [index, p] of products.entries()) {
    await db.query(
      "INSERT INTO business.products(id,name,category,description,material,season,image,price,supplier_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [p[0], p[1], p[2], p[3], p[4], p[5], `/products/${p[6]}.svg`, p[7], p[9]],
    );
    for (const [colorIndex, color] of p[10].entries())
      for (const [sizeIndex, size] of ["S", "M", "L"].entries()) {
        const id = `${p[0]}-${colorIndex + 1}-${size}`;
        const stock =
          (index === 0 && size === "M") || (index === 2 && size === "L")
            ? 3
            : 16 + ((index * 7 + sizeIndex * 3 + colorIndex * 5) % 28);
        await db.query(
          "INSERT INTO business.skus(id,product_id,color,size,cost,stock,reorder_point) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [id, p[0], color, size, p[8], stock, 5],
        );
        await db.query(
          "INSERT INTO business.inventory_movements(sku_id,quantity,type,reference,created_at) VALUES($1,$2,'期初入库','KC20261001001','2026-10-01 09:00:00+08')",
          [id, stock],
        );
      }
  }
  const statuses = [
    "已完成",
    "已完成",
    "已发货",
    "待发货",
    "待付款",
    "已完成",
    "待发货",
    "已发货",
    "已完成",
    "待付款",
    "已完成",
    "待发货",
    "已完成",
    "已完成",
    "待发货",
    "已完成",
    "已发货",
    "待发货",
  ];
  for (let i = 0; i < 18; i++) {
    const customer = customers[i % customers.length];
    const p = products[i % products.length];
    const sku = `${p[0]}-1-${i % 3 === 0 ? "S" : "L"}`;
    const status = statuses[i];
    const day = i >= 14 ? 28 : 20 + (i % 8);
    const at = `2026-10-${day} ${String(9 + (i % 8)).padStart(2, "0")}:${String((i * 3) % 60).padStart(2, "0")}:00+08`;
    const id = `XS202610${day}${String(i + 1).padStart(4, "0")}`;
    const address = (
      await db.query(
        "SELECT recipient,phone,address FROM business.addresses WHERE customer_id=$1",
        [customer[0]],
      )
    ).rows[0];
    await db.query(
      "INSERT INTO business.orders(id,customer_id,status,total,address,tracking,carrier,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)",
      [
        id,
        customer[0],
        status,
        p[7],
        address,
        ["已发货", "已完成"].includes(status)
          ? `SF2026102800${String(i).padStart(3, "0")}`
          : null,
        ["已发货", "已完成"].includes(status) ? "顺丰速运" : null,
        at,
      ],
    );
    await db.query(
      "INSERT INTO business.order_items(order_id,sku_id,name,color,size,price,quantity) VALUES($1,$2,$3,$4,$5,$6,1)",
      [id, sku, p[1], p[10][0], i % 3 === 0 ? "S" : "L", p[7]],
    );
    if (["待付款", "待发货"].includes(status))
      await db.query(
        "UPDATE business.skus SET reserved=reserved+1 WHERE id=$1",
        [sku],
      );
    else {
      await db.query("UPDATE business.skus SET stock=stock-1 WHERE id=$1", [
        sku,
      ]);
      await db.query(
        "INSERT INTO business.inventory_movements(sku_id,quantity,type,reference,created_at) VALUES($1,-1,'销售出库',$2,$3)",
        [sku, id, at],
      );
    }
    if (status !== "待付款")
      await db.query(
        "INSERT INTO business.ledger(type,direction,amount,reference,counterparty,created_at) VALUES('销售收款','收入',$1,$2,$3,$4)",
        [p[7], id, customer[1], at],
      );
  }
  for (const [id, supplier, sku, quantity, cost, received, paid] of [
    ["CG202610260001", "S001", "P001-1-M", 30, 13800, false, false],
    ["CG202610250002", "S003", "P003-1-L", 24, 11200, false, true],
    ["CG202610240003", "S002", "P005-1-M", 20, 9600, true, true],
  ] as const) {
    await db.query(
      "INSERT INTO business.purchase_orders(id,supplier_id,status,total,paid,note,created_at,received_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        id,
        supplier,
        received ? "已入库" : "待到货",
        quantity * cost,
        paid,
        "秋冬常规款补单",
        "2026-10-26 10:00:00+08",
        received ? "2026-10-27 14:00:00+08" : null,
      ],
    );
    await db.query(
      "INSERT INTO business.purchase_items(purchase_id,sku_id,cost,quantity) VALUES($1,$2,$3,$4)",
      [id, sku, cost, quantity],
    );
    if (received) {
      await db.query("UPDATE business.skus SET stock=stock+$1 WHERE id=$2", [
        quantity,
        sku,
      ]);
      await db.query(
        "INSERT INTO business.inventory_movements(sku_id,quantity,type,reference,created_at) VALUES($1,$2,'采购入库',$3,'2026-10-27 14:00:00+08')",
        [sku, quantity, id],
      );
    }
    if (paid)
      await db.query(
        "INSERT INTO business.ledger(type,direction,amount,reference,counterparty,created_at) VALUES('采购付款','支出',$1,$2,$3,'2026-10-26 11:00:00+08')",
        [quantity * cost, id, suppliers.find((s) => s[0] === supplier)![1]],
      );
  }
  await db.query(
    "INSERT INTO business.aftersales(id,order_id,customer_id,reason,status,amount) SELECT 'SH202610280001',id,customer_id,'上身偏宽松，申请退货退款','待审核',total FROM business.orders WHERE id='XS202610200001'",
  );
  await applyCatalog20261030(db);
}
