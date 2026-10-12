import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { resolveEaseAttributes, type EaseAttributes } from "@/shell/easeResolve";

// EASE-OF-USE-01c: the person's ease of use settings become the five data-ease-* attributes on <html>
// that the kit's generated token blocks (ui/scripts/gen-ease-tokens.ts) are keyed on. Home sets attributes only.

/** Applies the signed-in person's resolved ease settings to <html>. */
export function useEase(personId: string): EaseAttributes {
  const scope = `person:${personId}`;
  const query = useQuery({ queryKey: ["settings-values", scope], queryFn: () => api.settingsValues(scope) });
  const values: Record<string, unknown> = {};
  for (const item of query.data ?? []) if (item.key.startsWith("ease.")) values[item.key] = item.value;
  const attributes = resolveEaseAttributes(values);
  // Until the settings arrive, leave <html> as it is: applying Standard first would flash the wrong size and contrast.
  const signature = query.data ? JSON.stringify(attributes) : "";

  useEffect(() => {
    if (!signature) return;
    const root = document.documentElement;
    const applied = JSON.parse(signature) as EaseAttributes;
    for (const [attribute, value] of Object.entries(applied)) root.setAttribute(attribute, value);
    return () => {
      for (const attribute of Object.keys(applied)) root.removeAttribute(attribute);
    };
  }, [signature]);

  return attributes;
}
