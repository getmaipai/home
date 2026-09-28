import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export const LOOKS = ["neutral", "stone", "zinc", "mauve", "olive", "mist", "taupe", "navy"] as const;
export type Look = (typeof LOOKS)[number];

function isLook(value: unknown): value is Look {
  return (LOOKS as readonly unknown[]).includes(value);
}

/** Reads the person's selected `ui.look` value from the same settings
 * cache entry the generic Settings renderer writes. */
export function useLookValue(personId: string): Look {
  const scopeValue = `person:${personId}`;
  const query = useQuery({
    queryKey: ["settings-values", scopeValue],
    queryFn: () => api.settingsValues(scopeValue),
  });
  const found = query.data?.find((value) => value.key === "ui.look")?.value;
  return isLook(found) ? found : "neutral";
}
