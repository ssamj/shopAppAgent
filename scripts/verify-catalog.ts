import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { database } from "../shared/db.ts";
import { catalogPlan, catalogImage } from "./catalog-data.ts";

const root = "output/catalog-20261030";
const before = JSON.parse(readFileSync(`${root}/before.json`, "utf8"));
const businessBefore = JSON.parse(
  readFileSync(`${root}/before-business-records.json`, "utf8"),
);
const images = JSON.parse(readFileSync(`${root}/images.json`, "utf8"));
const pool = database("business");
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
try {
  const products = plain(
    (await pool.query("SELECT * FROM business.products ORDER BY id")).rows,
  );
  const skus = plain(
    (await pool.query("SELECT * FROM business.skus ORDER BY id")).rows,
  );
  assert.equal(products.length, before.products.length + 20);
  assert.equal(skus.length, before.skus.length + 160);
  for (const old of before.products) {
    const current = products.find((p: any) => p.id === old.id);
    assert.deepEqual(
      { ...current, image: old.image },
      old,
      `原商品资料发生额外变更：${old.id}`,
    );
    assert.equal(current.image, catalogImage(old.id));
  }
  for (const old of before.skus)
    assert.deepEqual(
      skus.find((s: any) => s.id === old.id),
      old,
      `原库存或占用被改动：${old.id}`,
    );
  for (const product of catalogPlan.newProducts) {
    const current = products.find((p: any) => p.id === product.id);
    assert.equal(current.name, product.name);
    assert.equal(current.price, product.price);
    assert.equal(current.material, product.material);
    assert.equal(current.image, catalogImage(product.id));
    const variants = skus.filter((s: any) => s.product_id === product.id);
    assert.equal(variants.length, 8);
    assert.deepEqual(
      [...new Set(variants.map((s: any) => s.color))].sort(),
      [...product.colors].sort(),
    );
    assert.deepEqual(
      [...new Set(variants.map((s: any) => s.size))].sort(),
      [...catalogPlan.sizes].sort(),
    );
    assert.ok(
      variants.every(
        (s: any) => s.cost === product.cost && s.stock >= 0 && s.reserved === 0,
      ),
    );
  }
  for (const [table, expected] of Object.entries(businessBefore) as [
    string,
    any,
  ][]) {
    const rows = (
      await pool.query(`SELECT * FROM business.${table} ORDER BY id`)
    ).rows;
    assert.deepEqual(
      {
        count: rows.length,
        sha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
      },
      expected,
      `原有业务单据发生变化：${table}`,
    );
  }
  const movements = (
    await pool.query(
      "SELECT count(*)::int AS count FROM business.inventory_movements WHERE reference=$1",
      [catalogPlan.batchId],
    )
  ).rows[0].count;
  assert.equal(
    movements,
    159,
    "Initial-stock movements must be created once, excluding zero-stock SKU",
  );
  assert.equal(new Set(images.images.map((i: any) => i.webpSha256)).size, 32);
  await Promise.all(
    products.map(async (p: any) => {
      const response = await fetch(`http://127.0.0.1:5180${p.image}`);
      assert.equal(response.status, 200, p.id);
      assert.match(response.headers.get("content-type")!, /image\/webp/);
      const data = Buffer.from(await response.arrayBuffer());
      assert.equal(
        createHash("sha256").update(data).digest("hex"),
        images.images.find((i: any) => i.id === p.id).webpSha256,
      );
    }),
  );
  const password = readFileSync(".local/登录账号.txt", "utf8").match(
    /初始密码：([^\r\n]+)/,
  )![1];
  const login = await fetch("http://127.0.0.1:5180/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-client": "shop" },
    body: JSON.stringify({ login: "zhixia", password }),
  });
  assert.equal(login.status, 200);
  const response = await fetch("http://127.0.0.1:5180/api/business/query", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-client": "shop",
      cookie: login.headers.get("set-cookie")!.split(";")[0],
    },
    body: JSON.stringify({
      capability: "products_search",
      arguments: { limit: 50 },
    }),
  });
  assert.equal(response.status, 200);
  const catalog = (await response.json()) as any;
  assert.equal(catalog.rows.length, 32);
  assert.ok(catalog.rows.every((p: any) => p.image.endsWith(".webp")));
  const report = {
    at: new Date().toISOString(),
    status: "passed",
    productCount: products.length,
    skuCount: skus.length,
    addedProducts: 20,
    replacedImages: 32,
    uniqueImages: 32,
    inventoryMovements: movements,
    originalProductsPreserved: true,
    originalStockAndReservationsPreserved: true,
    existingBusinessRecordsPreserved: true,
    authenticatedCatalogCount: catalog.rows.length,
    imagesHttpVerified: 32,
    priceRangeYuan: [
      Math.min(...products.map((p: any) => p.price)) / 100,
      Math.max(...products.map((p: any) => p.price)) / 100,
    ],
  };
  writeFileSync(`${root}/verification.json`, JSON.stringify(report, null, 2));
  writeFileSync(
    `${root}/catalog-for-lesson.json`,
    JSON.stringify(catalog, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await pool.end();
}
