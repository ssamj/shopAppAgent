import pg from "pg";
import { config } from "./config.ts";
export function database(owner: "business" | "agent") {
  return new pg.Pool({
    ...config()[owner === "business" ? "businessDatabase" : "agentDatabase"],
    max: 12,
  });
}
export async function transaction<T>(
  pool: pg.Pool,
  action: (db: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const result = await action(db);
    await db.query("COMMIT");
    return result;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
export class BusinessError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function requireCondition(
  value: unknown,
  code: string,
  message: string,
): asserts value {
  if (!value) throw new BusinessError(code, message);
}
