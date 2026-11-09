import { i18n } from "@lingui/core";
import { useEffect, useState, type FormEvent } from "react";
import { Section } from "@maipai/ui/src/primitives/Section";
import { DestructiveConfirm } from "@maipai/ui/src/primitives/DestructiveConfirm";
import { Input } from "@maipai/ui/src/ui/input";
import { Button } from "@maipai/ui/src/ui/button";
import { api } from "@/lib/api";
import { errorLine } from "@/lib/hubReachability";
import { StatusCard } from "@maipai/ui/src/elements/status-card";

const KEY = "voice.hf_token";

// The paste-and-confirm flow `SettingField.tsx`'s own comment names as
// the real way to change a `secret: true` key ("setting a secret needs
// its own flow... that no key exercises yet") - voice.hf_token
// (2026-09-04) is the first one that does. Owner/admin only, the same
// gate ModelsSection/BackupsSection already use:
// household scope's own write authorization (lib/settings.ts's
// assertCanAccessScope) already requires it for any household-scope
// write, this just keeps the control itself from rendering for someone
// who'd get a 403 clicking it.
//
// Saves/removes go through the dedicated /api/voice/hf-token routes, not
// the generic setSetting/resetSetting - the generic PUT route has no hook
// to update the Stack speech service afterward, and a
// saved-but-not-yet-applied token would silently do nothing until the
// backend happened to restart some other way (see routes/voice.ts).
export function HuggingFaceTokenSection() {
  const [isSet, setIsSet] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function load() {
    setLoadError(null);
    try {
      const values = await api.settingsValues("household");
      const setting = values.find((v) => v.key === KEY);
      setIsSet(setting?.isSet ?? false);
    } catch (e) {
      setLoadError(errorLine(e, i18n._({ id: "Could not load the current status.", message: "Could not load the current status." })));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      await api.setHfToken(token);
      setToken("");
      setSuccess(true);
      await load();
    } catch (err) {
      setError(errorLine(err, i18n._({ id: "Could not save that token.", message: "Could not save that token." })));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove() {
    setSubmitting(true);
    setError(null);
    setSuccess(false);
    try {
      await api.removeHfToken();
      setConfirmRemove(false);
      await load();
    } catch (err) {
      setError(errorLine(err, i18n._({ id: "Could not remove it.", message: "Could not remove it." })));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Section heading={i18n._({ id: "Hugging Face token (for voice cloning)", message: "Hugging Face token (for voice cloning)" })}>
      <p className="text-base text-muted-foreground">
        {i18n._({ id: "Needed by the Stack to clone a voice from a recording. Create a read token at huggingface.co/settings/tokens and paste it below.", message: "Needed by the Stack to clone a voice from a recording. Create a read token at huggingface.co/settings/tokens and paste it below." })}
      </p>
      {loadError ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={loadError} /> : null}
      {isSet !== null ? (
        <p className="text-base text-muted-foreground">
          {isSet ? i18n._({ id: "A token is connected.", message: "A token is connected." }) : i18n._({ id: "No token connected yet.", message: "No token connected yet." })}
        </p>
      ) : null}
      <form onSubmit={handleSubmit} className="flex max-w-sm flex-col gap-3">
        <Input
          type="password"
          placeholder={i18n._({ id: "hf_...", message: "hf_..." })}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          disabled={submitting}
          required
        />
        {error ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={error} /> : null}
        {success ? <p className="text-base text-primary">{i18n._({ id: "Saved.", message: "Saved." })}</p> : null}
        <div className="flex gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? i18n._({ id: "Saving…", message: "Saving…" }) : i18n._({ id: "Save", message: "Save" })}
          </Button>
        </div>
      </form>
      {isSet ? confirmRemove ? <DestructiveConfirm message={i18n._({ id: "Remove the connected Hugging Face token?", message: "Remove the connected Hugging Face token?" })} detail={i18n._({ id: "Voice cloning will no longer be able to use this token.", message: "Voice cloning will no longer be able to use this token." })} confirmLabel={i18n._({ id: "Remove token", message: "Remove token" })} busyLabel={i18n._({ id: "Removing…", message: "Removing…" })} busy={submitting} onConfirm={() => void handleRemove()} onCancel={() => setConfirmRemove(false)} /> : <Button type="button" variant="destructive" disabled={submitting} onClick={() => setConfirmRemove(true)}>{i18n._({ id: "Remove", message: "Remove" })}</Button> : null}
    </Section>
  );
}
