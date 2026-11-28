import { formatTimeSaved } from "@/shell/skip/skipPlan";
import { useNavigate } from "react-router-dom";
import { i18n } from "@lingui/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Roster } from "@/lib/api";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Alert, AlertDescription } from "@maipai/ui/src/dashboard/components/ui/alert";
import { formatRelative } from "@/lib/format";

type Choice = "skip" | "mark" | "off" | "inherit";
const choices: Choice[] = ["skip", "mark", "off", "inherit"];
const groups = [{ label: "Ads", kinds: ["ad", "selfpromo"] }, { label: "Sponsors", kinds: ["sponsor"] }, { label: "Intros and outros", kinds: ["intro", "outro", "recap"] }, { label: "Break bumpers", kinds: ["bumper"] }];
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
  const [saved, setSaved] = useState(false);
  const [viewScope, setViewScope] = useState<"me" | "household">("me");
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
  const save = async (targetScope: string, key: string, value: unknown) => {
    setError(""); setSaved(false);
    try { await api.setSetting(targetScope, key, value); await Promise.all([queryClient.invalidateQueries({ queryKey: ["podcast-skip-settings"] }), queryClient.invalidateQueries({ queryKey: ["settings-values", targetScope] })]); setSaved(true); }
    catch { setError(i18n._({ id: "Could not save {key}. Check your connection and try again.", message: "Could not save {key}. Check your connection and try again.", values: { key } })); }
  };
  const showStats = summary.data?.shows.find((entry) => entry.show_id === showId);
  const lastProcessed = summary.data?.episodes.filter((entry) => entry.show_id === showId).map((entry) => entry.updated_at).sort().at(-1);
  const dirOn = homeValues.find((entry) => entry.key === "podcasts.directory.enabled")?.value === true;
  const bumpersWithAds = homeValues.find((entry) => entry.key === "podcasts.skip.bumpers_with_ads")?.value !== false;
  const editingHousehold = !showId && isAdmin && viewScope === "household";
  const rowKinds = groups.flatMap((group) => group.kinds);
  const options: Choice[] = ["skip", "mark", "off"];
  const Segmented = ({ label, value, onPick }: { label: string; value: Choice | undefined; onPick: (choice: Choice) => void }) => (
    <div role="group" aria-label={label} className="inline-flex rounded-full bg-muted p-1">
      {options.map((choice) => <button key={choice} type="button" aria-pressed={value === choice} onClick={() => onPick(choice)} className={value === choice ? "rounded-full bg-background px-3 py-1 text-sm font-medium text-foreground shadow-sm" : "rounded-full px-3 py-1 text-sm text-muted-foreground hover:text-foreground"}>{choiceLabel(choice)}</button>)}
    </div>
  );
  const Switch = ({ label, hint, on, onToggle }: { label: string; hint: string; on: boolean; onToggle: () => void }) => (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0"><p className="font-medium">{label}</p><p className="text-sm text-muted-foreground">{hint}</p></div>
      <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onToggle} className={on ? "relative h-6 w-11 shrink-0 rounded-full bg-primary" : "relative h-6 w-11 shrink-0 rounded-full bg-muted"}><span className={on ? "absolute left-6 top-1 h-4 w-4 rounded-full bg-background" : "absolute left-1 top-1 h-4 w-4 rounded-full bg-muted-foreground"} /></button>
    </div>
  );
  const title = showId ? i18n._({ id: "Skip settings for {show}", message: "Skip settings for {show}", values: { show: showQuery.data?.title ?? i18n._({ id: "this show", message: "this show" }) } }) : i18n._({ id: "Podcast settings", message: "Podcast settings" });
  return <section className="flex max-w-2xl flex-col gap-5" aria-label={title}>
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-title font-semibold">{title}</h2>
      <p role="status" className="text-sm text-muted-foreground">{saved ? i18n._({ id: "Saved", message: "Saved" }) : ""}</p>
    </div>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <p className="text-body text-muted-foreground">{showId
      ? i18n._({ id: "Choose what happens to each kind of break in this show. Use default follows your own choice, then the household's.", message: "Choose what happens to each kind of break in this show. Use default follows your own choice, then the household's." })
      : i18n._({ id: "Skip jumps over the break. Mark shows it on the progress bar and lets you skip with one tap. Off leaves it alone.", message: "Skip jumps over the break. Mark shows it on the progress bar and lets you skip with one tap. Off leaves it alone." })}</p>
    {!showId && isAdmin ? <div role="group" aria-label={i18n._({ id: "Whose settings", message: "Whose settings" })} className="inline-flex self-start rounded-full bg-muted p-1">
      {(["me", "household"] as const).map((v) => <button key={v} type="button" aria-pressed={viewScope === v} onClick={() => setViewScope(v)} className={viewScope === v ? "rounded-full bg-background px-4 py-1 text-sm font-medium shadow-sm" : "rounded-full px-4 py-1 text-sm text-muted-foreground"}>{v === "me" ? i18n._({ id: "For me", message: "For me" }) : i18n._({ id: "For the household", message: "For the household" })}</button>)}
    </div> : null}
    <div className="divide-y rounded-xl border">
      {rowKinds.map((kind) => {
        const key = `podcasts.skip.${kind}`;
        const personChoice = readChoice(people, key);
        const householdChoice = readChoice(homeValues, `${key}.default`);
        const current = showId ? showOverrideMap(kind)[showId] : editingHousehold ? householdChoice : personChoice;
        const fallback = showId ? (personChoice && personChoice !== "inherit" ? personChoice : householdChoice && householdChoice !== "inherit" ? householdChoice : builtIn[kind]!) : editingHousehold ? builtIn[kind]! : (householdChoice && householdChoice !== "inherit" ? householdChoice : builtIn[kind]!);
        const isDefault = !current || current === "inherit";
        const pick = (choice: Choice) => showId ? void save("household", `${key}.shows`, JSON.stringify({ ...showOverrideMap(kind), [showId]: choice })) : editingHousehold ? void save("household", `${key}.default`, choice) : void save(scope, key, choice);
        const reset = () => showId ? (() => { const next = showOverrideMap(kind); delete next[showId]; void save("household", `${key}.shows`, JSON.stringify(next)); })() : editingHousehold ? void save("household", `${key}.default`, "inherit") : void save(scope, key, "inherit");
        return <div key={kind} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0"><p className="font-medium">{kindLabel(kind)}</p>
            <p className="text-sm text-muted-foreground">{isDefault ? i18n._({ id: "Using default: {value}", message: "Using default: {value}", values: { value: choiceLabel(fallback) } }) : <button type="button" className="underline" onClick={reset}>{i18n._({ id: "Use default", message: "Use default" })}</button>}</p></div>
          <Segmented label={kindLabel(kind)} value={isDefault ? undefined : current} onPick={pick} />
        </div>;
      })}
    </div>
    {editingHousehold ? <div className="divide-y rounded-xl border"><Switch label={i18n._({ id: "Skip bumpers with ads", message: "Skip bumpers with ads" })} hint={i18n._({ id: "A bumper is a short sound or spoken tag around an ad break. One next to a skipped ad goes with it.", message: "A bumper is a short sound or spoken tag around an ad break. One next to a skipped ad goes with it." })} on={bumpersWithAds} onToggle={() => void save("household", "podcasts.skip.bumpers_with_ads", !bumpersWithAds)} /></div> : null}
    {!showId ? <div className="flex flex-col gap-2"><h3 className="text-title font-medium">{i18n._({ id: "Finding shows", message: "Finding shows" })}</h3>
      <div className="divide-y rounded-xl border">{isAdmin
        ? <Switch label={i18n._({ id: "Search the public podcast directory", message: "Search the public podcast directory" })} hint={i18n._({ id: "Lets adults find and follow shows. Only the words you type are sent.", message: "Lets adults find and follow shows. Only the words you type are sent." })} on={dirOn} onToggle={() => void save("household", "podcasts.directory.enabled", !dirOn)} />
        : <p className="px-4 py-3 text-sm text-muted-foreground">{i18n._({ id: "Only an admin can change whether people can find shows in the directory.", message: "Only an admin can change whether people can find shows in the directory." })}</p>}</div></div> : null}
    {showId ? <div className="rounded-xl border px-4 py-3"><p className="font-medium">{i18n._({ id: "This show", message: "This show" })}</p>{summary.isError ? <><p className="text-sm text-muted-foreground">{i18n._({ id: "Stack is offline. Retry to reload this show summary.", message: "Stack is offline. Retry to reload this show summary." })}</p><Button type="button" variant="outline" onClick={() => void summary.refetch()}>{i18n._({ id: "Retry", message: "Retry" })}</Button></> : showStats ? <><p className="text-body">{i18n._({ id: "{count, plural, one {# ad skipped} other {# ads skipped}} · {saved}", message: "{count, plural, one {# ad skipped} other {# ads skipped}} · {saved}", values: { count: showStats.ads_skipped, saved: formatTimeSaved(showStats.seconds_saved) } })}</p>{lastProcessed ? <p className="text-sm text-muted-foreground">{i18n._({ id: "Last processed {when}", message: "Last processed {when}", values: { when: formatRelative(lastProcessed) } })}</p> : null}</> : <p className="text-sm text-muted-foreground">{i18n._({ id: "Nothing skipped yet.", message: "Nothing skipped yet." })}</p>}</div> : null}
  </section>;
}

export function PodcastShowSkipSettingsAction({ person, showId }: { person: Roster; showId: string }) {
  const navigate = useNavigate();
  if (person.age_band !== "adult" || (person.role !== "owner" && person.role !== "admin") || !showId) return null;
  return <div className="px-4 pb-6"><Button type="button" variant="outline" onClick={() => navigate(`/apps/podcasts/skip?show=${encodeURIComponent(showId)}`, { state: { pageState: { show: showId } } })}>{i18n._({ id: "Skip settings for this show", message: "Skip settings for this show" })}</Button></div>;
}
