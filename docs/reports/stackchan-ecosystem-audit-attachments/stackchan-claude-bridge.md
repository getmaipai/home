# Audit: heavenchenggong/stackchan-claude-bridge (local clone, read-only)

## 1. What it is
- A thin bridge that lets a Xiaozhi-cloud LLM (DeepSeek/Qwen/Doubao) call the user's local Claude Code (`claude --print`) or WorkBuddy (`codebuddy -p`) through a Xiaozhi "MCP access point" websocket. Robot control itself is NOT in this repo (it lives in a separate firmware fork, `heavenchenggong/stackchan-xiaozhi-firmware`). Single commit 2026-09-12, MIT, 15 files, ~350 KB, Python only. Stars [unverified]. Chinese README/docs.

## 2. Architecture / protocol
- Chain (README, docs/architecture.md): mic -> Xiaozhi cloud ASR + LLM -> `wss://api.xiaozhi.me/mcp/?token=JWT` -> bridge/mcp_pipe.py (wss <-> stdio pump, Xiaozhi's official sample) -> FastMCP stdio server bridge/server.py -> subprocess `claude --print --permission-mode acceptEdits <task>`.
- Tools (server.py): `claude_code(task)` async, returns a spoken receipt immediately; `claude_code_quick(task)` sync, 20 s cap, output cut to 400 chars; `claude_code_background(task, summary_for_user)` LLM supplies its own receipt wording; `claude_code_check_results()` pops the newest outbox file. WorkBuddy variant renames to `workbuddy*`. bridge/stackchan_connector.py adds `notify_attention(project)`, `notify_dismiss`, `robot_status` that POST to the robot's own notify HTTP server on LAN :8788 (head shake x3 + pinned "waiting for you: <project>" on screen until dismissed) - an "approval alert" pattern.
- Robot-side tools are Xiaozhi firmware MCP (JSON-RPC over the same cloud link): `self.head.move(yaw -45..45, pitch 5..60) / center / nod / shake`, LED ring, expression (docs/firmware-changes.md; code is not in this repo). Targets xiaozhi-esp32 on CoreS3 (ESP-IDF 5.5.2). Cloud relay: YES, fully (xiaozhi.me sees audio, text, tool calls, results).

## 3. Wake word / speech
- Handled entirely by xiaozhi firmware ("你好小智", cloud streaming ASR/TTS). Repo notes light-sleep disabled via `PowerSaveTimer(-1,-1,-1)` so the wake word keeps working (docs/firmware-changes.md section 4). Conversation state lasts ~30 s then idle; results need a re-wake (docs/troubleshooting.md L115).

## 4. Features / wording tricks
- Tool docstrings are the prompt: explicit "use when / do not use for" lists, a mandatory behaviour line ("tell the user it is being looked up, do not imply a result exists"), sample Chinese task strings, and the recommended persona prompt in README (reply 1-2 sentences, no markdown, no emoji because it will be read aloud). Async receipt + later poll pattern solves a hard 30 s keepalive limit on the wss link ("1011 keepalive ping timeout"). `summary_for_user` argument lets the LLM write the spoken receipt. Outputs truncated (600/800 chars) for TTS.
- WorkBuddy version injects IDENTITY/USER/MEMORY.md persona files into system prompt per call (server_workbuddy.py L95-115).

## 5. Security (weak)
- Auth is a single long-lived bearer JWT in the websocket URL query string (`MCP_ENDPOINT`), stored in gitignored bridge/.env. Anyone with the token (or Xiaozhi itself, or whoever the LLM is prompted by) can drive tools. Token in URL leaks into logs/proxies.
- Remote voice-to-shell: any sentence heard by the robot (including TV/guests/prompt-injected content from tool results) can become a `claude --print` task. server.py uses `--permission-mode acceptEdits` while its comment claims it "disables dangerous write/shell" - misleading; server_workbuddy.py defaults to `bypassPermissions` with extra dirs (`WORKBUDDY_PERMISSION`, L67) and hard-coded personal paths (`/Users/I501579/...`, defaults at L55-65, and in stackchan_connector.py docstring with an internal LAN IP). No confirmation step, no allowlist of tasks, no per-call rate limit, no speaker/age gating, no audit log beyond stderr. Outbox in world-readable /tmp (`/tmp/claude-bridge-outbox`, predictable path; other local users can read/plant result files, and planted text is read back to the user by TTS) and result text from Claude is spoken verbatim (injection path both ways). Fire-and-forget `asyncio.create_task` with no concurrency cap: repeated tool calls spawn unlimited `claude` processes.
- Good: no inbound ports (outbound-only wss, stdio child), secrets gitignored with .example files, `stdin=DEVNULL` for the engine, SIGTERM-then-kill on timeouts, timeouts 20/120/300 s, empty-stdout-as-failure handling (don't speak a green check on engine error).

## 6. Performance / reliability
- launchd KeepAlive + ThrottleInterval 10; mcp_pipe reconnect with exponential backoff 1..600 s - but backoff is never reset after a successful connection (mcp_pipe.py connect_with_retry only doubles), so a flaky link drifts to 10 minute waits [bug]. Child process killed per reconnect. Async receipt pattern; node PATH discovery for launchd; model-routing pitfall documented. Latency table in docs/architecture.md (receipt 2-4 s, work 30-300 s). Outbox is "latest only": older results are never read (lost), no ids/correlation.

## 7. UI / images
- No images in repo (README text/ASCII only). 1/5.

## 8. README / docs
- Long, practical README: architecture ASCII, quick start 6 steps, "engineering pitfalls already hit", limits section; docs/ has architecture, firmware-changes, engineering-notes, troubleshooting. No tests, no CI, no AI-transparency note, no SECURITY.md, personal data left in examples. 3/5.

## 9. Top 8 ideas to adopt
1. Async "receipt then poll" tool pair for slow agent work, with a spoken-friendly receipt string supplied by the LLM (`summary_for_user`).
2. `notify_attention(project)` / `notify_dismiss`: robot shakes head and pins a "waiting for you" card when an agent needs human approval - good for our Claude/Home approvals.
3. Tool docstrings with explicit "use when / do not use for" and a behaviour-after-call instruction.
4. Persona prompt that bans markdown/emoji and caps length for TTS.
5. Truncate tool results to TTS-sized text (400-600 chars) at the tool boundary.
6. Treat empty output / exit 0 with stderr as failure.
7. Servo hold/lock semantic: `head.move` holds until `center`, with a manual-lock flag preventing face-tracker from overriding (and Nod using the commanded position, not tracker state) - exactly our "behavior vs explicit command" arbitration problem.
8. Disable light sleep on powered desks so wake word stays live.

## 9b. Avoid
1. Token-in-URL cloud relay with voice-to-agent execution and `bypassPermissions` (never pipe a household microphone to a shell-capable agent without per-user gating and confirmation).
2. World-readable /tmp mailbox and "latest only" result polling.
3. Backoff that never resets, unbounded background task spawning, and committing personal paths/IPs in examples.
