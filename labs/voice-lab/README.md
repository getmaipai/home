# Voice lab

A standalone local voice-loop experiment. It does not import product code. Run `bun run start` from this directory, then open `http://127.0.0.1:9911`. The one-time secret is printed on startup; enter it on the page. The Stack must be running locally. Speech uses Silero when the configured model and native package load, otherwise the page reports an energy detector fallback.

Environment variables: `LAB_PORT` (9911), `LAB_SECRET` (generated and saved in `results/.secret` when absent), `LAB_STACK_URL` (`http://127.0.0.1:8770`), `LAB_SILERO` (Silero model path), and `LAB_TEMPERATURE` (0.8).

Tests: `bun test`. Tests are local and do not open sockets or call the Stack.
