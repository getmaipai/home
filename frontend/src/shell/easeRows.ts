// EASE-OF-USE-01c polish: the display data for the Ease of use card's rows, passed to the kit renderer as
// `rowExtras`. Pure: a summary under the Look row ("Large + 2 changes") with a way back, and a lock reason
// on each row an admin set for the person. Home draws nothing itself.
export interface EaseValue {
  key: string;
  value: unknown;
  layer?: string;
  locked?: boolean;
}

export interface EaseRowExtras {
  note?: string;
  lockedReason?: string;
  action?: { label: string; onPress: () => void };
}

const LOCKED = "An admin set this for you. Ask them if you want it changed.";

/** Keys the person has changed on top of the Look (own value, not the "preset" follow value). */
export function easeChangedKeys(values: readonly EaseValue[]): string[] {
  return values.filter((v) => v.key.startsWith("ease.") && v.key !== "ease.preset" && v.layer === "person" && v.value !== "preset").map((v) => v.key);
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** `viewingSelf`: only the person themself is told a row is locked; an admin on someone else's page can change it. */
export function easeRowExtras(values: readonly EaseValue[], viewingSelf: boolean, resetKeys: (keys: string[]) => void): Record<string, EaseRowExtras> {
  const out: Record<string, EaseRowExtras> = {};
  if (viewingSelf) for (const v of values) if (v.key.startsWith("ease.") && v.locked) out[v.key] = { lockedReason: LOCKED };
  const preset = values.find((v) => v.key === "ease.preset");
  const changed = easeChangedKeys(values);
  if (preset && typeof preset.value === "string" && changed.length > 0) {
    const name = titleCase(preset.value);
    const free = changed.filter((k) => !(viewingSelf && values.find((v) => v.key === k)?.locked));
    out["ease.preset"] = {
      ...out["ease.preset"],
      note: `${name} + ${changed.length} ${changed.length === 1 ? "change" : "changes"}`,
      action: free.length > 0 ? { label: `Back to ${name}`, onPress: () => resetKeys(free) } : undefined,
    };
  }
  return out;
}
