import { Page } from "@/kit/primitives/Page";
import { VoiceCatalogSection } from "@/apps/settings/VoiceCatalogSection";
import { ClonedVoicesSection } from "@/apps/settings/ClonedVoicesSection";
import type { Roster } from "@/lib/api";

interface VoicesPageProps {
  person: Roster;
}

// Session B step 7 (see ModelsPage.tsx's own comment for the full
// reasoning): the catalog (browse and pick a voice) and cloned voices
// (record and manage your own) were two separate inline sections on
// the single long Settings scroll - one page here, since both are the
// same "voices" management surface step 7 names as one item. No
// owner/admin gate: picking or recording a voice is a person-scope
// choice anyone signed in already makes for themselves
// (`tts.voice_id`); upload and delete carry their own, narrower checks
// (backend/src/routes/voice.ts). Not a schema page - recording/
// uploading a clone needs a selector `kit/schema`'s FormNode doesn't
// have (see BackupsPage.tsx's identical file/upload gap).
export function VoicesPage({ person }: VoicesPageProps) {
  return (
    <Page title="Voices">
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
        <VoiceCatalogSection personId={person.id} />
        <ClonedVoicesSection person={person} />
      </div>
    </Page>
  );
}
