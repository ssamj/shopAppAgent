import pg from "pg";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
if (existsSync(".local/config.json")) {
  console.log("Local configuration already exists.");
  process.exit(0);
}
const base = {
  host: process.env.PGHOST || "127.0.0.1",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
};
if (!process.env.WINCODE_API_KEY)
  throw new Error("Set WINCODE_API_KEY to your model API credential before configuration.");
const client = new pg.Client({ ...base, database: "postgres" });
await client.connect();
try {
  const present = await client.query(
    "SELECT 1 FROM pg_database WHERE datname=$1",
    ["qihe_commerce"],
  );
  if (present.rowCount)
    throw new Error(
      "Target database already exists without a local configuration; refusing to overwrite.",
    );
  await client.query("CREATE DATABASE qihe_commerce");
  const internalSecret = randomBytes(32).toString("hex");
  const businessPassword = randomBytes(32).toString("hex"),
    agentPassword = randomBytes(32).toString("hex");
  await client.query(
    `CREATE ROLE qihe_business LOGIN PASSWORD '${businessPassword}'`,
  );
  await client.query(
    `CREATE ROLE qihe_agent LOGIN PASSWORD '${agentPassword}'`,
  );
  mkdirSync(".local", { recursive: true });
  writeFileSync(
    ".local/config.json",
    JSON.stringify(
      {
        database: { ...base, database: "qihe_commerce" },
        businessDatabase: {
          ...base,
          database: "qihe_commerce",
          user: "qihe_business",
          password: businessPassword,
        },
        agentDatabase: {
          ...base,
          database: "qihe_commerce",
          user: "qihe_agent",
          password: agentPassword,
        },
        internalSecret,
        model: {
          baseUrl: process.env.WINCODE_BASE_URL,
          model: process.env.WINCODE_MODEL,
          apiKey: process.env.WINCODE_API_KEY,
        },
      },
      null,
      2,
    ),
  );
  console.log(
    "Created independent qihe_commerce database and service accounts; saved protected local configuration.",
  );
} finally {
  await client.end();
}
