import { VoiceCatalogSection } from "@/apps/settings/VoiceCatalogSection";
import { ClonedVoicesSection } from "@/apps/settings/ClonedVoicesSection";
import type { Roster } from "@/lib/api";

interface VoicesPageProps {
  person: Roster;
}

// Session B step 7 (see ModelsPage.tsx's own comment for the full
// reasoning, including the 2026-09-06 nesting fix): the catalog
// (browse and pick a voice) and cloned voices (record and manage your
// own) were two separate inline sections on the single long Settings
// scroll - one destination here, since both are the same "voices"
// management surface step 7 names as one item. No owner/admin gate:
// picking or recording a voice is a person-scope choice anyone signed
// in already makes for themselves (`tts.voice_id`); upload and delete
// carry their own, narrower checks (backend/src/routes/voice.ts). Not
// a schema page - recording/uploading a clone needs a selector
// `kit/schema`'s FormNode doesn't have (see BackupsPage.tsx's identical
// file/upload gap). Renders straight into SettingsPage's own content
// pane (App.tsx's nested route through its <Outlet/>), not its own
// `<Page>`. Unlike Models/Backups/Commands, neither section below is
// actually titled "Voices" ("More voices", "Cloned voices" - a code
// review, 2026-09-06, caught this: the earlier claim that "the section
// cards already carry their own heading" was true for those three but
// not this page), so this needs its own heading rather than relying on
// theirs.
export function VoicesPage({ person }: VoicesPageProps) {
  return (
    <>
      <h2 className="border-l-2 border-primary pl-2 text-lg font-bold text-foreground">Voices</h2>
      <VoiceCatalogSection personId={person.id} />
      <ClonedVoicesSection person={person} />
    </>
  );
}
