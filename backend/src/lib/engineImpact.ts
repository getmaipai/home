/** A Stack supplied sizing choice. Home only words these measurements; it
 * never fills missing memory or speed figures with guesses. */
export interface EngineChoiceSize {
  id: string;
  label: string;
  memoryBytes: number | null;
  speed: "fast" | "steady" | "slow" | "not measured";
  loses?: string[];
}

export interface EngineRoleSizing {
  role: string;
  label: string;
  proposed: string;
  choices: EngineChoiceSize[];
}

export interface EngineSizingHardware {
  unifiedMemory: boolean;
  systemMemoryBytes: number | null;
  graphicsMemoryBytes: number | null;
}

export interface EngineImpactProposal {
  hardware: EngineSizingHardware;
  roles: EngineRoleSizing[];
  choices: Record<string, string>;
}

export interface EngineImpactResult {
  fits: boolean | null;
  availableBytes: number | null;
  usedBytes: number | null;
  freedBytes: number;
  roles: Array<{ role: string; label: string; choice: string; memoryBytes: number | null; speed: string; impact: string }>;
  refusal: string | null;
  memoryQuestion: string | null;
  trade: string | null;
}

const GB = 1024 ** 3;
const wordsForBytes = (bytes: number): string => `${(bytes / GB).toFixed(1)} GB`;

/** Explain a proposed allocation using only measurements reported by the
 * Stack. Unified-memory machines share system and graphics memory; other
 * machines are sized from graphics memory alone. */
export function engineImpact(proposal: EngineImpactProposal): EngineImpactResult {
  const { hardware } = proposal;
  const availableBytes = hardware.unifiedMemory
    ? hardware.systemMemoryBytes !== null && hardware.graphicsMemoryBytes !== null
      ? hardware.systemMemoryBytes + hardware.graphicsMemoryBytes
      : null
    : hardware.graphicsMemoryBytes;
  const knownAvailableBytes = availableBytes !== null && Number.isFinite(availableBytes) && availableBytes > 0 ? availableBytes : null;

  const chosen = proposal.roles.map((role) => {
    const choiceId = proposal.choices[role.role] ?? role.proposed;
    const choice = choiceId === "off" ? null : role.choices.find((item) => item.id === choiceId);
    return { role, choiceId, choice };
  });
  const unknown = chosen.filter(({ choiceId, choice }) => choiceId !== "off" && (!choice || choice.memoryBytes === null));
  const usedBytes = chosen.reduce((sum, item) => sum + (item.choice?.memoryBytes ?? 0), 0);
  const proposedChoices = proposal.roles.map((role) => role.choices.find((item) => item.id === role.proposed));
  const proposedKnown = proposal.roles.every((role, index) => role.proposed === "off" || (proposedChoices[index] !== undefined && proposedChoices[index]!.memoryBytes !== null));
  const proposedBytes = proposedChoices.reduce((sum, choice) => sum + (choice?.memoryBytes ?? 0), 0);
  const freedBytes = Math.max(0, proposedBytes - usedBytes);
  const fits = unknown.length || knownAvailableBytes === null ? null : usedBytes <= knownAvailableBytes;
  const roles = chosen.map(({ role, choiceId, choice }) => {
    const loss = choice?.loses?.length ? ` This choice gives up ${choice.loses.join(" and ")}.` : "";
    const speed = choice?.speed ?? "off";
    const useLine = choiceId === "off" ? `${role.label} is off and keeps no model memory.` : choice?.memoryBytes === null || !choice ? `Memory use for ${role.label.toLowerCase()} has not been measured.` : `Keeps ${wordsForBytes(choice.memoryBytes)} for ${role.label.toLowerCase()}; expected speed is ${speed}.`;
    return { role: role.role, label: role.label, choice: choiceId, memoryBytes: choice?.memoryBytes ?? (choiceId === "off" ? 0 : null), speed, impact: `${useLine}${loss}` };
  });
  const refusal = fits === false ? `These choices need ${wordsForBytes(usedBytes)}, but this computer can give ${wordsForBytes(knownAvailableBytes!)} to models. Turn down ${roles.filter((role) => role.choice !== "off").map((role) => role.label).join(", ")} to make them fit.` : unknown.length ? `Memory use has not been measured for ${unknown.map(({ role }) => role.label).join(", ")}.` : null;
  const trade = proposedKnown && freedBytes > 0 ? `${wordsForBytes(freedBytes)} freed. Turn off pictures and chat can use a bigger model, which may answer better.` : null;
  return { fits, availableBytes: knownAvailableBytes, usedBytes: unknown.length ? null : usedBytes, freedBytes: proposedKnown ? freedBytes : 0, roles, refusal, memoryQuestion: knownAvailableBytes === null ? "The computer's model memory limit has not been measured." : null, trade };
}
