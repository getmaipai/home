# Voice lab

A standalone local voice-loop experiment. It does not import product code. Run `bun run start` from this directory, then open `http://127.0.0.1:9911`. The one-time secret is printed on startup; enter it on the page. The Stack must be running locally. Speech uses Silero when the configured model and native package load, otherwise the page reports an energy detector fallback.

Environment variables: `LAB_PORT` (9911), `LAB_SECRET` (generated and saved in `results/.secret` when absent), `LAB_STACK_URL` (`http://127.0.0.1:8770`), `LAB_SILERO` (Silero model path), and `LAB_TEMPERATURE` (0.8).

Tests: `bun test`. Tests are local and do not open sockets or call the Stack.


## Added controls and protocol

The page can select `talkOverMode` (`pause_then_decide`, default, or `stop_fast`), set `toolDelayMs` (default 2500 ms), choose a server network simulation preset, enable local ducking, and view the adaptive jitter buffer. Search results in the lab are placeholders. The built-in tools are `get_time` for a small city table and a delayed placeholder `web_search`.

Protocol 2 microphone frames have a 12-byte header (uint32 sequence and float64 capture time in milliseconds) followed by signed 16-bit PCM. Protocol 1 raw Float32 frames remain accepted. WebSocket messages include `pause`, `resume`, `tool_start`, `tool_end`, `ping`, and `pong`, alongside the existing turn, chunk, playback, duck, and stop messages.
