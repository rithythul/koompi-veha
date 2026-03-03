# Self-Generated Board ID Design

**Goal:** Make `BOARD_ID` optional in `veha-edge install` so multiple edge devices can be deployed with the same install command — no pre-coordination of IDs required.

**Date:** 2026-03-03

---

## Problem

The current install command requires a manually-chosen `BOARD_ID` per device:

```bash
sudo SERVER_URL=http://192.168.1.17:3000 BOARD_ID=board-001 ./veha-edge install
```

For a fleet of devices this is tedious — each device needs a unique ID chosen and coordinated by the operator before deployment.

## Solution

`BOARD_ID` becomes optional. When omitted, `veha-edge install` derives the board ID from the machine hostname. If the hostname is a known generic name (e.g., `raspberrypi`, `localhost`), the last 4 hex chars of `/etc/machine-id` are appended to ensure uniqueness.

### ID Generation Rules

1. If `BOARD_ID` env var is set → use it as-is (fully backward compatible)
2. Otherwise → read hostname from `gethostname()`
3. If hostname is in the generic list → append `-{suffix}` where suffix = last 4 chars of machine ID
4. Otherwise → use hostname as-is

**Generic hostname list:** `localhost`, `raspberrypi`, `ubuntu`, `debian`, `archlinux`, `kali`, `pi`

### Machine ID Source

Read `/etc/machine-id` (standard on all systemd Linux). Take the last 4 hex characters as the suffix.

Fallback: if `/etc/machine-id` doesn't exist, generate a random 4-char hex suffix and persist it to `/etc/veha/machine-id`.

### Examples

| Hostname | Machine ID suffix | Result |
|----------|-------------------|--------|
| `reception-pi` | (any) | `reception-pi` |
| `raspberrypi` | `...a3f2` | `raspberrypi-a3f2` |
| `localhost` | `...9c1b` | `localhost-9c1b` |
| `ubuntu` | `...4d77` | `ubuntu-4d77` |

### BOARD_NAME Default

`BOARD_NAME` also defaults to the raw hostname (no suffix) — more human-readable as a display name in the dashboard.

## Deployment Result

```bash
# Same command for every device — each registers with its own unique ID
sudo SERVER_URL=http://192.168.1.17:3000 ./veha-edge install

# Override still works for explicit control
sudo SERVER_URL=http://192.168.1.17:3000 BOARD_ID=lobby-screen-01 ./veha-edge install
```

## Scope of Changes

- **`veha-edge/src/install.rs`** — `read_install_params()`: make `BOARD_ID` optional, add `generate_board_id()` function
- **`CLAUDE.md`** — update edge device setup command to show `BOARD_ID` is optional
- No server changes needed (server already auto-creates boards on first connect via `upsert_board()`)
