import pg from "pg";
import { readFileSync } from "node:fs";
import { config } from "../shared/config.ts";
const client = new pg.Client(config().database);
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(
    readFileSync("db/migrations/20261030-conversation-memory.sql", "utf8"),
  );
  await client.query(
    "GRANT SELECT,INSERT,UPDATE,DELETE ON agent.conversation_memories TO qihe_agent",
  );
  await client.query("COMMIT");
  console.log(
    "Conversation memory migration applied; existing business data and prompts preserved.",
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
