import type { VoiceCatalogEntry } from "@/lib/voiceCatalog";
import { VCTK_SPEAKERS } from "@/lib/voiceLibraryData";

export interface LibraryVoice {
  id: string;
  name: string;
  detail: string;
  gender: "woman" | "man" | "neutral";
  language: "en";
  languageName: "English";
  country: string | null;
  countryName: string | null;
  quality: "good" | "great" | "best";
  sizeMb: number | null;
  attribution: string;
  licence: "CC BY 4.0";
  sampleUrl: string;
}

const attribution = "Voice Cloning Toolkit, University of Edinburgh; recordings by the Centre for Speech Technology Research. CC BY 4.0.";
const countryByAccent: Record<string, { code: string; name: string }> = {
  English: { code: "GB", name: "England" }, Scottish: { code: "GB-SCT", name: "Scotland" },
  Welsh: { code: "GB-WLS", name: "Wales" }, NorthernIrish: { code: "GB-NIR", name: "Northern Ireland" },
  Irish: { code: "IE", name: "Ireland" }, American: { code: "US", name: "United States" },
  Canadian: { code: "CA", name: "Canada" }, Australian: { code: "AU", name: "Australia" },
  NewZealand: { code: "NZ", name: "New Zealand" }, SouthAfrican: { code: "ZA", name: "South Africa" }, Indian: { code: "IN", name: "India" },
};
const properPlaces = new Set(["Southern England", "South England", "Southeast England", "Southwest England", "Northeast England", "Yorkshire", "Surrey", "Cumbria", "Stockton-on-Tees", "Staffordshire", "Manchester", "Fife", "Belfast", "Perth", "London", "Dublin", "Selkirk", "Argyll", "Aberdeen", "Edinburgh", "Cardiff", "Galloway", "Birmingham", "Nottingham", "Orkney", "West Lothian", "Ross", "Athlone", "Newcastle", "Midlothian", "Suffolk", "Essex", "Oxford", "Cheshire", "Leicester", "Cork", "York", "Tipperary", "San Francisco", "New York", "California", "North Carolina", "Montreal", "Toronto", "Philadelphia", "Ontario", "Alabama", "Tennessee", "Iowa", "Hamilton", "Cape Town", "Alberta", "Napa", "Pretoria", "Sydney", "Indiana", "Chicago", "Johannesburg", "Pennsylvania", "Ohio", "Derry", "Florida", "Donegal", "New Jersey"]);
function titleCase(s: string): string { return s.toLowerCase().replace(/\b[a-z]/g, (x) => x.toUpperCase()); }
function normalizedRegion(s: string): string {
  const value = s.replace(/\s+/g, " ").trim().replace(/^SW England$/, "Southwest England").replace(/^SE England$/, "Southeast England").replace(/^NE England$/, "Northeast England");
  return titleCase(value);
}

export function buildVoiceLibrary(entries: VoiceCatalogEntry[]): LibraryVoice[] {
  const paths = new Set(entries.filter((e) => e.collection === "vctk" && e.path.startsWith("vctk/")).map((e) => e.path));
  const result: LibraryVoice[] = [];
  for (const speaker of VCTK_SPEAKERS) {
    const enhanced = `vctk/${speaker.id}_023_enhanced.wav`;
    const plain = `vctk/${speaker.id}_023.wav`;
    const id = paths.has(enhanced) ? enhanced : paths.has(plain) ? plain : null;
    if (!id) continue;
    const country = countryByAccent[speaker.accent];
    const region = normalizedRegion(speaker.region);
    const where = region && properPlaces.has(region) ? region : country?.name ?? "accent not recorded";
    const gender = speaker.gender;
    const name = where === "accent not recorded" ? `${titleCase(gender)}, accent not recorded` : `${where} ${gender}`;
    const decade = `${Math.floor(speaker.age / 10) * 10}s`;
    const detailWhere = country?.name ?? "accent not recorded";
    result.push({ id, name, detail: `${titleCase(gender)}, ${detailWhere}, ${decade}`, gender, language: "en", languageName: "English", country: country?.code ?? null, countryName: country?.name ?? null, quality: id === enhanced ? "best" : "good", sizeMb: null, attribution, licence: "CC BY 4.0", sampleUrl: `/api/voice/library/sample?path=${encodeURIComponent(id)}` });
  }
  const seen = new Map<string, number>();
  for (const voice of result) {
    const key = voice.name.toLocaleLowerCase();
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count > 1) voice.name = `${voice.name} ${count}`;
  }
  const countrySort = (v: LibraryVoice) => v.countryName ?? "ZZZ";
  return result.sort((a, b) => countrySort(a).localeCompare(countrySort(b)) || a.name.localeCompare(b.name));
}

export interface VoiceLibraryFilters { q?: string; gender?: string; language?: string; country?: string; quality?: string; }
export function searchVoiceLibrary(voices: LibraryVoice[], filters: VoiceLibraryFilters): LibraryVoice[] {
  const q = filters.q?.trim().toLocaleLowerCase();
  return voices.filter((v) => (!q || [v.name, v.detail, v.countryName ?? "", v.languageName].some((s) => s.toLocaleLowerCase().includes(q)))
    && (!filters.gender || filters.gender === v.gender)
    && (!filters.language || filters.language === v.language)
    && (!filters.country || filters.country === v.country)
    && (!filters.quality || filters.quality === v.quality));
}
