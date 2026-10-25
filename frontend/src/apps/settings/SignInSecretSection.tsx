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
    ? person.pinDigits ? `You sign in with a ${person.pinDigits}-digit PIN.` : "You sign in with a password."
    : "You have no PIN or password yet.";

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await api.changeSecret(hasSecret ? current : undefined, next);
      setCurrent(""); setNext(""); setAgain("");
      setSuccess(`Your ${isPin ? "PIN" : "password"} ${hasSecret ? "is changed." : "is set."}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["people"] }),
        queryClient.invalidateQueries({ queryKey: ["auth-profiles"] }),
        onPersonChange(),
      ]);
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 401
        ? "Your current PIN or password is not right. Try again."
        : cause instanceof ApiError && cause.status === 429
          ? "Too many tries. Wait a minute, then try again."
          : "Could not save this. Check your connection and try again.");
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
        <TabsList aria-label="Sign-in method"><TabsTrigger value="pin">PIN</TabsTrigger><TabsTrigger value="password">Password</TabsTrigger></TabsList>
      </Tabs>
      {hasSecret ? field("current-secret", "Current PIN or password", current, setCurrent, true) : null}
      {field("new-secret", `New ${isPin ? "PIN" : "password"}`, next, setNext)}
      {field("confirm-secret", "Type it again", again, setAgain)}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {success ? <p role="status" className="text-sm text-muted-foreground">{success}</p> : null}
      <Button type="button" disabled={!canSave} onClick={() => void save()}>{saving ? "Saving…" : hasSecret ? `Change ${isPin ? "PIN" : "password"}` : `Set a ${isPin ? "PIN" : "password"}`}</Button>
  </div>;
}
