import { useEffect, useState, type ReactNode } from "react";
import type { MergedSetting } from "@maipai/ui/src/settings/groupSettings";
import type { ResolvedSetting } from "@/lib/api";
import { titleCaseOption, localeDisplayName } from "@maipai/ui/src/settings/SettingField";
import { Input } from "@maipai/ui/src/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";
import { Switch } from "@maipai/ui/src/dashboard/components/ui/switch";
import { Button } from "@maipai/ui/src/ui/button";
import { ItemDescription } from "@maipai/ui/src/dashboard/components/ui/item";
import { OptionMultiSelect } from "@maipai/ui/src/settings/OptionMultiSelect";
import { PersonMultiSelect } from "@/shell/pages/settings/PersonMultiSelect";
import { LocationSetting } from "@/shell/pages/settings/placeAdapter";
import { requestBrowserAlertPermission } from "@/shell/BrowserAlerts";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { formatBytes } from "@maipai/ui/src/format";

/** SHELL-05's own per-key control: the registry-selector-to-primitive
 * mapping docs/SETTINGS.md's generic renderer calls for, pointed at the
 * template's own shipped form primitives (`@maipai/ui/src/dashboard/
 * components/ui/{input,select,switch,button}`) instead of the kit's
 * pre-shadcndashboard ones `@maipai/ui/src/settings/SettingField.tsx`
 * (a Home/kit-authored file, not a vendored one) already uses. Mirrors
 * that file's own behavior selector by selector - boolean/select/
 * number/text/secret, the same draft/commit/reset logic, the same
 * write-only secret flow, the same "not supported yet" fallback for a
 * selector with no real registry key today (duration/entity/area/
 * media, and a scalar `person` with no `range.multiple`) - reusing its
 * two pure exported helpers (`titleCaseOption`, `localeDisplayName`)
 * rather than redefining them. NOTIFY-SHARE-02 adds the one real
 * exception: `person` WITH `range.multiple: true` renders
 * PersonMultiSelect, this file's own new control (see its header) -
 * the kit's `SettingField.tsx` still has no such case, an accepted gap
 * of the same shape SHELL-05's own duplication paragraph already names.
 * A named, accepted duplication
 * (docs/plans/shell-on-shadcndashboard-2026-09-21.md's own SHELL-05 gap
 * paragraph): the field logic lives in two places. */
const SECRETS_WITH_DEDICATED_FLOWS = new Set(["voice.hf_token"]);

interface SettingFieldProps {
  setting: MergedSetting;
  onChange: (value: unknown) => Promise<boolean>;
  onReset: () => void;
  disabled?: boolean;
  /** NOTIFY-SHARE-02: the signed-in viewer's own id, threaded down from
   * SettingsRenderer's `scopeValue` - dropped from a person
   * multi-select's own option list (see PersonMultiSelect's header).
   * Unused by every other selector. */
  selfPersonId?: string;
  optionsFrom?: Readonly<Record<string, readonly { value: string; label: string }[]>>;
}

