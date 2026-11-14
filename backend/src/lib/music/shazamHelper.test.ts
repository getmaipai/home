import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findShazamPython, makeSignature, wavOf } from "./shazamHelper";

const dirs: string[] = [];
const oldPython = process.env.MAIPAI_SHAZAM_PYTHON;
function temp(): string { const path = mkdtempSync(join(tmpdir(), "shazam-helper-")); dirs.push(path); return path; }
afterEach(() => {
  if (oldPython === undefined) delete process.env.MAIPAI_SHAZAM_PYTHON; else process.env.MAIPAI_SHAZAM_PYTHON = oldPython;
  for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("Shazam helper", () => {
  test("writes mono s16le WAV header and samples", () => {
    const wav = wavOf(Int16Array.from([1, -2]), 11025);
    const view = new DataView(wav.buffer);
    expect(wav.length).toBe(48);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe("WAVE");
    expect(view.getUint32(24, true)).toBe(11025);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(40, true)).toBe(4);
    expect(view.getInt16(44, true)).toBe(1); expect(view.getInt16(46, true)).toBe(-2);
  });
  test("finds newest ready environment and honors override", () => {
    delete process.env.MAIPAI_SHAZAM_PYTHON;
    const root = temp();
    for (const version of ["1.0", "2.0"]) {
      const dir = join(root, "engines", "shazam-signature", version);
      mkdirSync(join(dir, "venv", "bin"), { recursive: true });
      writeFileSync(join(dir, "venv", "bin", "python"), ""); writeFileSync(join(dir, ".env-ready"), "");
    }
    expect(findShazamPython(root)).toBe(join(root, "engines", "shazam-signature", "2.0", "venv", "bin", "python"));
    rmSync(join(root, "engines", "shazam-signature", "2.0", ".env-ready"));
    expect(findShazamPython(root)).toBe(join(root, "engines", "shazam-signature", "1.0", "venv", "bin", "python"));
    const override = join(root, "python"); writeFileSync(override, ""); process.env.MAIPAI_SHAZAM_PYTHON = override;
    expect(findShazamPython(root)).toBe(override);
  });
  test("runs fake Python, returns null on bad output, and kills a timed out process", async () => {
    const script = join(temp(), "python"); process.env.MAIPAI_SHAZAM_PYTHON = script;
    writeFileSync(script, "#!/bin/sh\ncat >/dev/null\necho '{\"uri\":\"data:audio/vnd.shazam.sig;base64,AA==\",\"ms\":10000}'\n"); chmodSync(script, 0o755);
    expect(await makeSignature(new Int16Array([1]), 11025)).toEqual({ uri: "data:audio/vnd.shazam.sig;base64,AA==", sampleMs: 10000 });
    writeFileSync(script, "#!/bin/sh\ncat >/dev/null\necho nope\n"); chmodSync(script, 0o755);
    expect(await makeSignature(new Int16Array([1]))).toBeNull();
    writeFileSync(script, "#!/bin/sh\ncat >/dev/null\nsleep 20\n"); chmodSync(script, 0o755);
    const start = Date.now();
    expect(await makeSignature(new Int16Array([1]))).toBeNull();
    expect(Date.now() - start).toBeLessThan(17_000);
  }, 20_000);
});
