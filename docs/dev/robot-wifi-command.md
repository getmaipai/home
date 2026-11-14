# Robot Wi-Fi commands

Wi-Fi add commands use the robot's validated DeviceCommand envelope and active WebSocket, but bypass the durable command table and replay queue. A Wi-Fi password must not survive a request or be replayed after reconnect, so Home sends it only to a currently connected robot over a link the robot reports as encrypted. Forget commands contain only the network name and use the normal durable command path.

## Use this network now, and the tailnet test (ANYWHERE-08)

An admin can make the robot join one saved network at once, so the away path can be tested without carrying the
robot out of range of the home Wi-Fi. The Robot Wi-Fi card shows **Use this network now** beside each saved network;
it posts `{ action: "use", ssid }` to `POST /api/devices/{id}/wifi`, which sends the durable device command `wifi_use`
(payload `{ ssid }`, 60 s). The command carries no password, so it needs no encrypted link, only an online robot and a
network that is in the robot's saved list.

On the unit (bot firmware patch 154) the choice is a memory-only hold: the Wi-Fi component joins the strongest saved
network in range, so for the length of the hold only the chosen network is left in the in-memory list, and the saved
list in flash is never written (a restart brings every saved network back). When the robot reaches the hub on the new
network the hold ends (event `wifi_use_ok`); when it has not reached the hub in 3 minutes, the full list is restored and
the robot reconnects by itself (event `wifi_use_revert`). Press **Use this network now** on the home network to come back
sooner.

**Test the tailnet path for 10 minutes** (an admin's button on the same card) sends `prefer_tailnet` with `{ minutes }`
through `POST /api/devices/{id}/commands`; the unit then skips the home address and reaches the hub over its own
tailnet address for that long (firmware patch 153; off by default, never saved, 0 turns it off).

The check-in reports `link_encrypted: true` when the robot's connection comes from its own tailnet address while its
tailnet client reports connected (WireGuard encrypts that channel end to end), so the add-network form on the card
unlocks while the robot is away on the tailnet. A connection from another tailnet address, such as the laptop relay, stays
plain.
