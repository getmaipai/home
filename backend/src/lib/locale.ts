import type { PersonRow } from "@/types";
import { getHouseholdSettingValue, getSettingValueForPerson } from "@/lib/settings";
import { isSupportedLocale } from "@/lib/supportedLocales";

export function resolveLocale(person: PersonRow | null): string {
  if (person) {
    const row = getSettingValueForPerson(person.id, "person.locale");
    if (typeof row === "string" && row !== "household" && isSupportedLocale(row)) return row;
  }
  const household = getHouseholdSettingValue("household.locale");
  return isSupportedLocale(household) ? household : "en-US";
}

export function resolveLocaleFromValues(personValue: unknown, householdValue: unknown): string {
  return typeof personValue === "string" && personValue !== "household" && isSupportedLocale(personValue)
    ? personValue
    : isSupportedLocale(householdValue) ? householdValue : "en-US";
}

export function householdLocale(): string {
  const value = getHouseholdSettingValue("household.locale");
  return isSupportedLocale(value) ? value : "en-US";
}

export function isSafeAutoTranslation(file: string, id: string): boolean {
  return !/child|teen|crisis|consent|refusal|spoken|robot|SEARCH-DOWN-EMPTY-01/i.test(`${file} ${id}`);
}

