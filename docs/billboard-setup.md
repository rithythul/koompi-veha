# Billboard Hardware Setup Guide

This guide covers setting up a remote billboard running on a Linux PC connected to a display via HDMI or framebuffer.

## Architecture

```
Internet ──► veha-agent (WebSocket client, auto-reconnects)
                 │
                 │ IPC (Unix socket, JSON commands)
                 ▼
             veha-player (FFmpeg decoder loop)
                 │
                 │ framebuffer / HDMI
                 ▼
             LED Display
```

Each billboard runs two processes:

- **veha-agent** — connects to the API server via WebSocket, receives schedule updates and commands, forwards them to the player via IPC
- **veha-player** — decodes video/images with FFmpeg and outputs frames to the display

> **Note:** Media files are streamed directly from the API server by the player. The agent does not download or cache media — it passes media URLs to the player, which fetches them over HTTP on demand.

## Hardware Requirements

- Linux PC (x86 or ARM — mini PC, Intel NUC, Raspberry Pi 4/5, etc.)
- HDMI or LED display
- Internet connection (ethernet recommended, WiFi works)
- Sufficient storage for OS and binaries (4GB+ recommended)

## 1. Install Dependencies

### Debian / Ubuntu

```bash
sudo apt update
sudo apt install ffmpeg libavcodec-dev libavformat-dev libavutil-dev libswscale-dev libswresample-dev
```

### Arch Linux

```bash
sudo pacman -S ffmpeg
```

### Raspberry Pi OS

```bash
sudo apt update
sudo apt install ffmpeg libavcodec-dev libavformat-dev libavutil-dev libswscale-dev libswresample-dev
```

Verify FFmpeg is installed:

```bash
ffmpeg -version   # should show FFmpeg 8.x or later
```

## 2. Build the Binaries

On your build machine (can be the billboard PC itself or a separate dev machine):

```bash
cd koompi-veha

# Build player with framebuffer support (headless, no desktop needed)
cargo build --release -p veha-player --features framebuffer

# Build agent
cargo build --release -p veha-agent
```

The binaries will be at:

- `target/release/veha-player`
- `target/release/veha-agent`

### Cross-compiling for ARM (Raspberry Pi)

If building on an x86 machine for ARM deployment:

```bash
rustup target add aarch64-unknown-linux-gnu
cargo build --release -p veha-player --features framebuffer --target aarch64-unknown-linux-gnu
cargo build --release -p veha-agent --target aarch64-unknown-linux-gnu
```

## 3. Deploy to Billboard PC

Copy binaries and create the installation directory:

```bash
# From your build machine
scp target/release/veha-player target/release/veha-agent user@billboard-ip:/tmp/

# On the billboard PC
sudo mkdir -p /opt/veha
sudo mv /tmp/veha-player /tmp/veha-agent /opt/veha/
sudo chmod +x /opt/veha/veha-player /opt/veha/veha-agent
```

## 4. Configure the Player

Create `/opt/veha/veha-player.toml`:

```toml
# Output backend:
#   "framebuffer" — direct HDMI output, no desktop environment needed (recommended)
#   "window"      — opens a window, requires X11 desktop
#   "null"        — no output, for testing only
output_backend = "framebuffer"

# Display resolution (match your physical display)
width = 1920
height = 1080

# IPC socket path (agent connects here to send commands)
socket_path = "/tmp/veha-player.sock"

# Optional: path to a playlist JSON file to load on startup
# default_playlist = "/opt/veha/default-playlist.json"

# Window title (only used with "window" backend)
title = "veha-player"
```

### Common resolutions

| Display Type | Width | Height |
|---|---|---|
| Full HD | 1920 | 1080 |
| 4K UHD | 3840 | 2160 |
| LED Panel (custom) | varies | varies |
| Portrait HD | 1080 | 1920 |

## 5. Configure the Agent

Create `/opt/veha/veha-agent.toml`:

