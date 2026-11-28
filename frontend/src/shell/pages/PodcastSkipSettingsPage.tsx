import { formatTimeSaved } from "@/shell/skip/skipPlan";
import { useNavigate } from "react-router-dom";
import { i18n } from "@lingui/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Roster } from "@/lib/api";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Alert, AlertDescription } from "@maipai/ui/src/dashboard/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { formatRelative } from "@/lib/format";

type Choice = "skip" | "mark" | "off" | "inherit";
const choices: Choice[] = ["skip", "mark", "off", "inherit"];
const kinds = ["ad", "sponsor", "bumper", "selfpromo", "intro", "outro", "recap"];
const builtIn: Record<string, Choice> = { ad: "skip", sponsor: "skip", bumper: "skip", selfpromo: "off", intro: "mark", outro: "mark", recap: "mark" };
const kindLabel = (kind: string) => ({ ad: i18n._({ id: "Ad", message: "Ad" }), sponsor: i18n._({ id: "Sponsor", message: "Sponsor" }), bumper: i18n._({ id: "Bumper", message: "Bumper" }), selfpromo: i18n._({ id: "Self-promotion", message: "Self-promotion" }), intro: i18n._({ id: "Intro", message: "Intro" }), outro: i18n._({ id: "Outro", message: "Outro" }), recap: i18n._({ id: "Recap", message: "Recap" }) }[kind] ?? kind);
const choiceLabel = (choice: Choice) => ({ skip: i18n._({ id: "Skip", message: "Skip" }), mark: i18n._({ id: "Mark", message: "Mark" }), off: i18n._({ id: "Off", message: "Off" }), inherit: i18n._({ id: "Inherit", message: "Inherit" }) }[choice]);
const readChoice = (rows: Array<{ key: string; value: unknown }> | undefined, key: string): Choice | undefined => {
  const value = rows?.find((entry) => entry.key === key)?.value;
  return choices.includes(value as Choice) ? value as Choice : undefined;
};

