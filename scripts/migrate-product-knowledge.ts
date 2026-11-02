import pg from "pg";
import { readFileSync } from "node:fs";
import { config } from "../shared/config.ts";
const cfg = config(),
  db = new pg.Client(cfg.database);
const quote = (s: string) => '"' + s.replaceAll('"', '""') + '"';
await db.connect();
try {
  await db.query("BEGIN");
  await db.query(
    readFileSync("db/migrations/20261101-product-knowledge.sql", "utf8"),
  );
  await db.query(
    `GRANT SELECT ON business.knowledge_indexes,business.knowledge_documents,business.knowledge_chunks TO ${quote(cfg.businessDatabase.user)}`,
  );
  await db.query("COMMIT");
  console.log(
    "Knowledge migration complete; business data and user prompts preserved.",
  );
} catch (e) {
  await db.query("ROLLBACK");
  throw e;
} finally {
  await db.end();
}
