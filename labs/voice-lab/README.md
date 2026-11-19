# Voice lab

A standalone local voice-loop experiment. It does not import product code. Run `bun run start` from this directory, then open `http://127.0.0.1:9911`. The one-time secret is printed on startup; enter it on the page. The Stack must be running locally. Speech uses Silero when the configured model and native package load, otherwise the page reports an energy detector fallback.

Environment variables: `LAB_PORT` (9911), `LAB_SECRET` (generated and saved in `results/.secret` when absent), `LAB_STACK_URL` (`http://127.0.0.1:8770`), `LAB_SILERO` (Silero model path), and `LAB_TEMPERATURE` (0.8).

Tests: `bun test`. Tests are local and do not open sockets or call the Stack.

## Page controls and link settings

The default `talkOverMode` is `continue`: speech over a reply lowers the reply gain to 60 percent without pausing. An acknowledgement restores gain without starting a turn. A transcript classified as an interruption stops the reply and carries the collected phrase into the next turn. Empty or failed transcripts are unknown and remain lowered until the duration limit decides. `pause_then_decide` and `stop_fast` remain selectable. Cut-in settings are `backchannelMaxMs` (1400 ms) and `backchannelGapMs` (250 ms); `toolDelayMs` defaults to 2500 ms.

Local ducking defaults on. It measures RMS per 32 ms mic frame. The noise floor adapts only when no reply is playing; two frames must be at least 10 dB above that floor and 6 dB above the mean of the prior 200 ms. A local trigger immediately lowers the reply to 60 percent and sends `local_duck`; without `duck`, `pause`, or `stop` from the hub, the page restores gain after 600 ms.

Network presets are Home (off), Phone on cellular (80 ms delay, 30 ms jitter, 1 percent audio loss), and Bad hotel Wi-Fi (200 ms delay, 120 ms jitter, 3 percent audio loss, 800 ms stall every 7 seconds). Audio frames can be dropped; control messages are protected from loss. One pure link model schedules both directions, adds delay and jitter per send time, and preserves message order. Search results in the lab are placeholders. The built-in tools are `get_time` for a small city table and a delayed placeholder `web_search`.

Other turn tunables include a 160 ms check pause, a 900 ms commit pause extended to at most 1800 ms for unfinished speech, a 0.6 turn threshold, 32 ms mic frames, 320 ms pre-roll, and 20 second recognition segments.

## Protocol and metrics

Protocol 2 microphone frames have a 12-byte header (uint32 sequence and float64 capture time in milliseconds) followed by signed 16-bit PCM. Protocol 1 raw Float32 frames remain accepted. WebSocket messages include `pause`, `resume`, `tool_start`, `tool_end`, `ping`, `pong`, `notice`, `local_duck`, `audio_scheduled`, and `error`, alongside turn, chunk, playback, duck, and stop messages. Reply audio frames, playback reports, and reply controls carry a turn generation. Stale frames, events, and page timers are ignored. `audio_scheduled` reports the AudioContext time of the first scheduled sample and output latency. Supported errors include `reply_failed` and `voice_failed`; readiness notices include `voice_not_ready`.

Allow-listed turn metrics include `t_check`, `t_transcript`, `t_turn_model`, `t_commit`, `t_llm_first_token`, `t_first_phrase_ready`, `t_voice_first_audio`, `t_first_frame_sent`, `t_first_audio_scheduled`, `t_first_audio_played`, `t_duck`, `t_local_duck`, `t_stop_sent`, `t_tool_start`, `t_tool_end`, `t_first_audio_after_tool`, `draft_head_start_ms`, `output_latency_ms`, `prompt_tokens`, `cached_tokens`, `chunks`, and `tool_rounds`. Records also allow `ok`, `failure` (`none`, `no_audio`, `voice_failed`, `reply_failed`, `cancelled`), and `draft` (`used`, `discarded`, `off`). The speed panel shows the hub's first-audio schedule time plus estimated output latency and a failed-turn count. Spoken text and transcripts are excluded from result records.
