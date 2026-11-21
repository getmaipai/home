# Code sandbox spike: can one session's machine be fenced in (2026-11-21)

A first run of the network gate from [code-app-refresh-2026-11-21.md](../design/code-app-refresh-2026-11-21.md), section 4, for backlog
rows `CODE-SANDBOX-01a` and `CODE-SANDBOX-02`. Run by hand on the Mac Studio (macOS 27.0.1, Apple silicon). It is a spike: the sandbox
service is not built, and this is not yet a repeatable test in the repo.

## Result

**Yes, with one extra step.** Apple's host-only network alone is not enough. With a lock loaded inside the machine at start, every check
passes, for the agent's user and for root.

| Check, from inside the machine | Host-only network alone | Host-only network, no resolver, lock loaded at start |
|---|---|---|
| 1. A hub port other than the allowed one | **Reachable**: every port the hub listens on for all addresses (SSH and AirPlay in this run), by the gateway address and by the hub's home-network address | Blocked |
| 2. Another device on the home network | Blocked | Blocked |
| 3. The internet by raw address | Blocked | Blocked |
| 4. A name lookup | Fails | Fails |
| The one allowed hub port | Reachable | Reachable (HTTP 200) |
| 5. A host off the list, through the proxy | Not tested: no proxy was set up | Not tested |

A hub service bound to loopback only was not reachable from the machine in either column.

## What was run

- Tool: Apple `container` 1.7.1 from Homebrew (`brew install container`, no admin password), `container system start`.
- Image: Alpine 3.22 with curl, DNS tools, nftables, netcat and libcap, and a user `agent` (uid 1000).
- Network: `container network create --internal`. Machine: `--network <that> --no-dns -c 4 -m 4g`, one folder mounted.
- Two plain listeners on the hub stood in for the allowed port and a forbidden port.
- The lock: the machine starts with `--cap-add CAP_NET_ADMIN`. Its first process loads one nftables table (output and input default
  drop; loopback and replies allowed; one rule allowing the gateway address on the allowed port), then gives up the right for good and
  starts the workload.

## Findings

1. **The host-only network keeps the internet and the home network out, not the hub.** This matches the open upstream report. A firewall
   on the Mac was not tried because it needs the admin password.
2. **Without `CAP_NET_ADMIN` the lock does not load**, and the start-up step must stop the session if loading fails. In the first try
   the load failed and the workload started anyway with every hub port open.
3. **The agent's user cannot undo the lock.** uid 1000 with no capabilities: flushing the rules, reading them and taking the interface
   down were all refused. The image has no setuid files.
4. **Root cannot undo it either, once the right is dropped.** Root started through `capsh --drop=cap_net_admin,cap_sys_admin,
   cap_sys_module,cap_net_raw`: flushing the rules, taking the interface down and adding an address were refused, and only the allowed
   port was open. So a setup script may run as root behind the same lock.
5. **A machine with no network at all works** (`--network none`, loopback only). Useful for a session that needs no model inside it, or
   for a setup phase.
6. **Start-up is about half a second** for a machine on the host-only network (one run, image already unpacked).
7. **The machine sees one folder.** The mount is virtiofs at the mount point; the hub's home folders are not visible.
8. The tool's builder machine stays running after a build and holds 2 GB until the service is stopped.

## What this changes in the plan

- The lock inside the machine is required, not optional: host-only network, no resolver, lock at start, right dropped, fail closed.
- The firewall anchor on the Mac becomes a second layer an admin may add, not a condition for shipping.
- Hub services should listen on loopback wherever they can; the allowed gateway and proxy ports listen on the sandbox network's gateway
  address only.

## Not covered by this run

- Check 5 (the allowlist proxy), and names resolved by the proxy.
- A break-out from the guest kernel, which would lift the lock and leave the machine like any device on the host-only network.
- The disk and process limits, memory growth over a long session, snapshots, and the setup-script cache.
- The agent (OpenCode) running inside, and the real gateway port.
- Git at Push, links out of the workspace, and the planted repositories (`CODE-GIT-02`, `CODE-SAFE-03`).

## State left on the Studio

`container` 1.7.1 stays installed. Its service is stopped, and the test network, image and listeners are removed.
