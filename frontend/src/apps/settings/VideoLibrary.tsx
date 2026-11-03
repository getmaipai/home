// VIDEO-GEN-04: Home settings, Pictures and videos, the video half. The video model's state in plain words, who can
// make videos (children and teens are locked off, whatever any setting says), and the household's video styles
// (LoRA) now live on the Styles tab (VIDEO-LORA-08). Admins only
// (the settings area gates it; the routes gate it again). Kit primitives only (rule 9b); the two switches the
// household can set are the keys card above this view.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { Switch } from "@maipai/ui/src/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@maipai/ui/src/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@maipai/ui/src/ui/table";
import { JobProgress } from "@maipai/ui/src/elements/job-progress";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { ApiError } from "@/lib/api";
import { formatBytes } from "@maipai/ui/src/format";
import { videosApi, type VideoSettings } from "@/lib/videosApi";
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
    catch (e) { setError(messageOf(e, "Getting Detailed videos could not start. Videos are not ready yet, so try again in a minute.")); }
  }
  const quickOn = data.available && data.model_installed;
  return (
    <section aria-label="Video quality" className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">Quick and Detailed videos</h2>
      {!data.available ? (
        <p className="text-sm text-muted-foreground">{data.reason ?? "This computer cannot make videos."}</p>
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
            <p className="text-sm text-muted-foreground">Detailed is chosen, but it is not on this computer yet. Chat makes Quick videos until it is.</p>
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

export function VideoLibrary() {
  const client = useQueryClient();
  const settings = useQuery({ queryKey: KEY, queryFn: videosApi.settings, refetchInterval: 15_000 });
  const refresh = () => { void client.invalidateQueries({ queryKey: KEY }); };
  if (settings.isError || !settings.data) return <AsyncState data={settings.data} error={settings.isError} isFetching={settings.isFetching} onRetry={() => void settings.refetch()} errorMessage="Home could not load the video settings. Check the Home connection, then reload this page." loadingLabel="Loading the video settings">{() => null}</AsyncState>;
  const data = settings.data;
  return (
    <div className="mt-10 flex min-w-0 flex-col gap-10">
      <VideoQualitySection data={data} refresh={refresh} />
      <WhoMakesVideosSection data={data} />
    </div>
  );
}
