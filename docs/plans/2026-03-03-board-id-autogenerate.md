# Self-Generated Board ID Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `BOARD_ID` optional in `veha-edge install` — when omitted, derive it from the machine hostname (with a machine-id suffix for generic hostnames).

**Architecture:** Two new private functions in `veha-edge/src/install.rs`: `generate_board_id()` (reads `/etc/hostname`, applies suffix logic) and `machine_id_suffix()` (reads `/etc/machine-id`, falls back to generating+persisting a 4-hex suffix). `read_install_params()` changes from `env::var("BOARD_ID").map_err(...)` to `env::var("BOARD_ID").unwrap_or_else(|_| generate_board_id())`. CLAUDE.md updated to show `BOARD_ID` as optional.

**Tech Stack:** Rust, `std::fs` (no new crate dependencies).

---

## Context

**File to modify:** `veha-edge/src/install.rs`

Current `read_install_params()` lines 16–18:
```rust
fn read_install_params() -> Result<InstallParams, String> {
    let board_id = std::env::var("BOARD_ID")
        .map_err(|_| "BOARD_ID env var is required".to_string())?;
```

This must become:
```rust
fn read_install_params() -> Result<InstallParams, String> {
    let board_id = std::env::var("BOARD_ID").unwrap_or_else(|_| generate_board_id());
```

**Generic hostnames** that get a suffix: `localhost`, `raspberrypi`, `ubuntu`, `debian`, `archlinux`, `kali`, `pi`

**machine-id suffix logic:**
1. Read last 4 hex chars from `/etc/machine-id` (e.g. `...a3f2` → `a3f2`)
2. If missing, read `/etc/veha/machine-id`
3. If still missing, generate from `subsec_nanos() as u16` formatted as `{:04x}`, persist to `/etc/veha/machine-id`

**Existing tests to keep passing** (all in `mod tests` at bottom of install.rs):
- `test_render_config_toml`
- `test_render_systemd_unit`
- `test_env_missing_board_id` — **this test must be updated** (BOARD_ID no longer causes an error when missing)
- `test_api_url_derivation`
- `test_api_url_trailing_slash`

---

## Task 1: Add `machine_id_suffix()` and `generate_board_id()` functions

**Files:**
- Modify: `veha-edge/src/install.rs`

**Step 1: Write the failing tests**

Add to `mod tests` in `veha-edge/src/install.rs`:

```rust
#[test]
fn test_machine_id_suffix_format() {
    let suffix = machine_id_suffix();
    assert_eq!(suffix.len(), 4, "suffix must be exactly 4 chars");
    assert!(
        suffix.chars().all(|c| c.is_ascii_hexdigit()),
        "suffix must be hex digits, got: {suffix}"
    );
}

#[test]
fn test_generate_board_id_nonempty() {
    let id = generate_board_id();
    assert!(!id.is_empty());
    assert!(!id.contains(' '), "board_id must not contain spaces");
}

#[test]
fn test_generate_board_id_generic_gets_suffix() {
    // Directly test the suffix-appending logic for known generic names.
    // We can't control /etc/hostname in tests, but we can verify the suffix
    // function returns a valid 4-char hex string that would be appended.
    let suffix = machine_id_suffix();
    let fake_generic = format!("localhost-{suffix}");
    assert!(fake_generic.starts_with("localhost-"));
    assert_eq!(fake_generic.len(), "localhost-".len() + 4);
}
```

**Step 2: Run tests to verify they fail**

```bash
cd /home/userx/projects/koompi-veha
cargo test -p veha-edge -- install::tests::test_machine_id_suffix_format install::tests::test_generate_board_id_nonempty install::tests::test_generate_board_id_generic_gets_suffix 2>&1 | tail -10
```
Expected: FAIL with `unresolved name 'machine_id_suffix'` / `unresolved name 'generate_board_id'`

**Step 3: Add the two functions to `veha-edge/src/install.rs`**

Insert after the `use` statements (after line 4, before `struct InstallParams`):

```rust
/// List of hostnames considered too generic to use as-is as a board ID.
const GENERIC_HOSTNAMES: &[&str] = &[
    "localhost", "raspberrypi", "ubuntu", "debian", "archlinux", "kali", "pi",
];

/// Returns the last 4 hex chars of /etc/machine-id (systemd standard).
/// Falls back to /etc/veha/machine-id, generating and persisting one if needed.
fn machine_id_suffix() -> String {
    // Primary: systemd machine ID
    if let Ok(id) = fs::read_to_string("/etc/machine-id") {
        let id = id.trim();
        if id.len() >= 4 && id.chars().all(|c| c.is_ascii_hexdigit()) {
            return id[id.len() - 4..].to_string();
        }
    }
    // Secondary: persisted fallback
    let fallback = "/etc/veha/machine-id";
    if let Ok(id) = fs::read_to_string(fallback) {
        let id = id.trim().to_string();
        if id.len() == 4 && id.chars().all(|c| c.is_ascii_hexdigit()) {
            return id;
        }
    }
    // Generate from subsecond nanoseconds and persist (best-effort)
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0x1a2b);
    let suffix = format!("{:04x}", nanos as u16);
    let _ = fs::create_dir_all("/etc/veha");
    let _ = fs::write(fallback, &suffix);
    suffix
}

/// Derives a unique board ID from the machine hostname.
/// Generic hostnames get a 4-char machine-id suffix appended.
fn generate_board_id() -> String {
    let hostname = fs::read_to_string("/etc/hostname")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "veha-board".to_string());

    if GENERIC_HOSTNAMES.contains(&hostname.as_str()) {
        format!("{}-{}", hostname, machine_id_suffix())
    } else {
        hostname
    }
}
```

