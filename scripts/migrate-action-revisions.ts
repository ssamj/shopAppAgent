import pg from "pg";
import { readFileSync } from "node:fs";
import { config } from "../shared/config.ts";
const client = new pg.Client(config().database);
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(
    readFileSync("db/migrations/20261031-action-revisions.sql", "utf8"),
  );
  await client.query("COMMIT");
  console.log(
    "Action revisions migration applied; existing data and prompts preserved.",
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
