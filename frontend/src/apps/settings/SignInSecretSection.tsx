import { i18n } from "@lingui/core";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@maipai/ui/src/dashboard/components/ui/input";
import { Label } from "@maipai/ui/src/dashboard/components/ui/label";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@maipai/ui/src/ui/tabs";
import { ApiError, api, type Roster } from "@/lib/api";

type SecretKind = "pin" | "password";
type MaskedStyle = React.CSSProperties & { WebkitTextSecurity: "disc" };

export function SignInSecretSection({ person, onPersonChange }: { person: Roster; onPersonChange: () => void | Promise<void> }) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<SecretKind>(person.pinDigits ? "pin" : "password");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const hasSecret = person.hasSecret;
  const isPin = kind === "pin";
  const validNext = isPin ? /^\d{4,10}$/.test(next) : next.length >= 4 && next.length <= 128;
  const canSave = validNext && next === again && (!hasSecret || current.length > 0) && !saving;
  const status = hasSecret
    ? person.pinDigits ? i18n._({ id: "You sign in with a {digits}-digit PIN.", message: "You sign in with a {digits}-digit PIN.", values: { digits: person.pinDigits } }) : i18n._({ id: "You sign in with a password.", message: "You sign in with a password." })
    : i18n._({ id: "You have no PIN or password yet.", message: "You have no PIN or password yet." });

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await api.changeSecret(hasSecret ? current : undefined, next);
      setCurrent(""); setNext(""); setAgain("");
      setSuccess(isPin
        ? hasSecret ? i18n._({ id: "Your PIN is changed.", message: "Your PIN is changed." }) : i18n._({ id: "Your PIN is set.", message: "Your PIN is set." })
        : hasSecret ? i18n._({ id: "Your password is changed.", message: "Your password is changed." }) : i18n._({ id: "Your password is set.", message: "Your password is set." }));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["people"] }),
        queryClient.invalidateQueries({ queryKey: ["auth-profiles"] }),
        onPersonChange(),
      ]);
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 401
        ? i18n._({ id: "Your current PIN or password is not right. Try again.", message: "Your current PIN or password is not right. Try again." })
        : cause instanceof ApiError && cause.status === 429
          ? i18n._({ id: "Too many tries. Wait a minute, then try again.", message: "Too many tries. Wait a minute, then try again." })
          : i18n._({ id: "Could not save this. Check your connection and try again.", message: "Could not save this. Check your connection and try again." }));
    } finally { setSaving(false); }
  }

  const masked = { WebkitTextSecurity: "disc" } as MaskedStyle;
  const field = (id: string, label: string, value: string, change: (value: string) => void, currentField = false) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={`maipai-${id}`} type="text" inputMode={isPin && !currentField ? "numeric" : "text"} style={masked} autoCapitalize="off" autoCorrect="off" spellCheck={false} autoComplete="off" data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" value={value} onChange={(event) => change(isPin && !currentField ? event.target.value.replace(/\D/g, "") : event.target.value)} />
    </div>
  );

  return <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{status}</p>
      <Tabs value={kind} onValueChange={(value) => { setKind(value as SecretKind); setNext(""); setAgain(""); setError(""); setSuccess(""); }}>
        <TabsList aria-label={i18n._({ id: "Sign-in method", message: "Sign-in method" })}><TabsTrigger value="pin">{i18n._({ id: "PIN", message: "PIN" })}</TabsTrigger><TabsTrigger value="password">{i18n._({ id: "Password", message: "Password" })}</TabsTrigger></TabsList>
      </Tabs>
      {hasSecret ? field("current-secret", i18n._({ id: "Current PIN or password", message: "Current PIN or password" }), current, setCurrent, true) : null}
      {field("new-secret", isPin ? i18n._({ id: "New PIN", message: "New PIN" }) : i18n._({ id: "New password", message: "New password" }), next, setNext)}
      {field("confirm-secret", i18n._({ id: "Type it again", message: "Type it again" }), again, setAgain)}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {success ? <p role="status" className="text-sm text-muted-foreground">{success}</p> : null}
      <Button type="button" disabled={!canSave} onClick={() => void save()}>{saving ? i18n._({ id: "Saving…", message: "Saving…" }) : hasSecret ? (isPin ? i18n._({ id: "Change PIN", message: "Change PIN" }) : i18n._({ id: "Change password", message: "Change password" })) : (isPin ? i18n._({ id: "Set a PIN", message: "Set a PIN" }) : i18n._({ id: "Set a password", message: "Set a password" }))}</Button>
  </div>;
}
