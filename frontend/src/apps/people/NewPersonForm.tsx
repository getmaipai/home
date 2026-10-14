import { useState, type FormEvent, type ReactNode, type Ref } from "react";
import { Button } from "@maipai/ui/src/ui/button";
import { Checkbox } from "@maipai/ui/src/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@maipai/ui/src/dashboard/components/ui/field";
import { Input } from "@maipai/ui/src/ui/input";
import { Select } from "@maipai/ui/src/primitives/Select";
import { ROLE_LABELS, creatableRoles, requiresSecret, roleAdminToServerRole, serverRoleToRoleAdmin, type NewPersonRole } from "@/apps/people/roles";
import type { Role } from "@/lib/api";

export interface NewPersonValues {
  displayName: string;
  role: Role;
  secret?: string;
}

interface NewPersonFormProps {
  actorRole: Role;
  fixedRole?: "owner";
  onSubmit: (values: NewPersonValues) => void | Promise<void>;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  extra?: ReactNode;
  formRef?: Ref<HTMLFormElement>;
}

const ROLE_OPTIONS: NewPersonRole[] = ["owner", "adult", "teen", "child", "guest"];
const NAME_ERROR = "Type a name for this person.";
export function NewPersonForm({ actorRole, fixedRole, onSubmit, submitLabel, busy, error, extra, formRef }: NewPersonFormProps) {
  const choices = [...new Set(creatableRoles(actorRole).map((role) => serverRoleToRoleAdmin(role).role))];
  const [role, setRole] = useState<NewPersonRole>(fixedRole ?? (choices.includes("adult") ? "adult" : choices[0] ?? "adult"));
  const [admin, setAdmin] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [secret, setSecret] = useState("");
  const [nameError, setNameError] = useState(false);
  const mayCreateAdmin = creatableRoles(actorRole).includes("admin");
  const owner = role === "owner";
  const secretRequired = requiresSecret(roleAdminToServerRole({ role, admin }));

  function validateName() {
    const invalid = displayName.trim().length === 0;
    setNameError(invalid);
    return !invalid;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validateName()) return;
    try {
      await onSubmit({ displayName, role: roleAdminToServerRole({ role, admin }), ...(secretRequired ? { secret } : {}) });
      setDisplayName("");
      setSecret("");
      setAdmin(false);
      setRole(fixedRole ?? (choices.includes("adult") ? "adult" : choices[0] ?? "adult"));
      setNameError(false);
    } catch {
      // The caller owns the visible error and keeps the entered values for correction.
    }
  }

  return (
    <form ref={formRef} onSubmit={submit} noValidate>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="new-person-name">Name</FieldLabel>
          <Input id="new-person-name" placeholder="Name" value={displayName} disabled={busy}
            aria-invalid={nameError} aria-describedby={nameError ? "new-person-name-error" : undefined}
            onChange={(event) => { const value = event.target.value; setDisplayName(value); if (nameError) setNameError(value.trim().length === 0); }} onBlur={validateName} />
          {nameError ? <FieldError id="new-person-name-error">{NAME_ERROR}</FieldError> : null}
        </Field>
        {!fixedRole ? <Field>
          <FieldLabel htmlFor="new-person-role">Role</FieldLabel>
          <Select aria-label="Role" value={role} onValueChange={(value) => { setRole(value as NewPersonRole); setAdmin(false); }}
            options={ROLE_OPTIONS.filter((option) => choices.includes(option))} getLabel={(value) => ROLE_LABELS[value as Role]} disabled={busy} />
        </Field> : null}
        {role === "adult" || owner ? <Field>
          <FieldLabel htmlFor="new-person-admin">
            <Checkbox id="new-person-admin" checked={owner || admin} disabled={busy || owner || !mayCreateAdmin}
              aria-describedby={owner ? "new-person-owner-admin-note" : undefined}
              onCheckedChange={(checked) => { if (!owner && mayCreateAdmin) setAdmin(checked === true); }} />
            Admin
          </FieldLabel>
          {owner ? <FieldDescription id="new-person-owner-admin-note">The owner is always an admin.</FieldDescription> : null}
        </Field> : null}
        {secretRequired ? <Field>
          <FieldLabel htmlFor="new-person-secret">PIN or password (required for {ROLE_LABELS[roleAdminToServerRole({ role, admin })].toLowerCase()})</FieldLabel>
          <Input id="new-person-secret" type="password" placeholder="Enter a PIN or password" value={secret} disabled={busy}
            aria-label="PIN or password" required onChange={(event) => setSecret(event.target.value)} />
          <FieldDescription>This person will use it to sign in.</FieldDescription>
        </Field> : null}
        {error ? <FieldError>{error}</FieldError> : null}
        {extra}
        <Button type="submit" disabled={busy}>{busy ? "Adding…" : submitLabel}</Button>
      </FieldGroup>
    </form>
  );
}
