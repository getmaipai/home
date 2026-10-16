# Use another computer for the AI (/docs/admin/install-and-set-up/use-another-computer-for-the-ai)

Home can use the AI engines (the Stack) on the same computer, or on a second computer in your home. A second computer is useful when it has a stronger graphics card or more memory than the one running Home.

<Shot id="settings-engines" />

## ✅ Before you start [#-before-you-start]

- The second computer runs Ubuntu Linux. Other systems are not supported for this.
- Both computers are on the same home network.
- You can use `sudo` on the engine computer.

## 🔧 Set up the engine computer [#-set-up-the-engine-computer]

1. On the engine computer, run the installer with the engine option.

```bash
sudo bash /home/example/home/scripts/install.sh --engine-computer
```

The installer creates a `maipai-stack` service user, installs the Stack under `/opt/maipai-stack`, keeps its data in `/data/stack`, and enables SSH, asking first if `openssh-server` is missing. It then installs the `maipai-engine` tool.

2. Wait for "Ready to pair."

## 🔗 Pair it with Home [#-pair-it-with-home]

1. In Home, open **Settings**, **Home settings**, **Engines and AI**.
2. Press **Pair engine computer**.
3. Pick **Another computer**, then **Next**.
4. Type the engine computer's name or home network address, for example `192.0.2.20`, and its SSH port (usually 22).
5. Press **Get a one-time code**. Home shows a command like `sudo maipai-engine pair https://home.example ABCD-EFGH-JKLM`. Copy it.
6. Run that command on the engine computer. The code works once and Home shows when it expires. The command prints a **check code**.
7. Back in Home, press **Check the engine computer**, type the check code, then press **Pin this computer**.

Home reads the computer's security key and compares the check code, so you know you are talking to your machine and not another one.

Home runs a hop-by-hop connection test and shows **PASS** or **FAIL** for each hop with the fix.

## 🩺 Check it later [#-check-it-later]

- **Engines** shows **Engine health** and a **Check the connection** button.
- On the engine computer, `sudo maipai-engine status` and `sudo maipai-engine doctor` report what is running.
- **Needs restart** or **Update available** on a row means exactly that.

## ✂️ Unpair [#️-unpair]

1. On the engine computer, run `sudo maipai-engine unpair`.
2. In Home, press **Revoke link key**.

## 🌍 Away from home [#-away-from-home]

Reaching the engine computer through Tailscale is off by default. Turn on the `engines.stack.remote.allow_tailnet` setting only after you have joined both computers to your Tailscale network yourself. See [Remote access](/docs/admin/connect-and-extend/remote-access).

## 🔧 If chat stops answering [#-if-chat-stops-answering]

**Engines** says "No Stack configured" when no engine is set. Open **Where the engine runs**, pick one, and run **Check the connection**. The page for the Home computer is at [Troubleshooting](/docs/admin/look-after-it/troubleshooting-and-support-report).
