import { resolve } from "node:path";
import { BusinessError } from "../../../shared/db.ts";
import {
  env,
  pipeline,
  type FeatureExtractionPipeline,
} from "@huggingface/transformers";

export const EMBEDDING_MODEL = "Xenova/multilingual-e5-small";
export const EMBEDDING_REVISION = "761b726dd34fb83930e26aab4e9ac3899aa1fa78";
export const EMBEDDING_ID = `${EMBEDDING_MODEL}@${EMBEDDING_REVISION}:q8:mean:normalized:query-passage`;
export const EMBEDDING_DIMENSIONS = 384;
let extractor: Promise<FeatureExtractionPipeline> | undefined;

// Download is an explicit installation step, never a hidden request-time fallback.
export async function loadEmbeddingModel(allowDownload = false) {
  if (!extractor) {
    env.cacheDir = resolve(
      process.env.QIHE_EMBEDDING_CACHE || ".local/embedding-cache",
    );
    env.allowLocalModels = true;
    env.allowRemoteModels = allowDownload;
    const createExtractor = pipeline as unknown as (
      task: "feature-extraction",
      model: string,
      options: Record<string, unknown>,
    ) => Promise<FeatureExtractionPipeline>;
    extractor = createExtractor("feature-extraction", EMBEDDING_MODEL, {
      revision: EMBEDDING_REVISION,
      dtype: "q8",
      session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
    }) as Promise<FeatureExtractionPipeline>;
  }
  try {
    return await extractor;
  } catch {
    throw new BusinessError(
      "EMBEDDING_UNAVAILABLE",
      "知识向量模型不可用，请先完成模型准备；本次检索未完成",
      503,
    );
  }
}

export async function embed(
  texts: string[],
  kind: "query" | "passage",
): Promise<number[][]> {
  const model = await loadEmbeddingModel();
  const vectors: number[][] = [];
  try {
    for (const text of texts) {
      const input = `${kind}: ${text}`;
      const encoded = model.tokenizer(input, { truncation: false });
      if (encoded.input_ids.dims.at(-1)! > 512)
        throw new BusinessError(
          "KNOWLEDGE_TEXT_LIMIT",
          "知识查询或条款超出向量模型长度限制，请缩小范围",
        );
      const output = await model(input, { pooling: "mean", normalize: true });
      const vector = Array.from(output.data, Number);
      if (
        vector.length !== EMBEDDING_DIMENSIONS ||
        vector.some((x) => !Number.isFinite(x))
      )
        throw new BusinessError(
          "EMBEDDING_INVALID",
          "知识向量格式无效，本次检索未完成",
          502,
        );
      vectors.push(vector);
    }
    return vectors;
  } catch (e) {
    if (e instanceof BusinessError) throw e;
    throw new BusinessError(
      "EMBEDDING_FAILED",
      "知识向量计算失败，本次检索未完成",
      502,
    );
  }
}

export function cosine(a: number[], b: number[]) {
  if (
    !a.length ||
    a.length !== b.length ||
    [...a, ...b].some((x) => !Number.isFinite(x))
  )
    throw new BusinessError("KNOWLEDGE_INDEX_INVALID", "知识索引向量无效", 503);
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] ** 2;
    bb += b[i] ** 2;
  }
  if (!aa || !bb)
    throw new BusinessError(
      "KNOWLEDGE_INDEX_INVALID",
      "知识索引包含空向量",
      503,
    );
  return dot / Math.sqrt(aa * bb);
}
