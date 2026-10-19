# Coding gateway end-to-end check

`backend/scripts/bench/coding-e2e.ts` checks that an API key belonging to a person reaches the coding role on a local Stack. It sends real prompts to the installed coding model, so it is an opt-in bench and is not part of the gate.

## Start scratch services

Use separate scratch checkouts and data folders for Home and Stack. The script refuses Home or Stack URLs on port 3000 or 8787, and refuses every non-loopback host. Prefer ports from 8893 through 8898.

1. In the Home worktree, reserve an unused 88xx port and start Home with a fresh data directory:

   ```sh
   cd /path/to/home
   PORT="$(bash scripts/wt.sh port)" MAIPAI_DATA_DIR="/private/tmp/maipai-home-coding-e2e" bun start
   ```

   `bun start` builds the frontend and prints the Home URL. If the leased port is outside 8893 through 8898, set `PORT` to a free port in that range after checking it is unused.

2. In a separate Stack worktree, reserve an unused 88xx port and start Stack with its own fresh data directory:

   ```sh
   cd /path/to/stack
   PORT="$(bash scripts/wt.sh port)" MAIPAI_DATA_DIR="/private/tmp/maipai-stack-coding-e2e" bun start
   ```

   Keep the Stack bound to loopback. Install the coding model and one supported coding engine on that scratch Stack before running the check. The script accepts `splash` or `llama-server` as the serving engine.

3. Sign in as the scratch Home owner in a browser. Copy the `session` cookie value from that scratch Home session. Do not use a household you care about. The script temporarily changes household Coding settings and restores their previous values in a `finally` block.

## Run

Set the two service URLs and the scratch owner's cookie. The defaults are Home at `127.0.0.1:8893` and Stack at `127.0.0.1:8894`:

```sh
cd /path/to/home/backend
E2E_HOME_URL=http://127.0.0.1:8893 E2E_STACK_URL=http://127.0.0.1:8894 E2E_HOME_COOKIE='session=SCRATCH_SESSION_VALUE' bun run scripts/bench/coding-e2e.ts
```

The script points the scratch Home at the selected Stack URL for the run, then restores the previous Stack URL. It creates an adult and a teen profile, signs into each profile, makes a code key on each, and removes the teen's temporary `use:code` allow grant before testing that key. It reads each key secret once from the create response and never prints it. Created people remain in the scratch Home so the run can be inspected.

The checks cover `/models`, non-streaming and streaming chat completions, Messages and token counting, Responses, chat and Messages tool-call round trips, model identity, reported reasoning token ceilings, missing and revoked key equivalence, the teen grant refusal, Coding off, the household Coding pause, and the Stack coding role. The table shows latency and output tokens per second when usage is reported.

Expected output has one row per check, a `PASS` status, the serving engine (`splash` or `llama-server`), model names, reasoning counts and timing values. Any failed assertion prints a `FAIL` row and the process exits non-zero. The check restores its saved household settings when it exits.

## Helper unit test

The pure URL guard, table formatter and key redactor have a unit test. The normal backend test preload reserves local engine ports, so use a minimal Bun test config when running only this isolated helper test:

```sh
printf '[test]\nroot = "scripts/bench"\n' > /private/tmp/coding-e2e-bunfig.toml
cd /private/tmp
bun test --config /private/tmp/coding-e2e-bunfig.toml /path/to/home/backend/scripts/bench/coding-e2e.test.ts
```

The live-model script was not run in the sandbox. It needs a scratch Home, a scratch Stack, and an installed real coding model.
