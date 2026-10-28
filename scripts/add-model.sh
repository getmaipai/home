#!/usr/bin/env bash
# MODEL-ADD-01 S5: add a chat model to the shipped catalog from a Hugging Face file. Usage: scripts/add-model.sh <owner/repo> <file.gguf>
# Reads the file through the running Stack (nothing downloads), writes the catalog record, prints the Stack pin. Never lands or ships.
set -euo pipefail
exec bun "$(dirname "$0")/addModel.ts" "$@"
