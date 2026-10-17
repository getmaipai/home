"use client";

// VOICE-LIVE-02b: tap -> gate -> session. `request` runs the probe once
// per tap (an in-flight tap is ignored), opens the session only when the
// browser allows the mic, and otherwise shows MicHelpDialog. The only
// re-checks are the PermissionStatus change event and window focus, and
// both only read the state: getUserMedia is never called from an effect.
import { useCallback, useEffect, useRef, useState } from "react";
import { detectBrowser, probeMic, queryMicPermission, type BrowserFamily, type MicProbeDeps, type MicProblem } from "@/lib/media/micPermission";

export function useMicGate(onGranted: () => void, deps?: MicProbeDeps) {
  const [problem, setProblem] = useState<MicProblem | null>(null);
  const inFlight = useRef(false);
  const onGrantedRef = useRef(onGranted);
  onGrantedRef.current = onGranted;
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const run = useCallback(async (open: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await probeMic(depsRef.current);
      if (result.ok) {
        setProblem(null);
        if (open) onGrantedRef.current();
        return result;
      } else {
        setProblem(result.problem);
      }
    } finally {
      inFlight.current = false;
    }
  }, []);
  const request = useCallback(() => run(true), [run]);
  // After a session that was already open failed to capture: show the help
  // when the browser blocks the mic, but never reopen the session. Reopening
  // here made a capture failure the probe cannot see loop open -> fail ->
  // probe ok -> open, many times a second.
  const diagnose = useCallback(() => run(false), [run]);

  // While the help is up, the person is off changing a setting: notice
  // when it flips to granted (read only) and start for them.
  useEffect(() => {
    if (problem !== "denied") return;
    let alive = true;
    let status: PermissionStatus | null = null;
    const recheck = () => {
      void (deps?.query ?? queryMicPermission)().then((state) => {
        if (alive && state === "granted") void request();
      });
    };
    const onChange = () => recheck();
    try {
      void navigator.permissions.query({ name: "microphone" as PermissionName }).then((s) => {
        if (!alive) return;
        status = s;
        s.addEventListener("change", onChange);
      }).catch(() => {});
    } catch { /* Permissions API unsupported: focus re-check only */ }
    window.addEventListener("focus", recheck);
    return () => {
      alive = false;
      status?.removeEventListener("change", onChange);
      window.removeEventListener("focus", recheck);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are test-only and stable.
  }, [problem, request]);

  return { problem, request, diagnose, dismiss: () => setProblem(null) };
}

const TITLES: Record<MicProblem, string> = {
  denied: "Microphone is blocked",
  not_found: "No microphone found",
  in_use: "Microphone is busy",
  insecure: "This address cannot use the microphone",
  error: "The microphone did not start",
};

const CAUSES: Record<MicProblem, string> = {
  denied: "This browser is not allowing Home to use the microphone.",
  not_found: "Plug in or turn on a microphone, then try again.",
  in_use: "Another app is using the microphone. Close it, then try again.",
  insecure: "Browsers only allow the microphone on https or localhost. Open Home at its https address.",
  error: "Reload the page and try again.",
};

export function micFixSteps(browser: BrowserFamily): string[] {
  const mac = "On a Mac also open System Settings > Privacy & Security > Microphone and switch on this browser.";
  switch (browser) {
    case "chrome":
      return ["Click the settings icon left of the address bar.", "Set Microphone to Allow, then reload.", mac];
    case "safari":
      return ["Safari menu > Settings for This Website > Microphone > Allow.", "Or Safari > Settings > Websites > Microphone.", mac];
    case "firefox":
      return ["Click the permissions icon in the address bar.", "Remove the blocked Microphone entry, then reload.", mac];
    default:
      return ["Open this site's settings in the address bar and allow the microphone, then reload.", mac];
  }
}

/** Copy for the help dialog ChatPage renders with the kit Dialog directly. */
export function micHelp(problem: MicProblem, userAgent?: string) {
  const browser = detectBrowser(userAgent ?? (typeof navigator === "undefined" ? "" : navigator.userAgent));
  return { title: TITLES[problem], cause: CAUSES[problem], steps: problem === "denied" ? micFixSteps(browser) : [] };
}
