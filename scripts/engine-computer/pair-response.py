#!/usr/bin/env python3
"""Fetch the pairing response and authenticate it with the one-time code."""
import hashlib
import hmac
import json
import sys
import urllib.request


def fetch(home: str, code: str) -> tuple[str, str]:
    url = home.rstrip("/") + "/api/engine-link/pair/" + code
    with urllib.request.urlopen(url, timeout=10) as response:
        reply = json.loads(response.read().decode())
    public_key = reply["public_key"]
    household_id = reply["household_id"]
    signed = (public_key + "\n" + household_id).encode()
    expected = hmac.new(code.encode(), signed, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, reply["hmac_sha256"]):
        raise ValueError("Pairing response signature did not verify.")
    if not public_key.startswith("ssh-ed25519 "):
        raise ValueError("Home returned an invalid SSH key.")
    return public_key, household_id


if __name__ == "__main__":
    try:
        key, household = fetch(sys.argv[1], sys.argv[2])
        print(key)
        print(household)
    except Exception as error:  # surfaced as a short actionable shell error
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
