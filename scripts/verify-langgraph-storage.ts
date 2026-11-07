import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { config } from "../shared/config.ts";
import { database } from "../shared/db.ts";
import { exerciseGraph } from "./verify-langgraph-unit.ts";
assert.ok(config().database.database.startsWith("qihe_episode09_") && process.env.QIHE_ALLOW_WRITE_TESTS === "1", "Explicit isolated episode09 configuration required");
const pool = database("agent");
try {
  const checks = await exerciseGraph(new PostgresSaver(pool, undefined, {schema: "agent_graph"}));
  const tables = (await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='agent_graph' ORDER BY table_name")).rows.map(r => r.table_name);
  assert.ok(tables.includes("checkpoints") && tables.includes("checkpoint_writes"));
  mkdirSync("output", {recursive: true});
  writeFileSync("output/langgraph-storage-verification.json", JSON.stringify({status: "passed", isolated: true, realPostgresCheckpointer: true, fixtureEffects: true, checks, tables}, null, 2));
  console.log(JSON.stringify({status: "passed", checks: checks.length, tables}));
} finally {await pool.end();}
