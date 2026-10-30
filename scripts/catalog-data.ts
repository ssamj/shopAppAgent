import { existsSync, readFileSync } from "node:fs";
import type pg from "pg";

export interface CatalogProduct {
  id: string;
  name: string;
  category: string;
  description: string;
  material: string;
  season: string;
  price: number;
  cost: number;
  supplierId: string;
  colors: string[];
  subject: string;
}
export const catalogPlan = JSON.parse(
  readFileSync(
    new URL("../data/catalog-20261030.json", import.meta.url),
    "utf8",
  ),
) as {
  batchId: string;
  sizes: string[];
  newProducts: CatalogProduct[];
  imageSubjects: { id: string; subject: string }[];
};
export const catalogImage = (id: string) =>
  `/products/catalog-20261030/${id}.webp`;

// Run inside a transaction. Existing orders, prices, stock and reservations are preserved.
export async function applyCatalog20261030(db: Pick<pg.Client, "query">) {
  for (const item of catalogPlan.imageSubjects)
    if (
      !existsSync(
        new URL(`../apps/web/public${catalogImage(item.id)}`, import.meta.url),
      )
    )
      throw new Error(`商品图尚未准备好：${item.id}`);
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    catalogPlan.batchId,
  ]);
  const added: string[] = [];
  for (const [index, product] of catalogPlan.newProducts.entries()) {
    const existing = (
      await db.query("SELECT name FROM business.products WHERE id=$1", [
        product.id,
      ])
    ).rows[0];
    if (existing) {
      if (existing.name !== product.name)
        throw new Error(`商品编号冲突：${product.id}，停止导入`);
      continue;
    }
    await db.query(
      "INSERT INTO business.products(id,name,category,description,material,season,image,price,supplier_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        product.id,
        product.name,
        product.category,
        product.description,
        product.material,
        product.season,
        catalogImage(product.id),
        product.price,
        product.supplierId,
      ],
    );
    for (const [colorIndex, color] of product.colors.entries()) {
      for (const [sizeIndex, size] of catalogPlan.sizes.entries()) {
        const skuId = `${product.id}-${colorIndex + 1}-${size}`;
        const stock =
          product.id === "P015" && colorIndex === 1 && size === "M"
            ? 0
            : product.id === "P023" && colorIndex === 0 && size === "S"
              ? 3
              : 12 + ((index * 13 + colorIndex * 7 + sizeIndex * 5) % 29);
        await db.query(
          "INSERT INTO business.skus(id,product_id,color,size,cost,stock,reorder_point) VALUES($1,$2,$3,$4,$5,$6,6)",
          [skuId, product.id, color, size, product.cost, stock],
        );
        if (stock)
          await db.query(
            "INSERT INTO business.inventory_movements(sku_id,quantity,type,reference) VALUES($1,$2,'期初入库',$3)",
            [skuId, stock, catalogPlan.batchId],
          );
      }
    }
    added.push(product.id);
  }
  for (const item of catalogPlan.imageSubjects)
    await db.query(
      "UPDATE business.products SET image=$2 WHERE id=$1 AND image IS DISTINCT FROM $2",
      [item.id, catalogImage(item.id)],
    );
  return {
    added,
    updatedImageIds: catalogPlan.imageSubjects.map((item) => item.id),
  };
}
