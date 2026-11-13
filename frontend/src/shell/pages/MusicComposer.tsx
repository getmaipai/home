// The Music mode of the one composer (ONE-COMPOSER-01). The kit's PromptBar draws the panel from the mode record that
// `musicComposerMode.ts` builds (placeholder, Make / Singing / Length chips, Quality, Presets, a song to change, the primary button).
// What the kit has no slot for sits under it as one Custom section made of kit parts: lyrics with structure tags, a title, style chips
// and the advanced settings (takes, seed, key, tempo). It is one composer with one drawer, not a second composer.
// Create runs the same path as the generate_music tool (POST /api/music/songs), so every field here is a tool argument too.
import { i18n } from "@lingui/core";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PromptBar } from "@maipai/ui/src/elements/prompt-bar";
import { Button } from "@maipai/ui/src/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@maipai/ui/src/ui/collapsible";
import { Input } from "@maipai/ui/src/ui/input";
import { Label } from "@maipai/ui/src/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";
import { Slider } from "@maipai/ui/src/ui/slider";
import { Textarea } from "@maipai/ui/src/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@maipai/ui/src/ui/toggle-group";
import { Chip } from "@maipai/ui/src/primitives/Chip";
import { useToast } from "@maipai/ui/src/primitives/Toast";
import { getIcon } from "@maipai/ui/src/icons";
import { request } from "@/lib/api";
import { musicApi, type MusicCard } from "@/lib/musicApi";
import { MAKE_SONG_ADULT_LINE, NO_MUSIC_ENGINE_LINE } from "./MakeSongPage";
import { CreatePage } from "./MusicStudioPages";
import { VoiceCreate } from "./MusicVoiceCreate";
import { FORM_MAKES, musicMode, musicQuality, type Make } from "./musicComposerMode";
import {
  BPM_MAX, BPM_MIN, EMPTY_FORM, EMPTY_SOUND, KEYS, STARTER_STYLE_CHIPS, STRUCTURE_TAGS,
  createBlocker, createBody, formLikeSong, insertStructureTag, soundBody, toggleTag, type CreateForm, type SoundForm, type Takes, type Tier,
} from "./musicCreateForm";

type StyleRow = { id: string; title?: string };
type BandRow = { id: string; name?: string };
const AUTO = "auto";
const ChevronDown = getIcon("chevron-down");
const text = (error: unknown, fallback: string): string => (error instanceof Error && error.message ? error.message : fallback);
const AUDIO_FILE = /\.(mp3|m4a|wav|aac|ogg|flac)$/i;
export const BRING_LINE = () => i18n._({ id: "Add one audio file under 40 MB: mp3, m4a, wav, aac, ogg or flac.", message: "Add one audio file under 40 MB: mp3, m4a, wav, aac, ogg or flac." });

/** One grouped block of the Custom section: a quiet title and its body. */
function Block({ title, hint, children, testId }: { title: string; hint?: string; children: React.ReactNode; testId?: string }) {
  return <section className="bg-muted/40 flex flex-col gap-3 rounded-xl p-3" data-testid={testId}>
    <header className="flex flex-col gap-0.5">
      <h3 className="text-muted-foreground text-supporting font-semibold">{title}</h3>
      {hint ? <p className="text-muted-foreground text-supporting">{hint}</p> : null}
    </header>
    {children}
  </section>;
}

export interface MusicComposerProps {
  /** The address's query string: `style` and `band` preselect a saved sound; `like` and `seed` fill the form from a made song ("Make another like this"). */
  search?: string;
  /** The style chips picked, held by the page so the starter tiles under the composer can add to them. */
  tags: string[];
  onTags: (next: string[]) => void;
  /** Called with the job id once the song or sound is started. */
  onMade: (id: string) => void;
  adult?: boolean;
}

