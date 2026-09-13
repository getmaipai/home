// CHAT-03 (docs/dev/session-a.md): the one content policy every memory
// capture path applies, pure and offline. A credential said in chat
// must never be logged, embedded, sent to a model or stored as a memory;
// declared credentials live encrypted in lib/secrets.ts and nothing
// conversational should hold one.
//
// Bounded on purpose. Detected: an explicit assignment to a credential
// label ("the wifi password is Juniper2026", "api key = ...", "token:
// ..."), and the known secret formats (an AWS access key id, a GitHub
// token, an sk- style API key, a JWT, a PEM private-key header, a long
// hex or base64 run right after a credential label). Not detected, and
// stated as the limit: an unlabeled arbitrary string cannot be proven a
// secret or not by any heuristic, so a bare token pasted with no label
// and no known shape passes. The policy never enumerates or decrypts the
// keystore to compare values: a matcher built from the secrets would be
// the leak it exists to prevent. A statement that a credential is kept
// somewhere ("the wifi password is on the fridge", "my password is
// managed in Credentials") passes: the value position holds a
// preposition, an article or a verb, not a value.

export const CREDENTIAL_SAFE_MESSAGE = "Keep passwords and keys in Credentials, not in chat.";
export const CREDENTIAL_REDACTION = "[credential redacted]";

