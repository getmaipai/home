// IMGGEN-SET-01: Home settings, Pictures and videos. The picture model, who can make pictures, and the household's
// styles (LoRA): which are on, how they were added, and a plain confirmation step before a new one is switched on.
// Admins only (the settings area gates it; the routes gate it again). Kit primitives only (rule 9b); the two
// switches the household can set (adults on or off, adult-only styles) are the keys card above this view.
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@maipai/ui/src/ui/alert";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { Checkbox } from "@maipai/ui/src/ui/checkbox";
import { Input } from "@maipai/ui/src/ui/input";
import { Label } from "@maipai/ui/src/ui/label";
import { JobProgress } from "@maipai/ui/src/elements/job-progress";
import { Switch } from "@maipai/ui/src/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@maipai/ui/src/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@maipai/ui/src/ui/table";
import { RadioGroup, RadioGroupItem } from "@maipai/ui/src/dashboard/components/ui/radio-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { ApiError } from "@/lib/api";
import { picturesAdminApi, type AdminAdapter, type AdminOverview } from "@/lib/picturesApi";
import { downloadProgress } from "@/lib/downloadProgress";

const OVERVIEW_KEY = ["pictures-admin"] as const;
/** Home takes a request body of at most 128 MiB (the server's own limit); a bigger style comes by its Hugging Face link. */
const MAX_UPLOAD_BYTES = 120 * 1024 * 1024;
const size = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const messageOf = (error: unknown, fallback: string) => (error instanceof ApiError ? error.message : fallback);

function useJob(jobId: string | null, onDone: () => void) {
  const query = useQuery({
    queryKey: ["pictures-admin-job", jobId],
    queryFn: () => picturesAdminApi.job(jobId!),
    enabled: jobId !== null,
    refetchInterval: (q) => (q.state.data?.state === "running" || q.state.data === undefined ? 1000 : false),
  });
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (jobId && query.data && query.data.state !== "running" && done.current !== jobId) { done.current = jobId; onDone(); }
  }, [jobId, query.data, onDone]);
  return query.data ?? null;
}

/** IMGGEN-QUALITY-01 (owner ruling 2026-10-17): two plain kinds of picture. The choice itself is the Picture quality row in the keys
 * card above this view; this section says what each kind is, whether it is on this computer, and gets Detailed (the install job and
 * the progress strip are the existing ones, rule S6). Model names appear only under Details. */
const QUICK_MODEL_ID = "flux2-klein-4b";
const DETAILED_MODEL_ID = "z-image-turbo";
const kindOfModel = (id: string) => (id === DETAILED_MODEL_ID ? "Detailed pictures" : id === QUICK_MODEL_ID ? "Quick pictures" : id);

