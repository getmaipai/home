// STACK-MENU-SYNC-01: the Stack's screens, from the one menu definition in the spec (`spec/stack/screens.json`, shared with the Stack's admin
// page). Home keeps no list of its own: a tab draws the screens the file assigns to it.
import screensFile from "@maipai/spec/stack/screens.json";
import { areaText } from "@/lib/settingCopy";

export interface StackScreen { id: string; label: string; question: string; group: string; tab: string; kit: string | null }

export const STACK_SCREENS: readonly StackScreen[] = screensFile.screens as StackScreen[];

/** Screens Home already draws with a page that is not a kit page over a `StackClient` (the engines console under Models). They get no stub. */
export const DRAWN_BY_HOME: ReadonlySet<string> = new Set(["engines"]);

/** The screens of one tab that have no page here yet: each is a stub with the screen's title, its question and the link to the Stack admin. */
export function stubScreensOf(tab: string): StackScreen[] {
  return STACK_SCREENS.filter((screen) => screen.tab === tab && screen.kit === null && !DRAWN_BY_HOME.has(screen.id));
}

export const screenLabel = (screen: StackScreen): string => areaText(screen.label);
export const screenQuestion = (screen: StackScreen): string => areaText(screen.question);
