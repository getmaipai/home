import { i18n } from "@lingui/core";
import { descriptorForLine, type MessageDescriptor } from "@maipai/home-backend/src/lib/failureCopy";

/** Design note i18n-2026-11-07, section 9 step 1: the hub's failure wording is data (an id plus the English default, defined only in
 * backend failureCopy.ts); the web client translates it here from the same catalogs as every other string. A minor's line has its own
 * `.minor`, `.teen` or `.child` id, and a child or teen catalog never overrides it. */
export function translateDescriptor(line: MessageDescriptor): string {
  return i18n._({ id: line.id, message: line.message, ...(line.values ? { values: line.values } : {}) });
}

/** A line that reached the client as plain English text (a health row's `notice`, an `advice` block, a stream error): find its
 * descriptor for this band and translate it. Text with no descriptor (an admin's own words, a reason from another part) is returned as it came. */
export function translateServerLine(text: string, minor: boolean): string {
  const line = descriptorForLine(text, minor);
  return line ? translateDescriptor(line) : text;
}
