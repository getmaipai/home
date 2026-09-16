# GPU validation

`backend/scripts/bench/gpu-validate.ts` is the preflight for a new engine host. It connects only to `MAIPAI_LLAMA_SERVER_URL`, creates a fresh temporary data directory, sends synthetic roster-name text, and never starts a process.

Run it from `backend/`:

```sh
MAIPAI_LLAMA_SERVER_URL=http://127.0.0.1:PORT bun run scripts/bench/gpu-validate.ts --quick
```

The identity row records the engine build, model file name, and context size. Fill proves that a prompt near 90 percent of context completes. Throughput runs twenty 256-token replies at concurrency 1, 2, and 4 and records stream and aggregate tokens per second plus first-token p50 and p95. The full run also soaks at concurrency 2; a sample below 70 percent of the first two minutes' mean is a throttle finding. `--min-tps` defaults to 20 and `--soak-minutes` defaults to 20. `--quick` runs identity, fill, and throughput.

The verdict fails if fill fails, concurrency-1 throughput is below the threshold, or throttling is found. On failure, keep the JSON line with the engine build and model file, inspect cooling, power, driver, context, and model placement, then rerun after the host is stable. Numbers belong in the dev record with the build, model file, and a sanitized hardware line. Never record a hostname or a family conversation.
