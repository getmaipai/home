import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { StudioLayout } from "@maipai/ui/src/elements/studio-layout";
import { List } from "@maipai/ui/src/primitives/List";
import { Badge } from "@maipai/ui/src/dashboard/components/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@maipai/ui/src/dashboard/components/ui/avatar";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { Progress } from "@maipai/ui/src/dashboard/components/ui/progress";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { ApiError, api, type CompanionStateRow } from "@/lib/api";
import { CompanionLookTab } from "@/shell/pages/CompanionLookTab";
import { CompanionStateContents } from "@/shell/pages/CompanionStateCard";
import { companionAppearanceKey, useCompanionStates } from "@/shell/pages/useCompanionStates";

type StudioItem = { id: string; label: string; status: string; state: CompanionStateRow | null };
const errorText = (error: unknown) => error instanceof ApiError ? error.message : "Could not reach Home. Check your connection and try again.";

export function CompanionStudioTab({ id, name, prompt, promptError, onPromptChange, active, draft }: { id: string; name: string; prompt: string; promptError?: string; onPromptChange: (value: string) => void; active: boolean; draft: boolean }) {
  const states = useCompanionStates(id, active);
  const appearanceQuery = useQuery({ queryKey: companionAppearanceKey(id), queryFn: () => api.companionAppearance(id), enabled: active, retry: false });
  const lookQuery = useQuery({ queryKey: ["companions", id, "look"], queryFn: () => api.companionLook(id), enabled: active, retry: false });
  const [selected, setSelected] = useState<string | null>(null);
  const data = states.data;
  const appearance = appearanceQuery.data;
  const look = lookQuery.data;
  const rest = look?.versions.find((version) => version.id === look.rest);
  useEffect(() => {
    if (!data || !look) return;
    setSelected((current) => {
      if (current !== "portrait" && data.states.some((state) => state.id === current)) return current;
      return look.sheet?.state === "approved" && rest ? "idle" : "portrait";
    });
  }, [data, look, rest]);
  const items = useMemo<StudioItem[]>(() => data ? [
    { id: "portrait", label: "Portrait", status: rest ? "Selected" : "Not chosen", state: null },
    ...data.states.map((state) => ({ id: state.id, label: state.label, status: `${state.approved ? "Assigned" : state.required ? "Required" : "Optional"}${state.takes.length ? "" : " · empty"}`, state })),
  ] : [] , [data, rest]);
  if (!active) return null;
  if (states.query.isError || appearanceQuery.isError || lookQuery.isError) {
    // Portrait editing must not depend on the clips endpoints: show the reason and keep the portrait editor usable.
    const failed = states.query.isError ? states.query : appearanceQuery.isError ? appearanceQuery : lookQuery;
    return <>
      <Alert variant="destructive"><AlertDescription>{errorText(failed.error)} <Button type="button" variant="link" onClick={() => { void states.query.refetch(); void appearanceQuery.refetch(); void lookQuery.refetch(); }}>Try again</Button></AlertDescription></Alert>
      <CompanionLookTab id={id} prompt={prompt} promptError={promptError} onPromptChange={onPromptChange} active />
    </>;
  }
  if (!data || !appearance || !look) return <AsyncState data={undefined} isFetching={states.query.isFetching || appearanceQuery.isFetching || lookQuery.isFetching} onRetry={() => { void states.query.refetch(); void appearanceQuery.refetch(); void lookQuery.refetch(); }} loadingLabel="Loading appearance studio">{() => null}</AsyncState>;
  const selectedKey = selected ?? (look.sheet?.state === "approved" && rest ? "idle" : "portrait");
  const selectedState = data.states.find((state) => state.id === selectedKey) ?? null;
  const activeTake = selectedState ? selectedState.takes.find((take) => take.id === selectedState.approved?.take_id) ?? selectedState.takes.find((take) => take.is_best) : null;
  const sheetApproved = data.sheet_ready;
  const badgeText = appearance.has_changes ? "Review needed" : appearance.published ? "Published" : "Draft";
  const nav = <><List items={items} getKey={(item) => item.id} label="Character and states" onSelect={(item) => setSelected(item.id)} isSelected={(item) => item.id === selectedKey} renderItem={(item) => <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2"><span className="min-w-0 break-words">{item.label}</span><Badge variant={item.id === selectedKey ? "secondary" : "outline"}>{item.status}</Badge></div>} />
    <p className="mt-4 text-sm text-muted-foreground">Changes stay in draft until published.</p></>;
  const actions = <><div className="flex flex-wrap items-center gap-2"><Button disabled={!appearance.can_publish || states.publishing} onClick={() => void states.publish()}>{states.publishing ? "Publishing…" : "Publish appearance"}</Button>{draft ? <div className="flex flex-col"><Button asChild variant="outline"><Link to={`/chat?try=${encodeURIComponent(id)}`}>Try it</Link></Button><span className="text-sm text-muted-foreground">Opens a temporary chat. Nothing is saved.</span></div> : null}{!appearance.can_publish && appearance.reasons[0] ? <span className="text-sm text-muted-foreground">{appearance.reasons[0]}</span> : null}</div>{states.status ? <Alert><AlertDescription>{states.status}</AlertDescription></Alert> : null}</>;
  const readiness = <section aria-label="Clip readiness" className="mb-4 flex flex-col gap-2"><h2 className="text-lg font-semibold">{data.counts.approved} of {data.counts.total} ready</h2><Progress value={data.counts.approved / data.counts.total * 100} aria-label="Approved clips" /><div className="flex flex-wrap gap-2"><Button disabled={!data.sheet_ready || !data.start_ready || states.running || !data.states.some((state) => !state.approved)} onClick={() => void states.start(() => api.generateCompanionStates(id, { required_only: false }))}>Generate missing clips</Button><Button variant="outline" disabled={!data.sheet_ready || !data.start_ready || states.running || data.counts.required_missing.length === 0} onClick={() => void states.start(() => api.generateCompanionStates(id, { required_only: true }))}>Generate required clips</Button></div></section>;
  const main = <>
    {!sheetApproved ? <Alert><AlertDescription>Approve the character sheet in Portrait first. Every clip starts from it. You can still copy a prompt for another tool.</AlertDescription></Alert> : null}
    {!data.start_ready ? <Alert><AlertDescription>{data.start_reason}</AlertDescription></Alert> : null}
    {selectedState ? readiness : null}
    {selectedKey === "portrait" ? <CompanionLookTab id={id} prompt={prompt} promptError={promptError} onPromptChange={onPromptChange} active /> : selectedState ? <CompanionStateContents id={id} state={selectedState} busy={states.running} startReady={data.start_ready} sheetReady={data.sheet_ready} onAction={states.perform} onError={states.setError} /> : null}
  </>;
  const rail = <div className="flex flex-col gap-4">
    <Card><CardHeader><CardTitle>Character reference</CardTitle></CardHeader><CardContent><div className="flex flex-col gap-3"><Avatar><AvatarImage src={rest ? api.companionLookImage(id, rest.id) : undefined} alt="" /><AvatarFallback>{name.trim().charAt(0).toUpperCase() || "?"}</AvatarFallback></Avatar><p className="text-sm text-muted-foreground">Use the approved portrait for every state.</p><Button variant="outline" onClick={() => setSelected("portrait")}>Change portrait</Button></div></CardContent></Card>
    <Card><CardHeader><CardTitle>Clip checks</CardTitle></CardHeader><CardContent>{selectedState ? activeTake && activeTake.ok !== null ? <><p>{activeTake.ok ? "Passed quality checks" : "Missed a quality check"}</p>{activeTake.reasons.map((reason, index) => <p key={`${index}-${reason}`}>{reason}</p>)}</> : <p>No clip quality report is available.</p> : <p>Pick a state to see its clip checks.</p>}</CardContent></Card>
    <Card><CardHeader><CardTitle>Recent generation</CardTitle></CardHeader><CardContent>{states.running ? <><p>{states.run?.label ?? data.run?.label ?? "Starting clip run"}</p><Progress value={states.run?.percent ?? data.run?.percent ?? 0} aria-label={states.run?.label ?? "Clip run progress"} /></> : <p>Nothing is running.</p>}</CardContent></Card>
  </div>;
  return <>
    {states.error ? <Alert variant="destructive"><AlertDescription>{states.error}</AlertDescription></Alert> : null}
    <StudioLayout title="Appearance studio" subtitle={<>{name} · <Badge>{badgeText}</Badge></>} actions={actions} navLabel="Character and states" nav={nav} rail={rail}>{main}</StudioLayout>
  </>;
}
