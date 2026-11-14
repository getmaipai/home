// The example picture shown on each template card: files in frontend/public/template-covers, one per template id.
// A template without a file here shows the plain gradient tile; backend/tests/templateCovers.test.ts keeps this list and the files in step.
export const TEMPLATE_COVER_IDS: readonly string[] = [
  "mtpl-adpack",
  "mtpl-afterhourslaunch",
  "mtpl-artcomic",
  "mtpl-artpapercut",
  "mtpl-artpixel",
  "mtpl-artwatercolor",
  "mtpl-flyerlaunch",
  "mtpl-greetingcard",
  "mtpl-merchlaunch",
  "mtpl-moodboard",
  "mtpl-nostalgia80s",
  "mtpl-photodump",
  "mtpl-portraitkind",
  "mtpl-poster",
  "mtpl-productmarble",
  "mtpl-productphoto",
  "mtpl-productplacement",
  "mtpl-productstudio",
  "mtpl-productwood",
  "mtpl-profile",
  "mtpl-scenelaunch",
  "mtpl-sticker",
  "mtpl-tryonoutfit",
];

export function templateCoverUrl(id: string): string | null {
  return TEMPLATE_COVER_IDS.includes(id) ? `/template-covers/${id}.jpg` : null;
}
