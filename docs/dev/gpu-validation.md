# GPU validation

`backend/scripts/bench/gpu-validate.ts` is the preflight for a new engine host. It connects only to `MAIPAI_LLAMA_SERVER_URL`, creates a fresh temporary data directory, sends synthetic roster-name text, and never starts a process or opens household data.

Run it from `backend/`:

```sh
MAIPAI_LLAMA_SERVER_URL=http://127.0.0.1:PORT bun run scripts/bench/gpu-validate.ts --quick
```

Phases and evidence:

- Identity calls `/props` and the engine identity endpoint. It proves the intended build, model file, and context size are being tested.
- Fill calls `/tokenize` once for the synthetic paragraph, repeats it to 90 percent of the reported context in tokens, and sends it as a 64-token request. It proves the host can process a near-limit prompt. A fill failure means to inspect context limits, model placement, and the engine log before rerunning.
- Throughput runs twenty 256-token replies at concurrency 1, 2, and 4. It records streaming and aggregate tokens per second plus first-token p50 and p95. The default concurrency-1 threshold is 20 tps; use `--min-tps=N` to change it. On failure, inspect cooling, power, driver, and model placement.
- Soak (omitted by `--quick`) runs at concurrency 2 for `--soak-minutes=N` (20 by default). It takes one sample per batch of 20 replies, about every N seconds, and flags a sample below 70 percent of the first two minutes' mean. A throttle finding calls for cooling and power checks, followed by a rerun on a stable host.

The verdict fails if fill fails, concurrency-1 throughput is below the threshold, or throttling is found. Keep the JSON line with every result. Record the numbers in the dev record with the engine build, model file, and a sanitized hardware line. Never record a hostname or a family conversation.
