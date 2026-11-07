import { i18n } from "@lingui/core";
import { API_ERROR_LINES, type ApiErrorDescriptor, type ApiErrorLine } from "@maipai/home-backend/src/lib/apiErrorCopy";
import type { ApiError } from "@/lib/api";

/** I18N-B2 (design note i18n-2026-11-07, section 9 step 3): the one place a server `code` becomes a message id. The wording is defined only
 * in backend apiErrorCopy.ts (extracted into the catalogs from there); this reads it. A code the table does not know, or text that is not
 * the table's English for that code (another route reusing a generic code, an old backend), shows the server's own English unchanged. */
function translate(line: ApiErrorDescriptor): string {
  return i18n._({ id: line.id, message: line.message });
}

function lineFor(error: ApiError): ApiErrorLine | undefined {
  return error.code && Object.hasOwn(API_ERROR_LINES, error.code) ? (API_ERROR_LINES as Record<string, ApiErrorLine>)[error.code] : undefined;
}

/** The error's main sentence in the person's language. */
export function localizedApiMessage(error: ApiError): string {
  const line = lineFor(error)?.error;
  return line && line.message === error.message ? translate(line) : error.message;
}

/** The route's "what to do next" sentence in the person's language, or undefined when the route sent none. */
export function localizedApiNext(error: ApiError): string | undefined {
  const line = lineFor(error)?.next;
  return line && line.message === error.next ? translate(line) : error.next;
}
