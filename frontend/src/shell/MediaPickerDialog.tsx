// VIDEO-CREATE-02 (U3): the body of the host's media picker behind `MediaHost.pickMedia`. A `prompt_bar` reference slot (the Make page's Picture slot) opens
// it; it lists the person's own Library pictures (uploads and pictures made here, newest first) and takes a new upload through the Library's
// own upload route, then hands back the chosen Library file id and a thumbnail. Closing it hands back null.
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@maipai/ui/src/ui/button";
import { SafeImage } from "@maipai/ui/src/primitives/SafeImage";
import { api, ApiError } from "@/lib/api";
import { uploadLibraryFile } from "@/lib/libraryUpload";

export interface PickedMedia { id: string; thumb?: string }
export type PickKind = "picture" | "character" | "place";

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
    if (!PICTURE_TYPES.split(",").includes(file.type)) { setError("Choose a PNG, JPEG or WebP picture."); return; }
    setBusy(true);
    setError(null);
    try {
      const added = await uploadLibraryFile(file);
      void queryClient.invalidateQueries({ queryKey: ["media-picker"] });
      onDone({ id: added.id, thumb: thumbUrlFor(added.id) });
    } catch (caught) {
      setError(caught instanceof ApiError && caught.message ? caught.message : "Home could not add that picture. Check your connection and try again.");
      setBusy(false);
    }
  };
  return (
    <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input ref={input} type="file" accept={PICTURE_TYPES} hidden data-testid="media-picker-file" onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ""; }} />
          <Button type="button" variant="secondary" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Adding" : "Add a picture"}</Button>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>
        {pictures.isPending ? <p className="text-sm text-muted-foreground">Loading your pictures.</p> : null}
        {pictures.isError ? <p role="alert" className="text-sm text-destructive">Your pictures did not load. Close this and try again.</p> : null}
        {pictures.data && pictures.data.length === 0 ? <p className="text-sm text-muted-foreground">You have no pictures in your Library yet. Add one above.</p> : null}
        {pictures.data && pictures.data.length > 0 ? (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label="Your pictures">
            {pictures.data.map((item) => (
              <li key={item.id}>
                <button type="button" className="block aspect-square w-full overflow-hidden rounded-md border border-border focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Use ${item.name}`} onClick={() => onDone({ id: item.id, thumb: item.thumb_url })}>
                  <SafeImage src={item.thumb_url} alt="" draggable={false} className="size-full object-cover" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
    </div>
  );
}
