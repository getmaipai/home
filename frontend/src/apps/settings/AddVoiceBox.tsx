import { i18n } from "@lingui/core";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@maipai/ui/src/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@maipai/ui/src/ui/toggle-group";
import { AddVoiceForm } from "@/apps/settings/AddVoiceForm";
import { api } from "@/lib/api";
import { countryFlag } from "@/lib/voice/countryFlag";
import { filterVoiceLibrary, type LibraryVoice } from "@/lib/voice/voiceLibraryFilter";
import { voicePreviewPlayer, type VoicePreviewState } from "@/lib/voice/voicePreviewPlayer";

export function AddVoiceBox({ onNotice }: { onNotice: (line: string) => void }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("download");
  const [query, setQuery] = useState("");
  const [gender, setGender] = useState("");
  const [country, setCountry] = useState("");
  const [quality, setQuality] = useState("");
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [playing, setPlaying] = useState<VoicePreviewState>(voicePreviewPlayer.getState());
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const unsubscribe = voicePreviewPlayer.subscribe(setPlaying); return () => { unsubscribe(); }; }, []);
  const library = useQuery({ queryKey: ["voice-library"], queryFn: api.voiceLibrary, enabled: open });
  const rows = useMemo(() => library.data?.voices ?? [], [library.data]);
  const filtered = useMemo(() => filterVoiceLibrary(rows, { q: query, gender, country, quality }), [rows, query, gender, country, quality]);
  const countries = useMemo(() => [...new Map(rows.filter((v) => v.country && v.countryName).map((v) => [v.country!, { code: v.country!, name: v.countryName! }])).values()], [rows]);

  async function add(voice: LibraryVoice) {
    setActionError(null);
    try {
      await api.selectCatalogVoice(voice.id);
      await Promise.all([client.invalidateQueries({ queryKey: ["stack-voices"] }), client.invalidateQueries({ queryKey: ["household-voices"] })]);
      setAdded((old) => new Set(old).add(voice.id));
      onNotice(i18n._({ id: "{name} is now your voice. You can change it any time.", message: "{name} is now your voice. You can change it any time.", values: { name: voice.name } }));
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : i18n._({ id: "Could not add this voice. Try again.", message: "Could not add this voice. Try again." })); }
  }
  function clear() { setQuery(""); setGender(""); setCountry(""); setQuality(""); }
  return <>
    <Button type="button" onClick={() => { setOpen(true); setTab("download"); }}>{i18n._({ id: "+ Add voice", message: "+ Add voice" })}</Button>
    <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}>
      <DialogContent variant="flow" size="xl" scroll="viewport">
        <DialogHeader><DialogTitle size="xl">{i18n._({ id: "Add voice", message: "Add voice" })}</DialogTitle><DialogDescription>{i18n._({ id: "Choose a voice to download, clone or make inspired by a recording.", message: "Choose a voice to download, clone or make inspired by a recording." })}</DialogDescription></DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList aria-label={i18n._({ id: "Add voice method", message: "Add voice method" })}>
            <TabsTrigger value="download">{i18n._({ id: "Download", message: "Download" })}</TabsTrigger>
            <TabsTrigger value="clone">{i18n._({ id: "Clone", message: "Clone" })}</TabsTrigger>
            <TabsTrigger value="inspired">{i18n._({ id: "Inspired", message: "Inspired" })}</TabsTrigger>
          </TabsList>
          <TabsContent value="download"><div className="flex flex-col gap-4">
            <Input aria-label={i18n._({ id: "Search voices", message: "Search voices" })} placeholder={i18n._({ id: "Search name, detail, country or language", message: "Search name, detail, country or language" })} value={query} onChange={(e) => setQuery(e.target.value)} />
            <div className="flex flex-wrap items-center gap-3">
              <span>{i18n._({ id: "Gender", message: "Gender" })}</span><ToggleGroup type="single" variant="chip" value={gender} onValueChange={setGender} aria-label={i18n._({ id: "Gender", message: "Gender" })}><ToggleGroupItem value="woman">{i18n._({ id: "Woman", message: "Woman" })}</ToggleGroupItem><ToggleGroupItem value="man">{i18n._({ id: "Man", message: "Man" })}</ToggleGroupItem></ToggleGroup>
              <span>{i18n._({ id: "Country", message: "Country" })}</span><ToggleGroup type="single" variant="chip" wrap value={country} onValueChange={setCountry} aria-label={i18n._({ id: "Country", message: "Country" })}>{countries.map((c) => <ToggleGroupItem key={c.code} value={c.code}><span aria-hidden="true">{countryFlag(c.code)}</span> {c.name}</ToggleGroupItem>)}</ToggleGroup>
              <span>{i18n._({ id: "Quality", message: "Quality" })}</span><ToggleGroup type="single" variant="chip" value={quality} onValueChange={setQuality} aria-label={i18n._({ id: "Quality", message: "Quality" })}>{(["good", "great", "best"] as const).map((q) => <ToggleGroupItem key={q} value={q}>{i18n._({ id: q === "good" ? "Good" : q === "great" ? "Great" : "Best", message: q === "good" ? "Good" : q === "great" ? "Great" : "Best" })}</ToggleGroupItem>)}</ToggleGroup>
              <span aria-live="polite">{i18n._({ id: "{count} voices", message: "{count} voices", values: { count: filtered.length } })}</span><Button type="button" variant="outline" onClick={clear}>{i18n._({ id: "Clear", message: "Clear" })}</Button>
            </div>
            {actionError ? <p role="alert">{actionError}</p> : null}
            {playing.error ? <p role="alert">{playing.error}</p> : null}
            <AsyncState data={library.data} error={library.isError} isFetching={library.isFetching} onRetry={() => void library.refetch()} errorMessage={library.error instanceof Error ? library.error.message : i18n._({ id: "Could not load voices. Try again.", message: "Could not load voices. Try again." })} loadingLabel={i18n._({ id: "Loading voices", message: "Loading voices" })}>
              {() => filtered.length === 0 ? <div><p>{i18n._({ id: "No voices match. Clear a filter or try another word.", message: "No voices match. Clear a filter or try another word." })}</p><Button type="button" variant="outline" onClick={clear}>{i18n._({ id: "Clear", message: "Clear" })}</Button></div> : <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{filtered.map((voice) => <li key={voice.id} className="flex flex-col gap-3 rounded-xl border border-border p-4">
                <div className="flex items-center gap-3"><span aria-hidden="true" className="text-title">{countryFlag(voice.country)}</span><div><p className="font-medium">{voice.name}</p><p className="text-body text-muted-foreground">{voice.detail}</p>{voice.countryName ? <p className="text-body text-muted-foreground">{voice.countryName}</p> : null}</div></div>
                <span aria-label={i18n._({ id: "{quality} quality", message: "{quality} quality", values: { quality: voice.quality } })} className="text-body">{[1, 2, 3].map((n) => <span key={n} aria-hidden="true" className={n <= ({ good: 1, great: 2, best: 3 }[voice.quality]) ? "text-primary" : "text-muted-foreground"}>● </span>)}</span>
                <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => playing.voiceId === voice.sampleUrl ? voicePreviewPlayer.stop() : void voicePreviewPlayer.start(voice.sampleUrl)}>{playing.voiceId === voice.sampleUrl ? i18n._({ id: "Stop", message: "Stop" }) : i18n._({ id: "Play", message: "Play" })}</Button><Button type="button" disabled={added.has(voice.id)} onClick={() => void add(voice)}>{added.has(voice.id) ? i18n._({ id: "Added", message: "Added" }) : i18n._({ id: "Add", message: "Add" })}</Button></div>
              </li>)}</ul>}
            </AsyncState>
            <p className="text-body text-muted-foreground">{library.data?.attribution ?? rows[0]?.attribution}</p>
          </div></TabsContent>
          <TabsContent value="clone"><AddVoiceForm canTune onBusyChange={setBusy} onCancel={() => setOpen(false)} onMade={(name) => { setOpen(false); onNotice(i18n._({ id: "{name} is ready. Test it here, then pick it for a person or a robot.", message: "{name} is ready. Test it here, then pick it for a person or a robot.", values: { name } })); }} /></TabsContent>
          <TabsContent value="inspired"><AddVoiceForm inspired canTune={false} onBusyChange={setBusy} onCancel={() => setOpen(false)} onMade={(name) => { setOpen(false); onNotice(i18n._({ id: "{name} is ready. Test it here, then pick it for a person or a robot.", message: "{name} is ready. Test it here, then pick it for a person or a robot.", values: { name } })); }} /></TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  </>;
}
