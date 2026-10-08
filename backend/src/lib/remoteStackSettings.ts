import { isHouseholdNetworkHost } from "@maipai/core/src/net";
import { getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";

export const REMOTE_ENGINE_HOST_KEY = "engines.stack.remote.host";
export const REMOTE_ALLOW_TAILNET_KEY = "engines.stack.remote.allow_tailnet";
export const ENGINE_WHERE_KEY = "engines.stack.where";
export const REMOTE_ENGINE_ADDRESS_ERROR = "That address is outside your home network.";
export const REMOTE_ENGINE_TAILNET_ERROR = "That address is not on your home network or your Tailscale network.";
export const REMOTE_ENGINE_TAILNET_DISABLE_ERROR = "Change the address to one on your home network first.";

export type StackLinkControl = {
  stopLocalStack(): Promise<void>;
  startLocalStackAndClearLink(): Promise<void>;
};

const noStackLinkControl: StackLinkControl = {
  async stopLocalStack() {},
  async startLocalStackAndClearLink() {},
};

let stackLinkControl: StackLinkControl = noStackLinkControl;

export function setStackLinkControl(control: StackLinkControl): void {
  stackLinkControl = control;
}

export function __resetStackLinkControlForTests(): void {
  stackLinkControl = noStackLinkControl;
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

export async function applyEngineWhere(value: unknown): Promise<void> {
  if (value === "another_computer") await stackLinkControl.stopLocalStack();
  else if (value === "this_computer") {
    await stackLinkControl.startLocalStackAndClearLink();
    setHouseholdSettingValue(REMOTE_ENGINE_HOST_KEY, "");
  }
}
