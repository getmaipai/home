"use client";

// SHELL-02 slice 6: the waveform+chevron live voice conversation
// control - HANDSFREE-01 (b) (docs/BACKLOG.md), owner ruling
// 2026-09-22: entered deliberately from the composer's waveform button,
// its chevron carrying voice selection. Built and unit-tested
// (composerVoiceControls.test.tsx) - it renders whenever stt+tts are
// both ready regardless of composerAddMenu.tsx's own unwired-controls
// flag, since it isn't gated by that flag at all. VOICE-LIVE-01
// (commons ui-v0.5.36) cut the `ComposerExtraEnd` slot `ComposerAction`'s
// right group (the dictate mic, Send) was missing - `NextChatPage.tsx`
// mounts this component there now. The real live voice session this
// control has nothing to drive yet (the vendored kit only carries the
// presentational `elements/voice.tsx`/`voice-conversation.tsx`, not
// upstream's runtime-wired `voice.aui.tsx`/`voice-conversation.aui.tsx`
// and `createVoiceSession()`) is VOICE-LIVE-02's own scope, not this
// file's.
import { useEffect, useState } from "react";
import { DismissableLayer } from "radix-ui/internal";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { VoiceOrb } from "@maipai/ui/src/elements/voice";
import { ComposerMenu, ComposerMenuItem } from "@maipai/ui/src/elements/composer";
import { Button } from "@maipai/ui/src/ui/button";
import { getIcon } from "@maipai/ui/src/icons";
import { titleCaseOption } from "@maipai/ui/src/settings/SettingField";
import { readyRole } from "@/apps/chat/engineRoles";
import { api, type EnginesOverview, type ResolvedSetting } from "@/lib/api";
import { readMicDevicePreference, writeMicDevicePreference } from "@/lib/voice/micDevicePreference";

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

// composerAddMenu.tsx's own unexported GroupLabel, matched exactly
// (the same section-header convention already used for the composer's
// other multi-group menu) rather than a second style invented here -
// not imported, since that file doesn't export it.
function GroupLabel({ children }: { children: string }) {
  return <div className="text-foreground/40 px-2.5 pt-2 pb-1 text-base font-medium uppercase tracking-wide first:pt-1">{children}</div>;
}

/** `MediaDeviceInfo.label` is empty until mic permission has been
 * granted at least once (browsers refuse to leak hardware names before
 * that) - the honest fallback name every OS does the same thing for.
 * Never the raw `deviceId` (VOICE-LIVE-03's own "names shown without
 * hardware ids"). */
function micLabel(device: MediaDeviceInfo, index: number): string {
  return device.label || `Microphone ${index + 1}`;
}

/** VOICE-LIVE-03: the microphones the browser reports, refreshed on
 * `devicechange` (a device plugged in or removed while the menu is
 * open) - `enumerateDevices()` itself needs no permission prompt to
 * call, only to return real labels (see `micLabel` above), so this
 * never triggers one on its own; a household member sees real names
 * only once dictation has asked for the mic at least once this
 * browser. `navigator.mediaDevices` itself is `undefined` in an
 * insecure context (a review, 2026-09-23: a self-hosted hub reached
 * over plain-HTTP LAN, a plausible way to open it, not just a test
 * environment) - guarded here rather than letting `ComposerVoiceControls`
 * (already mounted on every chat page load once stt+tts are ready)
 * throw on mount. */
function useAudioInputDevices(): MediaDeviceInfo[] {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    if (!navigator.mediaDevices) return;
    let cancelled = false;
    const refresh = () => {
      navigator.mediaDevices
        .enumerateDevices()
        .then((all) => {
          if (!cancelled) setDevices(all.filter((d) => d.kind === "audioinput"));
        })
        .catch(() => {
          if (!cancelled) setDevices([]);
        });
    };
    refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener("devicechange", refresh);
    };
  }, []);
  return devices;
}

/** The microphone group: `RESP-04 (f)`'s own ruling ("a control with
 * fewer than two selectable entries renders nothing at all, never a
 * disabled trigger") applies here too - a single mic is the common
 * household case (one laptop, no external input) and there is nothing
 * real to choose between. Selecting one writes the per-browser
 * preference (`micDevicePreference.ts`) the dictation adapter reads on
 * its own next session - it never re-opens the CURRENT session's
 * already-live stream. */
function MicrophoneGroup({ close }: { close: () => void }) {
  const devices = useAudioInputDevices();
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    setSelected(readMicDevicePreference());
  }, []);
  if (devices.length < 2) return null;
  return (
    <>
      <GroupLabel>Microphone</GroupLabel>
      {devices.map((device, index) => (
        <ComposerMenuItem
          key={device.deviceId}
          active={selected === device.deviceId}
          onClick={() => {
            writeMicDevicePreference(device.deviceId);
            setSelected(device.deviceId);
            close();
          }}
        >
          <span className="min-w-0 flex-1 truncate text-start font-medium">{micLabel(device, index)}</span>
        </ComposerMenuItem>
      ))}
    </>
  );
}

