import { useState, type FormEvent } from "react";
import { Section } from "@maipai/ui/src/primitives/Section";
import { Input } from "@maipai/ui/src/ui/input";
import { Button } from "@maipai/ui/src/ui/button";
import { api, ApiError, type Roster } from "@/lib/api";

interface DisplayNameSectionProps {
  person: Roster;
  onChanged: () => void;
}

export function DisplayNameSection({ person, onChanged }: DisplayNameSectionProps) {
  const [value, setValue] = useState(person.display_name);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const trimmed = value.trim();
  const canSave = trimmed.length > 0 && trimmed !== person.display_name && !submitting;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      await api.updatePerson(person.id, { displayName: trimmed });
      setSuccess(true);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save your name.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Section heading="Your name">
      <p className="text-base text-[var(--muted-foreground)]">
        This is the name MaiPai calls you and shows on your messages.
      </p>
      <form onSubmit={handleSubmit} className="flex max-w-sm flex-col gap-3">
        <Input
          type="text"
          placeholder="Your name"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={submitting}
        />
        {error ? <p className="text-base text-[var(--destructive)]">{error}</p> : null}
        {success ? <p className="text-base text-[var(--primary)]">Saved.</p> : null}
        <Button type="submit" disabled={!canSave} className="w-fit">
          {submitting ? "Saving…" : "Save"}
        </Button>
      </form>
    </Section>
  );
}
