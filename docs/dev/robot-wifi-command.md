# Robot Wi-Fi commands

Wi-Fi add commands use the robot's validated DeviceCommand envelope and active WebSocket, but bypass the durable command table and replay queue. A Wi-Fi password must not survive a request or be replayed after reconnect, so Home sends it only to a currently connected robot over a link the robot reports as encrypted. Forget commands contain only the network name and use the normal durable command path.
