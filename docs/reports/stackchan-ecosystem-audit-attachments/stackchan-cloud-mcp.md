# Audit: tianyupaipai-cmd/stackchan-cloud-mcp (local clone, read-only)

## 1. What it is
- A deployment kit that puts the upstream `kisaragi-mochi/stackchan-mcp` gateway (PyPI `stackchan-mcp` 0.17.0) on a public VPS and exposes it to claude.ai as a custom connector, so a phone can drive the robot with no laptop in the loop. Single commit 2026-10-07 (tianyupaipai-cmd), MIT, 19 files, ~450 KB. Python (cloud/*.py ~45 KB), bash patch scripts, JS sprite generator, Chinese+English docs. Stars [unverified]. Does not contain the gateway itself, only add-ons and patches.

## 2. Architecture / protocol
- claude.ai --MCP over HTTPS (OAuth 2.1 DCR+PKCE)--> Cloudflare Tunnel --> cloud/oauth_proxy.py :8770 --> upstream gateway MCP streamable-http 127.0.0.1:8767 --WebSocket (device port 8765, public)--> StackChan CoreS3 running xiaozhi-esp32-family firmware. Cloud relay by design (VPS holds audio, camera, TTS/STT).
- Tools used (names seen in reflex.py/xinchao_mood.py/docs): `say`, `listen`, `set_avatar(face)`, `load_avatar_set(archive_path, mode=layered, timeout)`, `set_blink(enabled)`, `set_mouth` / `set_mouth_sequence`, `move_head(yaw, pitch, speed)`, `set_all_leds(r,g,b)`, `clear_leds`, `set_volume`, `set_brightness`, `set_auto_torque_release(enabled, timeout_ms)`, `get_touch_state` (returns last_event, last_event_age_ms; events "stroke"/"press"), `get_status`, `take_photo`. Full catalog lives in the upstream repo (see stackchan-mcp audit).
- Add-on parts: cloud/oauth_proxy.py (aiohttp OAuth AS + streaming reverse proxy, rewrites Authorization to the gateway token so claude.ai token and gateway token are separate), cloud/fake_ota.py (always answers "latest version" + server time; port 8768), cloud/reflex.py (daemon), cloud/xinchao_mood.py (AI-state-driven mood), cloud/agent_state_hook.sh (Claude Code UserPromptSubmit/Stop hook writing think/speak state), patches/apply_patches.sh (idempotent sed/python patching of the installed package with .orig backups), sprites/ (zero-dependency JS that draws 16 faces x A/B frames as 40 RGB565 frames, 1,536,000 bytes).

## 3. Wake word / speech
- Not implemented here. Speech: gateway Edge TTS (free, rate-limited from CN) and faster-whisper STT (`listen`); HF mirror + `HF_HUB_DISABLE_XET=1` for China. README admits "wake word -> local brain auto reply" needs a gateway-side LLM and is not supported; the brain is claude.ai.

## 4. Features / wording
- The valuable layer is behavior: reflex.py re-pushes avatar set, blink, current face and device prefs (volume 100, brightness 40, auto torque release 3 s) 20 s after every "ESP32 ready" log line; speech watchdog returns to the idle face `duration_ms`+4 s after a say(); touch reaction (blush face + pink LEDs, 15 s cooldown, long because false positives look identical to real touches); idle micro look-arounds (yaw set -25..25, pitch 20-30 so gaze sits at seated eye level) after 40 s of no activity; standby dim after 600 s. xinchao_mood.py maps AI state (think/speak/call/ring/rest) to face, LED breathing and tiny head motions, with quiet hours, away schedule (CN workday calendar), per-motion cooldown (5 min "to save servo gears"), daily caps on "miss you" reactions, user-authored lines only. agent_state_hook.sh "only recognizes the owner" by regex on the prompt (OWNER_MARK) so cron/ops messages never wake the robot.
- No tool-description text in this repo (descriptions come from the upstream gateway).

## 5. Security
- Good: single-tenant OAuth with PKCE S256 only, auth codes single-use (pop) with 5 min TTL, in-memory tokens (restart revokes), service refuses to start without MCP_GATE_KEY / STACKCHAN_TOKEN, separate claude.ai vs gateway tokens, secrets via env only, listens on 127.0.0.1 behind Cloudflare Tunnel (no 80/443 open), privacy advice (visible indicator on photo, no disk, one photo per call). 
- Weaknesses (cloud/oauth_proxy.py): `/register` accepts any client and any redirect_uris; `/authorize` does NOT validate redirect_uri against the registered ones nor client_id, so an attacker-crafted link plus a phished gate key delivers a code to any URL (open-redirect-style code theft); redirect_uri also not re-checked at /token. Gate key compared with `!=` (not constant time), no rate limit or lockout (brute force of one shared key), no CSRF/state binding on the consent form, error page injects the raw posted `q` into HTML (self-XSS). Access tokens last 30 days, no refresh, no revoke, no scopes granularity (one token = all tools incl. camera/mic). 64 MB request body cap, no per-IP limits. Device WebSocket :8765 and fake OTA :8768 are bound 0.0.0.0 and the docs tell you to open them in the cloud security group; the device link relies on the shared STACKCHAN_TOKEN [device-auth detail unverified, depends on upstream]; fake OTA is plain HTTP and serves unauthenticated responses. Patch scripts modify installed packages with sed (fragile, silently stale after upgrades; restore.sh swallows errors with `|| true`). reflex.py parses journalctl lines with regex (log-scraping as an event bus; injectable by anything that can put text in the unit's log).
- Prompt injection: claude.ai drives physical tools and a camera; no confirmation or capability tiers; tool outputs (STT text) flow into the model unfiltered.

## 6. Performance / reliability
- Root-caused NAT idle timeout (device WS dropped at ~90 s with rcvd_code=None sent_code=None) -> ping 20 s/timeout 60 s. Fake OTA with 75 s read timeout because weak-WiFi POST bodies arrive in slow fragments; HTTP/1.1 keep-alive body draining. Lazy MCP session with reset on any error. Reconnect-then-wait-20-s before pushing 1.5 MB avatar set. Torque auto-release (heat). Missing `opuslib` makes say() "succeed" silently - documented silent failure. Stale state file with atomic write (`os.replace`). Poll `get_touch_state` every 2 s (no event push).

## 7. UI / images
- No images in repo (sprites are code; no screenshots). Pixel faces are described in sprites/README.md only. 2/5 (idea good, nothing viewable).

## 8. README / docs
- Strong, honest: problem/symptom/root cause/fix/verification table for each patch (patches/README.md ~17 KB, bilingual), full DEPLOY.md with systemd units, troubleshooting table, explicit security notes and known limits. No tests, no CI, no AI-transparency statement, no CHANGELOG. 4/5 docs, 0/5 tests.

## 9. Top 8 ideas to adopt
1. "Reflex" layer on our host: on every device (re)connect re-push persistent state (face set, volume, brightness, torque release, LEDs off) - firmware reboot resets must never leave the robot in defaults.
2. Speech watchdog: idle-face reset at say() duration + grace; a newer say() postpones.
3. Touch cooldown (15 s) and "state of the face the robot should show" file so every return-to-normal goes to the mood face, not a hard-coded idle.
4. Idle micro-motion with eye-level pitch band, per-gesture cooldown, quiet hours, away schedule, daily caps (servo wear + heat).
5. Hook-based agent state (think/speak) written atomically to a file with an owner-only filter; map Claude/Home turn states to face/LED.
6. Auto torque release after moves (heat) and low default brightness.
7. 90 s NAT drop diagnosis (look for `rcvd_code=None sent_code=None`) and WS ping 20/60 s defaults; always-OK fake OTA with slow-body tolerance as a pattern for boot-time cloud checks.
8. Document every field bug as symptom / root cause / change / verification; ship idempotent patch scripts with `.orig` backup and DRY_RUN.

## 9b. Avoid
1. Permissive DCR with unvalidated redirect_uri and one shared, rate-unlimited gate key guarding camera+mic tools.
2. Patching installed packages with sed instead of upstreaming or vendoring; log-scraping journalctl as the event bus.
3. Polling for touch state and one all-powerful 30-day token with no confirmation or scope for camera/mic.
