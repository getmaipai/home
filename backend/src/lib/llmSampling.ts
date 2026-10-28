// Which sampling fields a chat request carries (MODEL-ADD-01 S3): the
// answering model's own record, never a global.
import type { ModelCapabilities } from "@maipai/spec/gen/ts/model-capabilities.js";

/** What a chat record sends: its own sampling fields without the `source`
 * note, so a record with none (an added model whose card names nothing)
 * sends no sampling keys and the engine keeps its defaults. */
export function chatSamplingOf(record: Pick<ModelCapabilities, "sampling"> | undefined): Record<string, number> {
  const { source: _source, ...values } = record?.sampling ?? { source: "" };
  return Object.fromEntries(Object.entries(values).filter((entry): entry is [string, number] => typeof entry[1] === "number"));
}
