// GENERATED FILE. Do not edit by hand.
// Source: spec/schemas/model-capabilities.schema.json
// Regenerate with: cd spec && bun run gen:ts

import { z } from "zod";

/**One catalog entry: a specific model file (or checkpoint set) for one of backend/src/lib/llm.ts's roles, plus what it takes to run it. Platform plan 4.11 names this record ('context, tools, JSON schema, grammar, vision, think-mode key, template source, sampling, engine flags, quality tier, safety notes, licence') for describing catalog model packages and BYO GGUFs; spec/llm/README.md deferred writing it until a real producer (hardware detection) and consumer (the model-selection wizard/settings page) existed. Only the fields those actually use are populated; the rest of the plan's field list stays a named future gap, not guessed at here.*/
export const ModelCapabilities = z
  .object({
    /**Catalog id, e.g. 'qwen3-8b-instruct-q4-k-m'. Stable once published: settings values reference it by this id.*/
    id: z
      .string()
      .regex(new RegExp("^[a-z][a-z0-9-]*$"))
      .describe(
        "Catalog id, e.g. 'qwen3-8b-instruct-q4-k-m'. Stable once published: settings values reference it by this id.",
      ),
    /**Matches backend/src/lib/llm.ts's LlmRole.*/
    role: z
      .enum([
        "chat",
        "router",
        "embed",
        "vision",
        "image",
        "video",
        "coding",
        "tts",
        "stt",
        "wakeword",
      ])
      .describe("Matches backend/src/lib/llm.ts's LlmRole."),
    /**Display name, e.g. 'Qwen3 8B Instruct'.*/
    label: z
      .string()
      .min(1)
      .describe("Display name, e.g. 'Qwen3 8B Instruct'."),
    license: z.string().min(1),
    /**Which runtime hosts this model. Only llama-server is wired to a real backend today (llmSupervisor.ts); comfyui entries are catalog data ahead of that package existing.*/
    engine: z
      .enum(["llama-server", "comfyui"])
      .describe(
        "Which runtime hosts this model. Only llama-server is wired to a real backend today (llmSupervisor.ts); comfyui entries are catalog data ahead of that package existing.",
      ),
    /**False for a role with no real backend yet (image, video): the entry documents the decided pick without claiming it can be selected and run today.*/
    implemented: z
      .boolean()
      .describe(
        "False for a role with no real backend yet (image, video): the entry documents the decided pick without claiming it can be selected and run today.",
      ),
    quality_tier: z.enum(["draft", "standard", "high"]).optional(),
    tags: z.array(z.string()).optional(),
    /**Short, dad-readable upsides shown in the model-selection wizard.*/
    pros: z
      .array(z.string())
      .describe(
        "Short, dad-readable upsides shown in the model-selection wizard.",
      )
      .optional(),
    /**Short, dad-readable tradeoffs shown in the model-selection wizard.*/
    cons: z
      .array(z.string())
      .describe(
        "Short, dad-readable tradeoffs shown in the model-selection wizard.",
      )
      .optional(),
    safety_notes: z.string().optional(),
    /**Absent for a placeholder entry with nowhere to download from yet.*/
    download: z
      .object({
        url: z.string().url(),
        sha256: z.string().regex(new RegExp("^[a-f0-9]{64}$")),
        approx_bytes: z.number().int().gte(1),
      })
      .strict()
      .describe(
        "Absent for a placeholder entry with nowhere to download from yet.",
      )
      .optional(),
    sizing: z.any().superRefine((x, ctx) => {
      const schemas = [
        z
          .object({
            kind: z.literal("transformer_gguf"),
            param_count_billion: z.number().gt(0),
            /**e.g. 4 for Q4_K_M, 8 for Q8_0.*/
            bits_per_weight: z
              .number()
              .gt(0)
              .describe("e.g. 4 for Q4_K_M, 8 for Q8_0."),
            /**GGUF block metadata/scales over raw bit-packing (~0.05 for Q8_0, ~0.10 for Q4_K_M).*/
            gguf_overhead_fraction: z
              .number()
              .gte(0)
              .describe(
                "GGUF block metadata/scales over raw bit-packing (~0.05 for Q8_0, ~0.10 for Q4_K_M).",
              )
              .default(0.1),
            num_layers: z.number().int().gt(0),
            /**GQA key/value head count, not total attention heads. Using num_heads here overestimates KV cache by the GQA ratio.*/
            num_kv_heads: z
              .number()
              .int()
              .gt(0)
              .describe(
                "GQA key/value head count, not total attention heads. Using num_heads here overestimates KV cache by the GQA ratio.",
              ),
            head_dim: z.number().int().gt(0),
            max_context: z.number().int().gt(0),
          })
          .strict(),
        z
          .object({
            kind: z.literal("diffusion"),
            /**Measured/vendor-reported working VRAM for one generation at the checkpoint's normal resolution, not just the file size.*/
            approx_vram_bytes: z
              .number()
              .int()
              .gte(1)
              .describe(
                "Measured/vendor-reported working VRAM for one generation at the checkpoint's normal resolution, not just the file size.",
              ),
          })
          .strict(),
      ];
      const { errors, failed } = schemas.reduce<{
        errors: z.core.$ZodIssue[];
        failed: number;
      }>(
        ({ errors, failed }, schema) =>
          ((result) =>
            result.error
              ? {
                  errors: [...errors, ...result.error.issues],
                  failed: failed + 1,
                }
              : { errors, failed })(schema.safeParse(x)),
        { errors: [], failed: 0 },
      );
      const passed = schemas.length - failed;
      if (passed !== 1) {
        ctx.addIssue(
          errors.length
            ? {
                path: [],
                code: "invalid_union",
                errors: [errors],
                message:
                  "Invalid input: Should pass single schema. Passed " + passed,
              }
            : {
                path: [],
                code: "custom",
                errors: [errors],
                message:
                  "Invalid input: Should pass single schema. Passed " + passed,
              },
        );
      }
    }),
  })
  .strict()
  .describe(
    "One catalog entry: a specific model file (or checkpoint set) for one of backend/src/lib/llm.ts's roles, plus what it takes to run it. Platform plan 4.11 names this record ('context, tools, JSON schema, grammar, vision, think-mode key, template source, sampling, engine flags, quality tier, safety notes, licence') for describing catalog model packages and BYO GGUFs; spec/llm/README.md deferred writing it until a real producer (hardware detection) and consumer (the model-selection wizard/settings page) existed. Only the fields those actually use are populated; the rest of the plan's field list stays a named future gap, not guessed at here.",
  );
export type ModelCapabilities = z.infer<typeof ModelCapabilities>;
