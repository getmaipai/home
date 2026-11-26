// STACK-LORAS-01 slice 4 (docs/plans/stack-owns-loras-2026-11-25.md): the Styles tab of Settings, Pictures, videos and music. The Stack holds the library, so this
// is the one shared Styles page (`StackLorasPage` in `@maipai/ui`) over Home's pass-through, the same page the Stack's own admin shows. What stays Home's: the
// redaction (an adult-only style is ONE locked tile until the person's own unlock proof is valid; a teen, a child or a guest is sent no adult-only name), the per-person
// style picker in Create and chat, and the adult-lock prompts. `children` is the sources and keys list the Settings card adds below.
import { i18n } from "@lingui/core";
import { useMemo, type ReactNode } from "react";
import { StackLorasPage } from "@maipai/ui/src/stack/StackLorasPage";
import type { Card as SpecCard } from "@maipai/ui/src/settings/settingsAudience";
import type { Roster } from "@/lib/api";
import { createHomeLorasClient } from "@/lib/stackLorasClient";

const NOT_ADULT = "Only an adult owner or admin can change styles.";

/**
 * The page asks for a ticket when someone makes an adult-only style all-ages, but cannot say which style. Home only lets that page be opened with the Adult lock
 * open, and for a style the source did not call adult its server issues the real single-use ticket itself; a style the source called adult is refused there with the
 * passcode sentence. So the page's own ask is answered with a plain marker, never a secret.
 */
const askTicket = async (): Promise<string | null> => "home";

export function StylesTab({ person, card, children }: { person: Roster; card?: SpecCard; children?: ReactNode }) {
  // One client per mounted page: the shared page keeps one cache per client object.
  const client = useMemo(() => createHomeLorasClient(), []);
  const adult = person.role === "owner" || person.role === "admin";
  return (
    <div className="flex min-w-0 flex-col gap-8" data-testid="styles-tab">
      {card?.description ? <p className="text-sm text-muted-foreground">{card.description}</p> : null}
      <StackLorasPage client={client} locked={adult ? null : i18n._({ id: NOT_ADULT, message: NOT_ADULT })} askTicket={askTicket} />
      {children}
    </div>
  );
}
