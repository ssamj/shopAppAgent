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
    readFileSync("db/migrations/20261102-replenishment.sql", "utf8"),
  );
  await db.query(
    `GRANT SELECT ON business.replenishment_rules TO ${quote(cfg.businessDatabase.user)}`,
  );
  await db.query(
    `GRANT SELECT,INSERT,UPDATE ON business.replenishment_snapshots TO ${quote(cfg.businessDatabase.user)}`,
  );
  await db.query("COMMIT");
  console.log(
    "Replenishment tables ready; existing business data and prompts preserved.",
  );
} catch (e) {
  await db.query("ROLLBACK");
  throw e;
} finally {
  await db.end();
}
