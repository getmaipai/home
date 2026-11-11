import { i18n } from "@lingui/core";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { PromptBar } from "@maipai/ui/src/elements/prompt-bar";
import { Chip } from "@maipai/ui/src/primitives/Chip";
import { useSurface } from "@maipai/ui/src/useSurface";
import { api, type InstallStatusView } from "@/lib/api";
import { STARTER_SUGGESTIONS } from "@/apps/chat/chatStarterSuggestions";
import { engineDownReason, useChatAvailability } from "@/apps/chat/useChatAvailability";
import { installTitle } from "@/shell/InstallStrip";

const PLACEHOLDER = () => i18n._({ id: "Ask anything", message: "Ask anything" });
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

/** HOME-ALIVE-01h: the single kit composer and its three starter chips. */
export function AskBox({ focusOnRequest }: { focusOnRequest?: number }) {
  const navigate = useNavigate();
  const composerRef = useRef<HTMLDivElement>(null);
  const fine = useSurface().pointer === "fine";
  // Arriving on Home puts the cursor in the box (not on a touch screen, where it would pop the keyboard).
  useEffect(() => {
    const active = document.activeElement;
    if (fine && !(active instanceof HTMLElement && active.matches("input, textarea, select, [contenteditable='true']"))) composerRef.current?.querySelector<HTMLElement>("textarea, input")?.focus({ preventScroll: true });
  }, [fine]);
  useEffect(() => {
    if (focusOnRequest) composerRef.current?.querySelector<HTMLElement>("textarea, input")?.focus({ preventScroll: true });
  }, [focusOnRequest]);
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

  const submit = () => {
    const words = text.trim();
    if (words) navigate(askHref(words));
  };

  return (
    <div data-testid="home-ask" className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3">
      {down === undefined ? null : <img src="/setup-art/warming-up.webp" alt="" width={1312} height={1190} className="h-auto w-16 max-w-full sm:w-20" />}
      <div ref={composerRef} className="w-full">
        <PromptBar label={i18n._({ id: "Ask", message: "Ask" })} value={text} onValueChange={setText} placeholder={placeholder} maxLength={2000} fieldSize="large" layout="chat" shape="pill" submitLabel={i18n._({ id: "Send", message: "Send" })} onSubmit={submit} />
      </div>
      <div data-testid="home-suggestions" className="flex w-full flex-wrap justify-center gap-2">
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
