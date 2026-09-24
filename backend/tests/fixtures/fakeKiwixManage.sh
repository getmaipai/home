#!/bin/sh
# A scripted stand-in for kiwix-manage, kiwixSidecar.test.ts's own
# regenerateLibrary() tests: real kiwix-manage reads a ZIM's embedded
# metadata to build a <book> element (id, title, favicon...); this
# only needs to prove regenerateLibrary() calls it once per .zim file
# with the library path and the file's own path, so it inserts one
# minimal <book path="..."/> line before </library> instead.
set -eu
LIBRARY="$1"
ZIM="$3"
ZIM_NAME=$(basename "$ZIM")
TMP="${LIBRARY}.tmp"
sed "s#</library>#  <book path=\"${ZIM_NAME}\" />\n</library>#" "$LIBRARY" > "$TMP"
mv "$TMP" "$LIBRARY"
