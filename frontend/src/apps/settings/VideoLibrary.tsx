// VIDEO-GEN-04: Home settings, Pictures and videos, the video half. The video model's state in plain words, who can
// make videos (children and teens are locked off, whatever any setting says), and the household's video styles
// (LoRA): which are on, who can use each, and a confirmation step before a new one is switched on. Admins only
// (the settings area gates it; the routes gate it again). Kit primitives only (rule 9b); the two switches the
// household can set are the keys card above this view.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@maipai/ui/src/ui/alert";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { Checkbox } from "@maipai/ui/src/ui/checkbox";
import { Input } from "@maipai/ui/src/ui/input";
import { Label } from "@maipai/ui/src/ui/label";
import { Switch } from "@maipai/ui/src/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@maipai/ui/src/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@maipai/ui/src/ui/table";
import { JobProgress } from "@maipai/ui/src/elements/job-progress";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { RadioGroup, RadioGroupItem } from "@maipai/ui/src/dashboard/components/ui/radio-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { ApiError } from "@/lib/api";
import { formatBytes } from "@maipai/ui/src/format";
import { videosApi, type VideoAdapterRow, type VideoSettings } from "@/lib/videosApi";
import { componentsApi } from "@/lib/componentsApi";
import { downloadProgress } from "@/lib/downloadProgress";

