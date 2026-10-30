import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const config = JSON.parse(readFileSync(".local/config.json", "utf8"));
const response = await fetch("http://127.0.0.1:3181/internal/openapi", {
  headers: { "x-service-key": config.internalSecret },
});
if (!response.ok) throw new Error("Business API contract unavailable");
mkdirSync("docs", { recursive: true });
const contract = await response.json();
writeFileSync("docs/business-openapi.json", JSON.stringify(contract, null, 2));
console.log(
  `Exported ${Object.keys(contract.paths).length} business operations.`,
);
