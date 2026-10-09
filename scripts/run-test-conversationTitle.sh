#!/bin/bash
set -euo pipefail
export MAIPAI_DATA_DIR="/var/folders/qr/d9yr4nz52fbf1gvkq4hjc07w0000gn/T/maipai-home-test-$$"
exec "bun" test /Users/jessetorres/Developer/github.com/getmaipai/home-bench/backend/tests/conversationTitle.test.ts
