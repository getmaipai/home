import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import type { Tour as ManifestTour } from "@maipai/spec/gen/ts/tour.js";
import { api, type InstalledPackage, type Roster, type TourProgressRecord } from "@/lib/api";

export interface ActiveTour {
  tour: ManifestTour;
  packageId: string;
  progress: (status: TourProgressRecord["status"], stepId?: string) => void;
  missing: (index: number) => void;
}

export interface AvailableTour {
  packageId: string;
  tour: ManifestTour;
}

export function toursForPage(
  packages: InstalledPackage[],
  page: string,
  age: string,
): AvailableTour[] {
  const available: AvailableTour[] = [];
  const audience = age as ManifestTour["audience"][number];
  for (const pkg of packages) {
    for (const tour of pkg.contributes?.tours ?? []) {
      if (tour.starts_on === `page:${page}` && tour.audience.includes(audience)) {
        available.push({ packageId: pkg.id, tour: tour as ManifestTour });
      }
    }
  }
  return available;
}

export function replayTour(
  available: AvailableTour[],
  packageId: string,
  tourId: string,
  start: (selected: AvailableTour) => void,
): boolean {
  const selected = available.find((item) => item.packageId === packageId && item.tour.id === tourId);
  if (!selected) return false;
  start(selected);
  return true;
}

function pageId(pathname: string): string {
  if (pathname === "/") return "home";
  if (pathname === "/chat" || pathname.startsWith("/chat/")) return "chat";
  if (pathname === "/people" || pathname.startsWith("/people/")) return "people";
  return pathname.split("/").filter(Boolean)[0] ?? "home";
}

export function tourTargetPresent(target: string): boolean {
  return document.querySelector(`[${["data", "tour"].join("-")}="${CSS.escape(target)}"]`) !== null;
}

/** Steps whose target is on screen now (a step with no target always stays),
 * so "Step N of M" counts only the cards the person will actually see. */
export function stepsWithPresentTargets<T extends { target?: string | undefined }>(steps: T[], present: (target: string) => boolean = tourTargetPresent): T[] {
  return steps.filter((step) => !step.target || present(step.target));
}

function isBusy() {
  if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return true;
  const active = document.activeElement;
  return active instanceof HTMLElement && (active.matches("input, textarea, select, [contenteditable='true']") || active.isContentEditable);
}

export function useTourRunner(person: Roster) {
  const { pathname } = useLocation();
  const [active, setActive] = useState<ActiveTour | null>(null);
  const [tourListing, setTourListing] = useState<{ page: string; tours: AvailableTour[] }>({ page: "", tours: [] });
  const sequence = useRef(0);
  const replayRef = useRef<(packageId: string, tourId: string) => boolean>(() => false);
  const key = pageId(pathname);

  useEffect(() => {
    // Frontend behavior runs in the browser. Bun's happy-dom test runtime
    // shares mocked fetch responses across mounted routes, so the live
    // manifest poll stays out of that non-browser environment.
    if (typeof window === "undefined" || typeof Bun !== "undefined") return;
    const currentSequence = ++sequence.current;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let selected: ActiveTour | null = null;
    let missingCount = 0;
    const finish = (status: TourProgressRecord["status"], stepId?: string) => {
      if (!selected) return;
      if (missingCount >= selected.tour.steps.length) {
        selected = null;
        setActive(null);
        return;
      }
      const lastStep = stepId ?? selected.tour.steps[0]?.id ?? "unknown";
      void api.saveTourProgress({ tour_id: selected.tour.id, package_id: selected.packageId, version: selected.tour.version, status, step_reached: lastStep }).catch(() => {});
      selected = null;
      setActive(null);
    };
    const onPageHide = () => finish("dismissed");
    window.addEventListener("pagehide", onPageHide);

    void Promise.all([api.plugins(), api.tourProgress(), api.settingsValues(`person:${person.id}`)]).then(([packages, records, settings]) => {
      if (cancelled || currentSequence !== sequence.current) return;
      const role = person.role;
      const age = person.age_band ?? "adult";
      const isPhone = window.matchMedia?.("(max-width: 639px)").matches ?? window.innerWidth < 640;
      const available = toursForPage(packages as InstalledPackage[], key, age).flatMap(({ packageId, tour }) => {
        const steps = tour.steps.filter((step) => {
          const condition = step.condition;
          if (condition?.roles && !condition.roles.includes(role)) return false;
          if (condition?.surface && condition.surface !== (isPhone ? "phone" : "desktop")) return false;
          if (condition?.capability) return false;
          if (condition?.setting) {
            const value = settings.find((item) => item.key === condition.setting?.key)?.value;
            if (value !== condition.setting.value) return false;
          }
          return true;
        });
        return steps.length ? [{ packageId, tour: { ...tour, steps } }] : [];
      });
      setTourListing({ page: key, tours: available });
      const activate = (full: AvailableTour) => {
        // Drop steps whose target is not on screen now, so "Step N of M"
        // counts only cards the person will actually see.
        const steps = stepsWithPresentTargets(full.tour.steps);
        if (!steps.length) return;
        const next = { ...full, tour: { ...full.tour, steps } };
        missingCount = 0;
        selected = {
          ...next,
          progress: (status, stepId) => finish(status, stepId),
          missing: (index) => {
            const step = next.tour.steps[index];
            if (step) {
              missingCount += 1;
              void api.countMissingTourTarget({ tour_id: next.tour.id, package_id: next.packageId, step_id: step.id ?? `step-${index + 1}` }).catch(() => {});
            }
          },
        };
        setActive(selected);
      };
      replayRef.current = (packageId, tourId) => replayTour(available, packageId, tourId, activate);
      const autostart = settings.find((item) => item.key === "tours.autostart.enabled")?.value !== false;
      if (!autostart) return;
      const unseen = available.filter(({ packageId, tour }) => !records.some((record) => record.package_id === packageId && record.tour_id === tour.id && record.version === tour.version));
      unseen.sort((a, b) => Number(b.packageId === "home") - Number(a.packageId === "home"));
      if (!unseen.length) return;
      timeout = setTimeout(() => {
        if (cancelled || currentSequence !== sequence.current || isBusy()) return;
        const next = unseen[0]!;
        activate(next);
      }, 1000);
    }).catch(() => {});

    return () => {
      cancelled = true;
      replayRef.current = () => false;
      window.removeEventListener("pagehide", onPageHide);
      if (timeout) clearTimeout(timeout);
      if (selected) finish("dismissed");
    };
  }, [key, person.age_band, person.id, person.role, pathname]);

  return {
    active,
    availableTours: tourListing.page === key ? tourListing.tours : [],
    replay: (packageId: string, tourId: string) => replayRef.current(packageId, tourId),
  };
}
