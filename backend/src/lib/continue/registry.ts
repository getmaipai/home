// MEDIA-PROGRESS-01 (design section 12, "Resume and continue"): the Home page's "Pick up where you left off" shelf reads chats and
// media progress through one `continue` provider registry. A provider returns only the signed-in person's own rows, newest first; the
// registry merges them and applies the shelf's budget (three rows). Nothing here reads another person's rows, so a child's shelf can
// never show a parent's, and a guest gets none.
import type { PersonRow } from "@/types";

export const CONTINUE_BUDGET = 3;

export interface ContinueRow {
  /** Which provider made the row. */
  source: string;
  kind: "chat" | "media";
  id: string;
  title: string;
  subtitle: string | null;
  /** Where the shelf sends the person. Chats: `/chat?conversation=<id>`. Media: `/media/<item id>`, which the shell resolves to the app. */
  href: string;
  /** When the person last touched it (ISO). */
  at: string;
  /** Media only: how far along, 0 to 100, when known. */
  percent: number | null;
  media_kind: string | null;
  artwork_url: string | null;
}

export type ContinueProvider = (actor: PersonRow, limit: number) => ContinueRow[];

const providers = new Map<string, ContinueProvider>();

export function registerContinueProvider(name: string, provider: ContinueProvider): void {
  providers.set(name, provider);
}

export function __clearContinueProvidersForTests(): void {
  providers.clear();
}

export function continueRows(actor: PersonRow, limit: number = CONTINUE_BUDGET): ContinueRow[] {
  if (actor.role === "guest" || limit <= 0) return [];
  const rows: ContinueRow[] = [];
  for (const [name, provider] of providers) {
    try {
      rows.push(...provider(actor, limit).map((row) => ({ ...row, source: name })));
    } catch {
      // One provider failing leaves the others on the shelf.
    }
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
