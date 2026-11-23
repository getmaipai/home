export const INCOGNITO_COMPANION_ID = "incognito";

// One shared empty list: the header data hook re-sends on a changed reference, so a fresh array per call would loop.
const NO_COMPANIONS: never[] = [];

// The generic companion has no selected id, no picker list and no remembered name.
export function incognitoHeaderCompanion<
  T extends {
    companionId: string | null;
    companionName?: string | undefined;
    defaultCompanionId?: string | null | undefined;
    companions: unknown[];
  },
>(on: boolean, data: T): T {
  if (!on) return data;
  return {
    ...data,
    companionId: null,
    companionName: "Companion",
    defaultCompanionId: null,
    companions: NO_COMPANIONS,
  };
}
