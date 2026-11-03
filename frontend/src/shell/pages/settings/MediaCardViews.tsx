// VIDEO-SETTINGS-04: the cards of Pictures, videos and music that the spec (spec-v0.1.316) names by view id. Each draws its registry group
// through the kit renderer, the same way a plain keys card does, so every key shows with the spec's own label and help. The Pictures and
// Videos cards still carry today's style libraries underneath until VIDEO-SETTINGS-05 builds the tab screens and VIDEO-LORA-08 the Styles screen.
import { SettingsRenderer } from "@maipai/ui/src/settings/SettingsRenderer";
import { PicturesLibrary } from "@/apps/settings/PicturesLibrary";
import { VideoLibrary } from "@/apps/settings/VideoLibrary";
import { StylesTab } from "@/apps/settings/styles/StylesTab";
import { useTabItem } from "@/shell/tabIdentity";
import { scopeValueFor } from "@/shell/pages/settings/settingsViewer";
import type { SettingsViewProps } from "@/shell/pages/settings/settingsViews";

/** The keys of a Styles card the generic renderer draws: the Adult-only select. The Civitai switch and key have their own rows in the Styles view (VIDEO-LORA-08), because the key is write-only. */
export const STYLES_CARD_KEYS = ["generation.styles.adult_only"];

function MediaKeysCard({ person, card, includeKeys }: Pick<SettingsViewProps, "person" | "card"> & { includeKeys?: string[] }) {
  const group = card?.group;
  if (!group) return null;
  return (
    <div className="flex flex-col gap-2">
      {card.description ? <p className="text-sm text-muted-foreground">{card.description}</p> : null}
      <SettingsRenderer scope="household" scopeValue={scopeValueFor("household", person.id)} honouredBy="home" only={[group]} includeKeys={includeKeys} titleOverrides={{ [group]: card.label }} />
    </div>
  );
}

/** Children and teens: the kids switch, the two daily limits and the household likeness option. Admin only (the area is). */
export function MediaKidsView(props: SettingsViewProps) { return <MediaKeysCard person={props.person} card={props.card} />; }

export function MediaPicturesView(props: SettingsViewProps) {
  useTabItem("Pictures");
  return <><MediaKeysCard person={props.person} card={props.card} /><PicturesLibrary /></>;
}

export function MediaVideosView(props: SettingsViewProps) {
  useTabItem("Videos");
  return <><MediaKeysCard person={props.person} card={props.card} /><VideoLibrary /></>;
}

export function MediaMusicView(props: SettingsViewProps) { return <MediaKeysCard person={props.person} card={props.card} />; }

export function MediaStylesView(props: SettingsViewProps) {
  useTabItem("Styles");
  return <StylesTab person={props.person} card={props.card}><MediaKeysCard person={props.person} card={{ ...props.card!, description: undefined }} includeKeys={STYLES_CARD_KEYS} /></StylesTab>;
}
