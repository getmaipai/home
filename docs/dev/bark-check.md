# Bark feasibility check (BARK-CHECK-01)

Run by the owner, once, before NOTIFY-BARK-01 is built. It settles the four points the design note
([agentic-actions-design-2026-10-29](../plans/agentic-actions-design-2026-10-29.md), section 10) could not read from Bark's
GitHub pages. A session then records the measured answers in that note. Nothing here changes Home.

Throwaway only: use a test phone key and a test message ("Bark check"), never a real alarm label.

## What you need

- An iPhone with the Bark app from the App Store.
- A computer on the household network to run `bark-server`. Docker is the simplest way (`finab/bark-server` image, port 8080,
  a `/data` volume); a release binary also works (`./bark-server --addr 0.0.0.0:8080 --data ./bark-data`). The server's own
  README has the exact commands: https://github.com/Finb/bark-server
- A second network for step 3: the phone on cellular, Wi-Fi off.

## Steps and what to write down

1. **Start the server and check it.** Run `curl http://<server-address>:8080/ping` from another computer. Write down: the reply,
   and whether the server asked for any login or key (point 4, authentication).
2. **Register the phone.** In the Bark app, add the server address, with the phone on the home Wi-Fi. The app shows a key.
   Write down: did registration work with no outside Bark account, and does the server list the device? (point 2)
3. **Send a plain push from the server's own computer.** `curl "http://<server-address>:8080/<key>/Bark%20check/hello"`.
   Write down: did the phone ring? Then turn the phone's Wi-Fi off (cellular only) and send again. Write down: does it arrive
   while the phone cannot reach the server directly, and does the app still work when it is away from home? (point 3)
4. **Send an encrypted push.** In the Bark app, set an encryption key for the device (the app asks for an algorithm and a key).
   Send a push with the `ciphertext` parameter as the Bark docs describe. Write down: the algorithm and key length the app
   asks for, whether the message arrives readable on the phone, and whether the server's data folder or log shows the text
   in the clear (point 1).
5. **Check the alarm levels.** Send one push with `level=timeSensitive&call=1&sound=alarm`. Write down: does it repeat the
   sound, and does it show during a Focus mode?

## Answers to bring back

| Point | Question | Your answer |
|---|---|---|
| 1 | Which encryption algorithm and key size does Bark use, and is the text unreadable on the server? | |
| 2 | Does a self-hosted server reach Apple's push service with no outside Bark account? | |
| 3 | How does the phone, away from home, receive pushes and reach the server (public address, private network)? | |
| 4 | Does the server need a login or key, and is it on by default? | |

If any answer is "no" or "needs an outside account", stop: that changes the design, and the privacy row for Bark would have to
say so.
