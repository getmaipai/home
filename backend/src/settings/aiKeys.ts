// AI settings (docs/SETTINGS.md Rule 3: "One card per role... Advanced
// and expert details fold"). `chat.model_id` is the household's real
// selection (llmSupervisor.ts's tier 3 reads it to know what to spawn);
// the three `_override` keys are engineAutotune.ts's advanced escape
// hatch ("auto-tune launch flags... with an advanced override," this
// pass's own brief) for context size, flash attention, and the quantized
// KV cache, each defaulting to "let auto-tune decide."
//
// `chat.model_id` is `level: "expert"` on purpose, not "basic": it isn't
// meant to be edited through the generic settings renderer at all (Rule 1
// - ModelsSection.tsx's "choose this" flow is the real, declared `setup`-
// style escape hatch that owns changing it, since a plain value write
// here has no download/spawn side effects the generic PUT /api/settings
// route would run). Expert level just keeps it out of the Advanced fold a
// person browsing AI settings would otherwise see and could edit into a
// broken state (a stale or mistyped catalog id) with no download behind
// it.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const AI_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: "chat.model_id",
    scope: "household",
    selector: "text",
    default: "",
    label: "Selected chat model",
    help: "The catalog model id currently downloaded and running for chat. Changed through the AI models page, not here.",
    level: "expert",
    lives_in: "household.ai",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "chat.context_size_override",
    scope: "household",
    selector: "number",
    range: { min: 0, max: 131072 },
    default: 0,
    label: "Chat context size override",
    help: "0 lets the hub pick the largest context that fits this computer's memory. A higher number can run out of memory; a lower one leaves headroom but remembers less of the conversation.",
    level: "advanced",
    lives_in: "household.ai",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "chat.flash_attention_override",
    scope: "household",
    selector: "select",
    range: { options: ["auto", "on", "off"] },
    default: "auto",
    label: "Flash attention override",
    help: "\"Auto\" lets the hub decide based on the model and the quantized-KV-cache setting. Flash attention speeds up longer conversations; a very old GPU may not support it.",
    level: "advanced",
    lives_in: "household.ai",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "chat.kv_cache_override",
    scope: "household",
    selector: "select",
    range: { options: ["auto", "quantized", "full"] },
    default: "auto",
    label: "KV cache precision override",
    help: "\"Auto\" quantizes the conversation cache to fit more context in the same memory, with a small quality tradeoff. \"Full\" uses full precision: more accurate, uses roughly twice the memory for the same context size.",
    level: "advanced",
    lives_in: "household.ai",
    honoured_by: ["home"],
  }),
];
