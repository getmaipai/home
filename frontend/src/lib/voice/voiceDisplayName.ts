// VOICE-LIVE-03b: Jesse's live read of the composer's chevron (2026-09-23)
// found the catalog listed raw file names like
// "zerocool_enhanced.wav.1e68beda@240.safetensors" - the catalog record
// itself carries no name/title field at all (VoiceCatalogEntry,
// backend/src/lib/voiceCatalog.ts, confirmed against the Hugging Face
// tree API's own response shape: just `path` and `collection`), so this
// derives a readable name from the file stem instead of inventing a
// field the catalog doesn't have. Strips one trailing real extension,
// then one trailing content-hash segment some donated files carry (a
// dot, 6+ hex characters, an optional @<number>), then a real extension
// again if the hash sat between two of them (the donation case above:
// ".wav.1e68beda@240.safetensors"), and turns underscores into spaces.
// One definition, used by every place the catalog is listed (Settings'
// own VoiceCatalogSection.tsx today).
//
// A review (2026-09-23) found the hash pattern matched a real word that
// happens to use only hex letters (a-f) - "facade", "decade", "deface"
// are all 6+ letters, all valid hex digits, and would have been
// silently deleted. A genuine hash is effectively random bytes, so a
// 6+ character run with no digit at all is vanishingly unlikely
// (roughly a 1-in-500 chance even at exactly 6 characters, rarer at
// longer lengths); requiring at least one digit in the match is the
// distinguishing signal between "a hash" and "an English word that
// happens to fit in hex."
const REAL_EXTENSIONS = [".safetensors", ".wav", ".mp3"];
const HASH_SUFFIX = /\.(?=[0-9a-f]*[0-9])[0-9a-f]{6,}(?:@\d+)?$/i;

function stripRealExtension(stem: string): string {
  const lower = stem.toLowerCase();
  for (const ext of REAL_EXTENSIONS) {
    if (lower.endsWith(ext)) return stem.slice(0, -ext.length);
  }
  return stem;
}

export function voiceDisplayName(path: string): string {
  let stem = path.split("/").pop() ?? path;
  stem = stripRealExtension(stem);
  stem = stem.replace(HASH_SUFFIX, "");
  stem = stripRealExtension(stem);
  return stem.replace(/_/g, " ");
}
