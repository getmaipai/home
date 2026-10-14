export const HUB_RESTART_EXIT_CODE = 75;

type RestartScheduler = () => void;
const defaultScheduler: RestartScheduler = () => {
  // Let the response reach the admin before the OS service manager brings
  // Home back with its newly saved listener configuration.
  setTimeout(() => process.exit(HUB_RESTART_EXIT_CODE), 200);
};
let scheduler: RestartScheduler = defaultScheduler;

export function scheduleHubRestart(): void {
  scheduler();
}

/** Route tests replace the process exit with a harmless callback. */
export function __setHubRestartSchedulerForTests(next?: RestartScheduler): void {
  scheduler = next ?? defaultScheduler;
}
