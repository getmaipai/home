#!/usr/bin/env python3
"""Fetch the pairing response and authenticate it with the one-time code.

PAIR-WIRE-01: Home's reply carries the signature as `hmac` (always did) and as `hmac_sha256` (added so a helper that
reads that name works too); either is accepted here, so this helper works with an older or a newer Home. When Home
refuses, its own words are shown with the next step, not a bare KeyError or "HTTP Error 403".
"""
# Python 3.8 (Ubuntu 20.04) cannot subscript `tuple[...]` at definition time; this keeps the annotation lazy.
from __future__ import annotations

import hashlib
import hmac
import json
import sys
import urllib.error
import urllib.request


class PairingError(Exception):
    """A failure whose text already says what went wrong and what to do."""


def next_step(status: int) -> str:
    if status == 403:
        return "Run this on the engine computer while it is on your home network, then try again."
    if status == 429:
        return "Wait a minute, then run the pair command again."
    if status in (400, 404):
        return (
            "In Home, open Settings, Home settings, Engines and AI, select Pair engine computer to get a new code, "
            "then run the pair command again with Home's https:// address."
        )
    return "Check that Home is running and that the address in the command is right, then try again."


def home_error(error: urllib.error.HTTPError) -> PairingError:
    """Home's JSON error body (`{"error": "..."}`) if it sent one, with the next step."""
    message = ""
    try:
        body = json.loads(error.read().decode("utf-8", "replace"))
        if isinstance(body, dict) and isinstance(body.get("error"), str):
            message = body["error"].strip()
    except (ValueError, OSError):
        message = ""
    if not message:
        message = "Home answered with HTTP " + str(error.code) + "."
    return PairingError(message + " " + next_step(error.code))


def fetch(home: str, code: str) -> tuple[str, str]:
    code = code.replace("-", "").upper()
    code_bytes = code.encode()
    lookup = hmac.new(code_bytes, b"maipai-pair-lookup", hashlib.sha256).hexdigest()[:32]
    mac_key = hmac.new(code_bytes, b"maipai-pair-mac", hashlib.sha256).digest()
    url = home.rstrip("/") + "/api/engine-link/pair/" + lookup
    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            reply = json.loads(response.read().decode())
    except urllib.error.HTTPError as error:
        raise home_error(error) from error
    except (urllib.error.URLError, OSError, TimeoutError) as error:
        raise PairingError(
            "Could not reach Home at " + home + ". Check that Home is running and that the address in the command "
            "is right (use its https:// address), then try again."
        ) from error
    except ValueError as error:
        raise PairingError(
            "Home's reply was not readable. Check that the address in the command is Home's own address, then try again."
        ) from error
    if not isinstance(reply, dict):
        raise PairingError("Home's reply was not what pairing expects. Update Home, then try again.")
    if isinstance(reply.get("error"), str) and reply["error"].strip():
        raise PairingError(reply["error"].strip() + " " + next_step(400))
    public_key = reply.get("public_key")
    household_id = reply.get("household_id")
    signature = reply.get("hmac_sha256") or reply.get("hmac")
    if not (isinstance(public_key, str) and isinstance(household_id, str) and isinstance(signature, str)):
        raise PairingError(
            "Home's pairing reply is missing its key, its household or its signature. "
            "Update Home to the latest version, then get a new code and try again."
        )
    signed = (public_key + "\n" + household_id).encode()
    expected = hmac.new(mac_key, signed, hashlib.sha256).hexdigest()
    # Bytes, so a signature with a non-ASCII character is a failed check, not a TypeError.
    if not hmac.compare_digest(expected.encode(), signature.encode()):
        raise PairingError(
            "Pairing response signature did not verify. Check that you typed the code exactly as Home shows it, "
            "or get a new code in Home and try again."
        )
    if not public_key.startswith("ssh-ed25519 "):
        raise PairingError("Home returned an invalid SSH key. Update Home, then get a new code and try again.")
    return public_key, household_id


if __name__ == "__main__":
    try:
        key, household = fetch(sys.argv[1], sys.argv[2])
        print(key)
        print(household)
    except Exception as error:  # surfaced as a short actionable shell error
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
