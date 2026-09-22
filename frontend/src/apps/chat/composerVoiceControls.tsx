"use client";

// SHELL-02 slice 6: the waveform+chevron live voice conversation
// control - HANDSFREE-01 (b) (docs/BACKLOG.md), owner ruling
// 2026-09-22: entered deliberately from the composer's waveform button,
// its chevron carrying voice selection. Built and unit-tested
// (composerVoiceControls.test.tsx) - it renders whenever stt+tts are
// both ready regardless of composerAddMenu.tsx's own unwired-controls
// flag, since it isn't gated by that flag at all: it isn't mounted in
// the real composer today, so there's no default view for the flag to
// hide it from. `ComposerAction`'s right
// group (the dictate mic, Send) has no append point the way its left
// group does (`ComposerAddAttachmentOverride`, commons ui-v0.5.34;
// `ComposerExtra`, ui-v0.5.31) - a `ComposerExtraEnd`-shaped slot is
// HANDSFREE-01's own gap to cut, alongside the real live voice session
// this control has nothing to drive yet (the vendored kit only carries
// the presentational `elements/voice.tsx`/`voice-conversation.tsx`,
// not upstream's runtime-wired `voice.aui.tsx`/`voice-conversation.aui.tsx`
// and `createVoiceSession()` - worth a look when that session gets
// built, not this slice's call). So this file's only consumer today is
// its own test.
import { useState } from "react";
import { DismissableLayer } from "radix-ui/internal";
import { useQuery } from "@tanstack/react-query";
import { VoiceOrb } from "@maipai/ui/src/elements/voice";
import { ComposerMenu, ComposerMenuItem } from "@maipai/ui/src/elements/composer";
import { Button } from "@maipai/ui/src/ui/button";
import { getIcon } from "@maipai/ui/src/icons";
import { titleCaseOption } from "@maipai/ui/src/settings/SettingField";
import { readyRole } from "@/apps/chat/engineRoles";
import { api, type EnginesOverview } from "@/lib/api";

const ChevronDownIcon = getIcon("chevron-down");

/** The waveform button: opens the live voice conversation mode (not
 * built here - see the file comment). `VoiceOrb`'s own `idle` state,
 * the same Element HANDSFREE-01's real session drives through its
 * `state`/`volume` props once it exists. */
function WaveformButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="icon-sm" aria-label="Start a voice conversation" onClick={onClick} className="overflow-hidden rounded-full p-0">
      <VoiceOrb state="idle" className="size-8" />
    </Button>
  );
}

/** The chevron: lists voices from GET /api/voice/catalog, the same
 * display convention Settings' own VoiceCatalogSection.tsx already
 * established (the file's basename as the name, `titleCaseOption` on
 * the collection) - no second naming scheme invented here. Selecting
 * one only sets local state today (no live session to hand it to). */
function VoiceChevron() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["voice-catalog"], queryFn: () => api.voiceCatalog() });
  const entries = query.data?.entries ?? [];
  const close = () => setOpen(false);
  return (
    <DismissableLayer.Root className="relative" onDismiss={open ? close : undefined}>
      <Button type="button" variant="ghost" size="icon-xs" aria-label="Choose a voice" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <ChevronDownIcon className="size-3.5" />
      </Button>
      <ComposerMenu open={open} inert={!open} align="end">
        {entries.map((entry) => {
          const name = entry.path.split("/").pop() ?? entry.path;
          return (
            <ComposerMenuItem
              key={entry.path}
              active={selected === entry.path}
              onClick={() => {
                setSelected(entry.path);
                close();
              }}
            >
              <span className="flex min-w-0 flex-1 flex-col text-start">
                <span className="font-medium">{name}</span>
                <span className="text-foreground/45 truncate text-base">{titleCaseOption(entry.collection)}</span>
              </span>
            </ComposerMenuItem>
          );
        })}
      </ComposerMenu>
    </DismissableLayer.Root>
  );
}

/** Renders only when both `stt` and `tts` roles are ready (HANDSFREE-01's
 * own acceptance: "voice and glance have no controls" without them) -
 * absent, not disabled, the same posture Create image and the composer
 * Attach's other role-gated rows already take. */
export function ComposerVoiceControls() {
  const enginesQuery = useQuery<EnginesOverview>({ queryKey: ["engines"], queryFn: () => api.engines() });
  const overview = enginesQuery.data;
  if (!readyRole(overview, "stt") || !readyRole(overview, "tts")) return null;
  return (
    <div className="flex items-center gap-1">
      <WaveformButton onClick={() => {}} />
      <VoiceChevron />
    </div>
  );
}
