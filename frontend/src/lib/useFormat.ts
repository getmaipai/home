import { useLingui } from "@lingui/react";
import { format } from "@/lib/format";

/** The formatters bound to the active language. Reading the language through Lingui makes the component render again when it changes. */
export function useFormat(): typeof format {
  useLingui();
  return format;
}