/** The chevron: lists voices from GET /api/voice/catalog, the same
 * display convention Settings' own VoiceCatalogSection.tsx already
 * established (the file's basename as the name, `titleCaseOption` on
 * the collection) - no second naming scheme invented here. Selecting
 * one writes the person's real `tts.voice_id` setting through the same
 * `POST /api/voice/catalog/select` route `VoiceCatalogSection.tsx`
 * already calls (VOICE-LIVE-03: "choosing a voice changes the next
 * spoken reply" - no second mechanism, the setting IS what the next
 * `POST /api/tts` call reads server-side). The initial selection reads
 * that same setting back (`GET /api/settings?scope=person:<id>`),
 * mirroring `VoiceCatalogSection.tsx`'s own `expand()` - so a chosen
 * catalog voice still shows as chosen next time the menu opens,
 * instead of starting blank every mount.
 *
 * VOICE-LIVE-03's third clause - a wake-word shortcut, only when a
 * wakeword package is installed - has nothing to point at yet: there
 * is no settings key for a device's wake-word choice anywhere in the
 * registry (HANDSFREE-01 (c) is its own unbuilt row), and no "wakeword
 * package" install concept exists either (only a Stack engine ROLE of
 * that name, a different thing). The absent case is what this file
 * implements today - honestly, since nothing is ever "installed" by
 * that definition yet - and the present case is HANDSFREE-01 (c)'s own
 * item to build the key this menu would then read. */
function catalogPathFromSettings(values: ResolvedSetting[] | undefined): string | null {
  const voice = values?.find((v) => v.key === "tts.voice_id");
  const value = typeof voice?.value === "string" ? voice.value : null;
  return value?.startsWith("hf://kyutai/tts-voices/") ? value.replace("hf://kyutai/tts-voices/", "") : null;
}

function VoiceChevron({ personId }: { personId: string }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const settingsKey = ["settings-values", `person:${personId}`] as const;
  const catalogQuery = useQuery({ queryKey: ["voice-catalog"], queryFn: () => api.voiceCatalog() });
  const currentQuery = useQuery({ queryKey: settingsKey, queryFn: () => api.settingsValues(`person:${personId}`) });
  const entries = catalogQuery.data?.entries ?? [];
  const close = () => setOpen(false);

  useEffect(() => {
    setSelected(catalogPathFromSettings(currentQuery.data));
  }, [currentQuery.data]);

  async function selectVoice(path: string): Promise<void> {
    setSelected(path);
    close();
    try {
      // Patches the cache in place from the write's own response, the
      // same pattern NextSettingsRenderer.tsx's replaceValue() already
      // uses for a settings write - no second GET only to re-derive a
      // value the POST response already carried.
      const updated = await api.selectVoiceFromCatalog(path);
      queryClient.setQueryData<ResolvedSetting[]>(settingsKey, (prev) => (prev ?? []).map((v) => (v.key === updated.key ? updated : v)));
    } catch {
      // A review (2026-09-23): the menu doesn't remount on open, so
      // nothing was actually re-reading `currentQuery` to correct a
      // failed optimistic pick - rolling back to the cache's own last
      // known-good value directly, rather than the comment's stale
      // claim that reopening the menu alone would fix it. No toast for
      // a composer-menu pick, the same quiet-retry posture
      // ComposerThinkingControl's own session-only choice already has.
      setSelected(catalogPathFromSettings(queryClient.getQueryData<ResolvedSetting[]>(settingsKey)));
    }
  }

  return (
    <DismissableLayer.Root className="relative" onDismiss={open ? close : undefined}>
      <Button type="button" variant="ghost" size="icon-xs" aria-label="Choose a voice" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <ChevronDownIcon className="size-3.5" />
      </Button>
      <ComposerMenu open={open} inert={!open} align="end">
        {entries.map((entry) => {
          const name = entry.path.split("/").pop() ?? entry.path;
          return (
            <ComposerMenuItem key={entry.path} active={selected === entry.path} onClick={() => void selectVoice(entry.path)}>
              <span className="flex min-w-0 flex-1 flex-col text-start">
                <span className="font-medium">{name}</span>
                <span className="text-foreground/45 truncate text-base">{titleCaseOption(entry.collection)}</span>
              </span>
            </ComposerMenuItem>
          );
        })}
        <MicrophoneGroup close={close} />
      </ComposerMenu>
    </DismissableLayer.Root>
  );
}

/** Renders only when both `stt` and `tts` roles are ready (HANDSFREE-01's
 * own acceptance: "voice and glance have no controls" without them) -
 * absent, not disabled, the same posture Create image and the composer
 * Attach's other role-gated rows already take. */
export function ComposerVoiceControls({ personId }: { personId: string }) {
  const enginesQuery = useQuery<EnginesOverview>({ queryKey: ["engines"], queryFn: () => api.engines() });
  const overview = enginesQuery.data;
  if (!readyRole(overview, "stt") || !readyRole(overview, "tts")) return null;
  return (
    <div className="flex items-center gap-1">
      <WaveformButton onClick={() => {}} />
      <VoiceChevron personId={personId} />
    </div>
  );
}

