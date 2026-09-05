import { useEffect, useState, type ReactNode } from "react";
import type { MergedSetting } from "@/kit/settings/groupSettings";
import { Input } from "@/kit/components/Input";
import { Select } from "@/kit/components/Select";
import { Switch } from "@/kit/components/Switch";

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
// text/number/select/boolean actually render a control - docs/UI.md's
// selector vocabulary also names duration/time/entity/area/person/media,
// none of which have a real registry key yet (nor, for entity/area, any
// Home Assistant integration to pick from); typed by SettingsKey's own
// schema but not built, the same "typed, most unimplemented" posture
// llm.ts's IMPLEMENTED_ROLES already uses.
export function SettingField({ setting, onChange, onReset, disabled }: SettingFieldProps) {
  const { def, resolved } = setting;
  const [draft, setDraft] = useState<string>(String(resolved.value ?? ""));
  const canReset = resolved.source === "user";

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
  if (resolved.secret) {
    // CLAUDE.md > Credentials and secrets: never render a secret's real
    // value. resolveForResponse() on the backend already enforces this in
    // the response (value: null, isSet instead); this is a static status
    // row, not an editable control, since setting a secret needs its own
    // flow (a paste-and-confirm dialog) that no key exercises yet.
    control = (
      <span className="text-base text-[hsl(var(--muted-foreground))]">
        {resolved.isSet ? "Set" : "Not set"}
      </span>
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
        getLabel={titleCaseOption}
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
      <span className="text-base text-[hsl(var(--muted-foreground))]">
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
        {def.help ? <span className="text-base text-[hsl(var(--muted-foreground))]">{def.help}</span> : null}
        {canReset ? (
          <button
            type="button"
            onClick={onReset}
            disabled={disabled}
            className="mt-1 min-h-12 w-fit text-base text-[hsl(var(--primary))] hover:underline disabled:opacity-50"
          >
            Reset to default
          </button>
        ) : null}
      </div>
      <div className="w-full min-w-0 sm:w-auto sm:shrink-0 sm:pt-1">{control}</div>
    </div>
  );
}
