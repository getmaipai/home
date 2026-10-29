import { useEffect, useRef } from "react";

/**
 * Asks for the cut-off parts of a picture to be drawn in, once per picture, without a button. Any editor that shows a
 * picture with a `clipped` edge list can use it (the companion creator today, the chat image editor next).
 * `skip` holds it back while something else is working or for a picture that should not change by itself.
 */
export function useFillCutOff(picture: { id: string; clipped?: readonly string[] } | null, options: { skip: boolean; fill: (pictureId: string) => void }) {
  const asked = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!picture?.clipped?.length || options.skip || asked.current.has(picture.id)) return;
    asked.current.add(picture.id); options.fill(picture.id);
    // `fill` is the caller's current closure; only a different picture or a lifted `skip` should re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picture?.id, picture?.clipped?.length, options.skip]);
}