export function SettingField({ setting, onChange, onReset, disabled, selfPersonId, optionsFrom }: SettingFieldProps) {
  const { def } = setting;
  const resolved = setting.resolved as MergedSetting["resolved"] & Pick<ResolvedSetting, "does" | "state" | "reason">;
  const [draft, setDraft] = useState<string>(String(resolved.value ?? ""));
  const canReset = resolved.source === "user";

  const [secretEditing, setSecretEditing] = useState(false);
  const [secretDraft, setSecretDraft] = useState("");
  const [secretSaving, setSecretSaving] = useState(false);
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const [companionsOffOpen, setCompanionsOffOpen] = useState(false);

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

  async function handleSwitchChange(value: boolean) {
    if (def.key === "companions.allowed" && !value) {
      setCompanionsOffOpen(true);
      return;
    }
    setPermissionMessage(null);
    if (def.key === "notifications.browser.enabled" && value) {
      if (typeof Notification === "undefined" || !("serviceWorker" in navigator)) {
        setPermissionMessage("This browser cannot show system alerts.");
        return;
      }
      if (!(await requestBrowserAlertPermission(() => Notification.requestPermission(), value))) {
        setPermissionMessage("Browser permission was not granted, so alerts are off.");
        return;
      }
    }
    onChange(value);
  }

  let control: ReactNode;
  if (resolved.secret && SECRETS_WITH_DEDICATED_FLOWS.has(def.key)) {
    control = <span className="text-sm text-muted-foreground">{resolved.isSet ? "Set" : "Not set"}</span>;
  } else if (resolved.secret) {
    control = secretEditing ? (
      <div className="flex flex-col gap-2">
        <div className="w-64 max-w-full">
          <Input
            type="password"
            placeholder="Paste the new value"
            value={secretDraft}
            disabled={secretSaving}
            onChange={(e) => setSecretDraft(e.target.value)}
            aria-label={def.label}
            autoComplete="off"
          />
        </div>
        <div className="flex gap-2">
          <Button type="button" disabled={secretSaving || !secretDraft} onClick={commitSecret}>
            {secretSaving ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
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
        <span className="text-sm text-muted-foreground">{resolved.isSet ? "Set" : "Not set"}</span>
        <Button type="button" variant="outline" disabled={disabled} onClick={() => setSecretEditing(true)}>
          {resolved.isSet ? "Change" : "Set"}
        </Button>
      </div>
    );
  } else if (def.selector === "boolean") {
    control = <><Switch size={def.key === "companions.allowed" || def.key === "ui.enrollment_sounds" ? "md" : "default"} checked={Boolean(resolved.value)} onCheckedChange={handleSwitchChange} disabled={disabled} aria-label={def.label} />{permissionMessage ? <span role="status" className="text-sm text-muted-foreground">{permissionMessage}</span> : null}</>;
  } else if (def.selector === "select" && (def.range as { multiple?: boolean } | undefined)?.multiple) {
    control = (
      <OptionMultiSelect
        value={(resolved.value as string[] | undefined) ?? []}
        options={(def.range as { options?: string[] }).options ?? []}
        labels={(def as { copy?: { option_labels?: Record<string, string> } }).copy?.option_labels}
        onValueChange={onChange}
        disabled={disabled}
        ariaLabel={def.label}
      />
    );
  } else if (def.selector === "select") {
    const options = (def.range as { options?: string[] } | undefined)?.options ?? [];
    const source = (def.range as { options_from?: string } | undefined)?.options_from;
    const runtimeOptions = source ? optionsFrom?.[source] : undefined;
    const optionDescriptions = (def as { copy?: { options?: Record<string, string> } }).copy?.options;
    const optionLabels = (def as { copy?: { option_labels?: Record<string, string> } }).copy?.option_labels;
    // MINOR-TOPICS-01e: a key's spec copy names its options in plain words; titleCaseOption is the fallback.
    const getLabel = (option: string) => optionLabels?.[option] ?? (option === "until_storage_threshold" ? "Until storage runs low" : def.key === "household.locale" ? localeDisplayName(option) : titleCaseOption(option));
    control = (
      <Select value={String(resolved.value)} onValueChange={onChange} disabled={disabled || Boolean(source && !runtimeOptions && !source.startsWith("models."))}>
        <SelectTrigger aria-label={def.label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {runtimeOptions ? runtimeOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>) : options.map((option) => (
            <SelectItem key={option} value={option}>{optionDescriptions?.[option] ?? getLabel(option)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  } else if (def.selector === "number") {
    const range = def.range as { min?: number; max?: number } | undefined;
    control = (
      <div className="w-32 max-w-full shrink-0">
        <Input
          type="number"
          min={range?.min}
          max={range?.max}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          aria-label={def.label}
        />
      </div>
    );
  } else if (def.selector === "time") {
    control = <div className="flex items-center gap-2"><div className="w-40 max-w-full shrink-0"><Input type="time" value={String(resolved.value ?? "")} disabled={disabled} onChange={(e) => void onChange(e.target.value)} aria-label={def.key} /></div>{resolved.value == null && <><span className="text-sm text-muted-foreground">Inheriting household hours</span><Button type="button" variant="link" onClick={onReset} disabled={disabled}>Use household hours</Button></>}</div>;
  } else if (def.selector === "text") {
    control = (
      <div className="w-64 max-w-full">
        <Input
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          aria-label={def.label}
        />
      </div>
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
  } else if (def.selector === "location") {
    control = <LocationSetting def={def} value={resolved.value} onChange={onChange} disabled={disabled} />;
  } else {
    control = <span className="text-sm text-muted-foreground">Not supported in this hub version yet.</span>;
  }

  return (
    <>
    <div className="flex flex-col items-start gap-2 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        {def.key === "companions.allowed" ? <span className="flex min-h-12 items-center text-sm">{def.label}</span> : <span className="text-sm">{def.key === "storage.household.cap_bytes" ? "Household storage cap" : def.label}</span>}
        {def.key === "storage.household.cap_bytes" && typeof resolved.value === "number" ? <ItemDescription clamp={false}>{formatBytes(resolved.value)}</ItemDescription> : null}
        {resolved.does ? <ItemDescription clamp={false}>{resolved.does}</ItemDescription> : null}
        {resolved.state ? <ItemDescription clamp={false}>{resolved.state}</ItemDescription> : null}
        {resolved.reason ? <ItemDescription clamp={false}>{resolved.reason}</ItemDescription> : null}
        {canReset ? (
          <Button type="button" variant="link" onClick={onReset} disabled={disabled}>
            Reset to default
          </Button>
        ) : null}
      </div>
      <div className="w-full min-w-0 sm:w-auto sm:shrink-0">{control}</div>
    </div>
    <AlertDialog open={companionsOffOpen} onOpenChange={setCompanionsOffOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{def.label}</AlertDialogTitle>
          <AlertDialogDescription>The person may have grown attached to their AI companions. Turn them off with care. Their companion and personality data will be kept.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => { void onChange(false); }}>Turn off</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
