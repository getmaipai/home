import { i18n } from "@lingui/core";
// VIDEO-CREATE-02 (U3): the body of the host's media picker behind `MediaHost.pickMedia`. A `prompt_bar` reference slot (the Make page's Picture slot) opens
// it; it lists the person's own Library pictures (uploads and pictures made here, newest first) and takes a new upload through the Library's
// own upload route, then hands back the chosen Library file id and a thumbnail. Closing it hands back null.
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@maipai/ui/src/ui/button";
import { Textarea } from "@maipai/ui/src/ui/textarea";
import { SafeImage } from "@maipai/ui/src/primitives/SafeImage";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { api, ApiError } from "@/lib/api";
import { bedSongFirst } from "@/shell/library/musicBed";
import { uploadLibraryFile } from "@/lib/libraryUpload";
import { localizedApiMessage } from "@/lib/apiErrorLines";
import { StatusCard } from "@maipai/ui/src/elements/status-card";

export interface PickedMedia { id: string; thumb?: string }
export type PickKind = "picture" | "character" | "place";
/** VIDEO-STUDIO-07: the Studio's Add a clip (`video`) and Add a voice or Add music (`audio`). */
export type StudioPickKind = "video" | "audio";
/** The id an audio pick returns for a typed line (the Studio's Add a voice); anything else is the Library id of a song. */
export const SAY_PREFIX = "say:";
export const SAY_MAX_LENGTH = 600;

const PICTURE_TYPES = "image/png,image/jpeg,image/webp";
export const thumbUrlFor = (id: string): string => `/api/files/${encodeURIComponent(id)}/thumb?w=320`;

