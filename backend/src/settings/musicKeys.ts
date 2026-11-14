// MUSIC-GEN-03: the household's music control (docs/design/music-generation-2026-10-17.md, section 9).
// Declared here like the video keys (videoKeys.ts) and identical to the pinned spec's entry; it shows on the same
// Settings card, Pictures, videos and music. Children and teens never make songs whatever this says
// (lib/music/policy.ts): it is a control for adults only, and the minor line has no key.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const MUSIC_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: "music.lyrics_online", scope: "household", selector: "boolean", default: true,
    label: "Look up song lyrics online",
    help: "When someone opens Lyrics for a song with no words, Home sends its title, artist, album and length once per song to look them up. Never for songs made at home or for a child.",
    level: "advanced", secret: false, lives_in: "household.media_lookups", honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "music.musicbrainz_match", scope: "household", selector: "boolean", default: true,
    label: "Match my songs to MusicBrainz",
    help: "In the background, Home sends each library song's title, artist, album and track number to MusicBrainz, about one song a second, to find its public MusicBrainz id. Nothing else leaves your home. Off stops it; ids already found stay.",
    level: "advanced", secret: false, lives_in: "household.media_lookups", honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "music.artist_wikimedia", scope: "household", selector: "boolean", default: true,
    label: "Show facts and photos from Wikimedia",
    help: "In the background, Home asks Wikidata, Wikipedia and Wikimedia Commons about an artist you have songs by, and about each song, using only public ids found through MusicBrainz. It keeps one photo, a short bio and a short fact on your computer. Nothing about your home is sent. Never for an artist under 18. Off stops it; what is already kept stays, and artists show the generated cover instead.",
    copy: { does: "Shows facts and photos about your artists and songs, kept on your computer." },
    level: "advanced", secret: false, lives_in: "household.media_lookups", honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "music.album_art_online", scope: "household", selector: "boolean", default: true,
    label: "Fetch album covers from the Cover Art Archive",
    help: "In the background, Home asks the Cover Art Archive for the front cover of an album that has no art in its files or folder, using only the album's public MusicBrainz id, and keeps the picture on your computer. Nothing about your home is sent. Art in your files or folders is never replaced. Off stops it; covers already kept stay, and other albums show the generated cover.",
    level: "advanced", secret: false, lives_in: "household.media_lookups", honoured_by: ["home"],
  }),
  // MUSIC-ID-01: identical to the pinned spec's entry (spec-v0.1.389 and later); kept here like the other music keys.
  SettingsKey.parse({
    key: "music.identify.online", scope: "household", selector: "select", range: { options: ["on", "ask", "off"] }, default: "on",
    label: "Name songs online",
    help: "When Home hears a song and has no match in your own library, it can look the song up online. Only a short audio fingerprint and the clip length are sent to the open AcoustID service, never the recording. \"Ask each time\" asks first; \"Off\" matches your own library only.",
    level: "advanced", secret: false, lives_in: "household.media_lookups", honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "generation.music.enabled",
    scope: "household",
    selector: "boolean",
    default: true,
    label: "Adults can make songs",
    help: "Turns song making on or off for adults. Children and teens cannot make songs, whatever this says.",
    level: "basic",
    copy: { does: "Turns song making on or off for the grown-ups here." },
    lives_in: "household.media_music",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "generation.music.length",
    scope: "household",
    selector: "select",
    range: { options: ["quick", "full"] },
    default: "full",
    label: "Song length",
    help: "What chat makes when nobody says. Anyone can ask for the other kind. A song is as long as its words.",
    level: "basic",
    copy: {
      does: "Picks whether chat sings every part or only the hook when nobody says which.",
      options: {
        quick: "Short: the hook, the first verse and the chorus.",
        full: "Full: every part of the song.",
      },
    },
    lives_in: "household.media_music",
    honoured_by: ["home"],
  }),
];
