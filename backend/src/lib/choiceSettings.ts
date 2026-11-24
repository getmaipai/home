// Writes one picture-slot choice (the Standard slot takes a model name, the Boost slot an on or off switch) or an ordinary household setting.
import { setHouseholdSettingValue } from "@/lib/settings";
import { slotIsOff, slotKey, writeSlotModel } from "@/lib/tiers";
import { MODEL_OF_CHOICE } from "@/lib/tierSlotMigration";

/** Write one picture-slot choice or household setting. The Standard picture slot takes a choice name (`ernie` or `klein`) and the Boost slot takes the switch (true or false); both keep the slot's options. Turning Boost on keeps a model an admin already chose and only replaces `off`. Anything else for a slot is refused; every other key is an ordinary household write. */
export function writeChoiceSetting(key: string, value: unknown): { ok: true } | { ok: false; status: 400 | 403; error: string } {
  if (key === slotKey("pictures", "standard")) {
    const model = typeof value === "string" ? MODEL_OF_CHOICE[value] : undefined;
    return model ? writeSlotModel("pictures", "standard", model) : { ok: false, status: 400, error: "That is not a picture model Home can use for Standard. Choose one of the listed models." };
  }
  if (key === slotKey("pictures", "boost")) {
    if (typeof value !== "boolean") return { ok: false, status: 400, error: "Boost pictures are switched on or off here. Use the models list to choose another model." };
    if (value) return slotIsOff("pictures", "boost") ? writeSlotModel("pictures", "boost", "recommended") : { ok: true };
    return writeSlotModel("pictures", "boost", "off");
  }
  const written = setHouseholdSettingValue(key, value);
  return written.ok ? { ok: true } : { ok: false, status: written.status, error: written.error };
}
