# Use another computer for the AI

MaiPai Home can use the AI engines on another computer in your home. Home keeps its own screen and family settings. The other computer runs the engines.

## What you need

- MaiPai Home is running and you can sign in as an owner or admin.
- The engine computer runs Ubuntu and is on your home network.
- You can open a terminal on the engine computer.

## Set it up

1. On the engine computer, run Home's installer:

   ```sh
   sudo bash install.sh --engine-computer
   ```

   If the installer asks to add OpenSSH, type `y` and press Enter.
2. In Home, open **Engines**. Set **Where the engine runs** to **Another computer**, then enter the engine computer's name or home network address.
3. In **Settings**, open the **Devices** section. Under **Engine computer link**, select **Pair engine computer**. Copy the one-time code. On the engine computer, run:

   ```sh
   sudo maipai-engine pair 192.0.2.20 ABCD-EFGH-JKLM
   ```

   Replace `192.0.2.20` with Home's address. Replace the example code with the one from Home. The code expires after ten minutes. The command prints a check code when pairing finishes.
4. In Home, select **Check the engine computer**. Compare its check code with the one on the engine computer. If they match, select **Yes, pin this computer**.

The engine computer is ready when the **Status** screen shows it as working.

## If Home says the engine computer is not answering

Make sure the engine computer is on and connected to your home network. Open **Status** in Home and read the engine computer's status. If Home shows an alert, open **Repairs** and follow its steps. If the alert says the computer changed its security key, pair it again and compare the check codes before approving.

## Use it away from home

Both computers must be signed in to your own Tailscale network. In **Engines**, choose **Another computer**, then open the advanced settings and turn on **Reach the engine computer when away from home**. Set the engine computer's address to its Tailscale name or address. This setting starts off. If the link cannot connect, chat and pictures pause until the connection returns.

To go back, open **Engines** and set **Where the engine runs** to **This computer**. Home starts using its own AI engines again. To remove the pairing on the engine computer, run:

```sh
sudo maipai-engine unpair
```

Still need help? In **Settings**, open the **Devices** section. After unpairing the engine computer, choose **Revoke link key**.
