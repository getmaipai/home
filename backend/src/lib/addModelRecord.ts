// MODEL-ADD-01: the one place an inspected Hugging Face file becomes a ModelCapabilities record. Pure (no database, no Stack call),
// so the hub's add flow and scripts/add-model.sh produce the same record.
import { ModelCapabilities } from "@maipai/spec/gen/ts/model-capabilities.js";

export interface InspectedModel {
  repo: string; file: string; url: string; revision: string; sizeBytes: number; sha256: string; licence: string | null;
  architecture: string; verifiedArchitecture: boolean;
  shape: { paramCountBillion: number; bitsPerWeight: number; layers: number; kvHeads: number; headDim: number; maxContext: number };
  ramBytes: number;
}

/** A plain model id the Stack accepts as a directory name: lowercase letters, digits and dashes. */
export function addedModelId(repo: string, file: string): string {
  const slug = `${repo.split("/").pop() ?? repo}-${file.replace(/\.gguf$/i, "")}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return `added-${slug}`;
}

/** The record an admin's add makes. Sampling stays the engine's own: published values are shown, never applied. */
export function recordFor(inspected: InspectedModel, addedBy: string | null, now: Date = new Date(), origin: "added" | "shipped" = "added"): ModelCapabilities {
  return ModelCapabilities.parse({
    id: addedModelId(inspected.repo, inspected.file),
    role: "chat",
    label: `${inspected.repo.split("/").pop() ?? inspected.repo} (${inspected.file.replace(/\.gguf$/i, "")})`,
    license: inspected.licence ?? "Not stated by the repository",
    engine: "llama-server",
    implemented: true,
    origin,
    ...(origin === "added" ? { added_by: addedBy ?? undefined, added_at: now.toISOString() } : {}),
    tags: ["not-tested"],
    download: { url: inspected.url, sha256: inspected.sha256, approx_bytes: inspected.sizeBytes },
    sizing: {
      kind: "transformer_gguf", param_count_billion: inspected.shape.paramCountBillion, bits_per_weight: inspected.shape.bitsPerWeight,
      num_layers: inspected.shape.layers, num_kv_heads: inspected.shape.kvHeads, head_dim: inspected.shape.headDim, max_context: inspected.shape.maxContext,
    },
    sampling: { source: "engine defaults, not tuned" },
  });
}