/** The body of the picker dialog (the host draws the Dialog itself around it). */
export function MediaPickerBody({ kind, personId, onDone }: { kind: PickKind; personId: string | undefined; onDone: (picked: PickedMedia | null) => void }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pictures = useQuery({
    queryKey: ["media-picker", kind, personId],
    queryFn: async () => (await api.library({ type: "image", owner: "me", sort: "newest", limit: 60 })).items.filter((item) => item.owner.id === personId && PICTURE_TYPES.includes(item.media_type)),
  });
  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!PICTURE_TYPES.split(",").includes(file.type)) { setError(i18n._({ id: "Choose a PNG, JPEG or WebP picture.", message: "Choose a PNG, JPEG or WebP picture." })); return; }
    setBusy(true);
    setError(null);
    try {
      const added = await uploadLibraryFile(file);
      void queryClient.invalidateQueries({ queryKey: ["media-picker"] });
      onDone({ id: added.id, thumb: thumbUrlFor(added.id) });
    } catch (caught) {
      setError(caught instanceof ApiError && caught.message ? localizedApiMessage(caught) : "Home could not add that picture. Check your connection and try again.");
      setBusy(false);
    }
  };
  return (
    <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input ref={input} type="file" accept={PICTURE_TYPES} hidden data-testid="media-picker-file" onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ""; }} />
          <Button type="button" variant="secondary" disabled={busy} onClick={() => input.current?.click()}>{busy ? i18n._({ id: "Adding", message: "Adding" }) : i18n._({ id: "Add a picture", message: "Add a picture" })}</Button>
          {error ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={error} /> : null}
        </div>
        <AsyncState data={pictures.data} error={pictures.isError} isFetching={pictures.isFetching} onRetry={() => void pictures.refetch()} errorMessage={i18n._({ id: "Your pictures did not load. Close this and try again.", message: "Your pictures did not load. Close this and try again." })} loadingLabel={i18n._({ id: "Loading your pictures", message: "Loading your pictures" })}>
          {(rows) => rows.length === 0 ? <p className="text-sm text-muted-foreground">{i18n._({ id: "You have no pictures in your Library yet. Add one above.", message: "You have no pictures in your Library yet. Add one above." })}</p> : (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label={i18n._({ id: "Your pictures", message: "Your pictures" })}>
              {rows.map((item) => (
                <li key={item.id}>
                  <button type="button" className="block aspect-square w-full overflow-hidden rounded-md border border-border focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Use ${item.name}`} onClick={() => onDone({ id: item.id, thumb: item.thumb_url })}>
                    <SafeImage src={item.thumb_url} alt="" draggable={false} className="size-full object-cover" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </AsyncState>
    </div>
  );
}

/** VIDEO-STUDIO-07: the body of the Studio's picker. `video` lists the person's own made clips. `audio` is one box for the two sounds the Studio lays
 * under a film: a typed line for Home to say (handed back as `say:<line>`) and the person's own songs (their Library id). The kit asks for `audio` in both
 * cases, so `start` (which button was pressed) only chooses the side that opens first; the page's add action answers a wrong pick with one plain line. */
export function StudioPickerBody({ kind, start, personId, onDone }: { kind: StudioPickKind; start: "voice" | "music"; personId: string | undefined; onDone: (picked: PickedMedia | null) => void }) {
  const [side, setSide] = useState<"voice" | "music">(start);
  const [line, setLine] = useState("");
  const library = useQuery({
    queryKey: ["studio-picker", kind, personId],
    queryFn: async () => (await api.library(kind === "video" ? { type: "video", owner: "me", sort: "newest", limit: 60 } : { type: "audio", owner: "me", sort: "newest", limit: 60 })).items.filter((item) => item.owner.id === personId && (kind === "audio" || item.origin === "made")),
    enabled: kind === "video" || side === "music",
  });
  const items = kind === "audio" ? bedSongFirst(library.data ?? []) : (library.data ?? []);
  const noun = kind === "video" ? "clips" : "songs";
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {kind === "audio" ? (
        <div className="flex gap-2" role="group" aria-label={i18n._({ id: "What to add", message: "What to add" })}>
          <Button type="button" variant={side === "voice" ? "default" : "secondary"} aria-pressed={side === "voice"} onClick={() => setSide("voice")}>{i18n._({ id: "Say a line", message: "Say a line" })}</Button>
          <Button type="button" variant={side === "music" ? "default" : "secondary"} aria-pressed={side === "music"} onClick={() => setSide("music")}>{i18n._({ id: "Your songs", message: "Your songs" })}</Button>
        </div>
      ) : null}
      {kind === "audio" && side === "voice" ? (
        <div className="flex flex-col gap-2">
          <Textarea aria-label={i18n._({ id: "The line to say", message: "The line to say" })} value={line} maxLength={SAY_MAX_LENGTH} showCount placeholder={i18n._({ id: "Type what the voice should say.", message: "Type what the voice should say." })} onChange={(event) => setLine(event.target.value)} />
          <div><Button type="button" disabled={line.trim().length === 0} onClick={() => onDone({ id: `${SAY_PREFIX}${line.trim()}` })}>{i18n._({ id: "Add this line", message: "Add this line" })}</Button></div>
        </div>
      ) : (
        <>
          <AsyncState data={library.data} error={library.isError} isFetching={library.isFetching} onRetry={() => void library.refetch()} errorMessage={i18n._({ id: "Your {noun} did not load. Close this and try again.", message: "Your {noun} did not load. Close this and try again.", values: { noun } })} loadingLabel={i18n._({ id: "Loading your {noun}", message: "Loading your {noun}", values: { noun } })}>
            {() => items.length === 0 ? <p className="text-sm text-muted-foreground">{kind === "video" ? i18n._({ id: "You have no clips yet. Make one on the Create page.", message: "You have no clips yet. Make one on the Create page." }) : i18n._({ id: "You have no songs in your Library yet. Make one in Audio.", message: "You have no songs in your Library yet. Make one in Audio." })}</p> : (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label={i18n._({ id: "Your {noun}", message: "Your {noun}", values: { noun } })}>
                {items.map((item) => (
                  <li key={item.id}>
                    <button type="button" className="block w-full overflow-hidden rounded-md border border-border text-left focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Use ${item.name}`} onClick={() => onDone({ id: item.id, thumb: item.thumb_url })}>
                      {kind === "video" && item.audience !== "adult-only" ? <SafeImage src={item.thumb_url} alt="" draggable={false} className="aspect-video w-full object-cover" /> : null}
                      <span className="block truncate px-2 py-1 text-sm">{item.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </AsyncState>
        </>
      )}
    </div>
  );
}