export function MusicComposer({ search = "", tags, onTags, onMade, adult = true }: MusicComposerProps) {
  const { push } = useToast();
  const prefill = new URLSearchParams(search);
  const [make, setMake] = useState<Make>("song");
  const [form, setFormState] = useState<CreateForm>({ ...EMPTY_FORM, styleId: prefill.get("style"), bandId: prefill.get("band") });
  const [sound, setSoundState] = useState<SoundForm>(EMPTY_SOUND);
  const [custom, setCustom] = useState(false);
  const [reference, setReference] = useState<{ id: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [making, setMaking] = useState(false);
  const [problem, setProblem] = useState("");
  const lyricsRef = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<CreateForm>) => setFormState((current) => ({ ...current, ...patch }));
  const status = useQuery({ queryKey: ["music-status"], queryFn: () => musicApi.status(), staleTime: 10_000, retry: false });
  const styles = useQuery({ queryKey: ["music-made", "song_style"], queryFn: () => request<StyleRow[]>("/api/music/styles?scope=all"), staleTime: 15_000, enabled: adult });
  const bands = useQuery({ queryKey: ["music-made", "band"], queryFn: () => request<BandRow[]>("/api/music/bands"), staleTime: 15_000, enabled: adult });
  const like = prefill.get("like");
  const likeSeed = prefill.get("seed");
  const liked = useQuery({ queryKey: ["music-song", like], queryFn: ({ signal }) => musicApi.card(like!, signal), enabled: !!like, staleTime: 60_000 });
  const filled = useRef<string | null>(null);
  useEffect(() => {
    const song: MusicCard | undefined = liked.data;
    if (!like || !song || filled.current === like) return;
    filled.current = like;
    setFormState((current) => ({ ...current, ...formLikeSong({ ...song, seed: likeSeed ? Number(likeSeed) : song.seed }), styleId: current.styleId, bandId: current.bandId }));
    setCustom(true);
  }, [like, likeSeed, liked.data]);
  useEffect(() => { const params = new URLSearchParams(search); setFormState((current) => ({ ...current, styleId: params.get("style") ?? current.styleId, bandId: params.get("band") ?? current.bandId })); }, [search]);

  const withTags: CreateForm = { ...form, tags };
  const engineMissing = status.data ? !status.data.can_make : false;
  const blocked = status.isError ? text(status.error, "") : "";
  const noun = make === "sound" ? "sound" : "song";
  const formMake = FORM_MAKES.includes(make);
  const blocker = formMake ? i18n._({ id: "Fill in the form below to make this.", message: "Fill in the form below to make this." }) : createBlocker(withTags, { engineMissing, statusPending: status.isPending, making: making || uploading, adult, blocked }, { adult: MAKE_SONG_ADULT_LINE(), engine: NO_MUSIC_ENGINE_LINE() }, noun);
  const limits = status.data?.limits ?? null;

  const upload = async (picked: File) => {
    setProblem("");
    if (!AUDIO_FILE.test(picked.name) || picked.size > 40 * 1024 * 1024) { setProblem(BRING_LINE()); return; }
    setUploading(true);
    try {
      const body = new FormData(); body.append("file", picked, picked.name);
      const result = await request<{ id: string; name: string }>("/api/library/upload", { method: "POST", body });
      setReference({ id: result.id, name: result.name || picked.name });
    } catch (error) { console.error(error); setProblem(BRING_LINE()); }
    finally { setUploading(false); }
  };

  const create = () => {
    if (blocker) { if (!making) push(blocker); return; }
    setMaking(true); setProblem("");
    const failure = (error: unknown) => { const line = text(error, noun === "song" ? i18n._({ id: "Home could not start the song. Check the request and try again.", message: "Home could not start the song. Check the request and try again." }) : i18n._({ id: "Home could not start the sound. Check the request and try again.", message: "Home could not start the sound. Check the request and try again." })); setProblem(line); push(line); };
    const done = (card: MusicCard) => { setFormState((current) => ({ ...EMPTY_FORM, tier: current.tier, styleId: current.styleId, bandId: current.bandId })); onTags([]); setReference(null); onMade(card.id); };
    const run = make === "sound" ? musicApi.makeSound(soundBody(form.idea, sound, form.takes))
      : reference ? musicApi.editFromFile({ file_id: reference.id, change: "restyle", style: describe(withTags) })
        : musicApi.makeSong(createBody(withTags));
    run.then(done).catch(failure).finally(() => setMaking(false));
  };
  const addStructure = (tag: string) => {
    const box = lyricsRef.current;
    const start = box?.selectionStart ?? form.lyrics.length, end = box?.selectionEnd ?? form.lyrics.length;
    const next = insertStructureTag(form.lyrics, start, end, tag);
    set({ lyrics: next.text });
    requestAnimationFrame(() => { lyricsRef.current?.focus(); lyricsRef.current?.setSelectionRange(next.caret, next.caret); });
  };

  const tiers: readonly Tier[] = status.data?.tiers ?? ["standard"];
  const input = {
    make, form: withTags, sound, tiers,
    styles: Array.isArray(styles.data) ? styles.data : [], bands: Array.isArray(bands.data) ? bands.data : [],
    reference, referenceReason: adult ? (uploading ? i18n._({ id: "Adding your song.", message: "Adding your song." }) : "") : MAKE_SONG_ADULT_LINE(),
    setMake: (next: Make) => { setMake(next); setProblem(""); }, setForm: set, setSound: (patch: Partial<SoundForm>) => setSoundState((current) => ({ ...current, ...patch })),
    onPickReference: () => picker.current?.click(), onClearReference: () => setReference(null), onTags,
    onClear: () => set({ idea: "" }),
  };
  const mode = musicMode(input);
  const detailedLine = form.takes > 1 && make === "song" ? i18n._({ id: "{count} songs are made one after another, about a minute each, and show on one card you can step through.", message: "{count} songs are made one after another, about a minute each, and show on one card you can step through.", values: { count: form.takes } }) : "";

  return <>
    <PromptBar
      label={make === "sound" ? i18n._({ id: "Describe the sound", message: "Describe the sound" }) : i18n._({ id: "Describe your song", message: "Describe your song" })}
      value={form.idea} onValueChange={(idea) => set({ idea })} maxLength={make === "sound" ? 600 : 1200}
      layout="chat" modes={[mode]} mode="music" onModeChange={() => undefined} quality={make === "song" && !reference ? musicQuality(input) : undefined}
      onSubmit={create} busy={making || uploading} disabledReason={blocker} error={problem || null} submitLabel={mode.primaryLabel}
    />
    <input ref={picker} type="file" hidden accept=".mp3,.m4a,.wav,.aac,.ogg,.flac,audio/*" data-testid="music-reference-input" onChange={(event) => { const picked = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (picked) void upload(picked); }} />
    {tags.length ? <div className="flex flex-wrap gap-2" role="group" aria-label={i18n._({ id: "Picked styles", message: "Picked styles" })} data-testid="music-picked-styles">
      {tags.map((name) => <Chip key={name} onRemove={() => onTags(toggleTag(tags, name))} removeLabel={i18n._({ id: "Remove {name}", message: "Remove {name}", values: { name } })}>{name}</Chip>)}
    </div> : null}
    {detailedLine ? <p className="text-muted-foreground text-supporting" role="status">{detailedLine}</p> : null}
    {make === "song" && !reference ? <Collapsible open={custom} onOpenChange={setCustom} data-testid="music-custom">
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-expanded={custom}>{i18n._({ id: "Custom", message: "Custom" })}<span className="text-muted-foreground font-normal">{i18n._({ id: "Your own words, a title, styles, seed", message: "Your own words, a title, styles, seed" })}</span><ChevronDown className={custom ? "rotate-180" : ""} aria-hidden /></Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-3 grid items-start gap-3 lg:grid-cols-2">
          <Block title={i18n._({ id: "Lyrics", message: "Lyrics" })} hint={form.instrumental ? i18n._({ id: "Instrumental is on, so there are no words.", message: "Instrumental is on, so there are no words." }) : i18n._({ id: "Leave empty and Home writes the words.", message: "Leave empty and Home writes the words." })} testId="music-lyrics-block">
            <div className="flex flex-wrap gap-2" role="group" aria-label={i18n._({ id: "Add a part", message: "Add a part" })}>
              {STRUCTURE_TAGS.map((tag) => <Chip key={tag} tone="quiet" onClick={() => addStructure(tag)}>{`[${tag}]`}</Chip>)}
            </div>
            <Textarea ref={lyricsRef} aria-label={i18n._({ id: "Lyrics", message: "Lyrics" })} fill="surface" rows={8} maxLength={4000} disabled={form.instrumental} value={form.lyrics} onChange={(event) => set({ lyrics: event.currentTarget.value })}
              placeholder={form.instrumental ? i18n._({ id: "Instrumental", message: "Instrumental" }) : i18n._({ id: "[Verse]\nWrite your own words here, a line at a time.\n\n[Chorus]\nOr leave this empty and Home writes them.", message: "[Verse]\nWrite your own words here, a line at a time.\n\n[Chorus]\nOr leave this empty and Home writes them." })} />
          </Block>
          <div className="flex flex-col gap-3">
            <Block title={i18n._({ id: "Title", message: "Title" })}>
              <Input aria-label={i18n._({ id: "Title", message: "Title" })} maxLength={200} value={form.title} onChange={(event) => set({ title: event.currentTarget.value })} placeholder={i18n._({ id: "Home picks one if you leave this empty", message: "Home picks one if you leave this empty" })} />
            </Block>
            <Block title={i18n._({ id: "Styles", message: "Styles" })} hint={i18n._({ id: "Pick up to 8. Words only, never lyrics.", message: "Pick up to 8. Words only, never lyrics." })} testId="music-styles-panel">
              <div className="flex flex-wrap gap-2" role="group" aria-label={i18n._({ id: "Styles", message: "Styles" })}>
                {tags.filter((name) => !(STARTER_STYLE_CHIPS as readonly string[]).includes(name)).map((name) => <Chip key={name} selected onClick={() => onTags(toggleTag(tags, name))}>{name}</Chip>)}
                {STARTER_STYLE_CHIPS.slice(0, 8).map((name) => <Chip key={name} selected={tags.includes(name)} onClick={() => onTags(toggleTag(tags, name))}>{name}</Chip>)}
              </div>
            </Block>
          </div>
          <Block title={i18n._({ id: "Advanced", message: "Advanced" })}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label id="song-takes-label">{i18n._({ id: "Songs to make", message: "Songs to make" })}</Label>
                <ToggleGroup type="single" variant="outline" value={String(form.takes)} onValueChange={(next) => { if (next === "1" || next === "2" || next === "3") set({ takes: Number(next) as Takes }); }} aria-labelledby="song-takes-label">
                  {[1, 2, 3].map((count) => <ToggleGroupItem key={count} value={String(count)} aria-label={i18n._({ id: "{count, plural, one {# take} other {# takes}}", message: "{count, plural, one {# take} other {# takes}}", values: { count } })}>{count}</ToggleGroupItem>)}
                </ToggleGroup>
                <p className="text-muted-foreground text-supporting">{limits ? i18n._({ id: "Up to {minutes, plural, one {# minute} other {# minutes}} on this computer.", message: "Up to {minutes, plural, one {# minute} other {# minutes}} on this computer.", values: { minutes: Math.floor(limits.max_seconds / 60) } }) : i18n._({ id: "Each take is a different song from the same words.", message: "Each take is a different song from the same words." })}</p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="song-seed">{i18n._({ id: "Seed", message: "Seed" })}</Label>
                <div className="flex gap-2">
                  <Input id="song-seed" inputMode="numeric" value={form.seed} onChange={(event) => set({ seed: event.currentTarget.value.replace(/[^0-9]/g, "") })} placeholder={i18n._({ id: "Random", message: "Random" })} aria-describedby="song-seed-hint" />
                  <Button type="button" variant="outline" disabled={!form.seed} onClick={() => set({ seed: "" })}>{i18n._({ id: "Random", message: "Random" })}</Button>
                </div>
                <p id="song-seed-hint" className="text-muted-foreground text-supporting">{i18n._({ id: "The same seed with the same words makes a very similar song.", message: "The same seed with the same words makes a very similar song." })}</p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="song-key">{i18n._({ id: "Key", message: "Key" })}</Label>
                <Select value={form.key || AUTO} onValueChange={(next) => set({ key: !next || next === AUTO ? "" : next })}>
                  <SelectTrigger id="song-key" width="full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value={AUTO}>{i18n._({ id: "Auto", message: "Auto" })}</SelectItem>{KEYS.map((one) => <SelectItem key={one} value={one}>{one}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2"><Label id="song-bpm-label">{i18n._({ id: "Tempo (BPM)", message: "Tempo (BPM)" })}</Label><span className="text-supporting tabular-nums" data-testid="song-bpm-value">{form.bpm > 0 ? form.bpm : i18n._({ id: "Auto", message: "Auto" })}</span></div>
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1"><Slider aria-labelledby="song-bpm-label" min={BPM_MIN - 1} max={BPM_MAX} step={1} value={[form.bpm > 0 ? form.bpm : BPM_MIN - 1]} onValueChange={(next) => set({ bpm: (next[0] ?? 0) < BPM_MIN ? 0 : next[0]! })} /></div>
                  <Button type="button" variant="outline" size="sm" disabled={form.bpm === 0} onClick={() => set({ bpm: 0 })}>{i18n._({ id: "Auto", message: "Auto" })}</Button>
                </div>
              </div>
            </div>
          </Block>
        </div>
      </CollapsibleContent>
    </Collapsible> : null}
    {make === "band" || make === "album" || make === "song_style" ? <CreatePage kind={make} adult={adult} /> : make === "voice" ? <VoiceCreate /> : null}
  </>;
}

function describe(form: CreateForm): string { return createBody(form).idea; }
