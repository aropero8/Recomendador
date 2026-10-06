import { pipeline, env } from "@huggingface/transformers";

env.allowLocalModels = false;
const ctx: any = self;
let extractor: any = null;

async function getExtractor() {
  if (!extractor) {
    extractor = await pipeline("feature-extraction", "Xenova/multilingual-e5-small", {
      dtype: "q8",
      progress_callback: (p: any) => ctx.postMessage({ type: "progress", p }),
    });
  }
  return extractor;
}

ctx.onmessage = async (e: MessageEvent) => {
  const { id, texts } = e.data;
  try {
    const ex = await getExtractor();
    const out = await ex(texts, { pooling: "mean", normalize: true });
    ctx.postMessage({ type: "done", id, vectors: out.tolist() });
  } catch (err: any) {
    ctx.postMessage({ type: "error", id, message: String(err?.message ?? err) });
  }
};
