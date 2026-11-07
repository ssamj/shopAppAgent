import pg from "pg";
import { readFileSync } from "node:fs";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { config } from "../shared/config.ts";
const cfg = config(), pool = new pg.Pool(cfg.database);
const quote = (s: string) => '"' + s.replaceAll('"', '""') + '"';
try {
  await pool.query(readFileSync("db/migrations/20261107-langgraph.sql", "utf8"));
  await new PostgresSaver(pool, undefined, {schema: "agent_graph"}).setup();
  await pool.query(`GRANT USAGE ON SCHEMA agent_graph TO ${quote(cfg.agentDatabase.user)}`);
  await pool.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA agent_graph TO ${quote(cfg.agentDatabase.user)}`);
  console.log("LangGraph checkpoints ready; existing tasks retain their original engine.");
} finally { await pool.end(); }
