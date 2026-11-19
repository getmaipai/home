# Voice lab

A standalone local voice-loop experiment. It does not import product code. Run `bun run start` from this directory, then open `http://127.0.0.1:9911`. The one-time secret is printed on startup; enter it on the page. The Stack must be running locally. Speech uses Silero when the configured model and native package load, otherwise the page reports an energy detector fallback.

Environment variables: `LAB_PORT` (9911), `LAB_SECRET` (generated and saved in `results/.secret` when absent), `LAB_STACK_URL` (`http://127.0.0.1:8770`), `LAB_SILERO` (Silero model path), and `LAB_TEMPERATURE` (0.8).

Tests: `bun test`. Tests are local and do not open sockets or call the Stack.


## Added controls and protocol

The page can select `talkOverMode` (`continue`, default, `pause_then_decide`, or `stop_fast`), set `backchannelMaxMs` (1400 ms), `backchannelGapMs` (250 ms), `toolDelayMs` (2500 ms), choose a server network simulation preset, enable local ducking, and view the adaptive jitter buffer. Other turn tunables include a 160 ms check pause, a 900 ms commit pause extended to at most 1800 ms for unfinished speech, a 0.6 turn threshold, 32 ms mic frames, 320 ms pre-roll, and 20 second recognition segments. Network simulation supports fixed delay, jitter, loss, and periodic stalls. Search results in the lab are placeholders. The built-in tools are `get_time` for a small city table and a delayed placeholder `web_search`.

Protocol 2 microphone frames have a 12-byte header (uint32 sequence and float64 capture time in milliseconds) followed by signed 16-bit PCM. Protocol 1 raw Float32 frames remain accepted. WebSocket messages include `pause`, `resume`, `tool_start`, `tool_end`, `ping`, `pong`, `notice`, `local_duck`, and `error`, alongside the existing turn, chunk, playback, duck, and stop messages. Audio frames, playback reports, and reply controls carry a turn generation. Supported errors include `reply_failed` and `voice_failed`; readiness notices include `voice_not_ready`.

Turn metric names include `t_check`, `t_transcript`, `t_turn_model`, `t_commit`, `t_llm_first_token`, `t_first_phrase_ready`, `t_voice_first_audio`, `t_first_frame_sent`, `t_first_audio_scheduled`, `t_first_audio_played`, `t_duck`, `t_local_duck`, `t_stop_sent`, `draft_head_start_ms`, `output_latency_ms`, `prompt_tokens`, and `cached_tokens`. Metric records also allow `ok`, `failure` (`none`, `no_audio`, `voice_failed`, `reply_failed`, `cancelled`), and `draft` (`used`, `discarded`, `off`). Transcript and spoken text are excluded from result records.
