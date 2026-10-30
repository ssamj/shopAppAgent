import { mkdirSync, writeFileSync } from "node:fs";
import { database, transaction } from "../shared/db.ts";
import { applyCatalog20261030 } from "./catalog-data.ts";
const pool = database("business");
try {
  const outcome = await transaction(pool, applyCatalog20261030);
  const products = (
    await pool.query("SELECT * FROM business.products ORDER BY id")
  ).rows;
  const skus = (await pool.query("SELECT * FROM business.skus ORDER BY id"))
    .rows;
  const report = {
    at: new Date().toISOString(),
    ...outcome,
    productCount: products.length,
    skuCount: skus.length,
    products,
    skus,
  };
  mkdirSync("output/catalog-20261030", { recursive: true });
  const target = outcome.added.length ? "applied.json" : "idempotency.json";
  writeFileSync(
    `output/catalog-20261030/${target}`,
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      added: outcome.added.length,
      images: outcome.updatedImageIds.length,
      products: products.length,
      skus: skus.length,
    }),
  );
} finally {
  await pool.end();
}
