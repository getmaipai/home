---
title: Sign in
description: How the passcode boxes work, what happens after wrong tries, and how to get back in.
---

## Sign in with a PIN

1. Pick your name on the sign-in screen.
2. Type your PIN. The screen shows one box for each digit of your PIN, and each digit is hidden as you type. If your PIN has 6 digits, you see 6 boxes.
3. Home signs you in as soon as the last box is full. You do not press anything.

If your sign-in is a password with letters or symbols, you see one password field and a **Sign in** button instead. If you have a PIN but want to use a password, press **Use a password instead**. Press **Use a PIN instead** to go back. Press **Back** to pick another name.

## Two-step sign-in

An owner or admin can turn on two-step sign-in in **Settings** > **Profile and sign-in**, in the **Two-step sign-in** card. Scan the setup picture with an authenticator app, type the 6-digit code it shows, and press confirm.

After that, signing in has two steps. First you give your PIN, password or passkey. Only when that is right does Home ask for the 6-digit code from your app. Type the code and choose **Continue**. Keep your authenticator app with you when you sign in.

- The code step belongs to the step before it. Nobody can skip to the code step with just your name.
- Your first step stays good for 5 minutes. If you type a wrong code, you can try again without giving your PIN again. After 5 minutes, start over from your name.
- Two-step sign-in cannot be turned off by accident. To turn it off, open the same card and type a current code from your app. If it is already on, starting setup again does not reset it. Home tells you it is on.

## If you type the wrong code

The boxes shake, turn red and clear, so you can try again. Home says what to do next in plain words. If the network drops while you sign in, the boxes keep what you typed. Try again when the hub is back.

After 5 wrong tries in a row, the sign-in locks for a short time. The wait grows each time it happens again: 30 seconds, then 2 minutes, then 10 minutes, then 1 hour. A countdown shows on screen and the boxes stay off until it ends. A right code clears the count. PINs and passwords share one count.

The lock is for one person on one device. Wrong guesses for Sage from one address lock Sage on that address only. They do not lock anyone else, and they do not lock Sage on another device. This way a child who keeps guessing cannot lock the owner out of the house. If someone keeps guessing for the same person from many addresses, that person is locked on every address after 25 wrong tries, and the wait grows the same way.

Home also takes one sign-in try at a time for each person. If two tries arrive at the same moment, the second one is asked to wait a second and then try again.

## The lock screen

An owner or admin can ask for a lock screen on a person's account. The screen locks after a set number of idle minutes and asks for the same PIN in the same boxes. It also has a password option for people whose sign-in is a password. Nothing you had open is lost.

To turn it on for someone, an owner or admin opens **Settings**, then **Household and people**, then the **People** tab, and chooses **Users**. Choose **Edit** next to the name, tick **Require PIN lock**, and set the minutes. An admin can also find it in **Settings**, under **Your data and apps**, on the **Developer tools** tab, in the **Session lock** card.

## Change your PIN or password

Open **Settings**, then **Profile and sign-in**. Find the **PIN or password** card. Choose **PIN** or **Password**, type your current one, type the new one twice, then press **Change PIN** or **Change password**. A PIN or password can be 4 to 128 characters. A PIN of only digits shows as boxes at sign-in. If you change from a 4-digit PIN to a 6-digit one, the sign-in screen learns the new length by itself.

## If you forgot it

Nobody can read your PIN, and Home has no reset link on the sign-in screen. Ask an owner or admin for help. See [Fix a problem](fix-a-problem.md).

## Something not working?

| What you see | Why | What to do |
|---|---|---|
| Red shake and the boxes clear | Wrong code | Try again with the right code |
| A countdown and the boxes are off | 5 wrong tries in a row locked this person on this device | Wait for the countdown. It clears itself. The next lock is longer |
| "This address is not one Home answers to" | You opened Home by an address it does not use | Open Home by its own address. An owner or admin finds it in **Settings**, **Advanced**, **Network and access** |
| The code step says the sign-in expired | More than 5 minutes passed after your PIN | Pick your name and start again |
| The boxes do not sign you in by themselves | Home does not know your PIN length yet (an older account) | Use the password field and **Sign in** once. Home learns the length from a good sign-in |
| Only a password field shows | Your sign-in is a password, not a digit PIN | Type it and press **Sign in** |
| Boxes keep what you typed and show an error | The hub could not be reached | Check the hub is on, then try again |
| Locked out and forgot the code | Nobody can read your PIN | Ask an owner or admin for help |
