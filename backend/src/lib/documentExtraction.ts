// ATT-01b: bounded local document extraction. Apache Tika is the one
// parser surface for PDF and office input; RapidOCR is the separate local
// path for scanned images. Neither path accepts a URL or makes a network
// request on behalf of an attachment.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Subprocess } from "bun";
import { Attachment } from "@maipai/spec/gen/ts/attachment.js";
import { readAttachment } from "@/lib/attachments";
import type { PersonRow } from "@/types";

export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
export const MAX_EXTRACTED_TEXT_BYTES = 2 * 1024 * 1024;
export const LOCAL_PARSER_TIMEOUT_MS = 15_000;

const TIKA_JAR_ENV = "MAIPAI_TIKA_JAR";
const TIKA_SHA256_ENV = "MAIPAI_TIKA_SHA256";
const RAPIDOCR_COMMAND_ENV = "MAIPAI_RAPIDOCR_COMMAND";

const DOCUMENT_MEDIA_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
]);

export interface DocumentPage {
  page: number;
  text: string;
}

export interface ExtractedDocument {
  media_type: string;
  pages: DocumentPage[];
  parser: "tika";
}

export type ExtractionResult =
  | { ok: true; value: ExtractedDocument }
  | { ok: false; status: 400 | 403 | 404 | 413 | 500; error: string };

type TextRunner = (bytes: Uint8Array, mediaType: string) => Promise<string> | string;
type OcrRunner = (bytes: Uint8Array, mediaType: string) => string;

let tikaRunnerForTests: TextRunner | null = null;
let rapidOcrRunnerForTests: OcrRunner | null = null;

export function __setTikaRunnerForTests(runner: TextRunner | null): void {
  tikaRunnerForTests = runner;
}

export function __setRapidOcrRunnerForTests(runner: OcrRunner | null): void {
  rapidOcrRunnerForTests = runner;
}

function normalizeMediaType(mediaType: string): string | null {
  const normalized = mediaType.trim().toLowerCase();
  return Attachment.shape.media_type.safeParse(normalized).success ? normalized : null;
}

function isSupportedDocument(mediaType: string): boolean {
  return DOCUMENT_MEDIA_TYPES.has(mediaType);
}

async function readLimited(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) throw new Error("parser output exceeded its limit");
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function runProcess(process: Subprocess, input: Uint8Array): Promise<string> {
  const stdin = process.stdin as unknown as { write(input: Uint8Array): void; end(): void };
  const stdout = process.stdout as unknown as ReadableStream<Uint8Array>;
  stdin.write(input);
  stdin.end();
  const timeout = setTimeout(() => process.kill(), LOCAL_PARSER_TIMEOUT_MS);
  try {
    const [exitCode, output] = await Promise.all([process.exited, readLimited(stdout, MAX_EXTRACTED_TEXT_BYTES)]).catch((err) => {
      process.kill();
      throw err;
    });
    if (exitCode !== 0) {
      throw new Error(`local parser exited with code ${exitCode}`);
    }
    return new TextDecoder().decode(output);
  } finally {
    clearTimeout(timeout);
  }
}

function tikaJarPath(): string {
  const configured = process.env[TIKA_JAR_ENV];
  if (!configured || !configured.startsWith("/")) throw new Error("Apache Tika is not configured locally");
  const jar = resolve(configured);
  if (!existsSync(jar)) throw new Error("configured Apache Tika JAR was not found");
  const expected = process.env[TIKA_SHA256_ENV];
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error("Apache Tika checksum is not configured");
  const actual = createHash("sha256").update(readFileSync(jar)).digest("hex");
  if (actual !== expected) throw new Error("configured Apache Tika JAR checksum did not match");
  return jar;
}

async function runTikaProcess(bytes: Uint8Array): Promise<string> {
  // Tika receives bytes on stdin and the literal '-' means "read stdin";
  // no path, URL, or remote parser target crosses this boundary.
  const process = Bun.spawn(["java", "-jar", tikaJarPath(), "--text", "-"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {},
  });
  return runProcess(process, bytes);
}