```toml
# Unique board identifier — this is how the API server identifies this billboard.
# Use a descriptive, unique name. The board will be auto-registered in the dashboard
# when the agent first connects — no need to create it manually.
board_id = "board-pp-riverside-001"

# Human-readable display name
board_name = "PP Riverside Billboard"

# API server WebSocket URL
# Replace with your actual API server address
api_url = "ws://your-server.example.com:3000/ws/agent"

# API key — optional. The server does not enforce API key auth by default.
# If you enable API key validation on the server, set it here.
api_key = ""

# Must match the player's socket_path
player_socket = "/tmp/veha-player.sock"

# How often to report status to the server (seconds)
report_interval_secs = 10

# Directory for local data (reserved for future media caching, currently unused)
cache_dir = "/tmp/veha-cache"
```

## 6. Set Up Systemd Services

### Player service

Create `/etc/systemd/system/veha-player.service`:

```ini
[Unit]
Description=Veha Billboard Player
After=network.target

[Service]
Type=simple
ExecStart=/opt/veha/veha-player -c /opt/veha/veha-player.toml
WorkingDirectory=/opt/veha
Restart=always
RestartSec=5

# Framebuffer access requires root or membership in the "video" group.
# To run as non-root: sudo usermod -aG video veha && change User=veha
User=root

# Clean up IPC socket on stop
ExecStopPost=/bin/rm -f /tmp/veha-player.sock

[Install]
WantedBy=multi-user.target
```

### Agent service

Create `/etc/systemd/system/veha-agent.service`:

```ini
[Unit]
Description=Veha Billboard Agent
After=network-online.target veha-player.service
Wants=network-online.target
Requires=veha-player.service

[Service]
Type=simple
ExecStart=/opt/veha/veha-agent -c /opt/veha/veha-agent.toml
WorkingDirectory=/opt/veha
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
```

### Enable and start

```bash
sudo systemctl daemon-reload
sudo systemctl enable veha-player veha-agent
sudo systemctl start veha-player veha-agent
```

### Check status

```bash
sudo systemctl status veha-player
sudo systemctl status veha-agent

# View logs
sudo journalctl -u veha-agent -f
sudo journalctl -u veha-player -f
```

## 7. Verify Connection in Dashboard

Once the agent starts and connects to the API server:

1. Open the dashboard at `http://your-server:3000`
2. Log in with the default admin credentials (printed in the server logs on first start)
3. Go to **Boards** — your billboard should appear automatically (boards are auto-registered on first agent connection)
4. The board should show a green **online** badge and `last_seen` should update every 10 seconds
5. You can now edit the board's details (name, zone, group, sell mode) from the dashboard

> **Authentication:** The dashboard requires login. On first server start, a default admin account is created with a random password printed to the server log. Three roles are available: **admin** (full access), **operator** (manage boards/content/bookings), and **viewer** (read-only). Manage users from **System > Users** (admin only).

If the board does not appear:

- Check the agent logs: `sudo journalctl -u veha-agent -f`
- Verify the `api_url` is reachable from the billboard: `curl http://your-server:3000/health`
- Verify the `board_id` is unique — if two agents use the same ID, the newer connection replaces the older one
- Check firewall rules (port 3000 must be open)

## 8. Start Playing Content

### Supported media formats

The API server accepts the following file types for upload:

- **Video:** MP4, WebM
- **Image:** PNG, JPEG, WebP, BMP, GIF

Other file types are rejected with a 415 error.

### Via Campaigns + Bookings (advertising workflow, recommended)

The schedule resolver builds a playlist from active bookings and pushes it to the agent:

