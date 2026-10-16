// PLACE-WEATHER-01: the browser's current position for one chat turn.
// This never opens the permission prompt: it answers only when the browser
// already reports `granted` (the prompt belongs to the "Use current location"
// button in settings). Coordinates are rounded before they leave this file
// (two decimals, about 1 km; one decimal for a child) and are held only in
// memory for the one request: nothing is written to storage.
export interface CurrentLocation {
  lat: number;
  lon: number;
}

interface GeoDeps {
  permissions?: Pick<Permissions, "query">;
  geolocation?: Pick<Geolocation, "getCurrentPosition">;
}

export async function currentLocationIfGranted(ageBand: "adult" | "teen" | "child" | undefined, deps: GeoDeps = {}): Promise<CurrentLocation | undefined> {
  const permissions = deps.permissions ?? (typeof navigator === "undefined" ? undefined : navigator.permissions);
  const geolocation = deps.geolocation ?? (typeof navigator === "undefined" ? undefined : navigator.geolocation);
  if (!permissions || !geolocation) return undefined;
  try {
    const status = await permissions.query({ name: "geolocation" });
    if (status.state !== "granted") return undefined;
    const position = await new Promise<GeolocationPosition>((resolve, reject) => geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 3000, maximumAge: 10 * 60 * 1000 }));
    const decimals = ageBand === "child" ? 1 : 2;
    const round = (value: number) => Number(value.toFixed(decimals));
    return { lat: round(position.coords.latitude), lon: round(position.coords.longitude) };
  } catch {
    return undefined;
  }
}
