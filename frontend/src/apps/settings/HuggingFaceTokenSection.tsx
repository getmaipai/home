import { useEffect, useState, type FormEvent } from "react";
import { Section } from "@/kit/primitives/Section";
import { Input } from "@/kit/components/Input";
import { Button } from "@/kit/components/Button";
import { api, ApiError } from "@/lib/api";

const KEY = "voice.hf_token";

// The paste-and-confirm flow `SettingField.tsx`'s own comment names as
// the real way to change a `secret: true` key ("setting a secret needs
// its own flow... that no key exercises yet") - voice.hf_token
// (2026-09-04) is the first one that does. Owner/admin only, the same
// gate ModelsSection/BackupsSection already use in SettingsPage.tsx:
// household scope's own write authorization (lib/settings.ts's
// assertCanAccessScope) already requires it for any household-scope
// write, this just keeps the control itself from rendering for someone
// who'd get a 403 clicking it.
//
// Still just the credential, not voice cloning itself (docs/dev.md):
// nothing reads this token yet to actually clone a voice - that's the
// next, separate piece of work.
export function HuggingFaceTokenSection() {
  const [isSet, setIsSet] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function load() {
    setLoadError(null);
    try {
      const values = await api.settingsValues("household");
      const setting = values.find((v) => v.key === KEY);
      setIsSet(setting?.isSet ?? false);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Could not load the current status.");
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
      await api.setSetting("household", KEY, token);
      setToken("");
      setSuccess(true);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save that token.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove() {
    setSubmitting(true);
    setError(null);
    try {
      await api.resetSetting("household", KEY);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove it.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Section heading="Hugging Face token (for voice cloning)">
      <p className="text-sm text-[hsl(var(--muted-foreground))]">
        Needed to clone a voice from a recording. Accept the terms at huggingface.co/kyutai/pocket-tts, then create a
        read token at huggingface.co/settings/tokens and paste it below.
      </p>
      {loadError ? <p className="text-sm text-[hsl(var(--destructive))]">{loadError}</p> : null}
      {isSet !== null ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          {isSet ? "A token is connected." : "No token connected yet."}
        </p>
      ) : null}
      <form onSubmit={handleSubmit} className="flex max-w-sm flex-col gap-3">
        <Input
          type="password"
          placeholder="hf_..."
          value={token}
          onChange={(e) => setToken(e.target.value)}
          disabled={submitting}
          required
        />
        {error ? <p className="text-sm text-[hsl(var(--destructive))]">{error}</p> : null}
        {success ? <p className="text-sm text-[hsl(var(--primary))]">Saved.</p> : null}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={submitting} className="w-fit">
            {submitting ? "Saving…" : "Save"}
          </Button>
          {isSet ? (
            <Button type="button" variant="secondary" size="sm" disabled={submitting} onClick={handleRemove}>
              Remove
            </Button>
          ) : null}
        </div>
      </form>
    </Section>
  );
}
