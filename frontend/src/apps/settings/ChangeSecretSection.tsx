import { useState, type FormEvent } from "react";
import { Section } from "@/kit/primitives/Section";
import { Input } from "@/kit/components/Input";
import { Button } from "@/kit/components/Button";
import { api, ApiError, type Roster } from "@/lib/api";

interface ChangeSecretSectionProps {
  person: Roster;
  /** Called after a successful change so App.tsx's `person` (and this
   * section's own "doesn't have one yet" copy, driven by person.hasSecret)
   * reflects reality without waiting for a full page reload - a real gap
   * this session found and deferred earlier tonight, now closed. */
  onChanged: () => void;
}

// 4.1's self-service PIN/password change (backend/src/routes/auth.ts's
// new POST /api/auth/change-secret, added tonight - no route existed for
// a person to change their own PIN before). Visible to everyone, not
// gated to owner/admin like BackupsSection: changing your own PIN is a
// personal action any role can take, distinct from the household-admin
// actions the rest of this page's owner/admin gate covers.
export function ChangeSecretSection({ person, onChanged }: ChangeSecretSectionProps) {
  const [currentSecret, setCurrentSecret] = useState("");
  const [newSecret, setNewSecret] = useState("");
  const [confirmSecret, setConfirmSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (newSecret !== confirmSecret) {
      setError("Those two don't match.");
      return;
    }
    setSubmitting(true);
    try {
      await api.changeSecret(person.hasSecret ? currentSecret : undefined, newSecret);
      setCurrentSecret("");
      setNewSecret("");
      setConfirmSecret("");
      setSuccess(true);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change it.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Section heading="Your PIN or password">
      <form onSubmit={handleSubmit} className="flex max-w-sm flex-col gap-3">
        {person.hasSecret ? (
          <Input
            type="password"
            placeholder="Current PIN or password"
            value={currentSecret}
            onChange={(e) => setCurrentSecret(e.target.value)}
            disabled={submitting}
            required
          />
        ) : (
          <p className="text-base text-[hsl(var(--muted-foreground))]">
            Your profile doesn't have one yet. Add one below.
          </p>
        )}
        <Input
          type="password"
          placeholder={person.hasSecret ? "New PIN or password" : "Choose a PIN or password"}
          value={newSecret}
          onChange={(e) => setNewSecret(e.target.value)}
          disabled={submitting}
          required
        />
        <Input
          type="password"
          placeholder="Confirm"
          value={confirmSecret}
          onChange={(e) => setConfirmSecret(e.target.value)}
          disabled={submitting}
          required
        />
        {error ? <p className="text-base text-[hsl(var(--destructive))]">{error}</p> : null}
        {success ? <p className="text-base text-[hsl(var(--primary))]">Done.</p> : null}
        <Button type="submit" disabled={submitting} className="w-fit">
          {submitting ? "Saving…" : person.hasSecret ? "Change it" : "Set it"}
        </Button>
      </form>
    </Section>
  );
}