function configuredCommand(envName: string): string[] {
  const raw = process.env[envName];
  if (!raw) throw new Error(`${envName} is not configured locally`);
  let command: unknown;
  try {
    command = JSON.parse(raw);
  } catch {
    throw new Error(`${envName} must be a JSON array of local command arguments`);
  }
  if (!Array.isArray(command) || command.length === 0 || command.some((part) => typeof part !== "string" || part.length === 0)) {
    throw new Error(`${envName} must be a JSON array of local command arguments`);
  }
  return command;
}

function runRapidOcrProcess(bytes: Uint8Array): string {
  // The local RapidOCR adapter's contract is bytes on stdin and UTF-8 text
  // on stdout. The command is administrator-configured, never derived from
  // attachment content, and this process is not given a URL or a network
  // input. A production install pins the command to its RapidOCR runner.
  const process = Bun.spawnSync(configuredCommand(RAPIDOCR_COMMAND_ENV), {
    stdin: bytes,
    stdout: "pipe",
    stderr: "pipe",
    env: {},
    timeout: LOCAL_PARSER_TIMEOUT_MS,
  });
  if (!process.success) throw new Error(`local OCR exited with ${process.signalCode ?? `code ${process.exitCode}`}`);
  const output = process.stdout;
  if (!(output instanceof Uint8Array) || output.byteLength > MAX_EXTRACTED_TEXT_BYTES) throw new Error("OCR output exceeded its limit");
  return new TextDecoder().decode(output);
}

function pagesFromTikaText(text: string): DocumentPage[] {
  const pages = text.split("\f");
  return pages.map((page, index) => ({ page: index + 1, text: page.trim() })).filter((page) => page.text.length > 0);
}

/** Parse PDF or office bytes through one bounded local Tika surface. */
export async function extractDocument(bytes: Uint8Array, mediaType: string): Promise<ExtractionResult> {
  const normalized = normalizeMediaType(mediaType);
  if (!normalized || !isSupportedDocument(normalized)) return { ok: false, status: 400, error: "unsupported document type" };
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) return { ok: false, status: 413, error: "document is too large to extract" };
  try {
    const text = await (tikaRunnerForTests ?? runTikaProcess)(bytes, normalized);
    const pages = pagesFromTikaText(text);
    return { ok: true, value: { media_type: normalized, pages, parser: "tika" } };
  } catch (err) {
    void err;
    return { ok: false, status: 500, error: "document extraction failed" };
  }
}

/** Read an owned attachment, then extract it without exposing raw bytes. */
export async function extractAttachment(actor: PersonRow, id: string): Promise<ExtractionResult> {
  const found = readAttachment(actor, id);
  if (!found.ok) return found;
  return extractDocument(found.value.bytes, found.value.record.media_type);
}

export type OcrResult =
  | { ok: true; text: string }
  | { ok: false; code: "invalid_input" | "capability_missing" | "internal_error"; error: string };

/** Run the local RapidOCR boundary for a scan, never a document parser. */
export function runRapidOcr(bytes: Uint8Array, mediaType: string): OcrResult {
  const normalized = normalizeMediaType(mediaType);
  if (!normalized || !normalized.startsWith("image/")) return { ok: false, code: "invalid_input", error: "OCR needs an image input" };
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) return { ok: false, code: "invalid_input", error: "image is too large for OCR" };
  try {
    const text = (rapidOcrRunnerForTests ?? runRapidOcrProcess)(bytes, normalized);
    if (text.length > MAX_EXTRACTED_TEXT_BYTES) return { ok: false, code: "internal_error", error: "OCR output exceeded its limit" };
    return { ok: true, text: text.trim() };
  } catch (err) {
    const message = err instanceof Error ? err.message : "local OCR failed";
    const code = message.includes("not configured") ? "capability_missing" : "internal_error";
    return { ok: false, code, error: `OCR failed: ${message}` };
  }
}
