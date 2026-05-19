#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  VNC Helper — manage the ARM instance desktop connection
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SSH_HOST="129.213.35.8"
SSH_USER="ubuntu"
SSH_KEY="/root/.ssh/id_rsa_oci"
TUNNEL_PORT="5901"
VNC_PASSWORD="hA9JIn0KFNpjMtO"
# noVNC base URL fetched dynamically from the server (changes on cloudflared restart)
NOVNC_BASE_URL=""

# ── Fetch tunnel URL ────────────────────────────────────────
# Gets the current Cloudflare tunnel URL from the server (single SSH call)
fetch_novnc_url() {
  local url
  url=$(ssh -o StrictHostKeyChecking=accept-new \
    -o ConnectTimeout=8 \
    -o LogLevel=ERROR \
    -i "$SSH_KEY" \
    "${SSH_USER}@${SSH_HOST}" \
    "docker logs bing-cloudflared-1 2>&1 | grep -o 'https://[^ ]*\\.trycloudflare\\.com' | tail -1" \
    2>/dev/null || true)
  if [[ -n "$url" ]]; then
    NOVNC_BASE_URL="$url"
  elif [[ -z "$NOVNC_BASE_URL" ]]; then
    NOVNC_BASE_URL="https://stood-color-victoria-activity.trycloudflare.com"
  fi
  NOVNC_URL="${NOVNC_BASE_URL}/novnc/vnc.html"
  NOVNC_URL_LITE="${NOVNC_BASE_URL}/novnc/vnc_lite.html"
}

# ── Colors ──────────────────────────────────────────────────
BOLD='\033[1m'
DIM='\033[2m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# ── Help ────────────────────────────────────────────────────
usage() {
  echo -e "${BOLD}Usage:${NC} ./vnc.sh [command]"
  echo
  echo "  ${BOLD}open${NC}          Open noVNC in browser"
  echo "  ${BOLD}tunnel${NC}        Create SSH tunnel (port 5901 → localhost:5901)"
  echo "  ${BOLD}tunnel -b${NC}     Tunnel in background (get terminal back)"
  echo "  ${BOLD}info${NC}          Show all connection details  (default)"
  echo "  ${BOLD}check${NC}         Check if VNC services are running on the server"
  echo "  ${BOLD}help${NC}          Show this help"
  echo
  echo "Alias: add this to your ~/.bashrc or ~/.zshrc:"
  echo "  ${DIM}alias vnc='./vnc.sh'${NC}"
}

# ── Info ────────────────────────────────────────────────────
info() {
  # Single SSH call: fetch tunnel URL + service status in one shot
  local vnc_status="unknown"
  local novnc_status="unknown"

  local remote_output
  remote_output=$(ssh -o StrictHostKeyChecking=accept-new \
    -o ConnectTimeout=8 \
    -o LogLevel=ERROR \
    -i "$SSH_KEY" \
    "${SSH_USER}@${SSH_HOST}" \
    'echo "VNC_STATUS=$(sudo systemctl is-active vncserver@:1)" && \
     echo "NOVNC_STATUS=$(sudo systemctl is-active novnc.service)" && \
     echo "TUNNEL_URL=$(docker logs bing-cloudflared-1 2>&1 | grep -o "https://[^ ]*\.trycloudflare\.com" | tail -1)"' \
    2>/dev/null || true)

  if [[ -n "$remote_output" ]]; then
    eval "$remote_output" 2>/dev/null || true
    vnc_status="${VNC_STATUS:-unknown}"
    novnc_status="${NOVNC_STATUS:-unknown}"
    if [[ -n "$TUNNEL_URL" ]]; then
      NOVNC_BASE_URL="$TUNNEL_URL"
    fi
  fi

  # Fallback URL if fetch failed
  if [[ -z "$NOVNC_BASE_URL" ]]; then
    NOVNC_BASE_URL="https://stood-color-victoria-activity.trycloudflare.com"
  fi
  NOVNC_URL="${NOVNC_BASE_URL}/novnc/vnc.html"
  NOVNC_URL_LITE="${NOVNC_BASE_URL}/novnc/vnc_lite.html"

  echo
  echo -e "${BOLD}╔══════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}║         🖥️  Desktop Access                  ║${NC}"
  echo -e "${BOLD}╚══════════════════════════════════════════════╝${NC}"

  # ── Health indicator ────────────────────────────────────────
  if [[ "$vnc_status" == "active" ]]; then
    echo -e " ${GREEN}●${NC} VNC server: ${GREEN}active${NC}  |  noVNC: ${novnc_status}"
  else
    echo -e " ${RED}○${NC} VNC server: ${RED}${vnc_status}${NC}  |  noVNC: ${novnc_status}"
    echo -e " ${YELLOW}⚠${NC} Run ${BOLD}./vnc.sh check${NC} for details"
  fi

  echo
  echo -e " ${BOLD}Browser (HTTPS)${NC}  ${DIM}(recommended — no client needed)${NC}"
  echo -e "   ${CYAN}${NOVNC_URL_LITE}${NC}"
  echo -e "   Password: ${YELLOW}${VNC_PASSWORD}${NC}"
  echo
  echo -e " ${BOLD}VNC Client${NC}       ${DIM}(direct TCP, any VNC client)${NC}"
  echo -e "   Host:     ${GREEN}${SSH_HOST}:5901${NC}"
  echo -e "   Password: ${YELLOW}${VNC_PASSWORD}${NC}"
  echo
  echo -e " ${BOLD}SSH Tunnel${NC}       ${DIM}(most secure for VNC client)${NC}"
  echo -e "   ${GREEN}ssh -L 5901:localhost:5901 ${SSH_USER}@${SSH_HOST}${NC}"
  echo -e "   Then connect VNC client to ${DIM}localhost:5901${NC}"
  echo
  echo -e " ${BOLD}Quick shortcuts:${NC}"
  echo -e "   ${DIM}./vnc.sh open${NC}        — Open noVNC in browser"
  echo -e "   ${DIM}./vnc.sh tunnel${NC}      — Start SSH tunnel (foreground)"
  echo -e "   ${DIM}./vnc.sh tunnel -b${NC}   — Start SSH tunnel (background)"
  echo
}

