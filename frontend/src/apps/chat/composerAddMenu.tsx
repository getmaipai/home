"use client";

// SHELL-02 slice 6: the composer's "+" menu (Add: photos and files, a
// phone's camera; behind the unwired-controls flag: Create image, Web
// search, and Apps - see that flag's own comment below) and the
// context that carries a chosen app into the next send. Composed only
// from shipped pieces: `ComposerPrimitive` (real
// assistant-ui runtime primitives), `elements/composer.tsx`'s
// `ComposerMenu`/`ComposerMenuItem`/`ComposerAttachButton` (the same
// presentational primitives `ComposerThinkingControl` in
// NextChatPage.tsx already composes, same `DismissableLayer` dismiss
// pattern - a design-resolver ruling, 2026-09-22, docs/dev.md, after
// Popover was found to fight `ComposerMenu`'s own positioning), and the
// kit's `IconTile`/`getIcon` (the same icon source `apps/library/
// AppsPage.tsx`'s `kindStyle()` already established for a package's
// kind - manifests carry no icon field of their own).
//
// This is the composer's ONE "+" control (`ComposerAddAttachmentOverride`,
// commons ui-v0.5.34): the shipped bare `ComposerAddAttachment` button
// would otherwise render right beside it, a second "+" doing something
// different - see commons commit d438eac.
import { createContext, useContext, useState, type ComponentProps, type ComponentType } from "react";
import { DismissableLayer } from "radix-ui/internal";
import { ComposerPrimitive } from "@assistant-ui/react";
import { useComposerAddAttachment } from "@assistant-ui/core/react";
import { useQuery } from "@tanstack/react-query";
import { ComposerAttachButton, ComposerMenu, ComposerMenuItem } from "@maipai/ui/src/elements/composer";
import { IconTile } from "@maipai/ui/src/primitives/IconTile";
import { getIcon } from "@maipai/ui/src/icons";
import { kindStyle } from "@/apps/library/AppsPage";
import { readyRole } from "@/apps/chat/engineRoles";
import { api, type EnginesOverview, type InstalledPackage } from "@/lib/api";

// Owner ruling relayed by the coordinator, 2026-09-22: don't ship a
// control with nothing real behind it. Web search as an explicit tool
// and app-scoping's actual effect on the turn both need turn-request
// fields `routes/turn.ts` doesn't carry yet (U2's own scope, the old
// turn path is frozen - see docs/BACKLOG.md's U2 rows); Create image
// has no generation tool, route, or wire field at all, not just an
// unready role. Apps joined this list live, 2026-09-22 (Jesse): every
// installed package listed here (taller than the screen) with no real
// effect from picking one, the same underlying gap as Web search's -
// gating the group itself is the honest fix, not just the effect. All
// four render and are unit-tested with the flag forced on
// (`__setUnwiredControlsForTests`, below) - never in a real
// household's default view until their own wire lands.
let unwiredControlsEnabled = false;

export function unwiredControlsAreEnabled(): boolean {
  return unwiredControlsEnabled;
}

/** A code review (SHELL-02 slice 6) caught this: with no code path
 * anywhere setting the flag true, "unit-tested... with the flag
 * forced on" had nothing in the tree to prove it. The same
 * `__resetXForTests`-shaped test-only setter `llmSupervisor.ts`/
 * `documentExtraction.ts` already use. */
export function __setUnwiredControlsForTests(enabled: boolean): void {
  unwiredControlsEnabled = enabled;
}

/** Lifted the same way `ThinkingModeContext`/`BareModeContext` are
 * (NextChatPage.tsx): `useChatRuntimeHook`'s adapter deps read this via
 * a ref, single-shot, the same `consumeSupersedes()` shape - chosen
 * once, ridden on the next send, then cleared, never a mode that
 * outlives the turn it was picked for. */
export const PackageScopeContext = createContext<{ scope: InstalledPackage | null; setScope: (pkg: InstalledPackage | null) => void }>({
  scope: null,
  setScope: () => {},
});

const CameraIcon = getIcon("camera");
const FileTextIcon = getIcon("file-text");
const SearchIcon = getIcon("search");
const SparklesIcon = getIcon("sparkles");

function ComposerAddMenuItem({ icon, name, description, ...props }: { icon: ComponentType<{ className?: string }>; name: string; description: string } & Omit<ComponentProps<typeof ComposerMenuItem>, "children">) {
  const Icon = icon;
  return (
    <ComposerMenuItem {...props}>
      <Icon className="text-foreground/35 size-4 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col text-start">
        <span className="font-medium">{name}</span>
        <span className="text-foreground/45 truncate text-base">{description}</span>
      </span>
    </ComposerMenuItem>
  );
}

function GroupLabel({ children }: { children: string }) {
  return <div className="text-foreground/40 px-2.5 pt-2 pb-1 text-base font-medium uppercase tracking-wide first:pt-1">{children}</div>;
}

/** Add photos and files: the shipped `ComposerPrimitive.AddAttachment`
 * (opens the native file picker, accepts whatever the runtime's
 * attachments adapter declares - images plus text/Markdown, per
 * `useNextChatRuntime`'s own `CompositeAttachmentAdapter`), styled as a
 * menu row via `asChild` instead of its own bare button. */
function AddPhotosAndFilesItem({ onSelect }: { onSelect: () => void }) {
  return (
    <ComposerPrimitive.AddAttachment asChild>
      <ComposerAddMenuItem icon={FileTextIcon} name="Add photos and files" description="Images, text, and Markdown files" onClick={onSelect} />
    </ComposerPrimitive.AddAttachment>
  );
}

