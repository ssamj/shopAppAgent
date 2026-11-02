import pg from "pg";
import { randomUUID } from "node:crypto";
import { config } from "../shared/config.ts";
import { readCorpus, hash } from "../apps/business/knowledge/corpus.ts";
import {
  embed,
  EMBEDDING_ID,
  EMBEDDING_DIMENSIONS,
} from "../apps/business/knowledge/embedding.ts";

const docs = readCorpus(process.argv[2]),
  corpusHash = hash(JSON.stringify({ model: EMBEDDING_ID, docs }));
const db = new pg.Client(config().database);
await db.connect();
try {
  const existing = (
    await db.query(
      "SELECT id FROM business.knowledge_indexes WHERE active AND corpus_hash=$1 AND embedding_model=$2",
      [corpusHash, EMBEDDING_ID],
    )
  ).rows[0];
  if (existing)
    console.log(
      JSON.stringify({ status: "unchanged", indexVersion: existing.id }),
    );
  else {
    for (const doc of docs) {
      const rows = (
        await db.query(
          "SELECT id FROM business.products WHERE id=ANY($1::text[])",
          [doc.productIds],
        )
      ).rows;
      if (rows.length !== doc.productIds.length)
        throw Error(`Unknown product in ${doc.id}`);
    }
    const texts = docs.flatMap((doc) =>
      doc.chunks.map((c) => `${doc.title}\n${c.section}\n${c.text}`),
    );
    const vectors = await embed(texts, "passage");
    const index = randomUUID();
    await db.query("BEGIN");
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext('knowledge-index-activation'))",
    );
    await db.query(
      "INSERT INTO business.knowledge_indexes(id,embedding_model,dimensions,corpus_hash) VALUES($1,$2,$3,$4)",
      [index, EMBEDDING_ID, EMBEDDING_DIMENSIONS, corpusHash],
    );
    let position = 0;
    for (const doc of docs) {
      await db.query(
        "INSERT INTO business.knowledge_documents(index_id,id,title,version,product_ids,scope,audience,origin,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,'teaching',$8)",
        [
          index,
          doc.id,
          doc.title,
          doc.version,
          doc.productIds,
          doc.scope,
          doc.audience,
          doc.contentHash,
        ],
      );
      for (const chunk of doc.chunks)
        await db.query(
          "INSERT INTO business.knowledge_chunks(index_id,document_id,id,section,content,content_hash,embedding) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            index,
            doc.id,
            chunk.id,
            chunk.section,
            chunk.text,
            chunk.contentHash,
            vectors[position++],
          ],
        );
    }
    await db.query(
      "UPDATE business.knowledge_indexes SET active=false WHERE active",
    );
    await db.query(
      "UPDATE business.knowledge_indexes SET active=true WHERE id=$1",
      [index],
    );
    await db.query("COMMIT");
    console.log(
      JSON.stringify({
        status: "indexed",
        indexVersion: index,
        documents: docs.length,
        chunks: vectors.length,
        model: EMBEDDING_ID,
      }),
    );
  }
} catch (e) {
  await db.query("ROLLBACK");
  throw e;
} finally {
  await db.end();
}
