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
import { useAppCatalog } from "@/shell/useAppCatalog";
import type { Roster } from "@/lib/api";

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

export function composerHref(mode: string, text: string): string {
  const prompt = text.trim();
  if (mode === "video") return `/apps/video/create?prompt=${encodeURIComponent(prompt)}`;
  if (mode === "song") return `/apps/audio/create?prompt=${encodeURIComponent(prompt)}`;
  if (mode === "picture") return `/chat?ask=${encodeURIComponent(prompt)}&mode=picture`;
  return askHref(prompt);
}

/** HOME-ALIVE-01h: the single kit composer and its three starter chips. */
export function AskBox({ focusOnRequest, role = "owner" }: { focusOnRequest?: number; role?: Roster["role"] }) {
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
  const [mode, setMode] = useState("ask");
  const catalog = useAppCatalog();
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
    navigate(composerHref(mode, words));
  };
  const modes = [
    { id: "ask", label: i18n._({ id: "Ask", message: "Ask" }), icon: "message-circle" as const, primaryLabel: i18n._({ id: "Send", message: "Send" }) },
    ...(role === "child" ? [] : [{ id: "picture", label: i18n._({ id: "Picture", message: "Picture" }), icon: "image" as const, primaryLabel: i18n._({ id: "Make picture", message: "Make picture" }) }]),
    ...(role === "child" || !catalog.some((app) => app.to === "/apps/video") ? [] : [{ id: "video", label: i18n._({ id: "Video", message: "Video" }), icon: "film" as const, primaryLabel: i18n._({ id: "Make video", message: "Make video" }) }]),
    ...(role === "child" || !catalog.some((app) => app.to === "/apps/audio") ? [] : [{ id: "song", label: i18n._({ id: "Song", message: "Song" }), icon: "music" as const, primaryLabel: i18n._({ id: "Make song", message: "Make song" }) }]),
  ];

  return (
    <>
      {down === undefined ? null : <img src="/setup-art/warming-up.webp" alt="" width={1312} height={1190} className="h-auto w-16 max-w-full sm:w-20" />}
      <PromptBar label={i18n._({ id: "Ask", message: "Ask" })} value={text} onValueChange={setText} placeholder={placeholder} maxLength={2000} layout="chat" shape="pill" modes={modes} mode={mode} onModeChange={setMode} submitLabel={modes.find((item) => item.id === mode)?.primaryLabel} onSubmit={submit} />
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
