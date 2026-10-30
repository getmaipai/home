# MaiPai app helper

A small non-sandboxed Swift program that a LaunchAgent runs in the logged-in person's session. It is the one reader of running
apps for the auto-close feature ([design note](../../docs/design/auto-close-apps-2026-10-30.md)).

It answers three requests, one JSON object per line, on a unix socket that only the same user can open (mode 0600, peer uid checked):

- `{"op":"list"}`: running apps with name, bundle id, memory in bytes and whether the app is frontmost.
- `{"op":"quit","bundleId":"...","waitSeconds":20}`: asks the app to quit the way its Quit menu does, then waits. The reply is `quit`, `still_running` (a save prompt or a refusal: the app is left alone and reported), `not_running` or `refused_floor`.
- `{"op":"reopen","bundleId":"..."}`: opens the app again without bringing it to the front.

The never-close floor (Finder, Dock, login window, System Settings, remote-access tools, anything from MaiPai) is refused here whatever the caller says.
The helper sends no signal and has no force quit; a test fails the build if the sources contain one.

Build and test: `swift build` and `swift test` in this folder. Signing and installing the LaunchAgent are done by the installer in a later item.
