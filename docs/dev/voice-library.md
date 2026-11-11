# Voice library

The first Home voice library is a browser-friendly view over the existing live `kyutai/tts-voices` catalog. It includes only VCTK files with known per-speaker metadata and never performs a second catalog listing. `GET /api/voice/library` transforms the cached catalog paths into plain names and facts; previews are fetched from Hugging Face only after a person clicks a sample. Adding a voice uses the existing catalog selection route with its catalog path.

## Facts and attribution

The VCTK speaker table is copied from `data-scratch/briefs/vctk-speaker-info.txt`, from the Voice Cloning Toolkit, University of Edinburgh, [CC BY 4.0](https://datashare.ed.ac.uk/handle/10283/3443). Recordings are by the Centre for Speech Technology Research. The library displays that attribution and the licence on each voice. The source metadata supplies age, gender, accent and region; names are composed from place and gender, with age in the detail line. Unknown accent metadata is described as not recorded.

## Adding a collection

Before adding a collection, confirm its licence and provenance against `docs/design/voices-2026-10-18.md`. Add a typed metadata table, define its path-to-speaker mapping and plain labels, and extend the pure builder with fixtures for inclusion, preferred files, missing files, attribution and safe names. Do not create another catalog fetcher: derive membership from `getVoiceCatalog()`. Add preview restrictions appropriate to the collection and test that an uncatalogued path cannot be fetched.

Only CC0 and CC-BY collections are eligible. CC-BY requires attribution. Exclude non-commercial licences, any collection whose licence is unconfirmed, and recordings that identify a named real person.

Measured labels and flags-as-kit-images are later work. Current names use source metadata, and country values are plain codes and names; this first backend slice does not add measured voice traits or UI flags. Measured labels and non-English voices are the next step.

## The box

The Voices manager has one owner/admin **+ Add voice** button. Its kit flow dialog has Download, Clone and Inspired tabs in that order. Download reads `GET /api/voice/library` through the `voice-library` query, applies the same name/detail/country/language search fields as `searchVoiceLibrary`, and previews only after a person presses Play. Add posts the catalog path to `/api/voice/catalog/select` and refreshes the installed voice queries. The clone and inspired tabs reuse `AddVoiceForm` and its existing API calls. In a dev seed without network access, the library query shows the ordinary retryable error state.

Country flags use regional indicator emoji and subdivision tag sequences in `frontend/src/lib/voice/countryFlag.ts` until the kit ships its round-flag image Element (design record section 4).
