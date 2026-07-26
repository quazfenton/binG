#!/usr/bin/env bash
# update-model-snapshot.sh - Unified script for fetching model snapshots from various providers
# Supports OpenRouter, NVIDIA, and other providers via providers_model_fetcher.py

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_SCRIPT="$SCRIPT_DIR/providers_model_fetcher.py"

OUT_DIR="${OUT_DIR:-./snapshots}"
mkdir -p "$OUT_DIR"

log() { echo "[$(date -u +"%H:%M:%SZ")] $*" >&2; }

write_snapshot() {
  local provider="$1"
  local data="$2"  # JSON data
  local snapshot_file="${OUT_DIR}/models-${provider}-$(date -u +"%Y-%m-%dT%H-%M-%SZ").json"
  
  echo "$data" > "$snapshot_file"
  log "Wrote: $snapshot_file"
}

fetch_openrouter_free() {
  # Fetch free models from OpenRouter using the Python script
  python3 "$PYTHON_SCRIPT" openrouter --free --json
}

fetch_openrouter_all() {
  # Fetch all models from OpenRouter
  python3 "$PYTHON_SCRIPT" openrouter --json
}

fetch_nvidia_models() {
  # Fetch models from NVIDIA (requires NVIDIA_API_KEY)
  if [[ -z "${NVIDIA_API_KEY:-}" ]]; then
    echo "Error: NVIDIA_API_KEY environment variable is required for NVIDIA provider" >&2
    exit 1
  fi
  python3 "$PYTHON_SCRIPT" nvidia --json
}

fetch_provider_ids() {
  local provider="$1"
  local free_flag=""
  
  if [[ "${2:-}" == "free" ]]; then
    free_flag="--free"
  fi
  
  python3 "$PYTHON_SCRIPT" "$provider" $free_flag --ids
}

main() {
  local provider="${1:-openrouter}"
  local mode="${2:-all}"  # all|free|ids
  
  local models_json=''
  
  case "$provider" in
    openrouter)
      if [[ "$mode" == "free" ]]; then
        models_json="$(fetch_openrouter_free)"
      elif [[ "$mode" == "ids" ]]; then
        fetch_provider_ids "openrouter" "all" > /dev/null  # Just to trigger error if needed
        models_json="$(fetch_provider_ids "openrouter")"
      else  # all
        models_json="$(fetch_openrouter_all)"
      fi
      ;;
    nvidia)
      if [[ "$mode" == "ids" ]]; then
        models_json="$(fetch_provider_ids "nvidia")"
      elif [[ "$mode" == "free" ]]; then
        echo "Warning: NVIDIA provider does not support free filtering via API. Returning all models." >&2
        models_json="$(fetch_nvidia_models)"
      else  # all
        models_json="$(fetch_nvidia_models)"
      fi
      ;;
    *)
      echo "Unknown provider: $provider" >&2
      echo "Supported providers: openrouter, nvidia" >&2
      exit 1
      ;;
  esac
  
  # Validate that we got JSON
  echo "$models_json" | jq -e 'type=="object"' >/dev/null
  
  write_snapshot "$provider" "$models_json"
}

# Show help if no arguments
if [[ $# -eq 0 ]]; then
  echo "Usage: $0 <provider> [mode]"
  echo ""
  echo "Providers:"
  echo "  openrouter - Fetch models from OpenRouter"
  echo "  nvidia     - Fetch models from NVIDIA (requires NVIDIA_API_KEY)"
  echo ""
  echo "Modes:"
  echo "  all    - Fetch all models (default)"
  echo "  free   - Fetch only free models (where supported)"
  echo "  ids    - Output only model IDs (one per line, for snapshotting)"
  echo ""
  echo "Examples:"
  echo "  $0 openrouter free    # Get free OpenRouter models"
  echo "  $0 openrouter         # Get all OpenRouter models (default)"
  echo "  $0 nvidia             # Get all NVIDIA models (requires NVIDIA_API_KEY)"
  echo "  $0 nvidia ids         # Get NVIDIA model IDs only"
  echo ""
  echo "Environment variables:"
  echo "  NVIDIA_API_KEY    - Required for NVIDIA provider"
  echo "  OUT_DIR           - Output directory for snapshots (default: ./snapshots)"
  exit 0
fi

main "$@"