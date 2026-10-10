// GENUI-05: the picture set of an answer as an `image_gallery` answer block. This is the one place the set's
// display data (which pictures, the caption with its licence, the badge rule) becomes the block's props; the live
// turn (turn.ts) and the read of a turn stored before GENUI-05 (the `answer_images` column of migration 0087)
// both build their block here, so the two cannot drift apart.
//
// It supersedes the separate `answer_images` shape: the stored column, the `images` stream event and the
// `answer-images` data part. The picture proxy (`/api/answer-image`, its cache and its per-band 404) is unchanged:
// the block's `src` is that route's address, which the host's `hubImageSources` check demands.
import { createHash } from "node:crypto";
import type { AnswerBlock } from "@maipai/spec/gen/ts/answer-block.js";
import type { AnswerImageSet } from "../../wire";

/** The package that produces the block (the model-facing tool and the block's `producer`). */
export const SHOW_IMAGES_PRODUCER = "show_images";
/** Tiles in the row; the rest open from the badge. The one definition: select.ts imports it, and the candidate
 * counts there scale from it (IMG-QUALITY-01a, owner ruling: five tiles). */
export const GALLERY_VISIBLE = 5;
/** Candidates fetched per call (select.ts picks them, fetch.ts caps on it): about two per tile plus four spare, since
 * the filters, the fetch deadline and the duplicate check drop some. Five tiles need about ten. */
export const ANSWER_IMAGES_MAX_CANDIDATES = GALLERY_VISIBLE * 2 + 4;
const ALT_SUBJECT_MAX = 120;

type GalleryProps = { images: Array<Record<string, unknown>>; maxVisible: number };

/** The gallery's props from a picture set: a lone extra picture is dropped, so the badge never reads +1 and always
 * equals what the gallery holds. Null when the set has no picture. */
export function galleryProps(set: Pick<AnswerImageSet, "visible" | "items">): GalleryProps | null {
  if (set.items.length === 0) return null;
  const visible = Math.max(1, Math.min(set.visible, GALLERY_VISIBLE));
  const items = set.items.length > visible && set.items.length - visible < 2 ? set.items.slice(0, visible) : set.items;
  return {
    maxVisible: Math.min(visible, items.length),
    images: items.map((item) => ({
      id: item.id,
      src: item.src,
      alt: item.alt,
      caption: item.license ? `${item.caption} · ${item.license.short}${item.license.artist ? `, ${item.license.artist}` : ""}` : item.caption,
      source: { label: item.source.site, url: item.source.url },
    })),
  };
}

/** IMG-QUALITY-01b: the pictures a conversation has already shown, read from its stored `image_gallery` blocks (each
 * item's `id` and `source.url`); nothing is stored for it. */
export type ShownPictures = { ids: Set<string>; sources: Set<string> };

/** Adds the pictures of every `image_gallery` block in `blocks` to `into`. */
export function collectShownPictures(blocks: ReadonlyArray<{ kind?: unknown; props?: unknown }>, into: ShownPictures): void {
  for (const block of blocks) {
    if (block.kind !== "image_gallery") continue;
    const images = (block.props as { images?: unknown } | undefined)?.images;
    if (!Array.isArray(images)) continue;
    for (const image of images as Array<{ id?: unknown; source?: { url?: unknown } }>) {
      if (typeof image?.id === "string") into.ids.add(image.id);
      if (typeof image?.source?.url === "string" && image.source.url) into.sources.add(image.source.url);
    }
  }
}

function altFor(subject: string | null, count: number): string {
  const what = count === 1 ? "A photo" : `${count} photos`;
  return subject ? `${what} of ${subject.replace(/\s+/g, " ").trim().slice(0, ALT_SUBJECT_MAX)}.` : `${what} that ${count === 1 ? "goes" : "go"} with this answer.`;
}

/** The raw `image_gallery` block for one `show_images` call; the turn still runs it through the one block filter
 * (manifest allowlist, spec check, hub picture address, age band, output floor). Null when there is no picture. */
export function galleryBlockFor(set: Pick<AnswerImageSet, "visible" | "items">, subject: string, provenance: string, hlc: string): Record<string, unknown> | null {
  const props = galleryProps(set);
  if (!props) return null;
  return {
    id: `blk-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    kind: "image_gallery",
    schema_version: 1,
    producer: SHOW_IMAGES_PRODUCER,
    alt: altFor(subject, props.images.length),
    provenance,
    created_at: new Date().toISOString(),
    hlc,
    props,
  };
}

/** A turn stored before GENUI-05 kept its pictures in `answer_images`. Read as the block it would be today, with a
 * stable id and the turn's own time, so an old turn renders the same gallery in the same place (its
 * `after_paragraph` carries over) and a reload never changes it. Null when the stored value is not a picture set. */
export function legacyGalleryBlock(stored: unknown, turnId: string, turnCreatedAt: string): AnswerBlock | null {
  const set = stored as Partial<AnswerImageSet> | null;
  if (!set || !Array.isArray(set.items) || typeof set.after_paragraph !== "number") return null;
  const props = galleryProps({ visible: typeof set.visible === "number" ? set.visible : GALLERY_VISIBLE, items: set.items });
  if (!props) return null;
  const at = Number.isFinite(Date.parse(turnCreatedAt)) ? new Date(turnCreatedAt) : new Date(0);
  return {
    id: `blk-${createHash("sha256").update(`legacy-images:${turnId}`).digest("hex").slice(0, 12)}`,
    kind: "image_gallery",
    schema_version: 1,
    producer: SHOW_IMAGES_PRODUCER,
    alt: altFor(null, props.images.length),
    provenance: `show_images pictures stored with turn ${turnId} before answer blocks`,
    created_at: at.toISOString(),
    hlc: `${at.getTime()}:0:legacy`,
    props: props as never,
    after_paragraph: Math.max(0, Math.floor(set.after_paragraph)),
  } as AnswerBlock;
}
