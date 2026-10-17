import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@maipai/ui/src/dashboard/components/ui/input-group";
import { HitField } from "@maipai/ui/src/settings/HitField";
import { useSurface } from "@maipai/ui/src/useSurface";
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
  const inputRef = useRef<HTMLInputElement>(null);
  const fine = useSurface().pointer === "fine";
  // Arriving on Home puts the cursor in the box (not on a touch screen, where it would pop the keyboard).
  useEffect(() => {
    const active = document.activeElement;
    if (fine && !(active instanceof HTMLElement && active.matches("input, textarea, select, [contenteditable='true']"))) inputRef.current?.focus({ preventScroll: true });
  }, [fine]);
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
          {/* The field sits in the kit's HitField label (a 48 px target for a text input); the button is the
              kit's row size (28 px box, 48 px hit area). The span keeps the addon's negative end margin off
              the group's edge (it only applies to a direct button child). The button is aria-disabled, not
              disabled, while the box is empty: a disabled control fades the whole group (kit has-disabled), and
              the faded placeholder fails WCAG contrast. An empty submit does nothing (see submit). */}
          <HitField pad={10} className="flex-1">
            <InputGroupInput ref={inputRef} value={text} onChange={(event) => setText(event.target.value)} placeholder={placeholder} aria-label="Ask" maxLength={2000} />
          </HitField>
          <InputGroupAddon align="inline-end">
            <span className="flex">
              <Button type="submit" variant="default" size="row" aria-disabled={text.trim() === "" || undefined}>Ask</Button>
            </span>
          </InputGroupAddon>
        </InputGroup>
      </form>
      <div className="flex flex-wrap gap-x-2 gap-y-5">
        {STARTERS.map((starter) => (
          <Button
            key={starter.title}
            type="button"
            variant="outline"
            size="row"
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
