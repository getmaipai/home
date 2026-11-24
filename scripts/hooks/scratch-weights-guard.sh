#!/usr/bin/env bash
# Claude Code PreToolUse hook for Bash (DISK-KEEPER-02). Blocks a command that downloads model weights unless it writes under the one
# scratch root (MAIPAI_SCRATCH_WEIGHTS, default ~/scratch/maipai-weights), and blocks it when that root is over its cap.
# Install: add to ~/.claude/settings.json hooks.PreToolUse, matcher "Bash", command "bash <repo>/scripts/hooks/scratch-weights-guard.sh".
# Input is the hook JSON on stdin; exit 2 blocks and its stderr reaches the model.
set -uo pipefail
SCRATCH="${MAIPAI_SCRATCH_WEIGHTS:-$HOME/scratch/maipai-weights}"
CAP_GB="${MAIPAI_SCRATCH_CAP_GB:-150}"
input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)"
[[ -n "$cmd" ]] || exit 0
pull='(hf|huggingface-cli)[[:space:]]+download|snapshot_download|hf_hub_download|git[[:space:]]+lfs[[:space:]]+pull|(curl|wget|aria2c)[^|;&]*\.(safetensors|gguf|ckpt|onnx)'
printf '%s' "$cmd" | grep -Eq "$pull" || exit 0
case "$cmd" in
  *"$SCRATCH"*|*'$MAIPAI_SCRATCH_WEIGHTS'*|*'${MAIPAI_SCRATCH_WEIGHTS'*|*'~/scratch/maipai-weights'*) ;;
  *) echo "Blocked: this downloads model weights outside the scratch root. Put them under $SCRATCH/<experiment>/ (e.g. --local-dir \"$SCRATCH/<experiment>\"), keep RESULTS.md in the experiment folder, and delete the weights when the experiment is done (docs/dev/disk-keeper.md)." >&2; exit 2;;
esac
if [[ -d "$SCRATCH" ]]; then
  kb="$(du -sk "$SCRATCH" 2>/dev/null | awk '{print $1}')"
  if (( ${kb:-0} / 1048576 >= CAP_GB )); then
    echo "Blocked: $SCRATCH holds $(( kb / 1048576 )) GB (cap ${CAP_GB} GB). Delete a finished experiment's weights first: bash scripts/disk-keeper.sh weights --apply" >&2; exit 2
  fi
fi
exit 0
