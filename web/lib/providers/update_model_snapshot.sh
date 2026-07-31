#!/usr/bin/env bash
# update_model_snapshot.sh - CLI wrapper for providers_model_fetcher.py
# Creates timestamped snapshots of model lists from various AI providers

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_SCRIPT="${SCRIPT_DIR}/providers_model_fetcher.py"
OUT_DIR="${OUT_DIR:-./snapshots}"
TIMESTAMP="$(date -u +"%Y-%m-%dT%H-%M-%SZ")"

# Ensure output directory exists
mkdir -p "${OUT_DIR}"

# Logging function
log() {
    echo "[$(date -u +"%H:%M:%SZ")] $*" >&2
}

# Print usage
usage() {
    cat <<EOF
Usage: $0 <provider> [options] [output-file]

Providers:
  openrouter  Fetch models from OpenRouter (https://openrouter.ai)
  nvidia      Fetch models from NVIDIA NIM (https://integrate.api.nvidia.com/v1)

Options:
  free        Filter to only free models (if supported by provider)
  ids         Output only model IDs (one per line, no JSON)
  json        Output full JSON (default if neither --ids nor --free)
  
Output:
  If no output-file specified, creates timestamped file in ${OUT_DIR}/
  Format: models-\${provider}-\${timestamp}.json

Examples:
  # Get free OpenRouter models (saved to timestamped file)
  $0 openrouter free
  
  # Get all NVIDIA model IDs to stdout
  export NVIDIA_API_KEY="your-key-here"
  $0 nvidia ids
  
  # Get OpenRouter models as JSON to specific file
  $0 openrouter json ./my-models.json
  
  # Get help
  $0 --help

Environment:
  NVIDIA_API_KEY  Required for NVIDIA provider access
  OUT_DIR         Output directory for snapshots (default: ./snapshots)
EOF
}

# Main logic
main() {
    if [[ $# -eq 0 ]] || [[ "${1:-}" == "--help" ]] || [[ "${1:-}" == "-h" ]]; then
        usage
        exit 0
    fi
    
    local provider="$1"
    shift
    
    # Validate provider
    if [[ ! "openrouter nvidia" =~ (^|[[:space:]])${provider}($|[[:space:]]) ]]; then
        echo "Error: Unknown provider '$provider'" >&2
        echo "Valid providers: openrouter, nvidia" >&2
        exit 1
    fi
    
    # Parse arguments
    local output_file=""
    local args=()
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            free|ids|json)
                args+=("$1")
                shift
                ;;
            *)
                # Treat as output file
                output_file="$1"
                shift
                ;;
        esac
    done
    
    # Build Python command
    local python_cmd="python3 \"${PYTHON_SCRIPT}\" \"${provider}\""
    for arg in "${args[@]}"; do
        python_cmd+=" \"${arg}\""
    done
    
    # Execute and handle output
    if [[ -n "${output_file}" ]]; then
        # Output to specified file
        log "Fetching ${provider} models${args[*]:+(with ${args[*]})} -> ${output_file}"
        eval "${python_cmd}" > "${output_file}"
        log "Saved to ${output_file}"
    else
        # Output to timestamped file in OUT_DIR
        local output_file="${OUT_DIR}/models-${provider}-${TIMESTAMP}.json"
        # If only asking for IDs, use .txt extension
        if [[ " ${args[*]} " =~ " ids " ]]; then
            output_file="${OUT_DIR}/models-${provider}-${TIMESTAMP}.txt"
        fi
        
        log "Fetching ${provider} models${args[*]:+(with ${args[*]})} -> ${output_file}"
        eval "${python_cmd}" "${args[@]}" > "${output_file}"
        log "Saved to ${output_file}"
    fi
}

# Handle case where script is sourced vs executed
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    # Script is being executed
    main "$@"
fi