/** Take a photo: no shipped Element or primitive exposes the file
 * input's native `capture` attribute (`ComposerPrimitive.AddAttachment`
 * builds its own hidden input with no way to set it - checked against
 * the primitive's own source, `@assistant-ui/react`'s
 * `ComposerAddAttachment.js`). Composed instead from the same public
 * `useComposerAddAttachment()` hook that primitive itself calls
 * internally, adding only the native HTML attribute - no new visual
 * component, the menu row is the same shipped `ComposerMenuItem`.
 * Phone-only (`capture` has no meaning on a desktop file dialog): CSS
 * hides it above the phone breakpoint, the same `sm:hidden` convention
 * already used for touch-only controls elsewhere in the shell. */
function TakeAPhotoItem({ onSelect }: { onSelect: () => void }) {
  const { addAttachment, disabled } = useComposerAddAttachment();
  const openCamera = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.capture = "environment";
    input.hidden = true;
    const cleanup = () => {
      if (document.body.contains(input)) document.body.removeChild(input);
    };
    input.onchange = async () => {
      const file = input.files?.[0];
      cleanup();
      if (file) await addAttachment(file);
    };
    // A code review caught this: the input's own `cancel` event has
    // patchy cross-browser support (Safari only gained it in 16.4) -
    // the window regaining focus is the reliable cross-browser signal
    // that the native camera sheet closed, picked or not. `cleanup()`
    // already ran for a real pick (`onchange`, above); this is only
    // the fallback for "closed with nothing chosen", and a no-op by
    // then either way (`contains` guards it).
    window.addEventListener("focus", cleanup, { once: true });
    document.body.appendChild(input);
    input.click();
  };
  return (
    <ComposerAddMenuItem
      icon={CameraIcon}
      name="Take a photo"
      description="Use this device's camera"
      className="sm:hidden"
      disabled={disabled}
      onClick={() => {
        openCamera();
        onSelect();
      }}
    />
  );
}

function CreateImageItem({ overview, onSelect }: { overview: EnginesOverview | undefined; onSelect: () => void }) {
  if (!unwiredControlsAreEnabled()) return null;
  if (!readyRole(overview, "image")) return null;
  return <ComposerAddMenuItem icon={SparklesIcon} name="Create image" description="Generate a picture for this reply" onClick={onSelect} />;
}

function WebSearchItem({ onSelect }: { onSelect: () => void }) {
  if (!unwiredControlsAreEnabled()) return null;
  return <ComposerAddMenuItem icon={SearchIcon} name="Web search" description="Search the web for this reply" onClick={onSelect} />;
}

function AppsGroup({ onSelect }: { onSelect: (pkg: InstalledPackage) => void }) {
  // Found live, 2026-09-22 (Jesse): every installed package (timer,
  // trivia, math, lock the door, lights off, convert, write a
  // document, and on) listed here, taller than the screen - and
  // choosing one does nothing today, since app-scoping's actual
  // effect on the turn sits behind the same unwired-controls flag as
  // Create image/Web search (consumePackageScope's own comment,
  // chatModelAdapter.ts). Gated the same way: the group itself, not
  // just its effect, until U2 makes scoping real.
  const query = useQuery<InstalledPackage[]>({ queryKey: ["plugins"], queryFn: () => api.plugins() });
  if (!unwiredControlsAreEnabled()) return null;
  // Every other NextChatPage test's own fetch stub answers an endpoint
  // it doesn't know about with a bare `{}` (its own established
  // convention, e.g. `stubFetch()` above) - this menu now mounts on
  // every one of those renders, so a non-array response here is a real
  // case this component meets constantly, not a hypothetical.
  const apps = (Array.isArray(query.data) ? query.data : []).filter((pkg) => pkg.status === "enabled");
  if (apps.length === 0) return null;
  return (
    <>
      <GroupLabel>Apps</GroupLabel>
      {apps.map((pkg) => {
        const style = kindStyle(pkg.kind);
        return (
          <ComposerMenuItem key={pkg.id} onClick={() => onSelect(pkg)}>
            <IconTile icon={style.icon} hue={style.hue} size="sm" glow={false} />
            <span className="flex min-w-0 flex-1 flex-col text-start">
              <span className="font-medium">{pkg.display}</span>
              <span className="text-foreground/45 truncate text-base">{pkg.description}</span>
            </span>
          </ComposerMenuItem>
        );
      })}
    </>
  );
}

export function ComposerAddMenu() {
  const [open, setOpen] = useState(false);
  const { setScope } = useContext(PackageScopeContext);
  const enginesQuery = useQuery<EnginesOverview>({ queryKey: ["engines"], queryFn: () => api.engines() });
  const close = () => setOpen(false);
  return (
    <DismissableLayer.Root className="relative" onDismiss={open ? close : undefined}>
      <ComposerAttachButton aria-label="Add" aria-expanded={open} onClick={() => setOpen((value) => !value)} />
      <ComposerMenu open={open} inert={!open} align="start">
        <GroupLabel>Add</GroupLabel>
        <AddPhotosAndFilesItem onSelect={close} />
        <TakeAPhotoItem onSelect={close} />
        <CreateImageItem overview={enginesQuery.data} onSelect={close} />
        <WebSearchItem onSelect={close} />
        <AppsGroup
          onSelect={(pkg) => {
            setScope(pkg);
            close();
          }}
        />
      </ComposerMenu>
    </DismissableLayer.Root>
  );
}
