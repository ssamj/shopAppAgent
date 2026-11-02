import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import pg from "pg";
import { config } from "../shared/config.ts";
import {
  embed,
  EMBEDDING_ID,
  loadEmbeddingModel,
} from "../apps/business/knowledge/embedding.ts";
import { searchKnowledge } from "../apps/business/knowledge/search.ts";
import type { Context } from "../apps/business/contracts.ts";

if (process.argv.includes("--unavailable-model")) {
  await assert.rejects(
    () => loadEmbeddingModel(),
    (e: any) => e.code === "EMBEDDING_UNAVAILABLE",
  );
  console.log("Missing local model failed explicitly");
} else {
  const cfg = config();
  if (
    !process.env.QIHE_CONFIG_PATH ||
    !cfg.database.database.includes("episode05") ||
    process.env.QIHE_ALLOW_WRITE_TESTS !== "1"
  )
    throw Error(
      "Use an explicit isolated episode05 config and QIHE_ALLOW_WRITE_TESTS=1",
    );
  const pool = new pg.Pool(cfg.database),
    db = await pool.connect();
  const reports: any[] = [];
  const identity = {
    id: "U002",
    name: "演示顾客",
    role: "customer" as const,
    customerId: "C001",
  };
  async function search(
    query: string,
    productIds: string[],
    extra: Record<string, any> = {},
  ) {
    const prepared = (await embed([query], "query"))[0];
    return searchKnowledge({ query, productIds, ...extra }, {
      db,
      identity,
      preview: true,
      prepared,
    } as Context);
  }
  async function check(name: string, fn: () => Promise<unknown>) {
    const value = await fn();
    reports.push({ name, status: "passed", result: value });
    console.log(name);
  }
  try {
    await db.query("BEGIN");
    await check("per-product semantic retrieval and paraphrases", async () => {
      const results = [];
      for (const query of [
        "出差清洁衣服不想自己手洗也不想送洗，哪件更省事",
        "旅途中有没有可以丢洗衣机轻柔程序洗的款式",
        "能用烘衣机弄干吗",
      ]) {
        const r = await search(query, ["P001", "P009"], { limitPerProduct: 3 });
        assert.deepEqual(
          r.knowledge!.coverage.map((x) => x.productId),
          ["P001", "P009"],
        );
        const expected = query.includes("烘") ? "干燥方式" : "洗涤方式";
        const ranks = ["P001", "P009"].map((id) => ({
          productId: id,
          rank:
            r
              .sources!.filter((s) => s.productIds.includes(id))
              .findIndex((s) => s.section === expected) + 1,
        }));
        assert.ok(
          ranks.every((x) => x.rank > 0),
          JSON.stringify({ query, ranks }),
        );
        results.push({
          query,
          relevantSection: expected,
          ranks,
          topK: 3,
          sources: r.sources!.map((s) => ({
            document: s.documentId,
            section: s.section,
          })),
        });
      }
      return results;
    });
    await check(
      "product missing documentation yields successful empty result",
      async () => {
        const r = await search("洗涤方式", ["P003"]);
        assert.equal(r.sources!.length, 0);
        assert.equal(r.knowledge!.coverage[0].retrieved, 0);
      },
    );
    await check("unknown product fails", async () => {
      await assert.rejects(
        () => search("洗涤方式", ["P-NOT-EXIST"]),
        (e: any) => e.code === "PRODUCT_NOT_FOUND",
      );
    });
    await check("customer cannot retrieve downlisted product", async () => {
      await db.query(
        "UPDATE business.products SET status='下架' WHERE id='P021'",
      );
      await assert.rejects(
        () => search("洗涤", ["P021"]),
        (e: any) => e.code === "PRODUCT_NOT_FOUND",
      );
      await db.query(
        "UPDATE business.products SET status='上架' WHERE id='P021'",
      );
    });
    await check("public retrieval excludes internal document", async () => {
      const r = await search("内部维护标记 INTERNAL-DEMO-ONLY", ["P001"], {
        includeGeneral: true,
      });
      assert.ok(r.sources!.every((s) => s.documentId !== "internal-review"));
      assert.ok(!JSON.stringify(r).includes("INTERNAL-DEMO-ONLY"));
    });
    await check("incompatible index fails without fallback", async () => {
      await db.query(
        "UPDATE business.knowledge_indexes SET embedding_model='incompatible' WHERE active",
      );
      await assert.rejects(
        () => search("洗涤", ["P001"]),
        (e: any) => e.code === "KNOWLEDGE_INDEX_INCOMPATIBLE",
      );
      await db.query(
        "UPDATE business.knowledge_indexes SET embedding_model=$1 WHERE active",
        [EMBEDDING_ID],
      );
    });
    await check(
      "missing index is technical failure, not empty search",
      async () => {
        const id = (
          await db.query(
            "UPDATE business.knowledge_indexes SET active=false WHERE active RETURNING id",
          )
        ).rows[0].id;
        await assert.rejects(
          () => search("洗涤", ["P001"]),
          (e: any) => e.code === "KNOWLEDGE_INDEX_UNAVAILABLE",
        );
        await db.query(
          "UPDATE business.knowledge_indexes SET active=true WHERE id=$1",
          [id],
        );
      },
    );
    await check("corrupt source fails", async () => {
      await db.query("SAVEPOINT corrupt_source");
      await db.query(
        "UPDATE business.knowledge_chunks SET content_hash='broken' WHERE document_id='care-p009'",
      );
      await assert.rejects(
        () => search("洗涤", ["P009"]),
        (e: any) => e.code === "KNOWLEDGE_INDEX_INVALID",
      );
      await db.query("ROLLBACK TO SAVEPOINT corrupt_source");
    });
    await check(
      "fresh retrieval sees version change, old snapshot stays unchanged",
      async () => {
        const first = await search("洗涤", ["P009"], { limitPerProduct: 1 });
        await db.query(
          "UPDATE business.knowledge_documents SET version='test-next' WHERE id='care-p009'",
        );
        const next = await search("洗涤", ["P009"], { limitPerProduct: 1 });
        assert.equal(first.sources![0].version, "1.0");
        assert.equal(next.sources![0].version, "test-next");
      },
    );
    await db.query("ROLLBACK");
    await check("missing local embedding model fails explicitly", async () => {
      const run = spawnSync(
        process.execPath,
        [
          "node_modules/tsx/dist/cli.mjs",
          "scripts/verify-knowledge-storage.ts",
          "--unavailable-model",
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            QIHE_EMBEDDING_CACHE: resolve("output/knowledge-empty-cache"),
          },
          encoding: "utf8",
          timeout: 30000,
          windowsHide: true,
        },
      );
      assert.equal(run.status, 0, run.stderr);
      return run.stdout.trim();
    });
    mkdirSync("output", { recursive: true });
    writeFileSync(
      "output/knowledge-storage-verification.json",
      JSON.stringify(
        {
          status: "passed",
          model: EMBEDDING_ID,
          realEmbeddings: true,
          fixtureWritesRolledBack: true,
          reports,
        },
        null,
        2,
      ),
    );
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
    await pool.end();
  }
}
