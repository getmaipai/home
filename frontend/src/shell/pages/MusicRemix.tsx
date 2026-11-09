// MUSIC-REMIX-01: Remix opens here, on the song, and never in chat. You say what to change (the sound, the words, the tempo, the voice), the panel
// shows the exact request, and only the confirm button sends it, through the same revise route the chat edit card uses, so the change keeps the
// earlier version. Nothing is sent from a tile or a button on its own.
import { i18n } from "@lingui/core";
import { useState } from "react";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Chip } from "@maipai/ui/src/primitives/Chip";
import { useToast } from "@maipai/ui/src/primitives/Toast";
import { musicApi, type MusicCard } from "@/lib/musicApi";
import { errorLine } from "@/lib/hubReachability";
import { StatusCard } from "@maipai/ui/src/elements/status-card";

const VOICES = () => ([{ id: "", label: i18n._({ id: "Keep the voice", message: "Keep the voice" }) }, { id: "a female voice", label: i18n._({ id: "Female voice", message: "Female voice" }) }, { id: "a male voice", label: i18n._({ id: "Male voice", message: "Male voice" }) }, { id: "no vocals, instrumental only", label: i18n._({ id: "No vocals", message: "No vocals" }) }]);

/** The words of the change, built from the fields; empty when nothing was filled in. */
export function remixRequest({ style, lyrics, tempo, voice }: { style: string; lyrics: string; tempo: string; voice: string }): string {
  const parts = [style.trim() ? `Change the style to ${style.trim()}.` : "", tempo.trim() ? `Change the tempo to about ${tempo.trim()} BPM.` : "", voice ? `Use ${voice}.` : "", lyrics.trim() ? `Use these lyrics:\n${lyrics.trim()}` : ""];
  return parts.filter(Boolean).join(" ");
}

export function RemixSong({ card, onClose, onSent }: { card: MusicCard; onClose: () => void; onSent?: () => void }) {
  const { push } = useToast();
  const [style, setStyle] = useState(""); const [lyrics, setLyrics] = useState(""); const [tempo, setTempo] = useState(""); const [voice, setVoice] = useState("");
  const [reviewing, setReviewing] = useState(false); const [sending, setSending] = useState(false); const [problem, setProblem] = useState("");
  const change = remixRequest({ style, lyrics, tempo, voice });
  const send = () => {
    setSending(true); setProblem("");
    musicApi.revise(card.id, change)
      .then(() => { push(i18n._({ id: "Making your remix. It appears on this song when it is done.", message: "Making your remix. It appears on this song when it is done." })); onSent?.(); onClose(); })
      .catch((error: unknown) => setProblem(errorLine(error, i18n._({ id: "The remix could not start. Check your connection and try again.", message: "The remix could not start. Check your connection and try again." }))))
      .finally(() => setSending(false));
  };
  // The body of the Remix dialog (the dialog itself is drawn by the song page): wide, with room for the lyrics.
  return <div className="flex flex-col gap-4" data-testid="music-remix-panel" role="region" aria-label={i18n._({ id: "Remix this song", message: "Remix this song" })}>
    {reviewing ? <div className="flex flex-col gap-3" data-testid="music-remix-review">
      <p className="text-sm font-semibold">{i18n._({ id: "This is what will be made:", message: "This is what will be made:" })}</p>
      <p className="bg-muted/50 rounded-xl p-3 text-sm whitespace-pre-wrap">{change}</p>
      {problem ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={problem} /> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={sending} onClick={send}>{sending ? i18n._({ id: "Starting", message: "Starting" }) : i18n._({ id: "Make the remix", message: "Make the remix" })}</Button>
        <Button type="button" variant="secondary" disabled={sending} onClick={() => setReviewing(false)}>{i18n._({ id: "Change the request", message: "Change the request" })}</Button>
      </div>
    </div> : <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1"><label htmlFor="remix-style" className="text-sm font-medium">{i18n._({ id: "Style", message: "Style" })}</label><Input id="remix-style" value={style} onChange={(event) => setStyle(event.currentTarget.value)} maxLength={200} placeholder={i18n._({ id: "For example: slower, acoustic, with a warm piano", message: "For example: slower, acoustic, with a warm piano" })} /></div>
      <div className="flex flex-col gap-1"><label htmlFor="remix-tempo" className="text-sm font-medium">{i18n._({ id: "Tempo in beats per minute", message: "Tempo in beats per minute" })}</label><Input id="remix-tempo" type="number" min={40} max={220} value={tempo} onChange={(event) => setTempo(event.currentTarget.value)} placeholder={i18n._({ id: "For example: 96", message: "For example: 96" })} /></div>
      <div className="flex flex-col gap-2" role="group" aria-label={i18n._({ id: "Vocals", message: "Vocals" })}><span className="text-sm font-medium">{i18n._({ id: "Vocals", message: "Vocals" })}</span>
        <div className="flex flex-wrap gap-2">{VOICES().map((one) => <Chip key={one.label} selected={voice === one.id} onClick={() => setVoice(one.id)}>{one.label}</Chip>)}</div></div>
      <div className="flex flex-col gap-1"><label htmlFor="remix-lyrics" className="text-sm font-medium">{i18n._({ id: "New lyrics (optional)", message: "New lyrics (optional)" })}</label>
        <textarea id="remix-lyrics" rows={8} maxLength={4000} value={lyrics} onChange={(event) => setLyrics(event.currentTarget.value)} placeholder={i18n._({ id: "Write the new words with [Verse] and [Chorus] tags, or leave this empty.", message: "Write the new words with [Verse] and [Chorus] tags, or leave this empty." })}
          className="bg-muted/40 placeholder:text-muted-foreground w-full resize-none rounded-xl p-3 text-sm font-normal outline-none" /></div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={!change} onClick={() => setReviewing(true)}>{i18n._({ id: "Review the remix", message: "Review the remix" })}</Button>
        {change ? null : <span className="text-muted-foreground text-xs">{i18n._({ id: "Fill in at least one thing to change.", message: "Fill in at least one thing to change." })}</span>}
      </div>
    </div>}
  </div>;
}
