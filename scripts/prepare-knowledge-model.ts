import {
  loadEmbeddingModel,
  embed,
  EMBEDDING_ID,
} from "../apps/business/knowledge/embedding.ts";
await loadEmbeddingModel(true);
const [vector] = await embed(["针织衫的洗涤与干燥要求"], "query");
console.log(
  JSON.stringify({
    status: "ready",
    model: EMBEDDING_ID,
    dimensions: vector.length,
    localInference: true,
  }),
);