export function PodcastSkipSettingsPage({ person, showId }: { person: Roster; showId?: string }) {
  const scope = `person:${person.id}`;
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const [explainer, setExplainer] = useState(false);
  const [choiceToSave, setChoiceToSave] = useState<{ key: string; value: Choice } | null>(null);
  const personValues = useQuery({ queryKey: ["podcast-skip-settings", scope], queryFn: () => api.settingsValues(scope) });
  const household = useQuery({ queryKey: ["podcast-skip-settings", "household"], queryFn: () => api.settingsValues("household"), enabled: person.role === "owner" || person.role === "admin" || Boolean(showId) });
  const showQuery = useQuery({ queryKey: ["podcast-show-name", showId], queryFn: async () => (await api.appData<Array<{ id: string; title: string }>>("podcasts", "directory", { scope: "show", id: showId! }))[0], enabled: Boolean(showId) });
  const summary = useQuery({ queryKey: ["podcast-skip-summary"], queryFn: api.podcastSegmentsSummary, retry: false });
  if (personValues.isError || household.isError) return <section><Alert variant="destructive"><AlertDescription>{i18n._({ id: "Could not load podcast skip settings. Your saved choices were not changed. Retry or close this page.", message: "Could not load podcast skip settings. Your saved choices were not changed. Retry or close this page." })}</AlertDescription></Alert><Button type="button" variant="outline" onClick={() => { void personValues.refetch(); void household.refetch(); }}>{i18n._({ id: "Retry", message: "Retry" })}</Button></section>;
  if (personValues.isPending) return <p role="status">{i18n._({ id: "Loading podcast skip settings…", message: "Loading podcast skip settings…" })}</p>;
  const isAdmin = person.role === "owner" || person.role === "admin";
  if (person.age_band !== "adult") return <p className="text-body text-muted-foreground">{i18n._({ id: "Podcast skip choices follow the household settings.", message: "Podcast skip choices follow the household settings." })}</p>;
  const people = personValues.data ?? [];
  const homeValues = household.data ?? [];
  const showOverrideMap = (kind: string): Record<string, Choice> => {
    const raw = homeValues.find((entry) => entry.key === `podcasts.skip.${kind}.shows`)?.value;
    try { return JSON.parse(typeof raw === "string" ? raw : "{}") as Record<string, Choice>; } catch { return {}; }
  };
  const explainerDismissed = peopleValue(personValues.data, "podcasts.skip.explainer.dismissed") === true;
  const save = async (targetScope: string, key: string, value: unknown) => {
    setError("");
    try { await api.setSetting(targetScope, key, value); await Promise.all([queryClient.invalidateQueries({ queryKey: ["podcast-skip-settings"] }), queryClient.invalidateQueries({ queryKey: ["settings-values", targetScope] })]); }
    catch { setError(i18n._({ id: "Could not save {key}. Check your connection and try again.", message: "Could not save {key}. Check your connection and try again.", values: { key } })); }
  };
  const choose = (key: string, value: Choice) => {
    if (value !== "inherit" && !explainerDismissed) { setChoiceToSave({ key, value }); setExplainer(true); }
    else void save(scope, key, value);
  };
  const showStats = summary.data?.shows.find((entry) => entry.show_id === showId);
  const lastProcessed = summary.data?.episodes.filter((entry) => entry.show_id === showId).map((entry) => entry.updated_at).sort().at(-1);
  return <section className="flex flex-col gap-4" aria-label={showId ? i18n._({ id: "Skip settings for this show", message: "Skip settings for this show" }) : i18n._({ id: "Podcast skip settings", message: "Podcast skip settings" })}>
    <h2 className="text-title font-semibold">{showId ? i18n._({ id: "Skip settings for {show}", message: "Skip settings for {show}", values: { show: showQuery.data?.title ?? i18n._({ id: "this show", message: "this show" }) } }) : i18n._({ id: "Podcast skip settings", message: "Podcast skip settings" })}</h2>
    {error ? <p role="alert">{error}</p> : null}
    {!showId ? <><p className="text-body text-muted-foreground">{i18n._({ id: "Choose whether each kind of break is skipped, marked for you, or left alone.", message: "Choose whether each kind of break is skipped, marked for you, or left alone." })}</p><p className="text-body text-muted-foreground">{i18n._({ id: "A bumper is a short sound or spoken tag around an ad break. A bumper next to a skipped ad goes with it by default.", message: "A bumper is a short sound or spoken tag around an ad break. A bumper next to a skipped ad goes with it by default." })}</p></> : null}
    {kinds.map((kind) => {
      const key = `podcasts.skip.${kind}`;
      const current = showId ? showOverrideMap(kind)[showId] : readChoice(people, key);
      const personChoice = readChoice(people, key);
      const householdChoice = readChoice(homeValues, `${key}.default`);
      const inherited = showId ? (personChoice && personChoice !== "inherit" ? personChoice : householdChoice && householdChoice !== "inherit" ? householdChoice : builtIn[kind]!) : undefined;
      return <fieldset key={kind} className="rounded-lg border p-3"><legend className="px-1 font-medium">{kindLabel(kind)}</legend>
        {showId ? <p className="text-body text-muted-foreground">{i18n._({ id: "Inherited: {value}", message: "Inherited: {value}", values: { value: choiceLabel(inherited!) } })}</p> : null}
        <div role="group" aria-label={kindLabel(kind)} className="flex flex-wrap gap-2">{choices.map((choice) => <Button key={choice} type="button" variant={(current ?? "inherit") === choice ? "default" : "outline"} aria-pressed={(current ?? "inherit") === choice} onClick={() => showId ? void save("household", `${key}.shows`, JSON.stringify({ ...showOverrideMap(kind), [showId]: choice })) : choose(key, choice)}>{choiceLabel(choice)}</Button>)}</div>
        {showId ? <Button type="button" variant="ghost" onClick={() => { const next = showOverrideMap(kind); delete next[showId]; void save("household", `${key}.shows`, JSON.stringify(next)); }}>{i18n._({ id: "Reset to inherited", message: "Reset to inherited" })}</Button> : null}
        {!showId && isAdmin ? <div className="mt-3 border-t pt-3"><p className="text-body font-medium">{i18n._({ id: "Household default", message: "Household default" })}</p><div role="group" aria-label={i18n._({ id: "Household {kind} default", message: "Household {kind} default", values: { kind: kindLabel(kind) } })} className="mt-2 flex flex-wrap gap-2">{choices.map((choice) => <Button key={choice} type="button" variant={(readChoice(homeValues, `${key}.default`) ?? "inherit") === choice ? "default" : "outline"} aria-pressed={readChoice(homeValues, `${key}.default`) === choice} onClick={() => void save("household", `${key}.default`, choice)}>{choiceLabel(choice)}</Button>)}</div></div> : null}
      </fieldset>;
    })}
    {!showId && isAdmin ? <Button type="button" variant="outline" aria-pressed={homeValues.find((entry) => entry.key === "podcasts.skip.bumpers_with_ads")?.value !== false} onClick={() => void save("household", "podcasts.skip.bumpers_with_ads", homeValues.find((entry) => entry.key === "podcasts.skip.bumpers_with_ads")?.value === false)}>{i18n._({ id: "Skip bumpers with ads", message: "Skip bumpers with ads" })}: {homeValues.find((entry) => entry.key === "podcasts.skip.bumpers_with_ads")?.value === false ? i18n._({ id: "Off", message: "Off" }) : i18n._({ id: "On", message: "On" })}</Button> : null}
    {!showId ? <Button type="button" variant="outline" onClick={() => setExplainer(true)}>{i18n._({ id: "How skip settings work", message: "How skip settings work" })}</Button> : <div className="rounded-lg border p-3"><h3 className="font-medium">{i18n._({ id: "This show", message: "This show" })}</h3>{summary.isError ? <><p>{i18n._({ id: "Stack is offline. Retry to reload this show summary.", message: "Stack is offline. Retry to reload this show summary." })}</p><Button type="button" variant="outline" onClick={() => void summary.refetch()}>{i18n._({ id: "Retry", message: "Retry" })}</Button></> : showStats ? <><p className="text-body">{i18n._({ id: "{count, plural, one {# ad skipped} other {# ads skipped}} · {saved}", message: "{count, plural, one {# ad skipped} other {# ads skipped}} · {saved}", values: { count: showStats.ads_skipped, saved: formatTimeSaved(showStats.seconds_saved) } })}</p>{lastProcessed ? <p className="text-body text-muted-foreground">{i18n._({ id: "Last processed {when}", message: "Last processed {when}", values: { when: formatRelative(lastProcessed) } })}</p> : null}</> : <p className="text-body text-muted-foreground">{i18n._({ id: "Nothing skipped yet.", message: "Nothing skipped yet." })}</p>}</div>}
    <Dialog open={explainer} onOpenChange={(open) => { setExplainer(open); if (!open) { void save(scope, "podcasts.skip.explainer.dismissed", true); setChoiceToSave(null); } }}><DialogContent><DialogHeader><DialogTitle>{i18n._({ id: "Choose how podcast breaks work", message: "Choose how podcast breaks work" })}</DialogTitle><DialogDescription>{i18n._({ id: "Skip ads jumps over detected breaks. Mark only shows them in the timeline without skipping. Off leaves playback unchanged. A bumper is a short sound or spoken tag around an ad break; by default a bumper beside a skipped ad goes with it.", message: "Skip ads jumps over detected breaks. Mark only shows them in the timeline without skipping. Off leaves playback unchanged. A bumper is a short sound or spoken tag around an ad break; by default a bumper beside a skipped ad goes with it." })}</DialogDescription></DialogHeader><div className="flex flex-wrap gap-2">{(["skip", "mark", "off"] as const).map((choice) => <Button key={choice} type="button" onClick={() => { if (choiceToSave) { void save(scope, choiceToSave.key, choice); void save(scope, "podcasts.skip.explainer.dismissed", true); setChoiceToSave(null); } setExplainer(false); }}>{choice === "skip" ? i18n._({ id: "Skip ads", message: "Skip ads" }) : choice === "mark" ? i18n._({ id: "Mark only", message: "Mark only" }) : i18n._({ id: "Off", message: "Off" })}</Button>)}</div></DialogContent></Dialog>
  </section>;
}

function peopleValue(rows: Array<{ key: string; value: unknown }> | undefined, key: string): unknown {
  return rows?.find((entry) => entry.key === key)?.value;
}

export function PodcastShowSkipSettingsAction({ person, showId }: { person: Roster; showId: string }) {
  const navigate = useNavigate();
  if (person.age_band !== "adult" || (person.role !== "owner" && person.role !== "admin") || !showId) return null;
  return <div className="px-4 pb-6"><Button type="button" variant="outline" onClick={() => navigate(`/apps/podcasts/skip?show=${encodeURIComponent(showId)}`)}>{i18n._({ id: "Skip settings for this show", message: "Skip settings for this show" })}</Button></div>;
}
