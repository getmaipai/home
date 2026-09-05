import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, isOwnerOrAdminRole, type Roster, type CommandRow, type CommandAction } from "@/lib/api";
import { Section } from "@/kit/primitives/Section";
import { Input } from "@/kit/components/Input";
import { Button } from "@/kit/components/Button";
import { Select } from "@/kit/components/Select";
import { ROLE_LABELS, ROLE_LADDER, meetsMinRole } from "@/apps/people/roles";

interface CommandsSectionProps {
  person: Roster;
}

type ActionKind = CommandAction["kind"];
const ACTION_LABELS: Record<ActionKind, string> = {
  reply: "Say something back",
  home_call_service: "Control a smart-home device",
};

function summarize(action: CommandAction): string {
  if (action.kind === "reply") return `Replies: "${action.text}"`;
  const entityId = typeof action.target.entity_id === "string" ? action.target.entity_id : "?";
  return `Calls ${action.domain}.${action.service} on ${entityId}`;
}

// The command primitive's own settings surface (docs/dev.md: "The
// command primitive, shipped" - lib/commands.ts and its /api/commands
// routes existed with no UI to reach them until now). Household-wide
// list (any signed-in person, the same visibility GET /api/plugins
// already has); the create form only renders for a role that could
// actually create one (adult or higher - lib/commands.ts's own
// MIN_ROLE_TO_CREATE), the same "hide what would just 403" posture
// PeoplePage's own role gating already takes.
export function CommandsSection({ person }: CommandsSectionProps) {
  const [commands, setCommands] = useState<CommandRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [trigger, setTrigger] = useState("");
  const [minRole, setMinRole] = useState<string>("child");
  const [actionKind, setActionKind] = useState<ActionKind>("reply");
  const [replyText, setReplyText] = useState("");
  const [replySpeech, setReplySpeech] = useState("");
  const [domain, setDomain] = useState("");
  const [service, setService] = useState("");
  const [entityId, setEntityId] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function load() {
    setLoadError(null);
    try {
      setCommands(await api.commands());
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Could not load commands.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const canCreate = meetsMinRole(person.role, "adult");

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const action: CommandAction =
      actionKind === "reply"
        ? { kind: "reply", text: replyText, speech: replySpeech.trim() === "" ? undefined : replySpeech }
        : { kind: "home_call_service", domain, service, target: { entity_id: entityId } };
    setCreating(true);
    setCreateError(null);
    try {
      await api.createCommand({ trigger, minRole, action });
      setTrigger("");
      setReplyText("");
      setReplySpeech("");
      setDomain("");
      setService("");
      setEntityId("");
      await load();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Could not create that command.");
    } finally {
      setCreating(false);
    }
  }

  async function deleteCommand(id: string) {
    setPendingId(id);
    setActionError(null);
    try {
      await api.deleteCommand(id);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not delete that command.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <Section heading="Commands">
      <p className="text-base text-[hsl(var(--muted-foreground))]">
        Teach MaiPai a phrase of your own - "when I say X, do Y." A command always fires on an exact phrase, never a
        guess.
      </p>
      {loadError ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-base text-[hsl(var(--destructive))]">{loadError}</p>
          <Button variant="secondary" onClick={load}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          {canCreate ? (
            <form onSubmit={handleCreate} className="flex max-w-sm flex-col gap-3">
              <Input
                value={trigger}
                onChange={(e) => setTrigger(e.target.value)}
                placeholder='Trigger phrase, e.g. "movie night"'
                disabled={creating}
                required
              />
              <Select
                value={minRole}
                onValueChange={setMinRole}
                options={[...ROLE_LADDER]}
                getLabel={(v) => ROLE_LABELS[v as keyof typeof ROLE_LABELS]}
                aria-label="Who can trigger this command"
              />
              <Select
                value={actionKind}
                onValueChange={(v) => setActionKind(v as ActionKind)}
                options={["reply", "home_call_service"]}
                getLabel={(v) => ACTION_LABELS[v as ActionKind]}
                aria-label="What this command does"
              />
              {actionKind === "reply" ? (
                <>
                  <Input
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="What MaiPai says back"
                    disabled={creating}
                    required
                  />
                  <Input
                    value={replySpeech}
                    onChange={(e) => setReplySpeech(e.target.value)}
                    placeholder="Spoken version, if different (optional)"
                    disabled={creating}
                  />
                </>
              ) : (
                <>
                  <Input
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    placeholder="Home Assistant domain, e.g. light"
                    disabled={creating}
                    required
                  />
                  <Input
                    value={service}
                    onChange={(e) => setService(e.target.value)}
                    placeholder="Service, e.g. turn_off"
                    disabled={creating}
                    required
                  />
                  <Input
                    value={entityId}
                    onChange={(e) => setEntityId(e.target.value)}
                    placeholder="Entity id, e.g. light.living_room"
                    disabled={creating}
                    required
                  />
                </>
              )}
              {createError ? <p className="text-base text-[hsl(var(--destructive))]">{createError}</p> : null}
              <Button type="submit" disabled={creating} className="w-fit">
                {creating ? "Creating…" : "Create command"}
              </Button>
            </form>
          ) : null}
          {actionError ? <p className="text-base text-[hsl(var(--destructive))]">{actionError}</p> : null}
          {commands === null ? null : commands.length === 0 ? (
            <p className="text-base text-[hsl(var(--muted-foreground))]">No commands yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-[hsl(var(--border))]">
              {commands.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="flex flex-col">
                    <span className="text-base">"{c.trigger}"</span>
                    <span className="text-base text-[hsl(var(--muted-foreground))]">
                      {summarize(c.action)} - {ROLE_LABELS[c.minRole as keyof typeof ROLE_LABELS] ?? c.minRole} or higher
                    </span>
                  </div>
                  {isOwnerOrAdminRole(person.role) || c.creatorId === person.id ? (
                    <Button variant="secondary" disabled={pendingId === c.id} onClick={() => deleteCommand(c.id)}>
                      {pendingId === c.id ? "Deleting…" : "Delete"}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Section>
  );
}
