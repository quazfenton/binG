#!/usr/bin/env bash
#
# setup-rootless-podman.sh
#
# Quick-start script to install and configure rootless Podman with cgroups v2
# resource delegation on an Oracle Cloud VM (Ubuntu 22.04/24.04).
#
# This script is idempotent — safe to run multiple times.
#
# Usage:
#   sudo bash setup-rootless-podman.sh [username]
#
#   If no username is provided, defaults to:
#     1. $SUDO_USER (the original user when run with sudo)
#     2. $USER (current user if run directly)
#
#   On Oracle VMs the default user is usually 'opc'. Run as root or with sudo
#   since the script modifies system files (/etc/subuid, /etc/subgid, systemd).
#
# What it does:
#   1. Installs podman, fuse-overlayfs, slirp4netns
#   2. Configures /etc/subuid and /etc/subgid (65536 subordinate IDs)
#   3. Enables cgroups v2 delegation (cpu, cpuset, io, memory, pids)
#   4. Enables systemd lingering for the user
#   5. Starts the rootless podman socket
#   6. Verifies everything is working
#
# Related:
#   hardened-podman.json — seccomp profile for Podman containers
#   lib/terminal/oracle-vm-isolation.ts — integration code

set -euo pipefail

# ─── Configuration ───────────────────────────────────────────────────────────

SUBORDINATE_ID_COUNT=65536
SYSTEMD_DELEGATE_CONTROLLERS="cpu cpuset io memory pids"

# ─── Argument Parsing ────────────────────────────────────────────────────────

TARGET_USER="${1:-${SUDO_USER:-$USER}}"
if [ "$TARGET_USER" = "root" ]; then
  echo "ERROR: Target user cannot be root. Rootless Podman requires a non-root user."
  exit 1
fi

TARGET_HOME="$(eval echo "~$TARGET_USER" 2>/dev/null)"
if [ ! -d "$TARGET_HOME" ]; then
  echo "ERROR: Home directory for '$TARGET_USER' not found at $TARGET_HOME"
  exit 1
fi

echo "=== Rootless Podman Setup ==="
echo "Target user: $TARGET_USER"
echo "Home directory: $TARGET_HOME"
echo ""

# ─── Step 1: Install Packages ────────────────────────────────────────────────

echo ">>> Step 1/6: Installing Podman and dependencies..."

if command -v apt &>/dev/null; then
  apt update -qq
  apt install -y -qq podman fuse-overlayfs slirp4netns uidmap dbus-user-session
elif command -v yum &>/dev/null; then
  yum install -y podman fuse-overlayfs slirp4netns
elif command -v dnf &>/dev/null; then
  dnf install -y podman fuse-overlayfs slirp4netns
else
  echo "ERROR: Unsupported package manager. Only apt, yum, and dnf are supported."
  exit 1
fi

# Verify podman is now available
if ! command -v podman &>/dev/null; then
  echo "ERROR: Podman installation failed. 'podman' command not found after install."
  exit 1
fi

echo "  Podman installed: $(podman version --format '{{.Server.Version}}' 2>/dev/null || echo 'ok')"
echo ""

# ─── Step 2: Configure /etc/subuid and /etc/subgid ──────────────────────────

echo ">>> Step 2/6: Configuring subordinate UID/GID ranges..."

configure_subid() {
  local file="$1"
  local start_base="$2"

  if grep -q "^${TARGET_USER}:" "$file" 2>/dev/null; then
    local current_start
    current_start=$(grep "^${TARGET_USER}:" "$file" | cut -d: -f2)
    local current_count
    current_count=$(grep "^${TARGET_USER}:" "$file" | cut -d: -f3)
    echo "  $file: $TARGET_USER already configured ($current_start + $current_count IDs)"
  else
    echo "${TARGET_USER}:${start_base}:${SUBORDINATE_ID_COUNT}" >> "$file"
    echo "  $file: added ${TARGET_USER}:${start_base}:${SUBORDINATE_ID_COUNT}"
  fi
}

configure_subid "/etc/subuid" "100000"
configure_subid "/etc/subgid" "100000"

echo ""

# ─── Step 3: Enable lingering for the user ───────────────────────────────────

echo ">>> Step 3/6: Enabling systemd lingering for user '$TARGET_USER'..."

if loginctl show-user "$TARGET_USER" 2>/dev/null | grep -q "Linger=yes"; then
  echo "  Lingering already enabled."
else
  loginctl enable-linger "$TARGET_USER"
  echo "  Lingering enabled. User's systemd instance will persist after logout."
fi

echo ""

# ─── Step 4: Configure cgroups v2 delegation ────────────────────────────────

echo ">>> Step 4/6: Enabling cgroups v2 delegation..."

DELEGATE_CONF_DIR="/etc/systemd/system/user@.service.d"
DELEGATE_CONF_FILE="$DELEGATE_CONF_DIR/delegate.conf"

mkdir -p "$DELEGATE_CONF_DIR"

