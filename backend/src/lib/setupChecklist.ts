import { listActivePeople, isOwnerOrAdmin } from "@/lib/access";
import { checkSearchInstance } from "@/lib/searchInstanceCheck";
import { effectiveMode } from "@/lib/retrieval/sourceMode";
import { getLinkCredentialStatus } from "@/lib/stack/linkKeys";
import { getSetupState } from "@/lib/setupState";
import { getHouseholdSettingSource, getHouseholdSettingValue, getPersonSettingSource, getPersonSettingValue } from "@/lib/settings";
import type { PersonRow } from "@/types";
import type { SetupChecklistItem } from "@/wire";

export const SETUP_CHECKLIST_ITEMS = [
  { id: "backup-key", title: "Save your backup key", reason: "This key helps restore your Home if this computer is lost.", open: { label: "Open", href: "/settings/home/storage" } },
  { id: "voice", title: "Choose a speaking voice", reason: "Home can read replies aloud in this voice.", open: { label: "Open", href: "/settings/home/voice" } },
  { id: "photos", title: "Turn on photo understanding", reason: "Home can help with photos when you ask.", open: { label: "Open", href: "/settings/home/ai" } },
  { id: "people", title: "Add people to your Home", reason: "Each person gets their own account and settings.", open: { label: "Open", href: "/settings/home/people" } },
  { id: "web-search", title: "Set up web search", reason: "Web search helps Home look up current information.", open: { label: "Open", href: "/settings/home/search" } },
  { id: "remote-engine", title: "Pair your remote AI computer", reason: "A paired computer can run Home's AI on another machine.", open: { label: "Open", href: "/settings/home/ai" } },
] as const;

export type SetupChecklist = SetupChecklistItem[];
type ChecklistId = (typeof SETUP_CHECKLIST_ITEMS)[number]["id"];

export function checklistFromFacts(doneById: Record<ChecklistId, boolean>, dismissed: ReadonlySet<string> = new Set()): SetupChecklist {
  return SETUP_CHECKLIST_ITEMS
    .filter((item) => !dismissed.has(item.id))
    .map((item) => ({ ...item, done: doneById[item.id] }));
}

const DISMISSED_CHECKLIST_KEY = "setup.checklist_dismissed";

function dismissedIds(actor: PersonRow): Set<string> {
  const raw = getPersonSettingValue(actor, DISMISSED_CHECKLIST_KEY);
  if (typeof raw !== "string") return new Set();
  try {
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values)) return new Set();
    return new Set(values.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set();
  }
}

/** Facts for the owner and admin setup checklist. The item definition is
 * kept together so a later fact adds one entry here. */
export async function getSetupChecklist(actor: PersonRow): Promise<SetupChecklist> {
  if (!isOwnerOrAdmin(actor)) return [];
  const activePeople = listActivePeople();
  const owner = activePeople.find((person) => person.role === "owner");
  const webIsOffline = effectiveMode("web", "adult") === "offline";
  const searchStatus = webIsOffline ? null : await checkSearchInstance({ updateRepairs: false });
  const searchWorks = webIsOffline || Boolean(searchStatus?.checks.length && searchStatus.checks.every((check) => check.state === "pass"));
  const state = getSetupState();
  const backupSaved = state.steps.some((step) => step.id === "backup_key" && step.status === "done");
  const voiceChosen = owner ? getPersonSettingSource(owner.id, "tts.voice_id") !== undefined : false;
  const photosOn = getHouseholdSettingValue("vision.on_request.enabled") === true && getHouseholdSettingSource("vision.on_request.enabled") !== undefined;
  const engineIsRemote = getHouseholdSettingValue("engines.stack.where") === "another_computer";
  const enginePaired = !engineIsRemote || getLinkCredentialStatus().paired;
  const dismissed = dismissedIds(actor);

  const doneById: Record<(typeof SETUP_CHECKLIST_ITEMS)[number]["id"], boolean> = {
    "backup-key": backupSaved,
    voice: voiceChosen,
    photos: photosOn,
    people: activePeople.length > 1,
    "web-search": searchWorks,
    "remote-engine": enginePaired,
  };

  return checklistFromFacts(doneById, dismissed);
}