function PictureModelSection({ overview, refresh }: { overview: AdminOverview; refresh: () => void }) {
  const [job, setJob] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [family, setFamily] = useState<string | undefined>(undefined);
  const progress = useJob(job, () => { setJob(null); setFamily(undefined); refresh(); });
  const engine = overview.engine;
  const installed = engine.models.filter((m) => m.installed);
  const detailed = engine.models.find((m) => m.id === DETAILED_MODEL_ID);
  const installing = job !== null && progress?.state !== "failed";
  const card = installing ? <JobProgress {...downloadProgress({ title: "The picture model", state: "running", status: progress?.label || "Downloading and installing", percent: progress?.percent ?? 0 })} variant="full" /> : null;
  async function install(which?: string) {
    setError(null);
    setFamily(which);
    try { setJob((await picturesAdminApi.installModel(which)).job); }
    catch (e) { setFamily(undefined); setError(messageOf(e, "The picture engine could not start the install. Check that the engine is running, then try again.")); }
  }
  return (
    <section aria-label="Picture quality" className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">Quick and Detailed pictures</h2>
      {overview.stack === "unreachable" ? (
        <Alert><AlertTitle>The picture engine isn't answering</AlertTitle><AlertDescription>Check that the engine is running, then reload this page.</AlertDescription></Alert>
      ) : installed.length > 0 ? (
        <>
          <p className="text-sm text-muted-foreground">Pick which one chat uses in the Picture quality setting above. Anyone can still ask chat for the other kind for one picture.</p>
          <ItemGroup variant="card" aria-label="Kinds of picture">
            <Item>
              <ItemContent>
                <ItemTitle>Quick</ItemTitle>
                <ItemDescription clamp={false}>Clear words in about 15 to 25 seconds. It also changes pictures you already have.</ItemDescription>
              </ItemContent>
              <ItemActions><Badge variant="secondary">On this computer</Badge></ItemActions>
            </Item>
            <Item>
              <ItemContent>
                <ItemTitle>Detailed</ItemTitle>
                <ItemDescription clamp={false}>Takes about 30 to 45 seconds. Finer detail, and many more styles to add.{detailed && !detailed.installed && !detailed.available ? " This computer does not have the memory for it." : ""}</ItemDescription>
              </ItemContent>
              <ItemActions>
                {detailed?.installed ? <Badge variant="secondary">On this computer</Badge>
                  : detailed?.available ? <Button type="button" onClick={() => void install(DETAILED_MODEL_ID)} disabled={installing}>{installing && family === DETAILED_MODEL_ID ? "Getting Detailed pictures…" : `Get Detailed pictures (${size(detailed.remaining_bytes)})`}</Button>
                  : null}
              </ItemActions>
            </Item>
          </ItemGroup>
          {overview.quality === "detailed" && !overview.detailed_ready ? (
            <Alert><AlertTitle>Detailed is chosen, but it is not ready</AlertTitle><AlertDescription>Chat makes Quick pictures until Detailed pictures are on this computer.</AlertDescription></Alert>
          ) : null}
          <Collapsible>
            <CollapsibleTrigger asChild><Button type="button" variant="link">What is the difference?</Button></CollapsibleTrigger>
            <CollapsibleContent>
              <Table aria-label="Quick compared with Detailed">
                <TableHeader><TableRow><TableHead /><TableHead>Quick</TableHead><TableHead>Detailed</TableHead></TableRow></TableHeader>
                <TableBody>
                  <TableRow><TableHead scope="row">Time</TableHead><TableCell>About 15 to 25 seconds</TableCell><TableCell>About 30 to 45 seconds</TableCell></TableRow>
                  <TableRow><TableHead scope="row">Look</TableHead><TableCell>Clean and sharp. Good for most pictures and for words in a picture.</TableCell><TableCell>Finer detail, skin and fur that look real.</TableCell></TableRow>
                  <TableRow><TableHead scope="row">Styles</TableHead><TableCell>A few to choose from.</TableCell><TableCell>Many more, including most styles shared online.</TableCell></TableRow>
                  <TableRow><TableHead scope="row">Changing a picture</TableHead><TableCell>Yes (Edit)</TableCell><TableCell>No. Edit always uses Quick.</TableCell></TableRow>
                </TableBody>
              </Table>
            </CollapsibleContent>
          </Collapsible>
          <Collapsible>
            <CollapsibleTrigger asChild><Button type="button" variant="link">Details</Button></CollapsibleTrigger>
            <CollapsibleContent>
              <ItemGroup variant="card" aria-label="Installed picture models">
                {installed.map((m) => (
                  <Item key={m.id}>
                    <ItemContent>
                      <ItemTitle>{m.label}</ItemTitle>
                      <ItemDescription clamp={false}>{kindOfModel(m.id)}. {m.licence ? `${m.licence} licence. ` : ""}{m.peak_gb ? `Uses up to ${m.peak_gb} GB of memory while it draws. ` : ""}{m.edit ? "Also changes pictures. " : ""}</ItemDescription>
                    </ItemContent>
                  </Item>
                ))}
              </ItemGroup>
            </CollapsibleContent>
          </Collapsible>
        </>
      ) : (
        <Item variant="outline">
          <ItemContent>
            <ItemTitle>No picture model is installed</ItemTitle>
            <ItemDescription clamp={false}>{engine.reason ?? `Installing one downloads about ${size(engine.remaining_bytes)} once. Pictures are then made on this computer and nothing leaves it.`}</ItemDescription>
          </ItemContent>
          <ItemFooter>
            <Button type="button" onClick={() => void install()} disabled={installing || !engine.available}>{installing ? "Installing…" : "Install the picture model"}</Button>
          </ItemFooter>
        </Item>
      )}
      {card}
      {progress?.state === "failed" ? <p role="alert" className="text-sm text-destructive">{progress.error}</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </section>
  );
}

function WhoMakesPicturesSection({ overview }: { overview: AdminOverview }) {
  return (
    <section aria-label="Who can make pictures" className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">Who can make pictures</h2>
      <ItemGroup variant="card" aria-label="Pictures by age">
        {overview.bands.map((b) => (
          <Item key={b.band}>
            <ItemContent>
              <ItemTitle>{b.label}</ItemTitle>
              <ItemDescription clamp={false}>{b.note}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Switch checked={b.on} disabled aria-label={`${b.label} can make pictures`} />
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
      <p className="text-sm text-muted-foreground">Adults are switched on or off in the settings above. Home blocks CSAM and keeps the child and teen safeguards in place.</p>
    </section>
  );
}

function StyleRow({ a, refresh, setError }: { a: AdminAdapter; refresh: () => void; setError: (m: string | null) => void }) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  async function toggle(enabled: boolean) {
    setError(null);
    try { await picturesAdminApi.setEnabled(a.id, enabled); refresh(); }
    catch (e) { setError(messageOf(e, "Could not change that style. Try again.")); }
  }
  async function remove() {
    setError(null);
    setConfirmRemove(false);
    try { await picturesAdminApi.remove(a.id); refresh(); }
    catch (e) { setError(messageOf(e, "Could not remove that style. Try again.")); }
  }
  return (
    <>
      <Item>
        <ItemContent>
          <ItemTitle>{a.name} <Badge variant={a.classification === "adult-only" ? "destructive" : "secondary"}>{a.classification === "adult-only" ? "Adults only" : "All ages"}</Badge></ItemTitle>
          <ItemDescription clamp={false}>
            {a.licence} · {size(a.bytes)} · made for {kindOfModel(a.base_model).toLowerCase()}{a.trigger_words.length ? ` · adds: ${a.trigger_words.join(", ")}` : ""}
          </ItemDescription>
          {a.needs_confirmation ? (
            <Alert>
              <AlertTitle>Check this before you turn it on</AlertTitle>
              <AlertDescription>
                <span className="block">Fingerprint (SHA-256): <span className="font-mono break-all">{a.sha256}</span></span>
                <span className="block">Licence: {a.licence}{a.licence_known ? "" : ". The source did not state one, so you chose to add it anyway."}</span>
                <span className="block">{a.classification === "adult-only" ? "Only adults on their own screen can use it." : "Anyone who can make pictures can use it."}</span>
              </AlertDescription>
            </Alert>
          ) : null}
        </ItemContent>
        <ItemActions>
          {a.needs_confirmation ? (
            <Button type="button" onClick={() => void toggle(true)}>Turn it on</Button>
          ) : (
            <Switch checked={a.enabled} onCheckedChange={(v) => void toggle(Boolean(v))} aria-label={`${a.name} is on`} />
          )}
          <Button type="button" variant="outline" onClick={() => setConfirmRemove(true)}>Remove</Button>
        </ItemActions>
      </Item>
      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {a.name}?</AlertDialogTitle>
            <AlertDialogDescription>Its file is deleted from this computer. Pictures already made with it stay.</AlertDialogDescription>
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
  const [source, setSource] = useState<"link" | "file" | "path">("link");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [path, setPath] = useState("");
  const [licence, setLicence] = useState("");
  const [read, setRead] = useState(false);
  const [allAges, setAllAges] = useState<"yes" | "no" | "unsure">("unsure");
  const [words, setWords] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<string | null>(null);
  const progress = useJob(job, () => { setJob(null); refresh(); });
  const card = job && progress?.state !== "failed" ? <JobProgress {...downloadProgress({ title: "The style", state: "running", status: progress?.label || "Fetching the style", percent: progress?.percent ?? 0 })} variant="full" /> : null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (source === "file" && file && file.size > MAX_UPLOAD_BYTES) {
      setError(`That file is ${size(file.size)}. Home can take files up to ${size(MAX_UPLOAD_BYTES)} here. For a bigger one, choose \"A file already on this computer\" and type where it is saved, or paste its Hugging Face link.`);
      return;
    }
    setBusy(true);
    const form = new FormData();
    form.append("name", name.trim());
    form.append("licence", licence.trim());
    form.append("licence_acknowledged", read ? "true" : "false");
    form.append("all_ages", allAges);
    form.append("trigger_words", words);
    if (source === "link") form.append("url", url.trim());
    else if (source === "path") form.append("path", path.trim());
    else if (file) form.append("file", file, file.name);
    try {
      const reply = await picturesAdminApi.addAdapter(form);
      if ("job" in reply) setJob(reply.job);
      else { refresh(); }
      setName(""); setUrl(""); setFile(null); setPath(""); setLicence(""); setRead(false); setWords(""); setAllAges("unsure");
    } catch (e) { setError(messageOf(e, "The style could not be added. Check that the engine is running, then try again.")); }
    finally { setBusy(false); }
  }

  return (
    <section aria-label="Add a style" className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">Add a style</h2>
      <form onSubmit={(e) => void submit(e)} className="flex max-w-xl flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="style-name">Name</Label>
          <Input id="style-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ink wash" required maxLength={80} disabled={busy} />
        </div>
        <RadioGroup value={source} onValueChange={(v) => setSource(v as "link" | "file" | "path")} aria-label="Where the style is">
          <div className="flex items-center gap-2"><RadioGroupItem value="link" id="style-src-link" /><Label htmlFor="style-src-link">Hugging Face link</Label></div>
          <div className="flex items-center gap-2"><RadioGroupItem value="file" id="style-src-file" /><Label htmlFor="style-src-file">A file from this computer</Label></div>
          <div className="flex items-center gap-2"><RadioGroupItem value="path" id="style-src-path" /><Label htmlFor="style-src-path">A file already on this computer (for big files)</Label></div>
        </RadioGroup>
        {source === "link" ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="style-url">Link to the .safetensors file</Label>
            <Input id="style-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://huggingface.co/.../resolve/main/style.safetensors" required disabled={busy} />
          </div>
        ) : source === "path" ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="style-path">Where the .safetensors file is saved on this computer</Label>
            <Input id="style-path" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/Users/you/Downloads/style.safetensors" required disabled={busy} />
            <p className="text-sm text-muted-foreground">Download the file yourself, from Civitai or anywhere else you trust, then give its full path. Nothing is fetched for you and no account is needed.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Label htmlFor="style-file">The .safetensors file (up to 120 MB)</Label>
            <Input id="style-file" type="file" accept=".safetensors" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required disabled={busy} />
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="style-licence">Licence, as the source states it</Label>
          <Input id="style-licence" value={licence} onChange={(e) => setLicence(e.target.value)} placeholder="apache-2.0, or leave empty if it says none" maxLength={200} disabled={busy} />
          <div className="flex items-center gap-2"><Checkbox id="style-read" checked={read} onCheckedChange={(v) => setRead(v === true)} /><Label htmlFor="style-read">I have read the licence and it lets us use this style at home.</Label></div>
        </div>
        <div className="flex flex-col gap-2">
          <Label id="style-ages-label">Is this style fine for all ages?</Label>
          <RadioGroup value={allAges} onValueChange={(v) => setAllAges(v as "yes" | "no" | "unsure")} aria-labelledby="style-ages-label">
            <div className="flex items-center gap-2"><RadioGroupItem value="yes" id="style-ages-yes" /><Label htmlFor="style-ages-yes">Yes</Label></div>
            <div className="flex items-center gap-2"><RadioGroupItem value="no" id="style-ages-no" /><Label htmlFor="style-ages-no">No</Label></div>
            <div className="flex items-center gap-2"><RadioGroupItem value="unsure" id="style-ages-unsure" /><Label htmlFor="style-ages-unsure">Not sure</Label></div>
          </RadioGroup>
          <p className="text-sm text-muted-foreground">If you are not sure, only adults can use it.</p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="style-words">Words that switch the style on (optional, separated by commas)</Label>
          <Input id="style-words" value={words} onChange={(e) => setWords(e.target.value)} maxLength={400} disabled={busy} />
        </div>
        <p className="text-sm text-muted-foreground">The picture engine checks that the file can be used. Content decisions belong to the model; Home keeps its CSAM and age protections.</p>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {card}
        {progress?.state === "failed" ? <p role="alert" className="text-sm text-destructive">{progress.error}</p> : null}
        <div><Button type="submit" disabled={busy || job !== null}>{busy ? "Adding…" : "Add style"}</Button></div>
      </form>
    </section>
  );
}

export function PicturesLibrary() {
  const client = useQueryClient();
  const overview = useQuery({ queryKey: OVERVIEW_KEY, queryFn: picturesAdminApi.overview, refetchInterval: 15_000 });
  const [error, setError] = useState<string | null>(null);
  const refresh = () => { void client.invalidateQueries({ queryKey: OVERVIEW_KEY }); };
  if (overview.isError) return <p role="alert" className="text-sm text-destructive">Home could not load the picture settings. Check the Home connection, then reload this page.</p>;
  if (!overview.data) return <p className="text-sm text-muted-foreground">Loading the picture settings…</p>;
  const data = overview.data;
  return (
    <div className="flex min-w-0 flex-col gap-10">
      <PictureModelSection overview={data} refresh={refresh} />
      <WhoMakesPicturesSection overview={data} />
      <section aria-label="Styles" className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Styles</h2>
        <p className="text-sm text-muted-foreground">A style gives pictures a look, like pixel art or ink wash. {data.adult_adapters === "restricted" ? "Styles marked adults only are switched off for everyone while the setting above restricts them." : "Styles marked adults only can be used by adults on their own screen."}</p>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {data.adapters.length === 0 ? (
          <p className="text-sm text-muted-foreground">No styles yet. Add one below.</p>
        ) : (
          <ItemGroup variant="card" aria-label="Styles in the library">
            {data.adapters.map((a) => <StyleRow key={a.id} a={a} refresh={refresh} setError={setError} />)}
          </ItemGroup>
        )}
      </section>
      <AddStyle refresh={refresh} />
    </div>
  );
}
