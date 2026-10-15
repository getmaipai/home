# STACK-SEGMENTED-DL-01 report

## Decision

**Do not land this commit.** The production `downloadUrl` path remains unchanged. The segmented helper is uncalled by production and is retained only in this lane for coordinator review; the backlog row marks it not for landing. The real pinned-host paired 95% interval includes zero, so the approved ship condition was not met.

## Implementation and scope

- Extended `backend/src/lib/store/rangedDownload.ts` to write streamed byte ranges directly to offsets in a preallocated `.part` file, with a ranges sidecar, completed-range resume, streamed SHA-256 verification, access headers, per-part connection/stall handling, retry and progress.
- Added local range-server coverage for cap selection, gated headers, stall/retry behavior, 5xx retry, 429/403 no-retry fallback, resume, corrupt/missing sidecar restart, checksum failure and unsupported/non-206 fallback.
- Updated `backend/scripts/bench/download-strategies.ts` to use the helper's single-stream callback contract.
- No new outbound host or privacy row change. No new setting. The Stack production download path remains single stream.
- Request budget: at most N concurrent ranged GETs to one host for one file, N defaults to 4 and caps at 8; one file at a time per host. This prototype does not add a cross-call host semaphore, so concurrent callers could each use that per-file budget; this lane is not for landing.

## Benchmark evidence

### Local throttled server

All rows used the local loopback server with a synthetic deterministic 320 MiB payload. Three repeats were paired by run; checksum verification was included. The 12 MiB/s per-connection cap is a controlled fixture and does not predict real-host throughput.

| Strategy | Repeat 1 MiB/s | Repeat 2 MiB/s | Repeat 3 MiB/s | Mean MiB/s | Paired difference vs single | Paired 95% interval |
|---|---:|---:|---:|---:|---:|---:|
| Single stream | 46.11 | 45.09 | 46.37 | 45.86 | baseline | n/a |
| Four ranges | 46.07 | 45.71 | 45.19 | 45.66 | -0.20 | [-2.47, +2.07] |
| Eight ranges | 89.25 | 88.26 | 88.14 | 88.55 | +42.69 | [+40.69, +44.69] |
| Four parallel independent files | 45.06 | 44.42 | 44.20 | 44.56 | -1.30 | [-3.24, +0.64] |

### Real pinned model host

Source for every row: Hugging Face pinned model URL for `Qwen/Qwen3-1.7B-GGUF`, revision `90862c4b9d2787eaed51d12237eafdfe7c5f6077`, file `Qwen3-1.7B-Q8_0.gguf`, expected size 1,834,426,016 bytes. The Hub returned 302 to its declared `us.aws.cdn.hf.co` object host, advertised `Accept-Ranges: bytes`, and did not return 429 or 403. All six files passed the pinned SHA-256.

| Pair | Single stream MiB/s | Four ranges MiB/s | Difference MiB/s | Source |
|---|---:|---:|---:|---|
| 1 | 62.71 | 89.98 | +27.27 | Real pinned model host |
| 2 | 88.95 | 89.40 | +0.46 | Real pinned model host |
| 3 | 83.36 | 86.08 | +2.71 | Real pinned model host |
| Mean | 78.34 | 88.49 | +10.15 | Real pinned model host |

Paired two-sided 95% Student-t interval (df=2): **[-26.80, +47.09] MiB/s**. It includes zero. Four ranges are not shown to be faster under the acceptance criterion; the production switch remains off. Each host row used one file at a time. No 429/403 was seen.

## Machine and environment

- Engine build: `bun 1.3.14 (0d9b296a)`; runtime `arm64`.
- Hardware: Apple M4 Pro, 24 GB unified memory.
- Link type: Wi-Fi interface `en0` was the active default-route interface; the OS reported no associated AirPort network, so the physical uplink type is unconfirmed (no hostname or LAN IP recorded).
- File: local benchmark `payload.bin`, synthetic 320 MiB; real host file `Qwen3-1.7B-Q8_0.gguf`, pinned 1,834,426,016 bytes.
- No real model was retained; temporary downloads and local fixture files were cleaned up.

## Verification and commits

- Focused local downloader tests: 18 passed, 0 failed.
- Full `bash scripts/check.sh`: exit code **0**; typecheck passed; API and components docs had no drift; 443 tests passed; standards core passed.
- `git diff --check`: passed.
- Base: `origin/main` at `9a73c2c`.
- Prototype commit: `b593b986c2ddfa543b53679c295919027f17cf9f` (`Prototype safe segmented downloads (not for landing)`); report commit is recorded in Home's scratch reports directory.
- Scope line: prototype helper, its range-server tests, benchmark callback adaptation, Stack backlog row and this report only; production `downloadUrl` unchanged, no new dependency, no API/privacy change. Request budget is at most N concurrent ranged GETs per file per host (default 4, max 8), one file at a time per host; no cross-call host semaphore is implemented. **Not for landing** because the real-host paired interval includes zero.
