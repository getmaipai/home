let activeGuard: (() => boolean) | null = null;

export function registerRouteLeaveGuard(guard: (() => boolean) | null) {
  activeGuard = guard;
  return () => {
    if (activeGuard === guard) activeGuard = null;
  };
}

export function confirmRouteLeave() {
  return activeGuard?.() ?? true;
}