const LABEL = "(?:pass(?:word|code|phrase|wd)|pin(?:\\s+code)?|(?:api|access|secret|private|client|auth|bearer)[\\s_-]*(?:key|token|secret)|token|secret|cookie|credentials?)";
const LABEL_RE = new RegExp(`\\b${LABEL}\\b`, "gi");
// How far past the label a value may sit ("the password for disney plus is X").
const OPERATOR_WINDOW = 32;
// Operators, longest first. "to" counts only after a set/change verb
// before the label ("set the wifi password to X"; "I gave my password
// to my mom" and "text the pin to 555-0100" are recipients, not values).
const OPERATOR_RE = /\b(?:was set to|is now|will be|set to|changed to|is|was|are|to)\b|=|:/gi;
const ARTICLES = new Set(["the", "a", "an", "my", "our", "your", "their", "his", "her", "its"]);
const SET_VERB_BEFORE_RE = /\b(?:set|sets|setting|change|changed|changing|reset|update|updated|switch|switched|make|made)\b[^\n]{0,30}$/i;
// Words a value position holds when the sentence says WHERE a
// credential is, not WHAT it is.
const NOT_A_VALUE = new Set(
  "on in at the a an my our your their his her its written kept managed saved stored with by under inside behind still same as not no unchanged unknown safe secret private secure fine ok okay good strong weak long short new old wrong right correct different what where which whatever this that these those".split(" "),
);
// Value-shaped: an all-digit run of four or more (a PIN), or six or more
// characters with a digit or a symbol, or a purely alphabetic token with
// two or more lower-to-upper case changes ("MySecretPass"; a review
// found one change reading "McDonald's", "iPhone" and "LeBron" as
// values, and a plain capitalized word, "Snickerdoodle", "Patience",
// "Bramble", is a name).
function looksLikeValue(token: string): boolean {
  // A URL, an email address or a phone number is a place or a person,
  // never a value ("send the token to https://example.com/hook").
  if (/^(?:https?:)?\/\//i.test(token) || /^[^@\s]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(token) || /^\+?[\d()-]{7,}$/.test(token)) return false;
  if (/^\d{4,}$/.test(token)) return true;
  if (token.length < 6) return false;
  const lower = token.toLowerCase();
  if (NOT_A_VALUE.has(lower)) return false;
  const hasDigit = /\d/.test(token);
  // An apostrophe alone is a possessive or a contraction ("Grandma's",
  // "Don't"), not a symbol; a digit with it ("Don'tPanic42") still counts.
  const hasSymbol = /[^A-Za-z0-9']/.test(token);
  if (hasDigit || hasSymbol) return true;
  const caseChanges = (token.match(/[a-z][A-Z]/g) ?? []).length;
  return caseChanges >= 2;
}

/** The value token after an operator: the next run of non-whitespace,
 * an opening quote dropped, trailing sentence punctuation dropped (a
 * closing quote, a period, a comma, a question mark; an exclamation
 * mark may be part of a password and stays). Returns the value and its
 * span in `text`. */
function valueAfter(text: string, from: number): { value: string; start: number; end: number } | null {
  const m = /^\s*(\S+)/.exec(text.slice(from));
  if (!m || m[1] === undefined) return null;
  let raw: string = m[1];
  let start = from + m[0].length - raw.length;
  const opener = /^["'\`]/.exec(raw);
  if (opener) {
    raw = raw.slice(1);
    start += 1;
  }
  const trimmed = raw.replace(/["'\`.,;:?]+$/, "");
  if (!trimmed) return null;
  return { value: trimmed, start, end: start + trimmed.length };
}

/** Every explicit assignment: for each credential label, every operator
 * inside the window after it is tried in order and the first
 * value-shaped token wins; a rejected candidate never consumes the label
 * (a review found "the password to the wifi is X" and "the password is:
 * X" lost to the first non-value token after the label). */
function assignmentSpans(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  for (const label of text.matchAll(LABEL_RE)) {
    const labelEnd = label.index! + label[0].length;
    const window = text.slice(labelEnd, labelEnd + OPERATOR_WINDOW);
    const before = text.slice(Math.max(0, label.index! - 40), label.index!);
    const setVerbBefore = SET_VERB_BEFORE_RE.test(before);
    for (const op of window.matchAll(OPERATOR_RE)) {
      if (op[0].toLowerCase() === "to" && !setVerbBefore) continue;
      let candidate = valueAfter(text, labelEnd + op.index! + op[0].length);
      // "the password is the X": one article or possessive is stepped over.
      if (candidate && ARTICLES.has(candidate.value.toLowerCase())) candidate = valueAfter(text, candidate.end);
      if (!candidate || !looksLikeValue(candidate.value)) continue;
      spans.push({ start: candidate.start, end: candidate.end });
      break;
    }
  }
  return spans;
}

const FORMAT_RES: readonly { name: string; re: RegExp }[] = [
  { name: "aws_access_key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "github_token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/g },
  { name: "sk_api_key", re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  // The whole block, header through footer, when the footer is present
  // (#89: a header-only match left the key body behind on redaction);
  // a header with no footer (a cut paste) still marks the header.
  { name: "pem_private_key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----|-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  // A long hex or base64 run only when a credential label sits just before it.
  { name: "labeled_long_token", re: new RegExp(`\\b${LABEL}\\b[^\\n]{0,24}?\\s*(?:is|=|:)?\\s*([A-Fa-f0-9]{32,}|[A-Za-z0-9+/=_-]{40,})\\b`, "gi") },
];

export interface CredentialDetection {
  detected: boolean;
  /** Which rule fired, for the log line and the redaction; never the value. */
  kinds: string[];
  /** Character spans of the detected values, for redaction. */
  spans: { start: number; end: number }[];
}

export function detectCredential(text: string): CredentialDetection {
  const kinds: string[] = [];
  const spans: { start: number; end: number }[] = [];
  for (const span of assignmentSpans(text)) {
    kinds.push("assignment");
    spans.push(span);
  }
  for (const { name, re } of FORMAT_RES) {
    for (const m of text.matchAll(re)) {
      const value = m[1] ?? m[0];
      const start = m.index! + m[0].length - value.length;
      kinds.push(name);
      spans.push({ start, end: start + value.length });
    }
  }
  return { detected: spans.length > 0, kinds: [...new Set(kinds)], spans };
}

/** The declared-field half, at a structured boundary (a request body, a
 * package's structured input): a key named like a credential field with
 * a non-empty string value is rejected by name, never by comparing the
 * value to anything stored. */
const FIELD_RE = /^(?:pass(?:word|code|phrase|wd)|pin|(?:api|access|secret|private|client|auth|bearer)[_-]?(?:key|token|secret)|token|secret|cookie|credentials?)$/i;
export function hasDeclaredCredentialField(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (FIELD_RE.test(key) && typeof value === "string" && value.trim().length > 0) return key;
  }
  return null;
}

/** The text with every detected value replaced by the marker; a text
 * with nothing detected is returned unchanged. */
export function redactCredentials(text: string): string {
  const { spans } = detectCredential(text);
  if (spans.length === 0) return text;
  // Overlapping hits on one value (an assignment's value and the JWT
  // rule's longer match, say) merge to the widest span, so no tail of a
  // value survives the marker (a review found a labeled JWT losing only
  // its header).
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  let out = "";
  let cursor = 0;
  for (const span of merged) {
    out += text.slice(cursor, span.start) + CREDENTIAL_REDACTION;
    cursor = span.end;
  }
  return out + text.slice(cursor);
}
