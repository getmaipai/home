// A test helper: writes an iTunes advisory atom (`rtng`: 1 explicit, 2 clean, 4 explicit) into the `ilst` of an m4a, which
// ffmpeg cannot do. It walks moov > udta > meta > ilst, appends the atom and fixes every enclosing box size, so a test can
// exercise the real tag reader on real bytes instead of a mock.
function readBox(bytes: Uint8Array, offset: number): { size: number; type: string } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { size: view.getUint32(offset), type: new TextDecoder("latin1").decode(bytes.subarray(offset + 4, offset + 8)) };
}

export function withItunesAdvisory(m4a: Uint8Array, value: 0 | 1 | 2 | 4): Uint8Array {
  const view = new DataView(m4a.buffer, m4a.byteOffset, m4a.byteLength);
  const path: number[] = []; // offsets of the enclosing boxes, outermost first
  let offset = 0;
  let end = m4a.byteLength;
  const wanted = ["moov", "udta", "meta", "ilst"];
  for (const name of wanted) {
    let found = -1;
    while (offset < end) {
      const box = readBox(m4a, offset);
      if (box.type === name) { found = offset; break; }
      offset += box.size;
    }
    if (found < 0) throw new Error(`no ${name} box in the fixture`);
    path.push(found);
    const size = readBox(m4a, found).size;
    offset = found + 8 + (name === "meta" ? 4 : 0); // meta is a full box: four bytes of version and flags
    end = found + size;
  }
  const atom = new Uint8Array(8 + 16 + 1);
  const atomView = new DataView(atom.buffer);
  atomView.setUint32(0, atom.length);
  atom.set(new TextEncoder().encode("rtng"), 4);
  atomView.setUint32(8, 17); // data box: size, "data", type 21 (integer), locale 0, one byte
  atom.set(new TextEncoder().encode("data"), 12);
  atomView.setUint32(16, 21);
  atom[24] = value;
  const insertAt = path[3]! + readBox(m4a, path[3]!).size;
  const out = new Uint8Array(m4a.byteLength + atom.length);
  out.set(m4a.subarray(0, insertAt), 0);
  out.set(atom, insertAt);
  out.set(m4a.subarray(insertAt), insertAt + atom.length);
  const outView = new DataView(out.buffer);
  for (const box of path) outView.setUint32(box, view.getUint32(box) + atom.length);
  return out;
}