# ── Open in browser ────────────────────────────────────────
open_browser() {
  fetch_novnc_url

  echo -e "Opening noVNC in browser..."
  echo -e "URL: ${CYAN}${NOVNC_URL_LITE}${NC}"
  echo -e "Password: ${YELLOW}${VNC_PASSWORD}${NC}"
  echo

  # Try common openers
  if command -v xdg-open &>/dev/null; then
    xdg-open "$NOVNC_URL_LITE"
  elif command -v open &>/dev/null; then
    open "$NOVNC_URL_LITE"
  elif command -v sensible-browser &>/dev/null; then
    sensible-browser "$NOVNC_URL_LITE"
  else
    echo -e "${YELLOW}Could not auto-detect browser opener.${NC}"
    echo "Open this URL manually:"
    echo "  $NOVNC_URL_LITE"
  fi
}

# ── SSH Tunnel ──────────────────────────────────────────────
start_tunnel() {
  local bg_mode=false
  if [[ "${1:-}" == "-b" || "${1:-}" == "--background" ]]; then
    bg_mode=true
  fi

  if $bg_mode; then
    echo -e "Starting SSH tunnel in ${BOLD}background${NC}..."
    echo -e "  ${GREEN}localhost:5901 → ${SSH_HOST}:5901${NC}"
    ssh -o StrictHostKeyChecking=accept-new \
        -o ServerAliveInterval=30 \
        -o ExitOnForwardFailure=yes \
        -i "$SSH_KEY" \
        -L 5901:localhost:5901 \
        -f -N \
        "${SSH_USER}@${SSH_HOST}"
    echo -e "  Finding tunnel PID..."
    sleep 2
    local tunnel_pid
    tunnel_pid=$(pgrep -f "ssh.*-L 5901:localhost:5901.*${SSH_HOST}" 2>/dev/null | head -1) || true
    if [[ -n "$tunnel_pid" ]]; then
      echo -e "  Tunnel PID: ${YELLOW}${tunnel_pid}${NC}"
      echo -e "  To stop: ${DIM}kill ${tunnel_pid}${NC}"
    else
      echo -e "  ${GREEN}Tunnel running in background${NC}"
      echo -e "  To stop: ${DIM}pkill -f 'ssh.*-L 5901:localhost:5901'${NC}"
    fi
  else
    echo -e "Starting SSH tunnel: ${GREEN}localhost:5901 → ${SSH_HOST}:5901${NC}"
    echo -e "Press ${BOLD}Ctrl+C${NC} to stop the tunnel."
    echo
    ssh -o StrictHostKeyChecking=accept-new \
        -o ServerAliveInterval=30 \
        -o ExitOnForwardFailure=yes \
        -i "$SSH_KEY" \
        -L 5901:localhost:5901 \
        -N \
        "${SSH_USER}@${SSH_HOST}"
  fi
}

# ── Check services ──────────────────────────────────────────
check_services() {
  echo -e "Checking VNC services on ${SSH_HOST}..."
  if ssh -o StrictHostKeyChecking=accept-new \
     -o ConnectTimeout=10 \
     -i "$SSH_KEY" \
     "${SSH_USER}@${SSH_HOST}" \
     'echo "=== VNC Server ===" && \
      sudo systemctl is-active vncserver@:1 2>/dev/null && \
      echo "=== VNC Process ===" && \
      sudo ss -tlnp | grep 5901 && \
      echo "=== noVNC ===" && \
      sudo systemctl is-active novnc.service 2>/dev/null && \
      echo "=== noVNC Process ===" && \
      sudo ss -tlnp | grep 6080 && \
      echo "=== LXDE Desktop ===" && \
      pgrep -a lxsession 2>/dev/null || echo "  (no lxsession process — may need restart)"'; then
    : # SSH succeeded
  else
    echo -e " ${RED}✗${NC} Could not reach ${SSH_HOST}"
  fi
  echo
  echo -e "${DIM}Run the script again to see connection details.${NC}"
}

# ── Main ────────────────────────────────────────────────────
case "${1:-info}" in
  open|browser|web)
    open_browser
    ;;
  tunnel|forward)
    start_tunnel "${2:-}"
    ;;
  info|status)
    info
    ;;
  check|health)
    check_services
    ;;
  help|--help|-h)
    usage
    ;;
  *)
    echo -e "${YELLOW}Unknown command:${NC} $1"
    usage
    exit 1
    ;;
esac
