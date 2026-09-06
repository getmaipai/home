import { useEffect, useState, type ReactNode } from "react";
import type { MergedSetting } from "@/kit/settings/groupSettings";
import { Input } from "@/kit/ui/input";
import { Select } from "@/kit/primitives/Select";
import { Switch } from "@/kit/ui/switch";
import { Button } from "@/kit/ui/button";

// Every `select`-selector registry value is a raw machine token today
// ("auto", "quantized", "vera") - a code review on tts.voice_id
// (2026-09-04, "per user selection of voice") found a raw preset name
// like "bill_boerst" meaningless to a family member choosing a voice, the
// same rough edge the People page's role picker already had to fix for
// its own raw role slugs ("owner", "child") with a hand-built label map.
// A generic word-split title-case, not a per-key label table: nothing
// here is voice-specific, and it improves every existing select key too
// ("quantized" -> "Quantized") for free.
export function titleCaseOption(value: string): string {
  if (!value) return value;
  return value
    .split("_")
    .map((word) => (word ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(" ");
}

// A code review, 2026-09-05, found `household.locale`'s BCP-47 values ("en-US",
// "en-GB") going through `titleCaseOption` above and coming out "En-US" -
// the split only ever looked for "_", so the dash-joined locale tag was
// treated as one word and had only its first letter capitalized.
// `Intl.DisplayNames` (a real browser-native API, not a hand-built locale-
// name table) renders the language a real family recognizes ("American
// English") - but a follow-up review, 2026-09-05, found the first fix
// guessed by the VALUE's shape (any two-or-three-letter, dash-joined
// string), applied inside `titleCaseOption` itself - which
// `VoiceCatalogSection.tsx` also calls, for community voice *collection*
// names, not locales. `Intl.DisplayNames` turned out lenient enough to
// resolve non-locale dashed strings too (confirmed: `.of("vi-nh")` returns
// "Vietnamese (Vanuatu)" instead of throwing), so a collection someday
// named something dash-joined and locale-shaped would have silently
// rendered as a wrong language name. Scoped to the one key that is
// actually a locale, at the one call site that knows it, instead.
export function localeDisplayName(value: string): string {
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(value);
    if (name) return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    // Not a real BCP-47 tag Intl recognizes - fall through.
  }
  return titleCaseOption(value);
}

// A code review (2026-09-06) on the write-only secret flow below found
// it made `voice.hf_token` writable a SECOND way: that key already has
// its own dedicated section (`HuggingFaceTokenSection.tsx`) because
// saving it has to restart the already-running pocket-tts process, which
// the generic PUT this flow calls has no hook for - a household member
// using this row instead of the dedicated one would see "Set" succeed
// while voice cloning silently keeps failing. Every other secret key has
// no such conflict, so this stays a narrow, named exception (the same
// shape as `household.locale`'s own key-specific check below) rather
// than a broader "does this key have a dedicated section" mechanism
// nothing else needs yet.
const SECRETS_WITH_DEDICATED_FLOWS = new Set(["voice.hf_token"]);

interface SettingFieldProps {
  setting: MergedSetting;
  /** Resolves true if the write landed, false if the backend rejected it
   * (below a key's min, a stale write, etc.) - commitDraft reverts the
   * local draft on false, since resolved.value won't have changed for the
   * resync effect below to catch. */
  onChange: (value: unknown) => Promise<boolean>;
  onReset: () => void;
  disabled?: boolean;
}

// One row: label, help text, the control for this key's selector, and a
// reset action when the value has been changed from its default. Only
// text/number/select/boolean/secret actually render a control -
// docs/UI.md's selector vocabulary also names duration/time/entity/area/
// person/media, none of which have a real registry key yet (nor, for
// entity/area, any Home Assistant integration to pick from); typed by
// SettingsKey's own schema but not built, the same "typed, most
// unimplemented" posture llm.ts's IMPLEMENTED_ROLES already uses.
export function SettingField({ setting, onChange, onReset, disabled }: SettingFieldProps) {
  const { def, resolved } = setting;
  const [draft, setDraft] = useState<string>(String(resolved.value ?? ""));
  const canReset = resolved.source === "user";

  // Session B step 7: the generic write-only secret flow. Found live
  // (2026-09-06) that `notifications.telegram.bot_token` - a plain
  // `secret: true` registry key with no dedicated backend route the way
  // `voice.hf_token` needed one for (restarting a running process) - had
  // no way to be set at all: the secret branch below only ever rendered
  // a static "Set"/"Not set" status, so Telegram notifications could
  // never actually be configured through the running app. `editing`
  // reveals a masked input; the value is never read back from the
  // server (CLAUDE.md > Credentials: "never logged, never returned"),
  // so there is no "previous value" to restore on a rejected write - the
  // typed draft just stays in the input for another try, unlike the
  // number/text paths above which revert to `resolved.value`. Clearing a
  // secret reuses the existing "Reset to default" action already below
  // (every secret key's own default is `""`), not a second control.
  const [secretEditing, setSecretEditing] = useState(false);
  const [secretDraft, setSecretDraft] = useState("");
  const [secretSaving, setSecretSaving] = useState(false);

  async function commitSecret() {
    if (!secretDraft) return;
    setSecretSaving(true);
    const ok = await onChange(secretDraft);
    setSecretSaving(false);
    if (ok) {
      setSecretDraft("");
      setSecretEditing(false);
    }
  }

  // Live-tested bug: `draft` only ever synced on mount, so a reset or a
  // reload that changed `resolved.value` from outside this component
  // (SettingsRenderer re-fetching after PUT/reset) never reached the
  // input - it kept showing whatever was last typed. This effect only
  // fires when the resolved value itself changes (an external update, or
  // our own commit echoing back), never while the person is mid-keystroke
  // typing a still-uncommitted draft.
  useEffect(() => {
    setDraft(String(resolved.value ?? ""));
  }, [resolved.value]);

  // Two real bugs a code review (2026-09-04) found here: (1) `Number("")`
  // is 0, not NaN, so clearing the field and blurring silently committed
  // 0 instead of being treated as "never mind" - a trimmed empty string
  // now reverts locally without calling onChange at all; (2) a rejected
  // write (below a key's min, etc.) left the invalid draft on screen
  // forever, since resolved.value never changes on failure and the
  // resync effect above only fires when it does - commitDraft now awaits
  // onChange and reverts the draft itself on a false result.
  async function commitDraft() {
    const trimmed = draft.trim();
    if (trimmed === "") {
      setDraft(String(resolved.value ?? ""));
      return;
    }
    let value: unknown = trimmed;
    if (def.selector === "number") {
      const n = Number(trimmed);
      if (Number.isNaN(n)) {
        setDraft(String(resolved.value ?? ""));
        return;
      }
      value = n;
    }
    const ok = await onChange(value);
    if (!ok) setDraft(String(resolved.value ?? ""));
  }

  let control: ReactNode;
  if (resolved.secret && SECRETS_WITH_DEDICATED_FLOWS.has(def.key)) {
    // This key's real write path is its own dedicated section, not this
    // generic one - see SECRETS_WITH_DEDICATED_FLOWS above. A static
    // status row, matching what every secret rendered before the write
    // flow below existed.
    control = (
      <span className="text-base text-[var(--muted-foreground)]">{resolved.isSet ? "Set" : "Not set"}</span>
    );
  } else if (resolved.secret) {
    // CLAUDE.md > Credentials and secrets: never render a secret's real
    // value. resolveForResponse() on the backend already enforces this in
    // the response (value: null, isSet instead) - `secretEditing` only
    // ever holds a fresh value someone just typed, never the stored one.
    control = secretEditing ? (
      <div className="flex flex-col gap-2">
        <Input
          type="password"
          className="w-64"
          placeholder="Paste the new value"
          value={secretDraft}
          disabled={secretSaving}
          onChange={(e) => setSecretDraft(e.target.value)}
          aria-label={def.label}
          autoComplete="off"
        />
        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={secretSaving || !secretDraft} onClick={commitSecret}>
            {secretSaving ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={secretSaving}
            onClick={() => {
              setSecretDraft("");
              setSecretEditing(false);
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    ) : (
      <div className="flex items-center gap-3">
        <span className="text-base text-[var(--muted-foreground)]">{resolved.isSet ? "Set" : "Not set"}</span>
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => setSecretEditing(true)}>
          {resolved.isSet ? "Change" : "Set"}
        </Button>
      </div>
    );
  } else if (def.selector === "boolean") {
    control = (
      <Switch checked={Boolean(resolved.value)} onCheckedChange={onChange} disabled={disabled} aria-label={def.label} />
    );
  } else if (def.selector === "select") {
    const options = (def.range as { options?: string[] } | undefined)?.options ?? [];
    control = (
      <Select
        value={String(resolved.value)}
        onValueChange={onChange}
        options={options}
        getLabel={def.key === "household.locale" ? localeDisplayName : titleCaseOption}
        disabled={disabled}
        aria-label={def.label}
      />
    );
  } else if (def.selector === "number") {
    const range = def.range as { min?: number; max?: number } | undefined;
    control = (
      <Input
        type="number"
        className="w-32"
        min={range?.min}
        max={range?.max}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        aria-label={def.label}
      />
    );
  } else if (def.selector === "text") {
    control = (
      <Input
        className="w-64"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        aria-label={def.label}
      />
    );
  } else {
    control = (
      <span className="text-base text-[var(--muted-foreground)]">
        Not supported in this hub version yet.
      </span>
    );
  }

  return (
    // Stacked on phone, side by side from tablet up. Looking at the real
    // Settings page at 390px during the accessibility pass (2026-09-05)
    // showed the control column being squeezed until a text input was
    // clipped at the screen edge - not caught by the overflow check,
    // because the page itself did not scroll sideways, the control was
    // just cut off inside it.
    <div className="flex flex-col items-start gap-2 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-base">{def.label}</span>
        {def.help ? <span className="text-base text-[var(--muted-foreground)]">{def.help}</span> : null}
        {canReset ? (
          <Button type="button" variant="link" onClick={onReset} disabled={disabled} className="mt-1 h-auto min-h-12 w-fit">
            Reset to default
          </Button>
        ) : null}
      </div>
      <div className="w-full min-w-0 sm:w-auto sm:shrink-0 sm:pt-1">{control}</div>
    </div>
  );
}
