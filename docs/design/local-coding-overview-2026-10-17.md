# Local coding, in plain words (2026-10-17)

The short version of [local-coding-2026-10-17.md](local-coding-2026-10-17.md). Clickable mockup:
[assets/local-coding-2026-10-17/index.html](assets/local-coding-2026-10-17/index.html) (phone and desktop, with screenshots in
its `shots/` folder). Design only; nothing is built yet.

## What it is

Home can help people in the house write code: adults by default, and a teen or a child when an admin allows it. The AI runs on the home's own computer, so the code never goes to a cloud
company.

- **An admin turns it on.** It is off until then, like the other big AI features. Then every adult can use it by default.
  The admin can turn any one person off, or turn "Adults by default" off and pick people one by one. Guests never can.
- **Teens and kids only when an admin says yes.** An admin grants coding to one teen or child at a time. Every admin can see
  that grant and what it allows. All of the young person's protections stay on: every answer is checked, they never see the
  AI's thinking, no internet unless the grant names a site, no family files, smaller limits, and no personal keys unless the
  grant allows them. Their sessions stay private, like their chats; they can show a grown-up a session themselves.
- **Two ways to code.**
  1. **Your own tool on your laptop**: Claude Code, Codex, OpenCode, Aider, Continue or Cline. You make a personal key in
     Settings, Coding, and copy the setup lines the screen gives you. The key is shown once.
  2. **The Code app** in the browser, on a phone or a computer. It works like Claude Code on the web: pick a project, describe
     the change, watch it work, approve the plan, see every command and every changed line, then push or open a pull request.
- **Chat comes first.** Coding runs as its own AI model, loaded only while someone codes and put away after about 15 quiet
  minutes; the chat model stays loaded. It never slows family chat; coding waits instead. (Jesse decided this on 2026-10-17.)

## How it stays safe

- Each Code app session runs in its own small, closed-off computer on the hub. It sees only that project.
- It cannot see the family's chats, memories, photos or files, unless you add one of your own folders.
- No internet unless you allow a site (like a package download site) for that session, from a list the admin keeps. Video
  sites can never be allowed.
- It never holds your GitHub password. Only you can push or open a pull request, after you see the changes, and Home checks
  them for passwords and keys first.
- Keys work only for coding, expire, and can be revoked by you or an admin. They work on the home network, and away from home
  only through the home's own Tailscale if an admin turns that on (Jesse decided this on 2026-10-17). No public address, ever.
- Nobody, admins included, sees your sessions, projects or where you used your keys. Admins see counts on the Status page.
- **Stop all coding now** is one button for an admin. Nobody loses work.

## Which AI

On the 128 GB Studio: **Qwen3.6 35B** ("Fast", about 90 tokens, or word pieces, a second: a published figure for this chip), with **Qwen3.8 27B**
("Careful", slower) as the other choice. On a 64 GB computer: Qwen3.8 27B, the model the team already measured. Smaller
computers cannot run coding beside chat. A benchmark on the Studio confirms the pick before anything ships.

What it is good at: clear, small jobs (fix this test, add this field, write tests for this file). It is slower than the big
cloud models and weaker at design choices.

## What Jesse decided (2026-10-17)

1. A second AI model for coding, loaded only while someone is coding. The chat model stays loaded.
2. Anyone an admin allows can code, adults by default. Teens and kids only with an admin's grant, with every protection on.
3. Keys work away from home only through Tailscale, and only when an admin allows it.

## Still open

1. Should a grown-up be able to read a teen's or a child's coding log? Today's rules say no: nobody, admins included, sees
   another person's activity. Saying yes means Jesse changes that rule first.
