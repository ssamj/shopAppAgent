import pg from "pg";
import { readFileSync } from "node:fs";
import { config } from "../shared/config.ts";
const cfg = config(), db = new pg.Client(cfg.database);
const quote = (s: string) => '"' + s.replaceAll('"', '""') + '"';
await db.connect();
try {
  await db.query("BEGIN");
  await db.query(readFileSync("db/migrations/20261104-workflows.sql", "utf8"));
  for (const table of ["workflows", "workflow_jobs", "workflow_events", "workflow_runs"])
    await db.query(`GRANT SELECT,INSERT,UPDATE ON agent.${table} TO ${quote(cfg.agentDatabase.user)}`);
  await db.query(`GRANT USAGE,SELECT ON SEQUENCE agent.workflow_events_id_seq TO ${quote(cfg.agentDatabase.user)}`);
  await db.query("COMMIT");
  console.log("Workflow migration ready; existing data and prompts preserved.");
} catch (error) { await db.query("ROLLBACK"); throw error; }
finally { await db.end(); }
