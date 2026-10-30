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
    <section aria-label="Stopwatch" className="grid justify-items-center gap-6 py-10">
      <output aria-live="off" className="text-6xl tabular-nums">{formatElapsed(elapsed)}</output>
      <p className="sr-only" aria-live="polite">{running ? "Stopwatch running" : `Stopped at ${formatElapsed(elapsed)}`}</p>
      <div className="flex flex-wrap justify-center gap-3">
        {running ? <>
          <Button type="button" variant="outline" onClick={recordLap}>Lap</Button>
          <Button type="button" onClick={stop}>Stop</Button>
        </> : <>
          <Button type="button" onClick={start}>{elapsed ? "Resume" : "Start"}</Button>
          <Button type="button" variant="outline" onClick={reset}>Reset</Button>
        </>}
      </div>
      {laps.length ? <ol aria-label="Stopwatch laps" className="m-0 w-full max-w-xl list-none p-0">
        {laps.map((lap) => <li key={lap.number} className="flex justify-between border-b py-3">
          <span>Lap {lap.number}</span>
          <span className="tabular-nums">{formatElapsed(lap.split)}</span>
          <span className="tabular-nums">{formatElapsed(lap.total)}</span>
        </li>)}
      </ol> : null}
    </section>
  );
}
