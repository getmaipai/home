---
title: Use OpenCode with Home
description: Point the OpenCode terminal tool at the coding model on your home computer, with your own key.
---

# Use OpenCode with Home

OpenCode can write and edit code using the coding model that runs on your home computer. Nothing leaves the house. This page takes about 5 minutes.

You need three things: Coding turned on by an admin, your own key, and OpenCode installed on the computer you code on. Home does not install OpenCode. Get it from [opencode.ai](https://opencode.ai).

## 1. Make your key

1. Open **Settings**, then **AI and models**, then **Coding**.
2. Choose **Create key**, name it after the computer it is for, and pick when it expires.
3. Copy the key now. Home shows it once.

Keep the key out of the config file. Save it in a file only you can read:

```
mkdir -p ~/.config/maipai
```

```
nano ~/.config/maipai/code.key
```

Paste the key, save, then run `chmod 600 ~/.config/maipai/code.key`.

## 2. Find the address

The address ends in `/code/v1`. Which start to use depends on where you are.

| Where you code | Base URL |
|---|---|
| On the home computer itself | `http://127.0.0.1:3000/code/v1` |
| Another computer at home | `https://home.example.com:3000/code/v1`, your Home address from Settings, Coding |
| Away from home | The same https address, over your household's Tailscale network. An admin must turn on away access first. |

Outside the home computer the address must start with `https`. If your computer asks you to trust the home certificate, say yes.

## 3. Add the provider to OpenCode

Open `~/.config/opencode/opencode.json` and add this block. Replace the base URL with the one from step 2.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "maipai": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "MaiPai Home",
      "options": {
        "baseURL": "http://127.0.0.1:3000/code/v1",
        "apiKey": "{file:~/.config/maipai/code.key}"
      },
      "models": {
        "maipai-coder": {
          "name": "Home coding model",
          "tool_call": true,
          "limit": { "context": 131072, "output": 16384 }
        }
      }
    }
  },
  "model": "maipai/maipai-coder"
}
```

The `apiKey` line reads the key from the file, so the config holds no secret.

## 4. Try it

In a project folder, run:

```
opencode run "say hello"
```

You'll know it worked when the model answers. The first answer can take a minute, because Home loads the coding model the first time someone asks.

## If it stops working

- **401 or "key not valid".** The key was copied wrong, expired or revoked. Make a new one in Settings, Coding.
- **403 "needs a secure address".** You used `http` away from the home computer. Switch to the `https` address.
- **503.** Coding is paused or the model is not ready. Ask an admin to open Settings, Coding and check **Stop all coding now** (it may be paused) and **What Coding needs** (a part may be missing).
- **Home stopped this request because it breaks a safety rule.** Home's safety filter refused a file the tool read. Ask OpenCode to skip that file.

Your key works only for Coding. If a key leaks, revoke it in the same screen. See [Coding keys](coding-keys.md) for the rest of the key controls.