**Step 4: Run tests to verify they pass**

```bash
cargo test -p veha-edge -- install::tests::test_machine_id_suffix_format install::tests::test_generate_board_id_nonempty install::tests::test_generate_board_id_generic_gets_suffix 2>&1 | tail -10
```
Expected: all 3 PASS

**Step 5: Commit**

```bash
git add veha-edge/src/install.rs
git commit -m "feat(install): add generate_board_id and machine_id_suffix functions"
```

---

## Task 2: Make BOARD_ID optional in `read_install_params()`

**Files:**
- Modify: `veha-edge/src/install.rs`

**Step 1: Write the failing test**

Add to `mod tests`:

```rust
#[test]
fn test_board_id_auto_generated_when_env_not_set() {
    // SAFETY: single-threaded test run (--test-threads=1)
    unsafe {
        std::env::remove_var("BOARD_ID");
        std::env::set_var("SERVER_URL", "http://192.168.1.17:3000");
    }
    let params = read_install_params().unwrap();
    assert!(!params.board_id.is_empty());
}

#[test]
fn test_board_id_env_overrides_auto_generation() {
    // SAFETY: single-threaded test run (--test-threads=1)
    unsafe {
        std::env::set_var("BOARD_ID", "explicit-board-id");
        std::env::set_var("SERVER_URL", "http://192.168.1.17:3000");
    }
    let params = read_install_params().unwrap();
    assert_eq!(params.board_id, "explicit-board-id");
}
```

Also **update** the existing `test_env_missing_board_id` test — `BOARD_ID` missing is no longer an error:

```rust
#[test]
fn test_env_missing_server_url() {
    // SAFETY: single-threaded test run (--test-threads=1)
    unsafe {
        std::env::remove_var("BOARD_ID");
        std::env::remove_var("SERVER_URL");
    }
    let result = read_install_params();
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("SERVER_URL"));
}
```
(Rename `test_env_missing_board_id` → `test_env_missing_server_url`, update the assertion.)

**Step 2: Run tests to verify the new ones fail and the renamed one now passes**

```bash
cargo test -p veha-edge -- install::tests 2>&1 | tail -15
```
Expected: `test_board_id_auto_generated_when_env_not_set` FAIL (BOARD_ID still required), `test_board_id_env_overrides_auto_generation` FAIL, `test_env_missing_server_url` PASS.

**Step 3: Update `read_install_params()`**

Change lines 17–18 in `veha-edge/src/install.rs`:

```rust
// Before:
let board_id = std::env::var("BOARD_ID")
    .map_err(|_| "BOARD_ID env var is required".to_string())?;

// After:
let board_id = std::env::var("BOARD_ID").unwrap_or_else(|_| generate_board_id());
```

**Step 4: Run all install tests**

```bash
cargo test -p veha-edge -- install::tests --test-threads=1 2>&1 | tail -15
```
Expected: all tests PASS (including the renamed `test_env_missing_server_url` and both new tests)

**Step 5: Run full workspace tests**

```bash
cargo test --workspace --test-threads=1 2>&1 | grep -E "FAILED|error|test result"
```
Expected: no failures

**Step 6: Commit**

```bash
git add veha-edge/src/install.rs
git commit -m "feat(install): make BOARD_ID optional — auto-generate from hostname if not set"
```

---

## Task 3: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Find the edge device install command in CLAUDE.md**

```bash
grep -n "BOARD_ID\|veha-edge install" /home/userx/projects/koompi-veha/CLAUDE.md
```

**Step 2: Update the install command**

In the `## Edge Device Setup` section, update the install block to show `BOARD_ID` as optional:

```bash
# Download pre-built binary (pick your arch: x86_64-linux or aarch64-linux)
wget https://github.com/rithythul/koompi-veha/releases/latest/download/veha-edge-x86_64-linux -O veha-edge
chmod +x veha-edge

# BOARD_ID defaults to machine hostname if not set
sudo SERVER_URL=http://192.168.1.17:3000 ./veha-edge install

# Override BOARD_ID when you want explicit control
sudo SERVER_URL=http://192.168.1.17:3000 BOARD_ID=lobby-screen-01 ./veha-edge install
```

Also update the Quick Start deploy-edge one-liner to remove `BOARD_ID=board-001`:

```bash
# Deploy edge device
sudo SERVER_URL=http://192.168.1.17:3000 ./veha-edge install
```

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: BOARD_ID is now optional in veha-edge install"
```

---

## Final Verification

```bash
# All tests pass
cargo test --workspace --test-threads=1 2>&1 | grep "test result"

# veha-edge builds
cargo build -p veha-edge 2>&1 | tail -3

# Confirm BOARD_ID is no longer required in help output
cargo run -p veha-edge -- install --help
```
