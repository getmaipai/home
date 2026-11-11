export interface LibraryVoice { id: string; name: string; detail: string; gender: "woman" | "man" | "neutral"; language: string; languageName: string; country: string | null; countryName: string | null; quality: "good" | "great" | "best"; attribution: string; sampleUrl: string }
export interface VoiceLibraryFilters { q?: string; gender?: string; country?: string; quality?: string }
/** Mirrors backend searchVoiceLibrary. */
export function filterVoiceLibrary(voices: LibraryVoice[], filters: VoiceLibraryFilters): LibraryVoice[] {
  const q = filters.q?.trim().toLocaleLowerCase();
  return voices.filter((v) => (!q || [v.name, v.detail, v.countryName ?? "", v.languageName].some((s) => s.toLocaleLowerCase().includes(q)))
    && (!filters.gender || filters.gender === v.gender) && (!filters.country || filters.country === v.country)
    && (!filters.quality || filters.quality === v.quality));
}
