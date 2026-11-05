import { readFileSync } from "node:fs";
import { resolve } from "node:path";
export interface LocalConfig {
  database: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  businessDatabase: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  agentDatabase: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  model: { baseUrl: string; model: string; apiKey: string };
  knowledge?: { enabled: boolean };
  replenishment?: { enabled: boolean };
  workflows?: { enabled: boolean; strictJsonSchema?: boolean };
  internalSecret: string;
}
export function config(): LocalConfig {
  return JSON.parse(
    readFileSync(
      resolve(process.env.QIHE_CONFIG_PATH || ".local/config.json"),
      "utf8",
    ),
  );
}
