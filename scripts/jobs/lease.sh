#!/usr/bin/env bash
# HOST-LAUNCH-02: the lease broker for heavy development work. See lease.ts. Runs as the user, never root.
exec bun "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/lease.ts" "$@"
