import { i18n } from "@lingui/core";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { getIcon } from "@maipai/ui/src/icons";
import { Chip } from "@maipai/ui/src/primitives/Chip";
import { useSurface } from "@maipai/ui/src/useSurface";
import { api, type InstallStatusView } from "@/lib/api";
import { STARTER_SUGGESTIONS } from "@/apps/chat/chatStarterSuggestions";
import { engineDownReason, useChatAvailability } from "@/apps/chat/useChatAvailability";
import { installTitle } from "@/shell/InstallStrip";

const PLACEHOLDER = () => i18n._({ id: "Ask anything", message: "Ask anything" });
const SparklesIcon = getIcon("sparkles");
const SendIcon = getIcon("arrow-up");
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
  const placeholder = installPlaceholder(install.data) ?? PLACEHOLDER();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const words = text.trim();
    if (words) navigate(askHref(words));
  };

  return (
    <div data-testid="home-ask" className="flex flex-col gap-3">
      {down === undefined ? null : <img src="/setup-art/warming-up.webp" alt="" width={1312} height={1190} className="h-auto w-16 max-w-full sm:w-20" />}
      <form onSubmit={submit} className="flex items-center gap-2">
        <Input ref={inputRef} value={text} onChange={(event) => setText(event.target.value)} placeholder={placeholder} aria-label={i18n._({ id: "Ask", message: "Ask" })} maxLength={2000} shape="pill" fill="surface" leading={<SparklesIcon />} />
        <Button type="submit" variant="ghost" shape="pill" size="icon-control" aria-label={i18n._({ id: "Send", message: "Send" })} aria-disabled={text.trim() === "" || undefined}><SendIcon aria-hidden /></Button>
      </form>
      <div data-testid="home-suggestions" className="flex w-full flex-nowrap gap-2 overflow-x-auto [&>*]:shrink-0 [&>*]:whitespace-nowrap [&::-webkit-scrollbar]:hidden">
        {STARTERS.map((starter) => (
          <Chip
            key={starter.title}
            tone="surface"
            size="strip"
            onClick={down === undefined ? () => navigate(askHref(starter.prompt)) : undefined}
            aria-disabled={down !== undefined || undefined}
          >
            {starter.title} {starter.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}
