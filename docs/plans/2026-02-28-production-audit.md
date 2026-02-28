# koompi-veha Production Readiness Audit

**Date:** 2026-02-28
**Scope:** Full codebase audit across all 7 crates
**Verdict:** Not production-ready. Requires hardening before any deployment beyond trusted internal networks.

---

## Executive Summary

The audit identified **68 issues** across the codebase. The architecture is sound and the code is well-organized, but it was built as a functional prototype, not a production system. The gaps fall into three categories:

| Category | Critical | Important | Total |
|----------|----------|-----------|-------|
| Security | 8 | 4 | 12 |
| Reliability / Error Handling | 9 | 8 | 17 |
| Resource Management | 5 | 6 | 11 |
| Data Integrity | 3 | 3 | 6 |
| Performance | 1 | 5 | 6 |
| API / UX Design | 0 | 8 | 8 |
| Missing Production Features | 0 | 8 | 8 |
| **Total** | **26** | **42** | **68** |

---

## Part 1: Critical Issues (Must Fix Before Any Production Use)

### SECURITY

#### S1. No Authentication Anywhere
**Severity:** CRITICAL | **Crates:** veha-api, veha-agent, veha-cli

The entire system has zero authentication:
- REST API endpoints are completely open (`veha-api/src/routes.rs` — all routes)
- WebSocket accepts any connection (`veha-api/src/ws.rs:24-56`)
- IPC socket is unauthenticated (`veha-player/src/ipc.rs:19-21`) at `/tmp/veha-player.sock`
- Agent `api_key` config field exists but is **never used** (`veha-agent/src/config.rs:16`)

**Impact:** Anyone with network access can control all billboards, delete all content, upload malware, impersonate boards.

**Fix:**
- Add JWT auth for dashboard/CLI users
- Add API key auth for agent WebSocket registration
- Set Unix socket permissions (chmod 600) for IPC
- Validate API key on server side in ws.rs

---

#### S2. CORS Allows Any Origin
**Severity:** CRITICAL | **File:** `veha-api/src/main.rs:51`

```rust
let app = routes::create_router(state).layer(CorsLayer::permissive());
```

**Fix:** Restrict to specific origins, or at minimum the dashboard origin.

---

#### S3. No Rate Limiting
**Severity:** CRITICAL | **Crate:** veha-api

No rate limiting on any endpoint. Trivial to DoS via upload floods, connection storms, or API spam.

**Fix:** Add `tower::limit::RateLimitLayer` or `governor` middleware.

---

#### S4. File Uploads Loaded Entirely Into Memory
**Severity:** CRITICAL | **Files:** `veha-api/src/routes.rs:210-217`, `veha-cli/src/main.rs:432-437`

Both server and CLI read entire files into memory. A 10GB video upload crashes the server via OOM.

**Fix:** Stream uploads to disk. Use `tokio::io::copy` from the multipart field directly to a file.

---

#### S5. File Downloads Loaded Entirely Into Memory
**Severity:** CRITICAL | **File:** `veha-api/src/routes.rs:267-279`

`tokio::fs::read(&path).await` loads the full file. Concurrent downloads of large files = OOM.

**Fix:** Use `axum::body::Body::from_stream()` with `tokio::fs::File` + `ReaderStream`.

---

#### S6. No WebSocket Message Size Limit
**Severity:** CRITICAL | **File:** `veha-api/src/ws.rs:85-98`

Agent can send arbitrarily large JSON messages. Also applies to IPC (`veha-player/src/ipc.rs:31`).

**Fix:** Configure max message size on WebSocket upgrade. Add max line length to IPC reader.

---

#### S7. No Input Validation on Dimensions
**Severity:** CRITICAL | **Files:** `veha-core/src/frame.rs:32`, `veha-output/src/framebuffer.rs:54-56`

Integer overflow in `width * height * 3` (frame.rs) and `stride * height` (framebuffer.rs). Corrupted media or sysfs values can trigger buffer overflows.

**Fix:** Use checked arithmetic (`checked_mul`). Validate dimensions against sane bounds (e.g., max 16384x16384).

