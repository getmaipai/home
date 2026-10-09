# Use another computer for the AI

MaiPai Home can use a second computer for its AI engines. Home keeps your family settings. The other computer runs the engines.

## What you need

- Home is running, and you can sign in as an owner or admin.
- The engine computer runs Ubuntu and is on your home network.
- You can open a terminal on the engine computer.

## Set it up

1. On the engine computer, run Home's installer with the engine computer option:

   ```sh
   sudo bash install.sh --engine-computer
   ```

   If asked to install OpenSSH, type `y` and press Enter.
2. In Home, open **Engines**. Choose **Another computer** and enter the engine computer's name or home network address.
3. Open **Settings**, then **Devices**. Under **Engine computer link**, select **Pair engine computer**. Copy the one-time code. On the engine computer, run:

   ```sh
   sudo maipai-engine pair https://home.example ABCD-EFGH-JKLM
   ```

   Replace the sample address with Home's secure address, the one that starts with `https://`, and use the code shown in Home. The code expires after ten minutes. The engine computer prints a check code. Keep it for the next step.
4. In Home, select **Check the engine computer**. Enter the check code, then select **Pin this computer**. Dashes, spaces, and lowercase letters are okay. Home does not pin the computer if the code is wrong. After five wrong tries, start again with a new one-time code.

You'll know it worked when the engine computer shows as ready on the **Status** screen.

## Pairing needs a secure address

Pairing only works when you open Home at a secure address that starts with `https://`. If you open Home at an address that starts with `http://`, Home says pairing only works at a secure address. Open Home through its `https://` address, then select **Pair engine computer** again. On the engine computer, give the pairing command the same `https://` address.

## If it stopped answering

Check that both computers are on and connected to your home network. Open **Status** and read the engine computer's message. If Home shows an alert, open **Repairs** and follow its steps. A message about a changed security key means you need to pair again and enter the new check code.

## Use it away from home

Both computers need to be on your Tailscale network. In **Engines**, open the advanced settings and turn on **Reach the engine computer when away from home**. Use its Tailscale name or address. The setting starts off. Chat and pictures pause if the connection drops and resume when it returns.

To go back, open **Engines** and choose **This computer**. To remove pairing from the engine computer, run `sudo maipai-engine unpair` in its terminal. For more help, open **Settings**, then **Devices**, and select **Revoke link key**.
