// Step 8: "the emergency kit (backup key and hub identity as a printable
// page and a file, shown once) generated at setup" (2.5). The wizard
// screen that shows this is E's, and "shown once" describes that wizard
// step happening once at setup, not a hard one-time API lock - an owner
// locked out of ever re-viewing their OWN backup key after an accidental
// page refresh would be a real usability disaster, and re-viewing an
// unchanged key is not the risky operation here (rotating it would be,
// and nothing here does that).
//
// backupCrypto.ts's own header names exactly this gap: "2.5's real
// design prints this key as part of an 'emergency kit' at setup... until
// then it lives in the same keystore the pepper does... just not yet
// shown to anyone." This is that kit, finally shown.
import { getOrCreateHexKey } from "@/lib/keystore";
import { BACKUP_KEY_NAME } from "@/lib/backupCrypto";
import { getHubInstanceId, getHubName } from "@/lib/hubIdentity";

export interface EmergencyKit {
  hubName: string;
  hubInstanceId: string;
  backupKeyHex: string;
  generatedAt: string;
}

/** The two things a burned-down house, a stolen laptop, or a dead drive
 * would otherwise take with this hub's own keystore: backupKeyHex to
 * actually read an offsite backup archive, and hubInstanceId/hubName so
 * whoever is restoring can confirm which household's backup they are
 * looking at (device.schema.json's `hlc`/pairing already keys off this
 * same instance id; restoreStaging.ts does not currently verify it
 * against a backup's own contents, but a household with more than one
 * archive lying around still needs a way to tell them apart by hand). */
export function generateEmergencyKit(): EmergencyKit {
  return {
    hubName: getHubName(),
    hubInstanceId: getHubInstanceId(),
    backupKeyHex: getOrCreateHexKey(BACKUP_KEY_NAME),
    generatedAt: new Date().toISOString(),
  };
}
