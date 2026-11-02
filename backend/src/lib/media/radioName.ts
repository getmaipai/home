// One definition of how a radio station's name is shown (RADIO-NAME-01). Stations publish whole slogans and web addresses as their
// name, so every door that ingests, saves or serves a station name goes through `cleanStationName`: the directory rows, a station being
// saved, and an already saved station read back. Nothing is stored twice; the saved record keeps whatever was saved and is cleaned on read.

export const STATION_NAME_MAX = 40;
const ELLIPSIS = "…";
const ADDRESS = /\b(?:https?:\/\/|www\.)\S+/gi;
// A tagline starts after one of these (spaces around it, so "AC/DC Radio" and "Radio 1-2" stay whole).
const SEPARATOR = /\s+(?:[-–—|:/•·~]+|::)\s+/;

const squash = (value: string): string => value.replace(/\s+/g, " ").trim();

function capped(name: string): string {
  if (name.length <= STATION_NAME_MAX) return name;
  const room = name.slice(0, STATION_NAME_MAX - 1);
  const space = room.lastIndexOf(" ");
  const cut = space >= 12 ? room.slice(0, space) : room;
  return `${cut.replace(/[\s,;:.\-|]+$/, "")}${ELLIPSIS}`;
}

/** The name to show for a station: no web addresses, no long tagline, at most 40 characters. */
export function cleanStationName(raw: string): string {
  const flat = squash(raw);
  const withoutAddress = squash(flat.replace(ADDRESS, " "));
  let name = withoutAddress === "" ? flat : withoutAddress;
  if (name.length > STATION_NAME_MAX) {
    const front = squash(name.split(SEPARATOR)[0] ?? "");
    if (front.length >= 3 && front.length <= STATION_NAME_MAX) name = front;
  }
  return capped(name);
}
