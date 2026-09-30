import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@maipai/ui/src/dashboard/components/ui/tabs";
import { NativeSelect, NativeSelectOption } from "@maipai/ui/src/dashboard/components/ui/native-select";

export interface SettingsSection {
  id: string;
  label: string;
  description: string;
  visible?: boolean;
  render: ReactNode;
}

export function SettingsSectionFrame({ sections, defaultSection, ariaLabel = "Settings sections" }: {
  sections: readonly SettingsSection[];
  defaultSection: string;
  ariaLabel?: string;
}) {
  const [params, setParams] = useSearchParams();
  const visibleSections = sections.filter((section) => section.visible !== false);
  const isVisible = useCallback((id: string | null) => id !== null && sections.some((item) => item.visible !== false && item.id === id), [sections]);
  const [section, setSection] = useState(() => isVisible(params.get("section")) ? params.get("section")! : defaultSection);
  useEffect(() => {
    const requested = params.get("section");
    if (requested !== null) {
      const next = isVisible(requested) ? requested : defaultSection;
      setSection(next);
      if (next !== requested) setParams((current) => { const updated = new URLSearchParams(current); updated.set("section", next); return updated; }, { replace: true });
    }
  }, [params, setParams, isVisible, defaultSection]);
  function changeSection(value: string) {
    const next = isVisible(value) ? value : defaultSection;
    setSection(next);
    setParams((current) => { const updated = new URLSearchParams(current); updated.set("section", next); return updated; }, { replace: true });
  }
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 py-4 md:flex-row md:gap-10">
      <NativeSelect
        aria-label="Settings section"
        className="w-full md:hidden [&>select]:min-h-12"
        value={section}
        onChange={(event) => changeSection(event.target.value)}
      >
        {visibleSections.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.label}</NativeSelectOption>)}
      </NativeSelect>
      <Tabs orientation="vertical" value={section} onValueChange={changeSection} className="w-full md:flex-1">
        <TabsList aria-label={ariaLabel} className="hidden h-auto w-full items-stretch gap-1 bg-transparent p-0 md:flex md:w-56 md:shrink-0">
          {visibleSections.map((item) => <TabsTrigger key={item.id} value={item.id} className="min-h-12 justify-start px-3 text-left">{item.label}</TabsTrigger>)}
        </TabsList>
        <div className="min-w-0 w-full max-w-3xl flex-1">
          {visibleSections.map((item) => (
            <TabsContent key={item.id} value={item.id} className="mt-0 flex flex-col gap-5">
              <header className="flex flex-col gap-1">
                <h2 className="text-xl font-semibold">{item.label}</h2>
                <p className="text-sm text-muted-foreground">{item.description}</p>
              </header>
              {item.render}
            </TabsContent>
          ))}
        </div>
      </Tabs>
    </div>
  );
}
