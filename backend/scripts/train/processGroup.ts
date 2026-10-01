export function spawnProcessGroup(command: string[]): Bun.Subprocess {
  return Bun.spawn(command, { detached: true, stdout: "inherit", stderr: "inherit" });
}

export async function terminateProcessGroup(pid: number, exited?: Promise<number>, graceMs = 2_000): Promise<void> {
  try { process.kill(-pid, "SIGTERM"); } catch { /* already gone */ }
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    try { process.kill(-pid, 0); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") {
        if (exited) await exited;
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  try { process.kill(-pid, "SIGKILL"); } catch { /* already gone */ }
  if (exited) await exited;
}
