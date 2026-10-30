// WEATHER-HOME-ASK-01: a local city lookup for "Where is your home?". It reads the city-timezones data that
// ships with Home (offline, MIT), so typing a city or tapping "Use my location" sends nothing to any server.
// Coordinates leave this file rounded to 2 decimals (about 1 km), the precision weather needs and no more.
import { cityMapping, lookupViaCity, findFromCityStateProvince } from "city-timezones";

export interface LocalPlace { name: string; area: string | null; lat: number; lon: number; country: string; zone: string }

const round2 = (n: number): number => Number(n.toFixed(2));

function toPlace(c: { city: string; province: string; country: string; lat: number; lng: number; timezone: string }): LocalPlace {
  return { name: c.city, area: [c.province, c.country].filter(Boolean).join(", ") || null, lat: round2(c.lat), lon: round2(c.lng), country: c.country, zone: c.timezone };
}

/** Up to five cities for a typed name ("Seattle", "Springfield MO"), most populous first. */
export function searchLocalPlaces(query: string): LocalPlace[] {
  const q = query.trim();
  if (!q || q.length > 200) return [];
  const direct = lookupViaCity(q);
  const found = direct.length > 0 ? direct : findFromCityStateProvince(q);
  const seen = new Set<string>();
  return [...found].sort((a, b) => b.pop - a.pop).map(toPlace).filter((p) => {
    const key = `${p.name}|${p.area}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);
}

/** The gazetteer city nearest a point (haversine), weighted so a tiny town beside a big city does not win. Null for a point
 * that is not on Earth or when no city lies within 150 km. */
export function nearestLocalPlace(lat: number, lon: number): LocalPlace | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const rad = Math.PI / 180;
  let best: { c: (typeof cityMapping)[number]; score: number } | null = null;
  for (const c of cityMapping) {
    const dLat = (c.lat - lat) * rad, dLon = (c.lng - lon) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat * rad) * Math.cos(c.lat * rad) * Math.sin(dLon / 2) ** 2;
    const km = 12742 * Math.asin(Math.min(1, Math.sqrt(a)));
    if (km > 150) continue;
    const score = km - Math.log10(Math.max(c.pop, 1)) * 5;
    if (!best || score < best.score) best = { c, score };
  }
  return best ? toPlace(best.c) : null;
}
