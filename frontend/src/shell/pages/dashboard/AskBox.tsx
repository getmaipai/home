import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@maipai/ui/src/dashboard/components/ui/input-group";
import { api, type InstallStatusView } from "@/lib/api";
import { STARTER_SUGGESTIONS } from "@/apps/chat/chatStarterSuggestions";
import { engineDownReason, useChatAvailability } from "@/apps/chat/useChatAvailability";
import { installTitle } from "@/shell/InstallStrip";

const PLACEHOLDER = "Ask anything";
const STARTERS = STARTER_SUGGESTIONS.slice(0, 3);

/** The install strip's own line while an install is moving, else null (one wording, InstallStrip.tsx). */
export function installPlaceholder(status: InstallStatusView | undefined): string | null {
  if (!status?.state || status.state === "none" || status.state === "ready") return null;
  return installTitle(status);
}

/** Where Home sends words: Chat, with them in the composer, unsent (HOME-ALIVE-01h). */
export function askHref(text: string): string {
  return `/chat?ask=${encodeURIComponent(text)}`;
}

/** HOME-ALIVE-01h: the ask box and three starters, built from kit primitives only (rule 9b). */
export function AskBox() {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const availability = useChatAvailability();
  const down = engineDownReason(availability);
  const install = useQuery({
    queryKey: ["install-status"],
    queryFn: api.installStatus,
    retry: false,
    refetchInterval: (current) => {
      const state = current.state.data?.state;
      return state === undefined || state === "none" || state === "ready" ? 30_000 : 2_000;
    },
  });
  const placeholder = installPlaceholder(install.data) ?? PLACEHOLDER;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const words = text.trim();
    if (words) navigate(askHref(words));
  };

  return (
    <div data-testid="home-ask" className="flex flex-col gap-3">
      {down === undefined ? null : <img src="/setup-art/warming-up.webp" alt="" width={1312} height={1190} className="h-auto w-24 max-w-full sm:w-32" />}
      <form onSubmit={submit}>
        <InputGroup>
          <InputGroupInput value={text} onChange={(event) => setText(event.target.value)} placeholder={placeholder} aria-label="Ask" maxLength={2000} />
          <InputGroupAddon align="inline-end">
            <InputGroupButton type="submit" variant="default" size="sm" disabled={text.trim() === ""}>Ask</InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
      <div className="flex flex-wrap gap-2">
        {STARTERS.map((starter) => (
          <Button
            key={starter.title}
            type="button"
            variant="outline"
            size="sm"
            disabled={down !== undefined}
            aria-label={down === undefined ? undefined : `${starter.title} ${starter.label}. ${down}`}
            onClick={() => navigate(askHref(starter.prompt))}
          >
            {starter.title} {starter.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
