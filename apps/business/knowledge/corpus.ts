import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const hash = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const docSchema = Type.Object(
  {
    id: Type.String({ pattern: "^[a-z0-9-]+$" }),
    title: Type.String({ minLength: 1 }),
    version: Type.String({ minLength: 1 }),
    productIds: Type.Array(Type.String(), { uniqueItems: true }),
    scope: Type.Union([Type.Literal("product"), Type.Literal("general")]),
    audience: Type.Union([Type.Literal("public"), Type.Literal("admin")]),
    file: Type.String(),
  },
  { additionalProperties: false },
);
const manifestSchema = Type.Object(
  { notice: Type.String(), documents: Type.Array(docSchema, { minItems: 1 }) },
  { additionalProperties: false },
);
export type CorpusDocument = Static<typeof docSchema> & {
  contentHash: string;
  chunks: { id: string; section: string; text: string; contentHash: string }[];
};

export function splitSections(markdown: string) {
  const sections: { section: string; text: string }[] = [];
  let section = "",
    lines: string[] = [];
  const flush = () => {
    if (!section) return;
    const text = lines.join("\n").trim();
    if (!text || text.length > 900)
      throw Error(
        "A complete knowledge section must contain 1–900 characters; edit the source instead of truncating it",
      );
    sections.push({ section, text });
  };
  for (const line of markdown.replaceAll("\r\n", "\n").split("\n")) {
    if (line.startsWith("## ")) {
      flush();
      section = line.slice(3).trim();
      lines = [];
    } else if (section) lines.push(line);
  }
  flush();
  if (
    !sections.length ||
    new Set(sections.map((s) => s.section)).size !== sections.length
  )
    throw Error("Knowledge sections must exist and have unique titles");
  return sections;
}

export function readCorpus(folder = "data/knowledge"): CorpusDocument[] {
  const root = resolve(folder),
    raw = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
  if (!Value.Check(manifestSchema, raw))
    throw Error("Invalid knowledge manifest");
  const ids = new Set<string>();
  return raw.documents.map((doc) => {
    if (ids.has(doc.id)) throw Error("Duplicate document ID");
    ids.add(doc.id);
    if ((doc.scope === "product") !== doc.productIds.length > 0)
      throw Error("Document scope does not match its product IDs");
    const file = resolve(root, doc.file);
    if (!file.startsWith(root + sep))
      throw Error("Knowledge source must stay inside its corpus folder");
    const markdown = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
    return {
      ...doc,
      contentHash: hash(markdown),
      chunks: splitSections(markdown).map((s) => ({
        ...s,
        id: `${doc.id}-${hash(s.section).slice(0, 12)}`,
        contentHash: hash(s.text),
      })),
    };
  });
}
