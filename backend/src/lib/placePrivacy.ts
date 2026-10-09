const PRECISE_ADDRESS = /\d|\b(?:street|st\.?|avenue|ave\.?|road|rd\.?|drive|dr\.?|boulevard|blvd\.?|lane|ln\.?|court|ct\.?|highway|hwy\.?|apartment|apt\.?|unit|suite|ste\.?)\b/i;

/** Child place labels must remain broad even when a client sends a street
 * address in Entity.geo.area. Fall back to a generic area label rather
 * than echoing address-like text. */
export function childSafeAreaLabel(value: string | null | undefined): string {
  const label = value?.trim();
  if (!label || PRECISE_ADDRESS.test(label)) return "Approximate area";
  return label.slice(0, 120);
}
