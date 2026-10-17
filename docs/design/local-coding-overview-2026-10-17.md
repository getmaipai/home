# Local coding, in plain words (2026-10-17)

The short version of [local-coding-2026-10-17.md](local-coding-2026-10-17.md). Clickable mockup:
[assets/local-coding-2026-10-17/index.html](assets/local-coding-2026-10-17/index.html) (phone and desktop, with screenshots in
its `shots/` folder). Design only; nothing is built yet.

## What it is

Home can help the adults in the house write code. The AI runs on the home's own computer, so the code never goes to a cloud
company.

- **An admin turns it on.** It is off until then, like the other big AI features. The admin picks who can use it: every adult,
  only admins, or chosen people. Guests never can. Kids and teens cannot in this version.
- **Two ways to code.**
  1. **Your own tool on your laptop**: Claude Code, Codex, OpenCode, Aider, Continue or Cline. You make a personal key in
     Settings, Coding, and copy the setup lines the screen gives you. The key is shown once.
  2. **The Code app** in the browser, on a phone or a computer. It works like Claude Code on the web: pick a project, describe
     the change, watch it work, approve the plan, see every command and every changed line, then push or open a pull request.
- **Chat comes first.** Coding runs as its own AI model, loaded only while someone codes and put away after 15 quiet
  minutes. It never slows family chat; coding waits instead.

## How it stays safe

- Each Code app session runs in its own small, closed-off computer on the hub. It sees only that project.
- It cannot see the family's chats, memories, photos or files, unless you add one of your own folders.
- No internet unless you allow a site (like a package download site) for that session, from a list the admin keeps. Video
  sites can never be allowed.
- It never holds your GitHub password. Only you can push or open a pull request, after you see the changes, and Home checks
  them for passwords and keys first.
- Keys work only for coding, expire, and can be revoked by you or an admin. They work on the home network, and away from home
  only through the home's own Tailscale if an admin turns that on. No public address, ever.
- Nobody, admins included, sees your sessions, projects or where you used your keys. Admins see counts on the Status page.
- **Stop all coding now** is one button for an admin. Nobody loses work.

## Which AI

On the 128 GB Studio: **Qwen3.6 35B** ("Fast", about 90 tokens, or word pieces, a second: a published figure for this chip), with **Qwen3.8 27B**
("Careful", slower) as the other choice. On a 64 GB computer: Qwen3.8 27B, the model the team already measured. Smaller
computers cannot run coding beside chat. A benchmark on the Studio confirms the pick before anything ships.

What it is good at: clear, small jobs (fix this test, add this field, write tests for this file). It is slower than the big
cloud models and weaker at design choices.

## What Jesse decides

1. A second AI model for coding, loaded only while in use (recommended), or coding shares the chat model and slows chat.
2. Adults only now with a teen "learn to code" version later (recommended), or never for teens.
3. Keys away from home only through Tailscale and only when an admin allows it (recommended), or home network only.
