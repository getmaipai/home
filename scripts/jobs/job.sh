#!/usr/bin/env bash
# HOST-LAUNCH-01: the dev job launcher. See job.ts for what it does. Runs as the user, never root.
exec bun "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/job.ts" "$@"