1. **Upload media** — Dashboard > Media Library > drag & drop video/image files
2. **Create an advertiser** — Dashboard > Advertisers > New Advertiser
3. **Create a campaign** — Dashboard > Campaigns > New Campaign > set dates and advertiser
4. **Add creatives** — Campaign Detail > Upload creatives (link to media files), set status to "approved"
5. **Create a booking** — Dashboard > Bookings > New Booking > assign the campaign to the board with time slots, priority, and booking type (exclusive or rotation). The server checks for conflicts — overlapping exclusive bookings on the same target are rejected.
6. **Set the board's sell mode** — Board Detail > set `sell_mode` to `programmatic` or `mixed` (the resolver skips boards with `house_only` mode)
7. The server resolves active bookings into a playlist and pushes it to the agent on WebSocket connection
8. The agent forwards the playlist to the player, which streams media directly from the API server

> **Note:** The schedule is resolved and pushed when the agent connects (or reconnects). It is also automatically pushed to connected agents whenever bookings are created, updated, or deleted — no agent restart needed.

### Via Playlists (manual scheduling)

1. **Upload media** — Dashboard > Media Library > drag & drop video/image files
2. **Create a playlist** — Dashboard > Playlists > New Playlist > add media items with durations
3. **Create a schedule** — Dashboard > Schedules > New Schedule > select the playlist, target the board or group, set days and times

### Via Direct Commands (manual, immediate)

1. Go to **Boards** > click the billboard > **Board Detail**
2. Use the **Player Controls**: Play, Pause, Resume, Stop, Next, Previous
3. Commands are sent instantly via WebSocket to the agent

## Troubleshooting

### Board shows "offline"

- Check internet connectivity on the billboard
- Verify `api_url` in `veha-agent.toml` is correct
- Check agent logs: `sudo journalctl -u veha-agent -f`
- The agent auto-reconnects on disconnection — check for repeated connection errors

### No video output

- Verify the display is connected and powered on
- For framebuffer: check `/dev/fb0` exists (`ls /dev/fb*`)
- Check player logs: `sudo journalctl -u veha-player -f`
- Try `output_backend = "null"` to test without display, then switch to `"framebuffer"`
- Verify FFmpeg can decode the media: `ffmpeg -i /path/to/video.mp4 -f null -`

### Media not loading

- Media is streamed from the API server — verify the server is reachable: `curl http://your-server:3000/api/media`
- Check that the board's `sell_mode` is not `house_only` (the resolver skips those boards)
- Verify bookings are active (correct dates/times, campaign within date range)
- Check that creatives have status `approved`
- Check player logs for HTTP errors: `sudo journalctl -u veha-player -f`

### High CPU usage

- Use hardware-accelerated FFmpeg if available (VAAPI, V4L2M2M on Raspberry Pi)
- Reduce resolution in `veha-player.toml` to match actual display
- Use pre-encoded media in H.264 at the target resolution

## Network Requirements

| Direction | Port | Protocol | Purpose |
|---|---|---|---|
| Billboard > Server | 3000 | WebSocket (WS/WSS) | Agent connection, commands, schedule updates |
| Billboard > Server | 3000 | HTTP/HTTPS | Media streaming (player fetches media on demand) |

The billboard only makes outbound connections. No inbound ports need to be open on the billboard.

> **Media URL resolution:** The schedule resolver provides relative URLs (e.g. `/api/media/{id}/download`). The agent automatically converts these to absolute URLs using the API server's address from `api_url`. The player then streams media directly from the API server. Ensure the `api_url` host is accessible over HTTP from the billboard.

## Known Limitations

- **No offline media caching** — The player streams media directly from the API server. If the network goes down, playback of new items will fail. Local media caching is planned but not yet implemented.
- **No API key enforcement by default** — The WebSocket agent endpoint does not require authentication by default. For production deployments, set the `--api-key` flag (or `VEHA_API_KEY` env var) on the server and configure the matching `api_key` in each agent's config.

## Recommended Directory Layout

```
/opt/veha/
├── veha-player          # player binary
├── veha-agent           # agent binary
├── veha-player.toml     # player config
└── veha-agent.toml      # agent config
```
