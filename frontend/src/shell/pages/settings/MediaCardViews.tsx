import { i18n } from "@lingui/core";
// VIDEO-SETTINGS-05: the Pictures, Videos and Music tab views and the Styles tab shell of Settings, Pictures, videos and music (settings-media-2026-11-02 sections 3 and 4).
// Each card draws its registry group through the kit renderer, so every key shows with the spec's own label and help, then the card's link rows (text from the spec
// card's `copy`, rule S5). The old style lists, the Quick and Detailed sections and the install buttons are gone: the one list of styles is the Styles tab, and which
// model fills a level is chosen in AI and models, so this area holds no second control for either.
import { SettingsRenderer } from "@maipai/ui/src/settings/SettingsRenderer";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@maipai/ui/src/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { StylesTab } from "@/apps/settings/styles/StylesTab";
import { useTabItem } from "@/shell/tabIdentity";
import { scopeValueFor } from "@/shell/pages/settings/settingsViewer";
import { settingsPath } from "@/shell/pages/settings/settingsAreas";
import { api } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import type { SettingsViewProps } from "@/shell/pages/settings/settingsViews";

/** The keys of a Styles card the generic renderer draws: the Adult-only select. The Civitai switch and key have their own rows in the Styles view (VIDEO-LORA-08), because the key is write-only. */
export const STYLES_CARD_KEYS = ["generation.styles.adult_only"];

function MediaKeysList({ person, card, includeKeys }: Pick<SettingsViewProps, "person" | "card"> & { includeKeys?: string[] }) {
  const group = card?.group;
  if (!group) return null;
  return (
    <div className="flex flex-col gap-2">
      {card.description ? <p className="text-sm text-muted-foreground">{card.description}</p> : null}
      <SettingsRenderer scope="household" scopeValue={scopeValueFor("household", person.id)} honouredBy="home" only={[group]} includeKeys={includeKeys} titleOverrides={{ [group]: card.label }} />
    </div>
  );
}

type Copy = Record<string, string | undefined>;
const copyOf = (card: SettingsViewProps["card"]): Copy => ((card as { copy?: Copy } | undefined)?.copy) ?? {};

type LinkSpec = { title?: string; help?: string; button?: string; to: string };

/** Link rows: a line of words and one button that opens another place. No state of its own, so it can never be a second control (S2). */
function linkRows(rows: LinkSpec[], navigate: (to: string) => void) {
  return rows.filter((row) => row.title && row.button).map((row) => (
    <ItemGroup key={row.to + row.title}>
      <Item variant="outline">
        <ItemContent>
          <ItemTitle>{row.title}</ItemTitle>
          {row.help ? <ItemDescription clamp={false}>{row.help}</ItemDescription> : null}
        </ItemContent>
        <ItemActions><Button type="button" variant="outline" onClick={() => navigate(row.to)}>{row.button}</Button></ItemActions>
      </Item>
    </ItemGroup>
  ));
}

const CHOOSE_MODELS = settingsPath("ai", "overview");

/** Children and teens: the kids switch and the two daily limits. Admin only (the area is). */
export function MediaKidsView(props: SettingsViewProps) { return <MediaKeysList person={props.person} card={props.card} />; }

export function MediaPicturesView(props: SettingsViewProps) {
  useTabItem(i18n._({ id: "Pictures", message: "Pictures" }));
  const copy = copyOf(props.card);
  const navigate = useNavigate();
  return <><MediaKeysList person={props.person} card={props.card} />{linkRows([{ title: copy.models_label, help: copy.models_help, button: copy.models_button, to: CHOOSE_MODELS }], navigate)}</>;
}

export function MediaVideosView(props: SettingsViewProps) {
  useTabItem(i18n._({ id: "Videos", message: "Videos" }));
  const copy = copyOf(props.card);
  const navigate = useNavigate();
  return (
    <>
      <MediaKeysList person={props.person} card={props.card} />
      {copy.max_note ? <p className="text-sm text-muted-foreground">{copy.max_note}</p> : null}
      {linkRows([
        { title: copy.models_label, help: copy.models_help, button: copy.models_button, to: CHOOSE_MODELS },
        { title: copy.styles_label, help: copy.styles_help, button: copy.styles_button, to: settingsPath("media", "styles") },
      ], navigate)}
    </>
  );
}

export function MediaMusicView(props: SettingsViewProps) {
  useTabItem(i18n._({ id: "Music", message: "Music" }));
  const copy = copyOf(props.card);
  const navigate = useNavigate();
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 15_000 });
  const identify = health.data?.engines?.identify;
  return <><MediaKeysList person={props.person} card={props.card} />{identify ? <ItemGroup><Item variant="outline"><ItemContent><ItemTitle>{i18n._({ id: "Song naming", message: "Song naming" })}</ItemTitle><ItemDescription clamp={false}>{identify.identify_line}</ItemDescription>{identify.identify_last ? <ItemDescription clamp={false}>{i18n._({ id: "Last try {when}: {line}", message: "Last try {when}: {line}", values: { when: formatRelative(identify.identify_last.at), line: identify.identify_last.line } })}</ItemDescription> : null}</ItemContent></Item></ItemGroup> : null}{linkRows([{ title: copy.models_label, help: copy.models_help, button: copy.models_button, to: CHOOSE_MODELS }], navigate)}</>;
}

export function MediaStylesView(props: SettingsViewProps) {
  useTabItem(i18n._({ id: "Styles", message: "Styles" }));
  return <StylesTab person={props.person} card={props.card}><MediaKeysList person={props.person} card={{ ...props.card!, description: undefined }} includeKeys={STYLES_CARD_KEYS} /></StylesTab>;
}