---

#### S8. Unbounded Playlist File Read
**Severity:** CRITICAL | **File:** `veha-core/src/playlist.rs:43`

`std::fs::read_to_string(path)` with no size limit. A multi-GB "playlist" file causes OOM.

**Fix:** Check file size before reading. Cap at reasonable limit (e.g., 10MB).

---

### RELIABILITY

#### R1. Public API Panics (`expect`/`unwrap`)
**Severity:** CRITICAL | **Multiple files**

| File | Count | Key Lines |
|------|-------|-----------|
| `veha-core/src/lib.rs:21` | 1 | `ffmpeg_next::init().expect(...)` |
| `veha-player/src/main.rs` | 25 | Mutex `.lock().unwrap()` throughout |
| `veha-api/src/db.rs:13-15` | 3 | DB connect + migration `.expect()` |
| `veha-api/src/main.rs:53-55` | 2 | Server bind `.unwrap()` |
| `veha-api/src/ws.rs:39,122` | 2 | JSON serialization `.unwrap()` |
| `veha-player/src/main.rs:197-201` | 2 | Sink creation `.expect()` |

**Total: 35+ panic paths in production code.**

Any of these crashes the daemon. For 24/7 LED billboards, a panic = black screen.

**Fix:** Replace all `unwrap()`/`expect()` with proper error handling. For mutex locks, handle poisoning gracefully.

---

#### R2. No Signal Handling (Graceful Shutdown)
**Severity:** CRITICAL | **Crates:** veha-player, veha-agent, veha-api

None of the three daemons handle SIGTERM/SIGINT:
- Socket files never cleaned up
- WebSocket connections dropped without close frames
- In-flight requests abandoned
- FFmpeg resources potentially leaked

**Fix:** Add `tokio::signal::ctrl_c()` handlers. Clean up resources before exit.

---

#### R3. Player Thread Panic Silently Ignored
**Severity:** CRITICAL | **File:** `veha-player/src/main.rs:183`

```rust
player_handle.join().ok();  // Swallows panics
```

If the player thread panics (FFmpeg crash, bad media), the daemon continues accepting commands but plays nothing — a zombie state.

**Fix:** Check `join()` result. Restart player thread or exit with error.

---

#### R4. Reconnect Backoff Never Resets
**Severity:** CRITICAL | **File:** `veha-agent/src/ws_client.rs:26-45`

After first disconnect, backoff grows to 60s and never resets. Even after hours of successful operation, the next disconnect uses 60s delay.

**Fix:** Reset `backoff_secs = 1` after successful connection establishment.

---

#### R5. No Timeouts on IPC Operations
**Severity:** CRITICAL | **File:** `veha-agent/src/player_client.rs:11-19`

`UnixStream::connect()`, `write_all()`, and `read_line()` have no timeouts. If veha-player is deadlocked, the agent hangs forever.

**Fix:** Wrap all IPC operations in `tokio::time::timeout()` (suggest 5-10s).

---

#### R6. Network Streams Hang Forever
**Severity:** CRITICAL | **File:** `veha-core/src/decoder.rs:129`

```rust
for (stream, packet) in self.input_ctx.packets() {
```

RTSP/RTMP/HLS streams block indefinitely on network failure. Player thread hangs.

**Fix:** Set FFmpeg `timeout` option when opening network sources.

---

#### R7. Division by Zero in Frame Timestamp
**Severity:** HIGH | **File:** `veha-core/src/frame.rs:56`

```rust
pts as f64 * self.time_base.0 as f64 / self.time_base.1 as f64
```

No check that `time_base.1 != 0`. Malformed containers can have zero denominators.

**Fix:** Guard against zero: `if self.time_base.1 == 0 { return None; }`

---

### DATA INTEGRITY

#### D1. Non-Atomic Playlist File Write
**Severity:** HIGH | **File:** `veha-core/src/playlist.rs:52`

```rust
std::fs::write(path, data)?;
```

Power loss during write corrupts the playlist. After reboot, the billboard can't start.

**Fix:** Write to temp file, then `rename()` (atomic on same filesystem).

