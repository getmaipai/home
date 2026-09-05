// Voice settings (docs/SETTINGS.md Rule 3: "One card per role"). The
// `tts` role's first real settings key: `tts.voice_id` is a real, ship-
// ready slice of the "per user selection of voice" ask (Jesse,
// 2026-09-04, alongside chat mode selection) and of the "official
// included voices" item from that same session's Pocket TTS follow-ups
// note (docs/dev.md) - not the full community-voice browser/downloader
// (any HF `kyutai/tts-voices` file via a URL), which is a real, larger,
// separate gap this key doesn't attempt to close.
//
// `person` scope, not `household`: each household member hears their own
// replies in their own chosen voice, the same "a household member's own
// preference" posture ChatPage.tsx's per-message `thinking` toggle
// already takes, just persisted instead of per-message. This is the
// registry's first real `person`-scope key - lib/settings.ts's
// `parseScope`/`assertCanAccessScope` already had the person branch built
// and unexercised through the HTTP layer; this is what finally exercises
// it for real.
//
// The option list is Pocket TTS's own complete, hardcoded set of 26 named
// presets (`pocket_tts.utils.utils._ORIGINS_OF_PREDEFINED_VOICES`,
// confirmed by reading the installed package's source, 2026-09-04 -
// there is no public listing endpoint, so this list has to be copied,
// not fetched). Every name resolves to a real, non-gated `hf://` file
// Pocket TTS downloads and caches itself the first time it's used
// (confirmed live: `voice_url=vera` on a running `pocket-tts serve`
// synthesized real audio in ~1.5s including that first download).
// `default: "alba"` rather than an empty "no choice yet" sentinel:
// "alba" is Pocket TTS's own built-in fallback (`DEFAULT_VOICE_FALLBACK`),
// so sending `voice_url=alba` explicitly produces the exact same audio as
// sending no `voice_url` at all - every value this key can ever hold is a
// real, valid preset name, with nothing else needing to special-case an
// out-of-band "unset" value anywhere downstream (routes/tts.ts always has
// a real name to send).
//
// Restricting to this fixed list matters for more than UX: `select`'s
// own validation (lib/settings.ts's `validateSelectorValue`) rejects
// anything not in `range.options` at write time, which is what keeps
// this key from ever becoming an arbitrary-URL field a household member
// (or a compromised session) could point at an internal address - Pocket
// TTS's real `/tts` endpoint accepts any `http://`/`https://`/`hf://`
// URL for `voice_url`, and the local `pocket-tts serve` process would
// fetch whatever it's given.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const VOICE_PRESET_NAMES = [
  "alba",
  "cosette",
  "marius",
  "javert",
  "jean",
  "anna",
  "vera",
  "fantine",
  "charles",
  "paul",
  "eponine",
  "azelma",
  "george",
  "mary",
  "jane",
  "michael",
  "eve",
  "bill_boerst",
  "peter_yearsley",
  "stuart_bell",
  "caro_davy",
  "giovanni",
  "lola",
  "juergen",
  "rafael",
  "estelle",
] as const;

export const VOICE_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: "tts.voice_id",
    scope: "person",
    selector: "select",
    range: { options: [...VOICE_PRESET_NAMES] },
    default: "alba",
    label: "Speaking voice",
    help: "The voice MaiPai uses when it reads its replies aloud to you.",
    level: "basic",
    lives_in: "person.voice",
    honoured_by: ["home"],
  }),
  // Voice cloning (2026-09-04, the last open Pocket TTS follow-up):
  // needs the gated `kyutai/pocket-tts` checkpoint, which the default
  // `kyutai/pocket-tts-without-voice-cloning` model this hub actually
  // runs never grew (docs/dev.md's TTS decision entry). The gate is
  // auto-approved on accepting Kyutai's terms (confirmed live,
  // 2026-09-04: `gated: "auto"`, not a manual review queue), so a
  // household can unblock cloning themselves with their own free HF
  // account - this key is that credential, not the cloning feature
  // itself (still not built - see docs/dev.md). `household` scope, not
  // `person`: one token authenticates the hub's own outbound requests,
  // the same "a household's own account, not a per-person one" shape
  // other whole-hub integrations take. `secret: true` is the first real
  // key to exercise lib/settings.ts's at-rest encryption
  // (lib/secrets.ts) - a plain text field otherwise, so this key holding
  // an actual bearer token is exactly what that encryption exists for.
  //
  // The generic PUT /api/settings route can still technically write this
  // key directly (setValue() has no per-key side-effect hook), skipping
  // the dedicated POST /api/voice/hf-token route's restartTtsBackend()
  // call - a saved value would then sit unapplied until the tts backend
  // happened to restart some other way. A code review (2026-09-04) flagged
  // this; not closed, on the same accepted-risk terms `chat.model_id`
  // already documents for the identical shape (aiKeys.ts): the frontend
  // has no path to it (SettingField.tsx never renders an editable control
  // for `secret: true`), and closing it generally needs a settings-key-
  // level "side effect" hook that doesn't exist yet, a bigger change than
  // this one credential warrants.
  SettingsKey.parse({
    key: "voice.hf_token",
    scope: "household",
    selector: "text",
    default: "",
    label: "Hugging Face token (for voice cloning)",
    help: "Needed to clone a voice from a recording. Accept the terms at huggingface.co/kyutai/pocket-tts, then create a read token at huggingface.co/settings/tokens and paste it here.",
    level: "advanced",
    secret: true,
    lives_in: "household.ai",
    honoured_by: ["home"],
  }),
];
