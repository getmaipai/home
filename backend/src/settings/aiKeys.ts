// `chat.model_id` remains declared for compatibility with stored settings.
// Home no longer writes it. The Stack owns chat model selection and process
// state. The three `_override` keys remain declared for legacy supervisor
// cleanup and do not control Stack chat.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

// Kept as a stable key name while old stored values remain readable.
export const CHAT_MODEL_SETTING_KEY = "chat.model_id" as const;

// One setting points Home at its required local Stack. An empty value
// means the Stack is not configured and chat is unavailable.
export const STACK_URL_SETTING_KEY = "engines.stack.url" as const;

export const AI_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: "chat.model_id",
    scope: "household",
    selector: "text",
    default: "",
    label: "Selected chat model",
    help: "The catalog model id currently downloaded and running for chat. Changed through the AI models page, not here.",
    level: "expert",
    lives_in: "household.ai_developer",
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
    lives_in: "household.ai_advanced",
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
    lives_in: "household.ai_advanced",
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
    lives_in: "household.ai_advanced",
    honoured_by: ["home"],
  }),
  // THIN-5C (docs/design/RULES.md rule 10, SAFETY.md): the only admin choice
  // that moves a minor's output gate, and it chooses between two checked
  // modes; nothing turns the gate off. Household scope: it gives no admin
  // path into a teen's own settings (the 2026-09-30 ruling stands). A child
  // and every spoken turn are per sentence whatever this says.
  // IMG-SPEC-KEYS (spec-v0.1.80): declared in the spec by the images lane;
  // registered here so the pinned registry matches. Its reader lands with
  // UPLOAD-IMG; until then nothing reads it.
  SettingsKey.parse({
    key: "chat.photo_uploads",
    scope: "person",
    selector: "boolean",
    default: true,
    label: "Send photos in chat",
    help: "Adults and teens are on by default; children are off until a parent enables this. Teens control their own setting.",
    level: "basic",
    lives_in: "person.chat",
    honoured_by: ["home"],
  }),
  // CHAT-PAUSE-01: the household's own off switch for chat. Server-side: the
  // turn routes answer 503 while it is on. Settings stays open, so an admin
  // can always turn it back off.
  SettingsKey.parse({
    key: "chat.paused",
    scope: "household",
    selector: "boolean",
    default: false,
    label: "Pause chat for everyone",
    help: "Turns chat off for the whole household until you turn it back on. Messages are not sent while it is paused. Timers, alarms and the emergency lines keep working.",
    copy: { does: "Stops chat from answering until you turn it back on." },
    level: "basic",
    lives_in: "household.chat_pause",
    honoured_by: ["home"],
  }),
  // CANARY-01: the health checks and the warm-up pings. Off stops the timers and the search check; the post-start suite,
  // Run checks now and the daily picture check stay.
  SettingsKey.parse({
    key: "health.keep_warm",
    scope: "household",
    selector: "boolean",
    default: true,
    label: "Keep the AI warm",
    help: "Home sends a tiny made-up message to the AI every few minutes so the first real reply is quick, and checks that chat, tools, search and voice still work. It uses about 1,000 words of AI output an hour, stores nothing, and never runs while someone is talking to the AI. Turn it off to stop these checks.",
    copy: { does: "Sends a tiny test message every few minutes so replies start fast." },
    level: "basic",
    lives_in: "household.ai_advanced",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "chat.paused_message",
    scope: "household",
    selector: "text",
    default: "",
    label: "Message shown while chat is paused",
    help: "Optional. One short line everyone sees next to the pause notice, for example when chat comes back.",
    copy: { does: "Adds a short note to the notice people see while chat waits." },
    level: "basic",
    lives_in: "household.chat_pause",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "chat.search_assist",
    scope: "household",
    selector: "select",
    range: { options: ["off", "shadow", "rescue"] },
    default: "shadow",
    label: "Help the chat remember to search the web",
    help: "\"Off\" is the kill switch: nothing is scored. \"Shadow\" (the default) only counts, as a number, how often a web search looked needed, and changes no reply. \"Rescue\" is not active yet; for now it behaves like shadow. Children and teens are never scored.",
    level: "advanced",
    lives_in: "household.ai_advanced",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "engines.stack.url",
    scope: "household",
    selector: "text",
    default: "",
    label: "MaiPai Stack address",
    help: "Empty uses Home's own built-in engines. Set once a MaiPai Stack is installed on this machine to route chat, embeddings and voice through it instead.",
    level: "expert",
    lives_in: "household.ai_developer",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "engines.stack.use_chat",
    // Deprecated and ignored. A configured Stack serves every role.
    scope: "household",
    selector: "boolean",
    default: false,
    label: "Use the MaiPai Stack for chat",
    help: "This switch is retired and does nothing; setting 'MaiPai Stack address' routes every role to the Stack.",
    level: "expert",
    lives_in: "household.ai_developer",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "engines.stack.use_embeddings",
    // Deprecated and ignored. A configured Stack serves every role.
    scope: "household",
    selector: "boolean",
    default: false,
    label: "Use the MaiPai Stack for search (embeddings)",
    help: "This switch is retired and does nothing; setting 'MaiPai Stack address' routes every role to the Stack.",
    level: "expert",
    lives_in: "household.ai_developer",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "engines.stack.use_stt",
    // Deprecated and ignored. A configured Stack serves every role.
    scope: "household",
    selector: "boolean",
    default: false,
    label: "Use the MaiPai Stack for listening (speech to text)",
    help: "This switch is retired and does nothing; setting 'MaiPai Stack address' routes every role to the Stack.",
    level: "expert",
    lives_in: "household.ai_developer",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "engines.stack.use_tts",
    // Deprecated and ignored. A configured Stack serves every role.
    scope: "household",
    selector: "boolean",
    default: false,
    label: "Use the MaiPai Stack for speaking (text to speech)",
    help: "This switch is retired and does nothing; setting 'MaiPai Stack address' routes every role to the Stack.",
    level: "expert",
    lives_in: "household.ai_developer",
    honoured_by: ["home"],
  }),
];