---

#### D2. Playlist Errors Silently Swallowed
**Severity:** HIGH | **File:** `veha-core/src/player.rs:64-66`

```rust
if let Err(e) = self.play_item(item, sink) {
    warn!("Error playing {}: {e}. Skipping.", item.source);
}
// ... returns Ok(()) even if ALL items fail
```

Billboard shows black screen but system reports success.

**Fix:** Track error count. Return error if all items fail or if error rate exceeds threshold.

---

#### D3. No Database Transaction Safety
**Severity:** HIGH | **File:** `veha-api/src/routes.rs:285-311`

Delete operations remove file from disk first, then DB record. If DB delete fails, the file is orphaned (or vice versa).

**Fix:** Wrap in transaction. Delete DB record first, then file.

---

---

## Part 2: Important Issues (Fix Before Scale)

### Database

| # | Issue | File | Fix |
|---|-------|------|-----|
| DB1 | No indexes on FK columns, sort columns | `migrations/001_init.sql` | Add indexes on `boards.group_id`, `boards.status`, `media.uploaded_at`, `playlists.created_at`, all schedule FKs |
| DB2 | Migration system splits on `;` naively | `veha-api/src/db.rs:18-26` | Use sqlx::migrate! macro or proper migration runner |
| DB3 | No pagination on list endpoints | `veha-api/src/db.rs` (all list queries) | Add `LIMIT/OFFSET` params; return total count |
| DB4 | SQLite single-writer bottleneck | `veha-api/src/db.rs:11` | Enable WAL mode (`PRAGMA journal_mode=WAL`) |

### WebSocket

| # | Issue | File | Fix |
|---|-------|------|-----|
| WS1 | Memory leak on duplicate board connections | `veha-api/src/ws.rs:62-82` | Abort old send_task before inserting new connection |
| WS2 | No registration timeout | `veha-api/src/ws.rs:33-55` | Add timeout on initial Register message |
| WS3 | Unlimited IPC connections | `veha-player/src/ipc.rs:24-28` | Add max connection counter (e.g., 10) |

### Error Handling

| # | Issue | File | Fix |
|---|-------|------|-----|
| E1 | Silent frame drops in decoder | `veha-core/src/decoder.rs:119,144,153` | Log decoded errors, track drop count |
| E2 | Catch-all `Error::Other(String)` loses context | `veha-core/src/error.rs:15-16` | Add specific variants: `JsonParse`, `ImageDecode`, `Timeout` |
| E3 | Silent IPC write failures | `veha-player/src/ipc.rs:55-73` | Log failures, close connection on write error |
| E4 | Config validation missing | Both player and agent `config.rs` | Validate width/height > 0, socket paths exist, URLs parse |
| E5 | Silent directory creation failure | `veha-api/src/main.rs:40` | Replace `.ok()` with proper error handling |

### Performance

| # | Issue | File | Fix |
|---|-------|------|-----|
| P1 | New Vec allocated every frame (window sink) | `veha-output/src/window.rs:46` | Add reusable buffer to WindowSink struct |
| P2 | Two allocations per frame in decoder | `veha-core/src/decoder.rs:115-116` | Reuse `Video::empty()` buffers across calls |
| P3 | Per-pixel bounds checks in framebuffer | `veha-output/src/framebuffer.rs:110-123` | Validate once before loop, remove inner checks |
| P4 | File opened twice in decoder | `veha-core/src/decoder.rs:62-75` | Reuse input context from first open |

### Missing Production Features

| # | Feature | Impact |
|---|---------|--------|
| F1 | Health endpoint (`/health`, `/readiness`) | Load balancers can't probe system |
| F2 | Request/access logging | No visibility into API usage |
| F3 | HTTPS/TLS support | All traffic in plaintext |
| F4 | Metrics export (Prometheus) | No monitoring, no alerting |
| F5 | Audit logging (who changed what) | No accountability |
| F6 | Agent media caching | Re-downloads media every playlist load |
| F7 | Schedule enforcement in agent | DB schema exists but agent ignores it |
| F8 | Proof-of-play logging | Can't verify ads actually played |

