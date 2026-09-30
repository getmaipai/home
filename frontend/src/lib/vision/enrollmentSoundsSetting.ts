// FACE-02M / FACE-02N: whether the face-capture sounds are on. ONE seam:
// the person's own `ui.enrollment_sounds` (boolean, default true, declared
// once in backend/src/settings/uiKeys.ts and getmaipai/commons's
// spec/settings/keys.json, drawn by the generic settings renderer under
// Profile, Appearance). Read from the same person-scoped values the page
// already fetches for the theme, so no second client and no second request.
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export const ENROLLMENT_SOUNDS_KEY = "ui.enrollment_sounds";

/** The setting from a person's resolved values; on when never set (the
 * key's own default) or when the stored value is not a boolean. */
export function enrollmentSoundsEnabled(values: { key: string; value: unknown }[]): boolean {
  const found = values.find((v) => v.key === ENROLLMENT_SOUNDS_KEY)?.value;
  return typeof found === "boolean" ? found : true;
}

/** Data wins: a failed background refetch keeps the earlier data, and must
 * never turn a stored "off" back on. With no data at all, a failed read
 * counts as the default (on); still loading is `null`. */
export function soundsFromQuery(data: { key: string; value: unknown }[] | undefined, isError: boolean): boolean | null {
  if (data) return enrollmentSoundsEnabled(data);
  return isError ? true : null;
}

/** `null` until the person's settings have answered, so the caller never
 * creates an audio context before it knows the person did not turn sounds
 * off. The query's default retries mean a failing first read takes a few
 * seconds to fall back to on; silent meanwhile is the safe side. */
export function useEnrollmentSoundsEnabled(personId: string): boolean | null {
  const query = useQuery({
    queryKey: ["settings-values", `person:${personId}`],
    queryFn: () => api.settingsValues(`person:${personId}`),
  });
  return soundsFromQuery(query.data, query.isError);
}
