import pg from "pg";
import { readFileSync, writeFileSync } from "node:fs";
import { config } from "../shared/config.ts";
import { hashPassword } from "../shared/security.ts";
import { prompts } from "../apps/agent/prompts.ts";
import { seed } from "./seed.ts";
const c = new pg.Client(config().database);
await c.connect();
try {
  await c.query("BEGIN");
  await c.query(readFileSync("db/schema.sql", "utf8"));
  await c.query("REVOKE ALL ON SCHEMA public FROM qihe_business,qihe_agent");
  await c.query("GRANT USAGE ON SCHEMA business TO qihe_business");
  await c.query(
    "GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA business TO qihe_business",
  );
  await c.query(
    "GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA business TO qihe_business",
  );
  await c.query("GRANT USAGE ON SCHEMA agent TO qihe_agent");
  await c.query(
    "GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA agent TO qihe_agent",
  );
  await c.query(
    "GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA agent TO qihe_agent",
  );
  const existing = await c.query("SELECT 1 FROM business.customers LIMIT 1");
  if (!existing.rowCount) {
    await seed(c);
    const password = "123";
    for (const [id, login, name, role, customerId] of [
      ["U001", "qihe", "陈念", "admin", null],
      ["U002", "zhixia", "林知夏", "customer", "C001"],
      ["U003", "wanyu", "周婉予", "customer", "C002"],
    ]) {
      await c.query(
        "INSERT INTO agent.accounts(id,login,name,role,customer_id,password_hash) VALUES($1,$2,$3,$4,$5,$6)",
        [id, login, name, role, customerId, hashPassword(password)],
      );
    }
    writeFileSync(
      ".local/登录账号.txt",
      `栖禾本地工作台\n管理端：http://127.0.0.1:5180/admin\n店长账号：qihe\n商城：http://127.0.0.1:5180/shop\n客户账号：zhixia / wanyu\n初始密码：${password}\n仅本机开发使用。\n`,
    );
  }
  for (const role of ["customer", "admin"] as const)
    await c.query(
      "INSERT INTO agent.prompts(role,content) VALUES($1,$2) ON CONFLICT(role) DO NOTHING",
      [role, prompts[role]],
    );
  await c.query("COMMIT");
  console.log(
    JSON.stringify({
      database: "qihe_commerce",
      products: (await c.query("SELECT count(*) FROM business.products"))
        .rows[0].count,
      skus: (await c.query("SELECT count(*) FROM business.skus")).rows[0].count,
      orders: (await c.query("SELECT count(*) FROM business.orders")).rows[0]
        .count,
    }),
  );
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  await c.end();
}
