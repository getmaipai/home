import { i18n } from "@lingui/core";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { PromptBar } from "@maipai/ui/src/elements/prompt-bar";
import { Chip } from "@maipai/ui/src/primitives/Chip";
import { useSurface } from "@maipai/ui/src/useSurface";
import { api, type InstallStatusView } from "@/lib/api";
import { STARTER_SUGGESTIONS } from "@/apps/chat/chatStarterSuggestions";
import { engineDownReason, useChatAvailability } from "@/apps/chat/useChatAvailability";
import { installTitle } from "@/shell/InstallStrip";
import { composerHref, useComposerModes, useComposerState } from "@/shell/composer/composerModes";

const PLACEHOLDER = () => i18n._({ id: "Ask anything", message: "Ask anything" });
const STARTERS = STARTER_SUGGESTIONS.slice(0, 3);

/** The install strip's own line while an install is moving, else null (one wording, InstallStrip.tsx). */
export function installPlaceholder(status: InstallStatusView | undefined): string | null {
  if (!status?.state || status.state === "none" || status.state === "ready") return null;
  return installTitle(status);
}

/** Where Home sends words: Chat, with them in the composer, unsent (HOME-ALIVE-01h). */
export function askHref(text: string): string {
  return composerHref(null, text);
}

/** HOME-ALIVE-01h: the single kit composer and its three starter chips. */
export function AskBox({ focusOnRequest }: { focusOnRequest?: number }) {
  const navigate = useNavigate();
  const focusField = () => document.querySelector<HTMLElement>('[data-slot="prompt-bar"] textarea, [data-slot="prompt-bar"] input')?.focus({ preventScroll: true });
  const fine = useSurface().pointer === "fine";
  // Arriving on Home puts the cursor in the box (not on a touch screen, where it would pop the keyboard).
  useEffect(() => {
    const active = document.activeElement;
    if (fine && !(active instanceof HTMLElement && active.matches("input, textarea, select, [contenteditable='true']"))) focusField();
  }, [fine]);
  useEffect(() => {
    if (focusOnRequest) focusField();
  }, [focusOnRequest]);
  const [text, setText] = useState("");
  const response = useComposerModes();
  const composer = useComposerState(response, setText);
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
    if (!words) return;
    // The mode survives the trip: a Create mode opens its own Create page with the words and every chip value, Ask opens Chat (ONE-COMPOSER-2026-11-13).
    navigate(composerHref(composer.current.route, words, composer.current.route === null ? {} : composer.settings));
  };
  const modes = composer.kitModes.map((item) => (item.id === "ask" ? { ...item, placeholder } : item));

  return (
    <>
      {down === undefined ? null : <img src="/setup-art/warming-up.webp" alt="" width={1312} height={1190} className="h-auto w-16 max-w-full sm:w-20" />}
      <PromptBar label={i18n._({ id: "Ask", message: "Ask" })} value={text} onValueChange={setText} placeholder={placeholder} maxLength={2000} layout="chat" shape="pill" modes={modes} mode={composer.mode} onModeChange={composer.setMode} quality={composer.quality} disabledReason={composer.disabledReason} onSubmit={submit} />
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
    </>
  );
}
