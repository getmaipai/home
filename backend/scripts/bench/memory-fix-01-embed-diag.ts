export {}
await import("./setup");
const { startBench } = await import("./setup");
await startBench();
const { embed } = await import("@/lib/llm");
const r = await embed(["hello world"]);
console.error(JSON.stringify(r.ok ? { ok: true, model: r.value.model, dims: r.value.vectors[0]!.length, pre: r.value.preprocess } : r));
process.exit(0);