if [ -f "$DELEGATE_CONF_FILE" ] && grep -q "$SYSTEMD_DELEGATE_CONTROLLERS" "$DELEGATE_CONF_FILE" 2>/dev/null; then
  echo "  cgroups v2 delegation already configured in $DELEGATE_CONF_FILE"
else
  cat > "$DELEGATE_CONF_FILE" <<EOF
# Rootless Podman cgroups v2 delegation
# Allows non-root users to control cpu, cpuset, io, memory, and pids controllers
# Applied via systemd user@.service template
[Service]
Delegate=$SYSTEMD_DELEGATE_CONTROLLERS
EOF
  echo "  Created $DELEGATE_CONF_FILE"
  systemctl daemon-reload
  echo "  systemd reloaded. Re-login or reboot required for delegation to take effect."
fi

echo ""

# ─── Step 5: Enable and start the rootless Podman socket ─────────────────────

echo ">>> Step 5/6: Enabling rootless Podman socket..."

su - "$TARGET_USER" -c "
  systemctl --user enable podman.socket 2>/dev/null
  systemctl --user start podman.socket 2>/dev/null
  echo '  Podman socket: \$(systemctl --user is-active podman.socket 2>/dev/null || echo \"unknown\")'
  echo '  Podman socket enabled: \$(systemctl --user is-enabled podman.socket 2>/dev/null || echo \"unknown\")'
"

echo "  To use Docker-compatible tools, set:"
echo "    export DOCKER_HOST=unix:///run/user/\$(id -u $TARGET_USER)/podman/podman.sock"
echo ""

# ─── Step 6: Verify ─────────────────────────────────────────────────────────

echo ">>> Step 6/6: Verification..."

# 6a. Podman version
echo "  Podman version: $(su - "$TARGET_USER" -c 'podman version --format "{{.Server.Version}}"' 2>/dev/null || echo 'unknown')"

# 6b. Rootless check
if su - "$TARGET_USER" -c 'podman info --format "{{.Host.Security.Rootless}}"' 2>/dev/null | grep -q "true"; then
  echo "  Rootless mode: enabled ✓"
else
  echo "  WARNING: Rootless mode not detected. Check user namespace configuration."
fi

# 6c. Storage driver
STORAGE_DRIVER=$(su - "$TARGET_USER" -c 'podman info --format "{{.Store.GraphDriverName}}"' 2>/dev/null || echo "unknown")
echo "  Storage driver: $STORAGE_DRIVER"
if [ "$STORAGE_DRIVER" != "overlay" ]; then
  echo "  NOTE: overlay/fuse-overlayfs driver recommended for rootless."
fi

# 6d. cgroups controllers (may require re-login to show delegated controllers)
USER_UID=$(id -u "$TARGET_USER")
CGROUP_PATH="/sys/fs/cgroup/user.slice/user-${USER_UID}.slice/user@${USER_UID}.service"
if [ -f "$CGROUP_PATH/cgroup.controllers" ]; then
  CONTROLLERS=$(cat "$CGROUP_PATH/cgroup.controllers" 2>/dev/null || echo "unknown")
  echo "  Delegated controllers: $CONTROLLERS"
else
  echo "  User slice not active yet (expected — activates on first user session)"
fi

# 6e. subuid/subgid
echo "  /etc/subuid: $(grep "^${TARGET_USER}:" /etc/subuid 2>/dev/null || echo 'NOT FOUND')"
echo "  /etc/subgid: $(grep "^${TARGET_USER}:" /etc/subgid 2>/dev/null || echo 'NOT FOUND')"

# 6f. Podman info summary (does not require network or image pulls)
echo ""
echo "  Podman system info:"
su - "$TARGET_USER" -c 'podman info --format "  OS: {{.Host.OS}} | Kernel: {{.Host.Kernel}} | Arch: {{.Host.Arch}} | Rootless: {{.Host.Security.Rootless}} | Storage: {{.Store.GraphDriverName}}"' 2>/dev/null || echo "  (could not retrieve — podman may need re-login)"

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Log out and back in (or reboot) for cgroups v2 delegation to take effect:"
echo "     cat /sys/fs/cgroup/user.slice/user-\\$(id -u)/user@\\$(id -u).service/cgroup.controllers"
echo "     # Expected: cpu cpuset io memory pids"
echo ""
echo "  2. Copy the hardened seccomp profile:"
echo "     scp hardened-podman.json ${TARGET_USER}@<vm-host>:/home/${TARGET_USER}/seccomp/"
echo ""
echo "  3. Set the environment variable (in the service config or .bashrc):"
echo "     export ORACLE_VM_PODMAN_SECCOMP=/home/${TARGET_USER}/seccomp/hardened-podman.json"
echo ""
echo "  4. Pull the container image (one-time):"
echo "     podman pull ubuntu:22.04"
echo "     # or the image configured in ORACLE_VM_PODMAN_IMAGE"
