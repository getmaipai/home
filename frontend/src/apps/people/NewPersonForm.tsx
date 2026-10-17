import { CheckIcon } from "lucide-react";
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
  /** Check the PIN or password (4 to 128 characters) before submitting. */
  checkSecret?: boolean;
  /** Hide the form's own submit button when the page supplies one. */
  hideSubmit?: boolean;
}

const ROLE_OPTIONS: NewPersonRole[] = ["owner", "adult", "teen", "child", "guest"];
const NAME_ERROR = "Type a name for this person.";
const SECRET_EMPTY_ERROR = "Type a PIN or password for this person so they can sign in.";
const SECRET_LENGTH_ERROR = "Use 4 to 128 characters for the PIN or password.";
const CONFIRM_ERROR = "The two passcodes are different. Type the same passcode in both boxes.";
function secretProblem(value: string): string | null {
  if (value.length === 0) return SECRET_EMPTY_ERROR;
  return value.length < 4 || value.length > 128 ? SECRET_LENGTH_ERROR : null;
}
export function NewPersonForm({ actorRole, fixedRole, onSubmit, submitLabel, busy, error, extra, formRef, checkSecret = false, hideSubmit = false }: NewPersonFormProps) {
  const choices = [...new Set(creatableRoles(actorRole).map((role) => serverRoleToRoleAdmin(role).role))];
  const [role, setRole] = useState<NewPersonRole>(fixedRole ?? (choices.includes("adult") ? "adult" : choices[0] ?? "adult"));
  const [admin, setAdmin] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [secret, setSecret] = useState("");
  const [confirm, setConfirm] = useState("");
  const [confirmError, setConfirmError] = useState(false);
  const [confirmBlurred, setConfirmBlurred] = useState(false);
  const [nameError, setNameError] = useState(false);
  const [secretError, setSecretError] = useState<string | null>(null);
  const mayCreateAdmin = creatableRoles(actorRole).includes("admin");
  const owner = role === "owner";
  const secretRequired = requiresSecret(roleAdminToServerRole({ role, admin }));
  // Neutral while the confirm box is empty; green when equal; red once it is different and either
  // the box lost focus or it is as long as the passcode (so the first characters never flash red).
  const matches = secretRequired && confirm.length > 0 && confirm === secret;
  const differs = secretRequired && confirm.length > 0 && confirm !== secret && (confirmBlurred || confirm.length >= secret.length);
  const showConfirmError = differs || confirmError;

  function validateName() {
    const invalid = displayName.trim().length === 0;
    setNameError(invalid);
    return !invalid;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nameOk = validateName();
    const problem = checkSecret && secretRequired ? secretProblem(secret) : null;
    setSecretError(problem);
    const mismatch = secretRequired && confirm !== secret;
    setConfirmError(mismatch);
    if (!nameOk || problem || mismatch) return;
    try {
      await onSubmit({ displayName, role: roleAdminToServerRole({ role, admin }), ...(secretRequired ? { secret } : {}) });
      setDisplayName("");
      setSecret("");
      setConfirm("");
      setConfirmError(false);
      setConfirmBlurred(false);
      setAdmin(false);
      setRole(fixedRole ?? (choices.includes("adult") ? "adult" : choices[0] ?? "adult"));
      setNameError(false);
      setSecretError(null);
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
            aria-label="PIN or password" required={!checkSecret}
            aria-invalid={secretError !== null || showConfirmError} valid={matches} aria-describedby={secretError ? "new-person-secret-error" : undefined}
            onChange={(event) => { setSecret(event.target.value); if (secretError) setSecretError(secretProblem(event.target.value)); if (confirmError) setConfirmError(confirm !== event.target.value); }} />
          {secretError ? <FieldError id="new-person-secret-error">{secretError}</FieldError> : null}
          <FieldDescription>This person will use it to sign in.</FieldDescription>
        </Field> : null}
        {secretRequired ? <Field>
          <FieldLabel htmlFor="new-person-confirm">Confirm passcode</FieldLabel>
          <Input id="new-person-confirm" type="password" placeholder="Type it again" value={confirm} disabled={busy}
            autoComplete="new-password" aria-invalid={showConfirmError} valid={matches}
            aria-describedby={showConfirmError ? "new-person-confirm-error" : matches ? "new-person-confirm-match" : undefined}
            onChange={(event) => { setConfirm(event.target.value); if (confirmError) setConfirmError(event.target.value !== secret); }}
            onBlur={() => { setConfirmBlurred(true); if (confirm.length > 0) setConfirmError(confirm !== secret); }} />
          {showConfirmError ? <FieldError id="new-person-confirm-error">{CONFIRM_ERROR}</FieldError> : null}
          <div role="status" aria-live="polite">
            {matches ? <FieldDescription id="new-person-confirm-match"><CheckIcon aria-hidden="true" className="inline size-4 align-text-bottom" /> Passcodes match</FieldDescription> : null}
          </div>
        </Field> : null}
        {error ? <FieldError>{error}</FieldError> : null}
        {extra}
        {hideSubmit ? null : <Button type="submit" disabled={busy}>{busy ? "Adding…" : submitLabel}</Button>}
      </FieldGroup>
    </form>
  );
}
