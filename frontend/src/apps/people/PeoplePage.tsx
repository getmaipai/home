import { useEffect, useState, type FormEvent } from "react";
import { Page } from "@/kit/primitives/Page";
import { Section } from "@/kit/primitives/Section";
import { Progress } from "@/kit/primitives/Progress";
import { Avatar } from "@/kit/components/Avatar";
import { Input } from "@/kit/components/Input";
import { Select } from "@/kit/components/Select";
import { Button } from "@/kit/components/Button";
import { api, ApiError, type PersonRosterEntry, type Role, type Roster } from "@/lib/api";
import { ROLE_LABELS, canManagePeople, creatableRoles, requiresSecret } from "@/apps/people/roles";

interface PeoplePageProps {
  person: Roster;
}

// 4.2's household roster, hand-built (not yet a declared page - v0 of
// spec/ui only covers Chat, docs/dev.md). The backend has no edit or
// delete-person route yet (routes/people.ts's own comment: "no route in
// this slice deletes or changes a person's role after creation"), so
// this page only lists and adds - there is nothing to build an edit flow
// against yet.
export function PeoplePage({ person }: PeoplePageProps) {
  const [roster, setRoster] = useState<PersonRosterEntry[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Role>("adult");
  const [secret, setSecret] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canManage = canManagePeople(person.role as Role);
  const roleOptions = canManage ? creatableRoles(person.role as Role) : [];

  function load() {
    setLoadError(false);
    api
      .people()
      .then(setRoster)
      .catch(() => setLoadError(true));
  }

  useEffect(load, []);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await api.createPerson({
        displayName,
        role,
        secret: requiresSecret(role) ? secret : undefined,
      });
      setDisplayName("");
      setSecret("");
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not add that person.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Page title="People">
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4">
        {loadError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <p className="text-base text-[hsl(var(--destructive))]">Could not load the household.</p>
            <Button variant="secondary" size="sm" onClick={load}>
              Try again
            </Button>
          </div>
        ) : roster === null ? (
          <div className="flex flex-1 items-center justify-center">
            <Progress mode="spinner" label="Loading household" />
          </div>
        ) : (
          <Section heading="Household">
            <div className="flex flex-col gap-3">
              {roster.map((p) => (
                <div key={p.id} className="flex items-center gap-3">
                  <Avatar name={p.display_name} className="h-10 w-10" />
                  <div className="flex flex-col">
                    <span className="text-base">{p.display_name}</span>
                    <span className="text-sm text-[hsl(var(--muted-foreground))]">{ROLE_LABELS[p.role]}</span>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {canManage ? (
          <Section heading="Add someone">
            <form onSubmit={handleAdd} className="flex max-w-sm flex-col gap-3">
              <Input
                placeholder="Name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={submitting}
                required
              />
              <Select
                value={role}
                onValueChange={(v) => setRole(v as Role)}
                options={roleOptions}
                getLabel={(v) => ROLE_LABELS[v as Role]}
                disabled={submitting}
                aria-label="Role"
              />
              {requiresSecret(role) ? (
                <Input
                  type="password"
                  placeholder="PIN or password (required for this role)"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  disabled={submitting}
                  required
                />
              ) : null}
              {formError ? <p className="text-sm text-[hsl(var(--destructive))]">{formError}</p> : null}
              <Button type="submit" disabled={submitting}>
                {submitting ? "Adding…" : "Add to household"}
              </Button>
            </form>
          </Section>
        ) : null}
      </div>
    </Page>
  );
}
