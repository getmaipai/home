import { useQuery } from "@tanstack/react-query";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
} from "@maipai/ui/src/dashboard/components/ui/combobox";
import { api, type PersonRosterEntry } from "@/lib/api";

interface PersonMultiSelectProps {
  value: readonly string[];
  onValueChange: (ids: string[]) => void;
  disabled?: boolean;
  /** Dropped from the option list, never from a value already stored -
   * NextSettingsRenderer only ever renders a person's OWN settings, and
   * muting yourself does nothing a real household member's mute
   * wouldn't already do more usefully. */
  excludePersonId?: string;
  ariaLabel: string;
  placeholder?: string;
  emptyText?: string;
}

/** NOTIFY-SHARE-02's own control: the settings renderer's first person
 * multi-select (docs/plans/people-profile-2026-09-26.md - "needs a
 * person multi-select control the generic settings renderer doesn't
 * have yet... no such control exists anywhere in this frontend today").
 * Composed entirely from the vendored kit's own Combobox/Chips
 * primitives (dashboard/components/ui/combobox.tsx, Base UI's own
 * `multiple` selection mode) - CLAUDE.md's "no hand-built UI": this
 * wires the shipped chips-combobox to the household roster, it doesn't
 * invent a new widget. Reusable the moment a second `selector: "person"`
 * + `range.multiple` key exists; NextSettingField.tsx is the one caller
 * today. */
export function PersonMultiSelect({ value, onValueChange, disabled, excludePersonId, ariaLabel, placeholder, emptyText }: PersonMultiSelectProps) {
  const peopleQuery = useQuery<PersonRosterEntry[]>({ queryKey: ["people"], queryFn: () => api.people() });
  const people = (peopleQuery.data ?? []).filter((p) => p.id !== excludePersonId);
  const items = people.map((p) => p.id);
  const getLabel = (id: string) => people.find((p) => p.id === id)?.display_name ?? id;

  return (
    <Combobox
      items={items}
      multiple
      value={[...value]}
      onValueChange={onValueChange}
      itemToStringLabel={getLabel}
      disabled={disabled || peopleQuery.isLoading}
    >
      <ComboboxChips aria-label={ariaLabel} className="w-64">
        {value.map((id) => (
          <ComboboxChip key={id}>{getLabel(id)}</ComboboxChip>
        ))}
        <ComboboxChipsInput placeholder={value.length === 0 ? (placeholder ?? "Add a person…") : undefined} />
      </ComboboxChips>
      <ComboboxContent>
        <ComboboxEmpty>{emptyText ?? "No one else in the household."}</ComboboxEmpty>
        <ComboboxList>{(id: string) => <ComboboxItem key={id} value={id}>{getLabel(id)}</ComboboxItem>}</ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
