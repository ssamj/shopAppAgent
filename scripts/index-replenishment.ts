import fs from "node:fs";
import pg from "pg";
import { Value } from "@sinclair/typebox/value";
import { config } from "../shared/config.ts";
import { hash, splitSections } from "../apps/business/knowledge/corpus.ts";
import {
  embed,
  EMBEDDING_ID,
  EMBEDDING_DIMENSIONS,
} from "../apps/business/knowledge/embedding.ts";
import { replenishmentRuleSchema } from "../shared/replenishment.ts";
import { fingerprint } from "../shared/security.ts";
const folder = "data/replenishment";
const manifest = JSON.parse(fs.readFileSync(`${folder}/manifest.json`, "utf8"));
if (
  !Value.Check(replenishmentRuleSchema, manifest.rule) ||
  manifest.rule.target < manifest.rule.triggerBelow
)
  throw Error("Invalid rule parameters");
if (!/^[a-z0-9-]+$/.test(manifest.id) || manifest.file !== "daily.md")
  throw Error("Invalid rule manifest");
const raw = splitSections(
  fs.readFileSync(`${folder}/${manifest.file}`, "utf8"),
);
if (
  JSON.stringify(raw.map((s) => s.section)) !==
  JSON.stringify(manifest.requiredSections)
)
  throw Error("Required policy sections missing or reordered");
const contentHash = fingerprint({
  title: manifest.title,
  version: manifest.version,
  rule: manifest.rule,
  sections: raw,
});
const db = new pg.Client(config().database);
await db.connect();
try {
  const existing = (
    await db.query(
      "SELECT content_hash FROM business.replenishment_rules WHERE id=$1",
      [manifest.id],
    )
  ).rows[0];
  if (existing) {
    if (existing.content_hash !== contentHash)
      throw Error("Published rule ID is immutable; use a new version ID");
    console.log("Rule package unchanged");
  } else {
    const vectors = await embed(
      raw.map((s) => `${manifest.title}\n${s.section}\n${s.text}`),
      "passage",
    );
    const sections = raw.map((s, i) => ({
      ...s,
      contentHash: hash(s.text),
      embedding: vectors[i],
    }));
    await db.query(
      "INSERT INTO business.replenishment_rules(id,title,version,content_hash,embedding_model,dimensions,rule,sections) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        manifest.id,
        manifest.title,
        manifest.version,
        contentHash,
        EMBEDDING_ID,
        EMBEDDING_DIMENSIONS,
        JSON.stringify(manifest.rule),
        JSON.stringify(sections),
      ],
    );
    console.log(
      JSON.stringify({
        status: "indexed",
        id: manifest.id,
        sections: sections.length,
      }),
    );
  }
} finally {
  await db.end();
}
