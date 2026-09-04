#!/usr/bin/env bash
# Generates spec/gen/py/*.py (Pydantic v2) from spec/schemas/*.schema.json.
# Committed output, not run at build time. Run with: bash scripts/gen-py.sh
# (from spec/), then commit the result.
set -euo pipefail
cd "$(dirname "$0")/.."

echo '== bundling schemas (resolves the cross-repo standards $ref)'
bun run scripts/bundle-schemas.ts

rm -rf gen/py
uv run datamodel-codegen \
  --input schemas.resolved \
  --input-file-type jsonschema \
  --output gen/py \
  --output-model-type pydantic_v2.BaseModel \
  --target-python-version 3.12 \
  --use-schema-description \
  --collapse-root-models \
  --use-standard-collections \
  --use-union-operator \
  --enum-field-as-literal all \
  --disable-timestamp

echo "Generated Pydantic v2 models into spec/gen/py/."
