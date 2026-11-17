import { i18n } from "@lingui/core";
import { useContext, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { PromptBar } from "@maipai/ui/src/elements/prompt-bar";
import { MediaHostContext } from "@maipai/ui/src/schema/mediaHost";
import { Chip } from "@maipai/ui/src/primitives/Chip";
import { useSurface } from "@maipai/ui/src/useSurface";
import { api, type InstallStatusView } from "@/lib/api";
import { engineDownReason, useChatAvailability } from "@/apps/chat/useChatAvailability";
import { installTitle } from "@/shell/InstallStrip";
import { composerHref, useComposerModes, useComposerState } from "@/shell/composer/composerModes";
import { useHomeMusic } from "@/shell/composer/homeMusicModes";
import { suggestionsFor } from "@/shell/composer/modeSuggestions";

const PLACEHOLDER = () => i18n._({ id: "Ask anything", message: "Ask anything" });

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
  // A reference slot of the chosen mode (the picture's Image reference) is filled here the same way a Create page fills it: the host's picker, then the id travels to that page.
  const mediaHost = useContext(MediaHostContext);
  const music = useHomeMusic(() => mediaHost?.pickMedia?.("audio") ?? Promise.resolve(null), () => setText(""), response.band === "adult");
  const [picked, setPicked] = useState<Record<string, Array<{ id: string; thumb?: string }>>>({});
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
    const carried = Object.fromEntries(composer.current.references.flatMap((ref) => (picked[ref.id]?.length ? [[ref.id, picked[ref.id]!.map((choice) => choice.id).join(",")]] : [])));
    navigate(composerHref(composer.current.route, words, composer.current.route === null ? {} : { ...composer.settings, ...music.settingsFor(composer.current.id), ...carried }));
  };
  const pickInto = (refId: string, kind: "picture" | "character" | "place" | "audio" | "video") => {
    if (!mediaHost?.pickMedia) return;
    const ref = composer.current.references.find((item) => item.id === refId);
    const max = ref?.max ?? 1;
    const current = picked[refId] ?? [];
    if (current.length >= max) return;
    void mediaHost.pickMedia(kind).then((got) => { if (got && !current.some((choice) => choice.id === got.id)) setPicked((all) => ({ ...all, [refId]: [...(all[refId] ?? []), got].slice(0, max) })); }, () => {});
  };
  const first = composer.current.references[0];
  const modes = composer.kitModes.map((item) => {
    // Song and Sound effect draw the Song page's own fields (one definition, musicMode), not the hub list's words-only record.
    const own = music.modeFor(item.id);
    if (own) return own;
    if (item.id === "ask") return { ...item, placeholder };
    if (item.id !== composer.mode || !first || !mediaHost?.pickMedia) return item;
    return {
      ...item,
      onAdd: () => pickInto(first.id, first.kind),
      references: composer.current.references.map((ref) => ({
        id: ref.id, label: ref.label, kind: ref.kind, ...(ref.max ? { max: ref.max } : {}),
        value: picked[ref.id]?.map((choice) => choice.id).join(",") ?? null, thumbs: picked[ref.id]?.map((choice) => choice.thumb),
        onPick: () => pickInto(ref.id, ref.kind),
        onRemove: (id?: string) => setPicked((all) => { const next = { ...all }; const remaining = id ? (all[ref.id] ?? []).filter((choice) => choice.id !== id) : []; if (remaining.length) next[ref.id] = remaining; else delete next[ref.id]; return next; }),
      })),
    };
  });

  return (
    <>
      {down === undefined ? null : <img src="/setup-art/warming-up.webp" alt="" width={1312} height={1190} className="h-auto w-16 max-w-full sm:w-20" />}
      <PromptBar label={i18n._({ id: "Ask", message: "Ask" })} value={text} onValueChange={setText} placeholder={placeholder} maxLength={2000} layout="chat" shape="pill" modes={modes} mode={composer.mode} onModeChange={composer.setMode} quality={music.qualityFor(composer.mode) ?? composer.quality} disabledReason={composer.disabledReason} onSubmit={submit} />
      <div data-testid="home-suggestions" className="mt-4 flex w-full flex-wrap justify-center gap-2">
        {suggestionsFor(composer.mode).map((starter) => (
          <Chip
            key={starter.title}
            tone="surface"
            size="strip"
            onClick={down === undefined ? () => (composer.mode === "ask" ? navigate(askHref(starter.prompt)) : (setText(starter.prompt), focusField())) : undefined}
            aria-disabled={down !== undefined || undefined}
          >
            {starter.title} {starter.label}
          </Chip>
        ))}
      </div>
    </>
  );
}
