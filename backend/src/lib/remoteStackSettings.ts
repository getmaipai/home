import { isHouseholdNetworkHost } from "@maipai/core/src/net";
import { getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";
import { getEngineLink, startEngineLink, stopEngineLink, type LinkConfig } from "@/lib/stack/link";
import { startLocalStackService, stopLocalStackService } from "@/lib/localStackService";
import { getLinkKeyPaths } from "@/lib/stack/linkKeys";
import { reportStackLinkState, resetStackLinkRepairs } from "@/lib/stack/linkRepairs";

export const REMOTE_ENGINE_HOST_KEY = "engines.stack.remote.host";
export const REMOTE_ALLOW_TAILNET_KEY = "engines.stack.remote.allow_tailnet";
export const ENGINE_WHERE_KEY = "engines.stack.where";
export const REMOTE_ENGINE_ADDRESS_ERROR = "That address is outside your home network. Enter the engine computer's name or its home network address, for example 192.168.1.20.";
export const REMOTE_ENGINE_TAILNET_ERROR = "That address is not on your home network or your Tailscale network.";
export const REMOTE_ENGINE_TAILNET_DISABLE_ERROR = "Change the address to one on your home network first.";

export type StackLinkControl = {
  stopLocalStack(): Promise<void>;
  startLocalStackAndClearLink(): Promise<void>;
  startLink(): void;
  stopLink(): void;
  refreshLink(): void;
};

const realStackLinkControl: StackLinkControl = {
  async stopLocalStack() { stopLocalStackService(); },
  async startLocalStackAndClearLink() { startLocalStackService(); },
  startLink() { startConfiguredEngineLink(); },
  stopLink() { resetStackLinkRepairs(); stopEngineLink(); },
  refreshLink() {
    if (getHouseholdSettingValue(ENGINE_WHERE_KEY) === "another_computer") startConfiguredEngineLink();
    else { resetStackLinkRepairs(); stopEngineLink(); }
  },
};

let stackLinkControl: StackLinkControl = realStackLinkControl;

export function setStackLinkControl(control: StackLinkControl): void {
  stackLinkControl = { ...realStackLinkControl, ...control };
}

export function __resetStackLinkControlForTests(): void {
  stackLinkControl = realStackLinkControl;
}

export async function validateRemoteEngineSetting(key: string, value: unknown): Promise<string | null> {
  if (key === REMOTE_ALLOW_TAILNET_KEY && value === false) {
    const host = getHouseholdSettingValue(REMOTE_ENGINE_HOST_KEY);
    if (typeof host === "string" && host && !(await isHouseholdNetworkHost(host))) return REMOTE_ENGINE_TAILNET_DISABLE_ERROR;
  }
  if (key !== REMOTE_ENGINE_HOST_KEY || typeof value !== "string" || !value.trim()) return null;
  const allowTailnet = getHouseholdSettingValue(REMOTE_ALLOW_TAILNET_KEY) === true;
  const accepted = await isHouseholdNetworkHost(value, { allowTailnet });
  return accepted ? null : allowTailnet ? REMOTE_ENGINE_TAILNET_ERROR : REMOTE_ENGINE_ADDRESS_ERROR;
}

// ENGINES-AI-01: the choice is already saved when this runs, so a service step that cannot run must never turn the
// save into a 500 (it did: a Home with no local Stack service installed threw "binary is missing" from the stop
// step, the PUT answered "Internal Server Error", the control snapped back and "Where the engine runs" looked
// impossible to switch). Each step is tried on its own; one that fails is reported by name, with no text from
// the person, and the rest still run. The link and the Status screen show whether the engine is reachable.
async function bestEffort(step: string, run: () => void | Promise<void>): Promise<void> {
  try { await run(); }
  catch { console.warn(`[engine-where] the "${step}" step could not run; the engine choice is saved. Open Status to see whether the engine is reachable.`); }
}

export async function applyEngineWhere(value: unknown): Promise<void> {
  if (value === "another_computer") {
    await bestEffort("stop the engine on this computer", () => stackLinkControl.stopLocalStack());
    await bestEffort("start the link to the engine computer", () => stackLinkControl.startLink());
  }
  else if (value === "this_computer") {
    await bestEffort("stop the link to the engine computer", () => stackLinkControl.stopLink());
    await bestEffort("start the engine on this computer", () => stackLinkControl.startLocalStackAndClearLink());
    setHouseholdSettingValue(REMOTE_ENGINE_HOST_KEY, "");
  }
}

/** The tunnel's config from the saved settings; the key files are where the pairing wrote them (`getLinkKeyPaths`, the one definition). */
export function configuredLink(): LinkConfig | null {
  const { privateKeyPath, knownHostsPath } = getLinkKeyPaths();
  const host = getHouseholdSettingValue(REMOTE_ENGINE_HOST_KEY);
  if (typeof host !== "string" || !host.trim()) return null;
  const numberSetting = (key: string, fallback: number) => {
    const value = getHouseholdSettingValue(key);
    return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65535 ? value : fallback;
  };
  return {
    host: host.trim(),
    sshPort: numberSetting("engines.stack.remote.ssh_port", 22),
    localPort: numberSetting("engines.stack.remote.local_port", 8771),
    allowTailnet: getHouseholdSettingValue(REMOTE_ALLOW_TAILNET_KEY) === true,
    privateKeyPath,
    knownHostsPath,
  };
}

function startConfiguredEngineLink(): void {
  const config = configuredLink();
  if (config) startEngineLink(config, { onState: reportStackLinkState });
  else { resetStackLinkRepairs(); stopEngineLink(); }
}

setStackLinkControl(realStackLinkControl);

/** Called at boot: invalid or incomplete pairing must not hold up Home. */
export function startConfiguredEngineLinkIfSelected(): void {
  if (getHouseholdSettingValue(ENGINE_WHERE_KEY) !== "another_computer") {
    resetStackLinkRepairs();
    stopEngineLink();
    return;
  }
  startConfiguredEngineLink();
}

/** Settings changes that affect the active route or tunnel restart it in place. */
export function refreshConfiguredEngineLink(): void { realStackLinkControl.refreshLink(); }

/** Pairing changes the SSH identity material, so discard any pre-pair
 * supervisor and build a new one from the newly pinned credentials. */
export function rebuildEngineLinkAfterPairing(): void {
  stackLinkControl.stopLink();
  stackLinkControl.refreshLink();
}

/** The link is synchronous to stop; this adapter matches shutdown hook semantics. */
export function stopConfiguredEngineLink(): void { resetStackLinkRepairs(); stopEngineLink(); }
