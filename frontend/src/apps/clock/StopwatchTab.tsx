import { i18n } from "@lingui/core";
import { useEffect, useRef, useState } from "react";
import { Button } from "@maipai/ui/src/ui/button";

type Lap = { number: number; split: number; total: number };

function formatElapsed(milliseconds: number) {
  const centiseconds = Math.floor(milliseconds / 10);
  const minutes = Math.floor(centiseconds / 6000);
  const seconds = Math.floor(centiseconds / 100) % 60;
  const fraction = centiseconds % 100;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(fraction).padStart(2, "0")}`;
}

export function StopwatchTab() {
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [laps, setLaps] = useState<Lap[]>([]);
  const startedAt = useRef<number | null>(null);
  const heldMilliseconds = useRef(0);

  useEffect(() => {
    if (!running) return;
    const tick = () => setElapsed(heldMilliseconds.current + performance.now() - (startedAt.current ?? performance.now()));
    tick();
    const interval = window.setInterval(tick, 50);
    return () => window.clearInterval(interval);
  }, [running]);

  function start() {
    if (running) return;
    startedAt.current = performance.now();
    setRunning(true);
  }

  function stop() {
    if (!running) return;
    heldMilliseconds.current += performance.now() - (startedAt.current ?? performance.now());
    setElapsed(heldMilliseconds.current);
    startedAt.current = null;
    setRunning(false);
  }

  function recordLap() {
    if (!running) return;
    const total = heldMilliseconds.current + performance.now() - (startedAt.current ?? performance.now());
    const previousTotal = laps[laps.length - 1]?.total ?? 0;
    setLaps([...laps, { number: laps.length + 1, split: total - previousTotal, total }]);
  }

  function reset() {
    heldMilliseconds.current = 0;
    startedAt.current = null;
    setRunning(false);
    setElapsed(0);
    setLaps([]);
  }

  return (
    <section aria-label={i18n._({ id: "Stopwatch", message: "Stopwatch" })} className="grid justify-items-center gap-6 py-10">
      <output aria-live="off" className="text-6xl tabular-nums">{formatElapsed(elapsed)}</output>
      <p className="sr-only" aria-live="polite">{running ? i18n._({ id: "Stopwatch running", message: "Stopwatch running" }) : i18n._({ id: "Stopped at {formatElapsed}", message: "Stopped at {formatElapsed}", values: { formatElapsed: formatElapsed(elapsed) } })}</p>
      <div className="flex flex-wrap justify-center gap-3">
        {running ? <>
          <Button type="button" variant="outline" onClick={recordLap}>{i18n._({ id: "Lap", message: "Lap" })}</Button>
          <Button type="button" onClick={stop}>{i18n._({ id: "Stop", message: "Stop" })}</Button>
        </> : <>
          <Button type="button" onClick={start}>{elapsed ? i18n._({ id: "Resume", message: "Resume" }) : i18n._({ id: "Start", message: "Start" })}</Button>
          <Button type="button" variant="outline" onClick={reset}>{i18n._({ id: "Reset", message: "Reset" })}</Button>
        </>}
      </div>
      {laps.length ? <ol aria-label={i18n._({ id: "Stopwatch laps", message: "Stopwatch laps" })} className="m-0 w-full max-w-xl list-none p-0">
        {laps.map((lap) => <li key={lap.number} className="flex justify-between border-b py-3">
          <span>{i18n._({ id: "Lap {number}", message: "Lap {number}", values: { number: lap.number } })}</span>
          <span className="tabular-nums">{formatElapsed(lap.split)}</span>
          <span className="tabular-nums">{formatElapsed(lap.total)}</span>
        </li>)}
      </ol> : null}
    </section>
  );
}