### Dashboard / Frontend

| # | Issue | File | Fix |
|---|-------|------|-----|
| FE1 | Tailwind loaded from CDN without SRI | `static/index.html:7` | Bundle Tailwind or add integrity hash |
| FE2 | No Content-Security-Policy headers | `veha-api/src/main.rs` | Add CSP middleware |
| FE3 | No real-time status updates | `static/app.js` | Connect dashboard to WebSocket for live data |

---

## Part 3: Prioritized Fix Plan

### Phase 0: Stop-the-Bleeding (before any external access)

| Priority | Issue | Effort | Impact |
|----------|-------|--------|--------|
| P0-1 | Add API authentication (JWT + API key) | Medium | Blocks all security exploitation |
| P0-2 | Restrict CORS | Trivial | Prevents cross-origin attacks |
| P0-3 | Stream file uploads/downloads | Medium | Prevents OOM crashes |
| P0-4 | Add message size limits (WS + IPC) | Small | Prevents DoS |
| P0-5 | Add rate limiting | Small | Prevents API abuse |

### Phase 1: Daemon Stability (before 24/7 deployment)

| Priority | Issue | Effort | Impact |
|----------|-------|--------|--------|
| P1-1 | Replace all unwrap/expect with error handling | Medium | Eliminates 35+ panic paths |
| P1-2 | Add signal handlers (graceful shutdown) | Small | Clean restarts, no stale sockets |
| P1-3 | Fix reconnect backoff reset | Trivial | 1-line fix, major reliability gain |
| P1-4 | Add IPC timeouts | Small | Prevents agent deadlock |
| P1-5 | Add FFmpeg network stream timeouts | Small | Prevents player thread hang |
| P1-6 | Monitor player thread, restart on panic | Small | No more zombie daemons |
| P1-7 | Fix integer overflow in frame/FB allocation | Small | Memory safety |
| P1-8 | Atomic playlist file writes | Small | Survives power loss |

### Phase 2: Data & API Quality (before fleet management)

| Priority | Issue | Effort | Impact |
|----------|-------|--------|--------|
| P2-1 | Add database indexes | Trivial | Query performance |
| P2-2 | Add pagination to list endpoints | Small | Dashboard doesn't choke on data |
| P2-3 | Fix WebSocket duplicate connection leak | Small | Memory stability |
| P2-4 | Add health endpoint | Trivial | Enables monitoring |
| P2-5 | Add request logging | Small | Operational visibility |
| P2-6 | Enable SQLite WAL mode | Trivial | Better concurrent reads |
| P2-7 | Config validation at startup | Small | Fail fast on bad config |
| P2-8 | Improve Error type granularity | Medium | Better error recovery |

### Phase 3: Production Polish (before commercial use)

| Priority | Issue | Effort | Impact |
|----------|-------|--------|--------|
| P3-1 | HTTPS/TLS support | Medium | Encrypted traffic |
| P3-2 | Agent media caching | Medium | Reduced bandwidth, offline play |
| P3-3 | Schedule enforcement | Medium | Core fleet feature |
| P3-4 | Metrics/Prometheus | Medium | Monitoring & alerting |
| P3-5 | Audit logging | Medium | Accountability |
| P3-6 | CSP headers + bundle Tailwind | Small | Frontend security |
| P3-7 | Frame buffer reuse (performance) | Small | Lower resource usage |
| P3-8 | Proof-of-play logging | Medium | Ad billing support |

---

## Appendix: Issue Count by Crate

| Crate | Critical | Important | Total |
|-------|----------|-----------|-------|
| veha-core | 6 | 7 | 13 |
| veha-player | 6 | 5 | 11 |
| veha-agent | 4 | 3 | 7 |
| veha-api | 7 | 15 | 22 |
| veha-output | 2 | 5 | 7 |
| veha-cli | 1 | 5 | 6 |
| veha-web | 0 | 2 | 2 |
| **Total** | **26** | **42** | **68** |

---

*This audit reflects the codebase at commit `49629fc` on the `main` branch.*
