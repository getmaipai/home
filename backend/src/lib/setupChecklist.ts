import { listActivePeople, isOwnerOrAdmin } from "@/lib/access";
import { listBiometricPrints } from "@/lib/biometricPrints";
import { getSmbTarget } from "@/lib/backupTargets";
import { hasRedeemedDeviceToken } from "@/lib/deviceTokens";
import { hasNonDefaultInstalledPackage } from "@/lib/plugins";
import { checkSearchInstance } from "@/lib/searchInstanceCheck";
import { effectiveMode } from "@/lib/retrieval/sourceMode";
import { getLinkCredentialStatus } from "@/lib/stack/linkKeys";
import { getSetupState } from "@/lib/setupState";
import { getHouseholdSettingSource, getHouseholdSettingValue, getPersonSettingSource, getPersonSettingValue } from "@/lib/settings";
import type { PersonRow } from "@/types";
import type { SetupChecklistItem } from "@/wire";

export const SETUP_CHECKLIST_ITEMS = [
  { id: "face-sign-in", title: "Set up face sign-in", reason: "A face print lets Home recognise you.", open: { label: "Open", href: "face" } },
  { id: "family", title: "Add your family", reason: "Home works best when everyone has their own account.", open: { label: "Open", href: "/settings/household?tab=people" } },
  { id: "backup-target", title: "Choose where backups go", reason: "A second place keeps a copy if this computer fails.", open: { label: "Open", href: "/settings/backups?tab=storage" } },
  { id: "phone-or-tablet", title: "Add a phone or tablet", reason: "Sign in on another device to use Home there.", open: { label: "Open", href: "/settings/profile?tab=profile" } },
  { id: "web-search", title: "Fix web search", reason: "Home cannot complete its web search check yet.", open: { label: "Open", href: "/settings/search?tab=search" } },
  { id: "apps", title: "Add apps", reason: "Add an app to give Home another useful skill.", open: { label: "Open", href: "/store" } },
  { id: "away-access", title: "Set up access away from home", reason: "Tailscale lets your family reach Home when they are away.", open: { label: "Open", href: "/setup/away" } },
  { id: "backup-key", title: "Save your backup key", reason: "This key helps restore your Home if this computer is lost.", open: { label: "Open", href: "/settings/backups?tab=storage" } },
  { id: "voice", title: "Choose a speaking voice", reason: "Home can read replies aloud in this voice.", open: { label: "Open", href: "/settings/home-voice?tab=voices" } },
  { id: "photos", title: "Turn on photo understanding", reason: "Home can help with photos when you ask.", open: { label: "Open", href: "/settings/ai?tab=overview" } },
  { id: "remote-engine", title: "Pair your remote AI computer", reason: "A paired computer can run Home's AI on another machine.", open: { label: "Open", href: "/settings/ai?tab=engines" } },
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
  const facePrints = owner ? listBiometricPrints(owner, owner.id) : null;
  const target = getSmbTarget();
  const hasDevice = hasRedeemedDeviceToken();
  const webIsOffline = effectiveMode("web", "adult") === "offline";
  const searchStatus = webIsOffline ? null : await checkSearchInstance({ updateRepairs: false });
  const searchWorks = webIsOffline || Boolean(searchStatus?.checks.length && searchStatus.checks.every((check) => check.state === "pass"));
  const state = getSetupState();
  const backupSaved = state.steps.some((step) => step.id === "backup_key" && step.status === "done");
  const voiceChosen = owner ? getPersonSettingSource(owner.id, "tts.voice_id") !== undefined : false;
  const photosOn = getHouseholdSettingValue("vision.on_request.enabled") === true && getHouseholdSettingSource("vision.on_request.enabled") !== undefined;
  const engineIsRemote = getHouseholdSettingValue("engines.stack.where") === "another_computer";
  const enginePaired = !engineIsRemote || getLinkCredentialStatus().paired;
  const appsAdded = hasNonDefaultInstalledPackage();
  const dismissed = dismissedIds(actor);

  const doneById: Record<(typeof SETUP_CHECKLIST_ITEMS)[number]["id"], boolean> = {
    "face-sign-in": Boolean(facePrints?.ok && facePrints.value.some((print) => print.modality === "face" && print.deleted_at === null)),
    family: activePeople.length > 1,
    "backup-target": target !== null,
    "phone-or-tablet": hasDevice,
    apps: appsAdded,
    "away-access": getHouseholdSettingValue("network.tailnet_access") === true,
    "backup-key": backupSaved,
    voice: voiceChosen,
    photos: photosOn,
    "web-search": searchWorks,
    "remote-engine": enginePaired,
  };

  return checklistFromFacts(doneById, new Set([...dismissed, ...(!engineIsRemote ? ["remote-engine"] : [])]));
}