const KEY = ["video-settings"] as const;
const size = (n: number) => (formatBytes(n), n >= 1e9 ? `${n >= 1e10 ? Math.round(n / 1e9) : (n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const messageOf = (error: unknown, fallback: string) => (error instanceof ApiError ? error.message : fallback);

/** The video model's state as one plain sentence. */
export function videoStateLine(data: VideoSettings): string {
  if (!data.available) return data.reason ?? "This computer can't make videos. Videos need a Mac with 128 GB of memory.";
  if (!data.model_installed) return "No video model is installed on this computer yet.";
  if (data.state === "running") return "Making a video now.";
  return `Ready. ${data.limits}`;
}

/** VIDEO-LTX-01 (owner ruling 2026-10-17): two plain kinds of video, the same words as pictures. The choice itself is the Video quality
 * row in the keys card above this view; this section says what each kind is, whether it is on this computer, and gets Detailed through
 * the existing install job (the strip above shows the same job, rule S6) after the admin has read and accepted the maker's licence once.
 * Model names appear only under Details. */
const DETAILED_BASE = "ltx-2.3";
const kindOfBase = (base: string) => (base === DETAILED_BASE ? "Detailed videos" : "Quick videos");

function VideoQualitySection({ data, refresh }: { data: VideoSettings; refresh: () => void }) {
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [licenceOpen, setLicenceOpen] = useState(false);
  const detailed = data.detailed;
  const components = useQuery({ queryKey: ["components"], queryFn: componentsApi.list, enabled: !!detailed, refetchInterval: (q) => (q.state.data?.components?.some((row) => row.id === detailed?.component && row.state === "installing") ? 2000 : 30_000) });
  const row = components.data?.components.find((candidate) => candidate.id === detailed?.component);
  const installing = row?.state === "installing";
  const card = installing ? <JobProgress {...downloadProgress({ title: "Detailed videos", state: "running", status: "Downloading and installing", percent: row?.percent ?? undefined })} variant="full" /> : null;
  async function install(accepted?: string) {
    if (!detailed) return;
    setError(null);
    try { await componentsApi.install(detailed.component, accepted); void client.invalidateQueries({ queryKey: ["components"] }); refresh(); }
    catch (e) { setError(messageOf(e, "The engine could not start getting Detailed videos. Check that the engine is running, then try again.")); }
  }
  const quickOn = data.available && data.model_installed;
  return (
    <section aria-label="Video quality" className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">Quick and Detailed videos</h2>
      {!data.available ? (
        <Alert><AlertTitle>This computer can't make videos</AlertTitle><AlertDescription>{data.reason ?? "Videos need a Mac with 128 GB of memory."}</AlertDescription></Alert>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">Pick which one chat uses in the Video quality setting above. Anyone who can make videos can still ask chat for the other kind for one video.</p>
          <ItemGroup variant="card" aria-label="Kinds of video">
            <Item>
              <ItemContent>
                <ItemTitle>Quick</ItemTitle>
                <ItemDescription clamp={false}>{quickOn ? `Ready. ${data.state === "running" ? "Making a video now. " : ""}` : "No Quick video model is installed on this computer yet. "}5 seconds with no sound, in about 2 minutes. Can start from a picture.</ItemDescription>
              </ItemContent>
              <ItemActions><Badge variant="secondary">{quickOn ? "On this computer" : "Not installed"}</Badge></ItemActions>
            </Item>
            <Item>
              <ItemContent>
                <ItemTitle>Detailed</ItemTitle>
                <ItemDescription clamp={false}>Adds sound and spoken words, runs up to 10 seconds from words, and has many more styles to add. About a minute or two. {detailed?.installed ? "" : detailed?.reason ?? ""}</ItemDescription>
                {card}
                {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
              </ItemContent>
              <ItemActions>
                {detailed?.installed ? <Badge variant="secondary">On this computer</Badge>
                  : detailed?.available && row ? (
                    <Button type="button" disabled={installing || !row.can_install} onClick={() => (row.licence && !row.licence.accepted_at ? setLicenceOpen(true) : void install())}>
                      {installing ? "Getting Detailed videos…" : `Get Detailed videos (${size(detailed.download_bytes || row.full_bytes)})`}
                    </Button>
                  ) : null}
              </ItemActions>
            </Item>
          </ItemGroup>
          {detailed && !detailed.installed && !installing && row && !row.can_install && row.install_block ? <p className="text-sm text-muted-foreground">{row.install_block}</p> : null}
          {data.quality === "detailed" && !detailed?.installed ? (
            <Alert><AlertTitle>Detailed is chosen, but it is not ready</AlertTitle><AlertDescription>Chat makes Quick videos until Detailed videos are on this computer.</AlertDescription></Alert>
          ) : null}
          <Collapsible>
            <CollapsibleTrigger asChild><Button type="button" variant="link">What is the difference?</Button></CollapsibleTrigger>
            <CollapsibleContent>
              <Table aria-label="Quick compared with Detailed">
                <TableHeader><TableRow><TableHead /><TableHead>Quick</TableHead><TableHead>Detailed</TableHead></TableRow></TableHeader>
                <TableBody>
                  <TableRow><TableHead scope="row">Time</TableHead><TableCell>About 2 minutes</TableCell><TableCell>About 1 to 2 minutes</TableCell></TableRow>
                  <TableRow><TableHead scope="row">Starts from</TableHead><TableCell>Words or a picture</TableCell><TableCell>Words only, for now</TableCell></TableRow>
                  <TableRow><TableHead scope="row">Length</TableHead><TableCell>Up to 5 seconds</TableCell><TableCell>Up to 10 seconds</TableCell></TableRow>
                  <TableRow><TableHead scope="row">Sound</TableHead><TableCell>None</TableCell><TableCell>Sound and spoken words, made with the picture</TableCell></TableRow>
                  <TableRow><TableHead scope="row">Styles</TableHead><TableCell>A few to choose from.</TableCell><TableCell>Many more, including most styles shared online.</TableCell></TableRow>
                </TableBody>
              </Table>
            </CollapsibleContent>
          </Collapsible>
          <Collapsible>
            <CollapsibleTrigger asChild><Button type="button" variant="link">Details</Button></CollapsibleTrigger>
            <CollapsibleContent>
              <ItemGroup variant="card" aria-label="Video models">
                <Item><ItemContent><ItemTitle>Wan 2.2 FastWan 5B</ItemTitle><ItemDescription clamp={false}>Quick videos. Apache 2.0 licence. Uses about 44 GB of memory while it makes a clip.</ItemDescription></ItemContent></Item>
                <Item><ItemContent><ItemTitle>LTX-2.3 (with the Gemma 3 text encoder)</ItemTitle><ItemDescription clamp={false}>Detailed videos. {detailed?.licence?.name ?? "LTX-2.x Community License"}; the text encoder is under the Gemma Terms of Use. Uses about 44 GB of memory while it makes a clip. {row?.licence?.accepted_at ? "You accepted the licence for this computer." : ""}</ItemDescription></ItemContent></Item>
              </ItemGroup>
            </CollapsibleContent>
          </Collapsible>
        </>
      )}
      {row?.licence && !row.licence.accepted_at ? (
        <AlertDialog open={licenceOpen} onOpenChange={setLicenceOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Before you get Detailed videos</AlertDialogTitle>
              <AlertDialogDescription>It comes with its maker's licence ({row.licence.name}). Read these points, then accept to start the {size(row.download_bytes || row.full_bytes)} download. You only need to accept once for this computer.</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="flex max-h-72 flex-col gap-3 overflow-y-auto text-sm">
              <ul className="flex list-disc flex-col gap-2 pl-5">{row.licence.summary.map((line) => <li key={line}>{line}</li>)}</ul>
              <p>The full licence: <span className="font-mono break-all">{row.licence.url}</span></p>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Not now</AlertDialogCancel>
              <AlertDialogAction onClick={() => { setLicenceOpen(false); void install(row.licence!.id); }}>I accept, get it</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </section>
  );
}

function WhoMakesVideosSection({ data }: { data: VideoSettings }) {
  const rows = [
    { key: "children", label: "Children", on: false, note: "Children cannot make videos." },
    { key: "teens", label: "Teens", on: false, note: "Teens cannot make videos." },
    { key: "adults", label: "Adults", on: data.enabled, note: data.enabled ? "Adults can ask chat for videos on their own screen." : "Adults cannot make videos while the setting above is off." },
  ];
  return (
    <section aria-label="Who can make videos" className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">Who can make videos</h2>
      <ItemGroup variant="card" aria-label="Videos by age">
        {rows.map((row) => (
          <Item key={row.key}>
            <ItemContent><ItemTitle>{row.label}</ItemTitle><ItemDescription clamp={false}>{row.note}</ItemDescription></ItemContent>
            <ItemActions><Switch checked={row.on} disabled aria-label={`${row.label} can make videos`} /></ItemActions>
          </Item>
        ))}
      </ItemGroup>
      <p className="text-sm text-muted-foreground">{data.minors} Videos are never made on a spoken turn, a shared screen or for a guest. Nothing here ever allows a video that is sexual and shows a child, or anyone who looks like one.</p>
    </section>
  );
}

function StyleRow({ a, refresh, setError }: { a: VideoAdapterRow; refresh: () => void; setError: (m: string | null) => void }) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  async function toggle(enabled: boolean) {
    setError(null);
    try { await videosApi.setAdapter(a.id, { enabled }); refresh(); }
    catch (e) { setError(messageOf(e, "Could not change that style. Try again.")); }
  }
  async function remove() {
    setError(null);
    setConfirmRemove(false);
    try { await videosApi.removeAdapter(a.id); refresh(); }
    catch (e) { setError(messageOf(e, "Could not remove that style. Try again.")); }
  }
  return (
    <>
      <Item>
        <ItemContent>
          <ItemTitle>{a.name} <Badge variant={a.classification === "adult-only" ? "destructive" : "secondary"}>{a.classification === "adult-only" ? "Adults only" : "All ages"}</Badge></ItemTitle>
          <ItemDescription clamp={false}>{a.licence} · {size(a.bytes)} · made for {kindOfBase(a.base_model).toLowerCase()}{a.trigger_words.length ? ` · adds: ${a.trigger_words.join(", ")}` : ""}</ItemDescription>
          {a.needs_confirmation ? (
            <Alert>
              <AlertTitle>Check this before you turn it on</AlertTitle>
              <AlertDescription>
                <span className="block">Fingerprint (SHA-256): <span className="font-mono break-all">{a.sha256}</span></span>
                <span className="block">Licence: {a.licence}</span>
                <span className="block">{a.classification === "adult-only" ? "Only adults on their own screen can use it." : "Anyone who can make videos can use it."}</span>
              </AlertDescription>
            </Alert>
          ) : null}
        </ItemContent>
        <ItemActions>
          {a.needs_confirmation ? <Button type="button" onClick={() => void toggle(true)}>Turn it on</Button> : <Switch checked={a.enabled} onCheckedChange={(v) => void toggle(Boolean(v))} aria-label={`${a.name} is on`} />}
          <Button type="button" variant="outline" onClick={() => setConfirmRemove(true)}>Remove</Button>
        </ItemActions>
      </Item>
      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {a.name}?</AlertDialogTitle>
            <AlertDialogDescription>Its file is deleted from this computer. Videos already made with it stay.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function AddStyle({ refresh }: { refresh: () => void }) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [licence, setLicence] = useState("");
  const [read, setRead] = useState(false);
  const [allAges, setAllAges] = useState<"yes" | "no" | "unsure">("unsure");
  const [words, setWords] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setError(null);
    setBusy(true);
    const form = new FormData();
    form.append("name", name.trim());
    form.append("licence", licence.trim() || "No licence stated");
    form.append("licence_acknowledged", read ? "true" : "false");
    // Not sure means adults only: the stricter class wins.
    form.append("classification", allAges === "yes" ? "all-ages" : "adult-only");
    form.append("trigger_words", words);
    form.append("file", file, file.name);
    try {
      await videosApi.addAdapter(form);
      refresh();
      setName(""); setFile(null); setLicence(""); setRead(false); setWords(""); setAllAges("unsure");
    } catch (e) { setError(messageOf(e, "The style could not be added. Check that the engine is running, then try again.")); }
    finally { setBusy(false); }
  }

  return (
    <section aria-label="Add a video style" className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">Add a video style</h2>
      <form onSubmit={(e) => void submit(e)} className="flex max-w-xl flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="vstyle-name">Name</Label>
          <Input id="vstyle-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Old colour film" required maxLength={80} disabled={busy} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="vstyle-file">The .safetensors file (made for Quick or Detailed videos)</Label>
          <Input id="vstyle-file" type="file" accept=".safetensors" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required disabled={busy} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="vstyle-licence">Licence, as the source states it</Label>
          <Input id="vstyle-licence" value={licence} onChange={(e) => setLicence(e.target.value)} placeholder="apache-2.0, or leave empty if it says none" maxLength={120} disabled={busy} />
          <div className="flex items-center gap-2"><Checkbox id="vstyle-read" checked={read} onCheckedChange={(v) => setRead(v === true)} /><Label htmlFor="vstyle-read">I have read the licence and it lets us use this style at home.</Label></div>
        </div>
        <div className="flex flex-col gap-2">
          <Label id="vstyle-ages-label">Is this style fine for all ages?</Label>
          <RadioGroup value={allAges} onValueChange={(v) => setAllAges(v as "yes" | "no" | "unsure")} aria-labelledby="vstyle-ages-label">
            <div className="flex items-center gap-2"><RadioGroupItem value="yes" id="vstyle-ages-yes" /><Label htmlFor="vstyle-ages-yes">Yes</Label></div>
            <div className="flex items-center gap-2"><RadioGroupItem value="no" id="vstyle-ages-no" /><Label htmlFor="vstyle-ages-no">No</Label></div>
            <div className="flex items-center gap-2"><RadioGroupItem value="unsure" id="vstyle-ages-unsure" /><Label htmlFor="vstyle-ages-unsure">Not sure</Label></div>
          </RadioGroup>
          <p className="text-sm text-muted-foreground">If you are not sure, only adults can use it. A style whose own description names adult content stays adults only, whatever you pick.</p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="vstyle-words">Words that switch the style on (optional, separated by commas)</Label>
          <Input id="vstyle-words" value={words} onChange={(e) => setWords(e.target.value)} maxLength={400} disabled={busy} />
        </div>
        <p className="text-sm text-muted-foreground">The video engine checks that the file can be used. Content decisions belong to the model; Home keeps its CSAM and age protections.</p>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div><Button type="submit" disabled={busy || !file}>{busy ? "Adding…" : "Add video style"}</Button></div>
      </form>
    </section>
  );
}

export function VideoLibrary() {
  const client = useQueryClient();
  const settings = useQuery({ queryKey: KEY, queryFn: videosApi.settings, refetchInterval: 15_000 });
  const [error, setError] = useState<string | null>(null);
  const refresh = () => { void client.invalidateQueries({ queryKey: KEY }); };
  if (settings.isError || !settings.data) return <AsyncState data={settings.data} error={settings.isError} isFetching={settings.isFetching} onRetry={() => void settings.refetch()} errorMessage="Home could not load the video settings. Check the Home connection, then reload this page." loadingLabel="Loading the video settings">{() => null}</AsyncState>;
  const data = settings.data;
  return (
    <div className="mt-10 flex min-w-0 flex-col gap-10">
      <VideoQualitySection data={data} refresh={refresh} />
      <WhoMakesVideosSection data={data} />
      <section aria-label="Video styles" className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Video styles</h2>
        <p className="text-sm text-muted-foreground">A video style gives clips a look, like old colour film. {data.adult_adapters ? "Styles marked adults only can be used by adults on their own screen." : "Styles marked adults only are switched off for everyone while the setting above restricts them."}</p>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {data.adapters.length === 0 ? (
          <p className="text-sm text-muted-foreground">No video styles yet. Add one below.</p>
        ) : (
          <ItemGroup variant="card" aria-label="Video styles in the library">
            {data.adapters.map((a) => <StyleRow key={a.id} a={a} refresh={refresh} setError={setError} />)}
          </ItemGroup>
        )}
      </section>
      <AddStyle refresh={refresh} />
    </div>
  );
}
