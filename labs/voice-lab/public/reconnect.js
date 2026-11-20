// When the lab server goes away (restart, network drop) the page says so and reconnects by itself, trying again every delayMs until it is back.
export function watchSocket(ws, { make, status, delayMs = 1500, timer = setTimeout, onSwap = () => {} }) {
  const handlers = { onopen: ws.onopen, onmessage: ws.onmessage };
  const lost = () => {
    status('Reconnecting...');
    timer(() => {
      const next = make();
      next.onopen = (e) => { status('Reconnected.'); handlers.onopen?.(e); };
      next.onmessage = handlers.onmessage; next.onclose = lost; next.onerror = () => {};
      onSwap(next);
    }, delayMs);
  };
  ws.onclose = lost;
  return lost;
}
