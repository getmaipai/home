import { useEffect, useState, type ReactNode } from "react";
import type { MergedSetting } from "@maipai/ui/src/settings/groupSettings";
import { titleCaseOption, localeDisplayName } from "@maipai/ui/src/settings/SettingField";
import { Input } from "@maipai/ui/src/dashboard/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/dashboard/components/ui/select";
import { Switch } from "@maipai/ui/src/dashboard/components/ui/switch";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { PersonMultiSelect } from "@/next/pages/settings/PersonMultiSelect";

/** SHELL-05's own per-key control: the registry-selector-to-primitive
 * mapping docs/SETTINGS.md's generic renderer calls for, pointed at the
 * template's own shipped form primitives (`@maipai/ui/src/dashboard/
 * components/ui/{input,select,switch,button}`) instead of the kit's
 * pre-shadcndashboard ones `@maipai/ui/src/settings/SettingField.tsx`
 * (a Home/kit-authored file, not a vendored one) already uses. Mirrors
 * that file's own behavior selector by selector - boolean/select/
 * number/text/secret, the same draft/commit/reset logic, the same
 * write-only secret flow, the same "not supported yet" fallback for a
 * selector with no real registry key today (duration/time/entity/area/
 * media, and a scalar `person` with no `range.multiple`) - reusing its
 * two pure exported helpers (`titleCaseOption`, `localeDisplayName`)
 * rather than redefining them. NOTIFY-SHARE-02 adds the one real
 * exception: `person` WITH `range.multiple: true` renders
 * PersonMultiSelect, this file's own new control (see its header) -
 * the kit's `SettingField.tsx` still has no such case, an accepted gap
 * of the same shape SHELL-05's own duplication paragraph already names
 * (the old shell shows "Not supported in this hub version yet" for this
 * one key until it retires, same as it already does for the other
 * selectors this file just listed). A named, accepted duplication
 * (docs/plans/shell-on-shadcndashboard-2026-09-21.md's own SHELL-05 gap
 * paragraph): the field logic itself lives in two places until the old
 * shell retires and this becomes the only one. */
const SECRETS_WITH_DEDICATED_FLOWS = new Set(["voice.hf_token"]);

interface NextSettingFieldProps {
  setting: MergedSetting;
  onChange: (value: unknown) => Promise<boolean>;
  onReset: () => void;
  disabled?: boolean;
  /** NOTIFY-SHARE-02: the signed-in viewer's own id, threaded down from
   * NextSettingsRenderer's `scopeValue` - dropped from a person
   * multi-select's own option list (see PersonMultiSelect's header).
   * Unused by every other selector. */
  selfPersonId?: string;
}

export function NextSettingField({ setting, onChange, onReset, disabled, selfPersonId }: NextSettingFieldProps) {
  const { def, resolved } = setting;
  const [draft, setDraft] = useState<string>(String(resolved.value ?? ""));
  const canReset = resolved.source === "user";

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

  useEffect(() => {
    setDraft(String(resolved.value ?? ""));
  }, [resolved.value]);

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
    control = <span className="text-sm text-muted-foreground">{resolved.isSet ? "Set" : "Not set"}</span>;
  } else if (resolved.secret) {
    control = secretEditing ? (
      <div className="flex flex-col gap-2">
        <Input
          type="password"
          className="min-h-12 w-64"
          placeholder="Paste the new value"
          value={secretDraft}
          disabled={secretSaving}
          onChange={(e) => setSecretDraft(e.target.value)}
          aria-label={def.label}
          autoComplete="off"
        />
        <div className="flex gap-2">
          <Button type="button" size="sm" className="min-h-12" disabled={secretSaving || !secretDraft} onClick={commitSecret}>
            {secretSaving ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-12"
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
        <span className="text-sm text-muted-foreground">{resolved.isSet ? "Set" : "Not set"}</span>
        <Button type="button" size="sm" variant="outline" className="min-h-12 min-w-12" disabled={disabled} onClick={() => setSecretEditing(true)}>
          {resolved.isSet ? "Change" : "Set"}
        </Button>
      </div>
    );
  } else if (def.selector === "boolean") {
    control = <Switch checked={Boolean(resolved.value)} onCheckedChange={onChange} disabled={disabled} aria-label={def.label} />;
  } else if (def.selector === "select") {
    const options = (def.range as { options?: string[] } | undefined)?.options ?? [];
    const getLabel = def.key === "household.locale" ? localeDisplayName : titleCaseOption;
    control = (
      <Select value={String(resolved.value)} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="min-h-12 w-40" aria-label={def.label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {getLabel(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  } else if (def.selector === "number") {
    const range = def.range as { min?: number; max?: number } | undefined;
    control = (
      <Input
        type="number"
        className="min-h-12 w-32"
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
        className="min-h-12 w-64"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        aria-label={def.label}
      />
    );
  } else if (def.selector === "person" && (def.range as { multiple?: boolean } | undefined)?.multiple) {
    // NOTIFY-SHARE-02: the one real key on this selector today
    // (notifications.file_shared.muted_senders) - see PersonMultiSelect's
    // own header for why this composes the kit's Combobox/Chips rather
    // than a hand-built widget.
    control = (
      <PersonMultiSelect
        value={(resolved.value as string[] | undefined) ?? []}
        onValueChange={onChange}
        disabled={disabled}
        excludePersonId={selfPersonId}
        ariaLabel={def.label}
      />
    );
  } else {
    control = <span className="text-sm text-muted-foreground">Not supported in this hub version yet.</span>;
  }

  return (
    <div className="flex flex-col items-start gap-2 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm">{def.label}</span>
        {def.help ? <span className="text-sm text-muted-foreground">{def.help}</span> : null}
        {canReset ? (
          <Button type="button" variant="link" size="sm" onClick={onReset} disabled={disabled} className="h-auto min-h-12 w-fit p-0">
            Reset to default
          </Button>
        ) : null}
      </div>
      <div className="w-full min-w-0 sm:w-auto sm:shrink-0">{control}</div>
    </div>
  );
}
