# KOOMPI VEHA User Guide

> Digital Out-of-Home Advertising Platform for LED Billboard Fleet Management

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Dashboard Overview](#dashboard-overview)
3. [Fleet Management](#fleet-management)
4. [Content Management](#content-management)
5. [Selling Ads](#selling-ads)
6. [Playing Ads on Boards](#playing-ads-on-boards)
7. [Monitoring & Analytics](#monitoring--analytics)
8. [System Administration](#system-administration)
9. [Setting Up Edge Devices](#setting-up-edge-devices)
10. [API Reference](#api-reference)

---

## Getting Started

### Logging In

Open the dashboard URL in your browser and sign in with your username and password.

Default admin credentials (change immediately after first login):
- Username: `admin`
- Password: `admin`

### User Roles

| Role | Access |
|------|--------|
| **Admin** | Full access including user management |
| **Operator** | Create and manage content, campaigns, boards |
| **Viewer** | Read-only access to all pages |

### Navigation

The sidebar organizes everything into sections:

- **Dashboard** -- Fleet overview and KPIs
- **Fleet** -- Boards, Zones, Groups
- **Content** -- Media Library, Playlists
- **Advertising** -- Advertisers, Campaigns, Bookings
- **Analytics** -- Play Logs, Reports, Alerts
- **System** -- Schedules, Settings, Users

---

## Dashboard Overview

The main dashboard shows four key metrics:

- **Total Boards** -- Number of registered boards
- **Online Boards** -- Currently connected boards (with percentage)
- **Active Campaigns** -- Running campaigns
- **Plays Today** -- Content plays in the last 24 hours

Below the metrics is a 7-day play chart and a live board status grid showing each board's connectivity and last seen time. Click any board to jump to its detail page.

---

## Fleet Management

### Boards

**Boards** is the central hub for managing your billboard fleet.

#### Viewing Boards

Three view modes are available from the toggle in the top-right:

- **Table** -- Detailed list with columns for status, preview screenshot, name, content, zone, group, CPU, memory, uptime, and last seen
- **Cards** -- Grid of thumbnails with status stripe, board name, and zone
- **Map** -- Geographic view (requires latitude/longitude on boards)

#### Filtering

- **Filter tabs**: All, By Zone, By Group, By Type
- **Search**: Type to filter by board name
- **Zone dropdown**: Filter to a specific zone
- **Status dropdown**: Show only Online or Offline boards

#### Creating a Board

1. Click **New Board**
2. Enter a board name (e.g. `BKK-001`)
3. Optionally select a group
4. Click **Create**

The board record is created. When the edge device connects with the matching Board ID, it will register automatically.

#### Board Detail Page

Click any board to open its detail page, which shows:

**Status Hero** -- Live connectivity status with action buttons:
- **Ping** -- Test network latency (shows milliseconds)
- **Restart Agent** -- Restart the agent service on the device
- **Restart Player** -- Restart the media player process

**System Metrics** (reported by the agent every few seconds):
- CPU usage, Memory, Disk, Temperature, Uptime, Agent version

**Live Preview** -- Latest screenshot from the board, auto-refreshing. Toggle between:
- **Live** -- Current screenshot with player controls overlay (play, pause, stop, next, previous, capture)
- **Timelapse** -- Scrub through stored screenshots to review past playback

**Board Info** -- Zone, group, sell mode, resolution, orientation, address, operating hours

**Resolved Schedule** -- The playlist currently assigned to this board by the schedule resolver

**Recent Play Logs** -- Last 10 playback records

#### Editing a Board

Click **Edit** on the detail page to modify:
- Name, Zone, Group, Address
- Sell mode (exclusive, rotation, etc.)
- Orientation (landscape/portrait)
- Latitude/Longitude (for map view)
- Operating hours (start/end time)

#### Bulk Actions

Select multiple boards using checkboxes, then use the bulk action bar:
- **Ping All** -- Check connectivity to all selected boards
- **Restart Agent** -- Restart agent on all selected boards
- **Restart Player** -- Restart player on all selected boards

### Zones

Zones organize boards geographically in a hierarchy (e.g. Country > City > District).

**Creating a Zone:**
1. Click **New Zone**
2. Enter name and type (country, city, area, custom, etc.)
3. Optionally set a parent zone for hierarchy
4. Set rate per slot and currency for pricing
5. Click **Create**

The left panel shows the zone tree. Click any zone to see its details and child zones on the right.

### Groups

Groups are flat collections of boards for bulk operations (e.g. "Mall A Screens", "Highway Billboards").

**Creating a Group:**
1. Click **New Group**
2. Enter a name
3. Click **Create**

Assign boards to groups from the Board Detail edit form.

---

## Content Management

### Media Library

The media library stores all image and video files used for advertising.

**Uploading Media:**
1. Go to **Media Library**
2. Click **Upload** or drag files onto the page
3. Supported formats: MP4, WebM, JPEG, PNG, GIF
4. Upload progress is shown per file

**Managing Media:**
- **Grid/List toggle** -- Switch between thumbnail grid and detailed table
- **Preview** -- Click the eye icon to preview media in a modal
- **Rename** -- Click the edit icon to change the display name
- **Download** -- Get the original file
- **Delete** -- Remove from library (warning: may break playlists using it)

### Playlists

Playlists are ordered sequences of media items that boards play.

**Creating a Playlist:**
1. Go to **Playlists** > **New Playlist**
2. Enter a playlist name
3. Click **Add Media** to pick items from the library
4. Set duration (seconds) for each item
5. Toggle **Loop** to repeat indefinitely
6. Click **Save**

**Editing a Playlist:**

Click a playlist to open the full editor with:
- Left panel: item list with drag reorder, duration inputs, duplicate/delete
- Right panel: preview player with play/pause and scrubber

**Keyboard shortcuts in the editor:**
- `Space` -- Play/Pause preview
- `Delete` -- Remove selected item
- `D` -- Duplicate selected item
- Arrow keys -- Navigate items

---

## Selling Ads

The advertising workflow follows this hierarchy: **Advertiser > Campaign > Creative > Booking**

### Step 1: Create an Advertiser

1. Go to **Advertisers** > **New Advertiser**
2. Fill in:
   - Name (required, e.g. "Coca-Cola Cambodia")
   - Contact name, email, phone (optional)
   - Check "House" for internal/filler content
3. Click **Create**

### Step 2: Create a Campaign

1. Go to **Campaigns** > **New Campaign**
2. Fill in:
   - Name (e.g. "Summer Promotion 2026")
   - Advertiser (dropdown)
   - Start and end dates
   - Budget (optional)
3. Click **Create**

The campaign starts in **Draft** status. Campaigns can be viewed in Kanban or Table view.

### Step 3: Add Creatives

From the Campaign Detail page:

1. Click **Add Creative**
2. Select media from the library
3. Set duration and name
4. Submit for approval

Creatives have an approval workflow:
- **Pending** -- Awaiting review
- **Approved** -- Ready to play
- **Rejected** -- Not suitable

Admins can approve or reject creatives from the campaign detail.

### Step 4: Create a Booking

Bookings assign campaign content to boards on a schedule.

1. Go to **Bookings** > **New Booking**
2. Fill in:
   - **Campaign** -- Select the campaign
   - **Booking Type**:
     - `Rotation` -- Shares airtime with other rotation bookings
     - `Exclusive` -- Reserved time, no other content plays
   - **Target Type** and **Target**:
     - `Board` -- Single specific board
     - `Zone` -- All boards in a zone
     - `Group` -- All boards in a group
   - **Start/End Date** -- When the booking runs
   - **Start/End Time** (optional) -- Daily time window (e.g. 8:00-22:00)
   - **Days of Week** -- Which days to play (default: all 7)
   - **Slot Duration** -- How long each play (seconds, default 15)
   - **Slots per Loop** -- How many times per rotation cycle (default 1)
   - **Priority** -- Higher number = more prominent placement
   - **Cost per Slot** -- For revenue tracking
3. Click **Create**

### How Schedule Resolution Works

The system automatically resolves what plays on each board:

1. Collects all active bookings targeting the board (directly, by zone, or by group)
2. Collects all direct schedules for the board
3. Filters by current date, time of day, and day of week
4. Sorts by priority (exclusive bookings first, then by priority number)
5. Builds a combined playlist with proportional slot distribution
6. The agent fetches this resolved playlist and plays it

This runs automatically -- no manual intervention needed once bookings are active.

### Activating a Campaign

A campaign must be **Active** for its bookings to take effect:

1. Go to **Campaigns**
2. Click on the campaign
3. Click **Activate**

To temporarily stop a campaign, click **Pause**.

### Pricing Example

A booking with:
- Slot duration: 15 seconds
- Slots per loop: 2
- Cost per slot: $5
- Date range: 30 days

Estimated cost = 2 slots x $5 x 30 days = **$300**

---

## Playing Ads on Boards

### Quick Play (Direct)

To immediately play content on a board without the full campaign workflow:

1. Go to **Boards** > click the board
2. In the **Live Preview** section, use the player controls:
   - **Play** -- Start/resume playback
   - **Pause** -- Pause playback
   - **Stop** -- Stop playback (shows black screen)
   - **Previous/Next** -- Skip between playlist items
   - **Capture** -- Take a screenshot now

To load a playlist:
1. Create a playlist in **Playlists**
2. Create a **Schedule** assigning that playlist to the board
3. The board picks up the schedule automatically

### Quick Play (via Schedule)

For content that should play on a fixed schedule without campaigns:

1. Go to **Schedules** > **New Schedule**
2. Select the board (or group)
3. Select the playlist
4. Optionally set time window and days
5. Click **Create**

### Stopping Playback

- From the board detail page, click the **Stop** button
- Or send a Stop command via the API:
  ```
  POST /api/boards/{id}/command
  {"command": {"type": "Stop"}}
  ```

---

## Monitoring & Analytics

### Play Logs

**Play Logs** records every media play across all boards.

- **Summary cards**: Total plays, total duration, unique boards
- **Date filter**: Select date range (default: last 30 days)
- **Board filter**: Filter to a specific board
- **Export CSV**: Download logs for external analysis

Each log entry shows: board, booking, start time, duration, and status.

### Reports

**Reports** provides revenue analytics grouped by:

- **Advertiser** -- Revenue per advertiser
- **Zone** -- Revenue per geographic area
- **Campaign** -- Revenue per campaign

Set the date range and grouping, then view:
- Total estimated revenue
- Revenue breakdown table with percentages

### Alerts

The system generates alerts automatically for events like:

- Board going offline
- Connection lost
- Player errors

**Managing Alerts:**
- **Active tab** -- Unacknowledged alerts requiring attention
- **Acknowledge** -- Click to mark an alert as handled
- Alert count badge appears in the header navigation

---

## System Administration

### Users (Admin only)

1. Go to **Users**
2. Click **New User**
3. Set username, password, and role
4. Click **Create**

Roles:
- **Admin** -- Full access, can manage users
- **Operator** -- Can create/edit content, boards, campaigns
- **Viewer** -- Read-only access

### API Keys

For programmatic access to the API:

1. Go to **Settings**
2. Click **Create API Key**
3. Enter a name (e.g. "CI/CD Pipeline")
4. Copy the key immediately (it won't be shown again)

Use the key in HTTP headers: `X-API-Key: <your-key>`

### Settings

- Manage API keys (create, view, delete)
- Future: additional platform settings

---

## Setting Up Edge Devices

### Requirements

- Linux machine (Arch, Ubuntu, Fedora)
- FFmpeg 8+ development libraries
- Network access to the API server
- Display output (HDMI/VGA for window mode, or framebuffer for kiosk)

### Automated Installation

Run the installer on the edge device:

```bash
curl -sSfL https://raw.githubusercontent.com/rithythul/koompi-veha/main/scripts/install-edge.sh | \
  sudo SERVER_URL=http://<server-ip>:3000 BOARD_ID=<board-id> bash
```

Replace:
- `<server-ip>` -- Your API server's IP address
- `<board-id>` -- A unique ID matching a board in the dashboard (e.g. `board-001`)

**Example:**
```bash
curl -sSfL https://raw.githubusercontent.com/rithythul/koompi-veha/main/scripts/install-edge.sh | \
  sudo SERVER_URL=http://192.168.1.17:3000 BOARD_ID=board-001 bash
```

### What the Installer Does

1. Installs system dependencies (FFmpeg, Rust, Clang, etc.)
2. Clones the repository and builds `veha-player` and `veha-agent` in release mode
3. Installs binaries to `/opt/veha/`
4. Generates configuration files (`veha-player.toml`, `veha-agent.toml`)
5. Creates and starts systemd services
6. Auto-detects display server (X11/XWayland) for the player window

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SERVER_URL` | Yes | API server URL (e.g. `http://192.168.1.17:3000`) |
| `BOARD_ID` | Yes | Unique board identifier |
| `BOARD_NAME` | No | Display name (defaults to BOARD_ID) |
| `WIDTH` | No | Display width in pixels (default: 1920) |
| `HEIGHT` | No | Display height in pixels (default: 1080) |
| `OUTPUT_BACKEND` | No | `window` (default on desktop), `framebuffer`, or `null` |
| `API_KEY` | No | API key for agent authentication |

### Interactive Installation

Without environment variables, the installer prompts for input:

```bash
curl -sSfL https://raw.githubusercontent.com/rithythul/koompi-veha/main/scripts/install-edge.sh | sudo bash
```

### Managing the Edge Device

**Check service status:**
```bash
sudo systemctl status veha-player veha-agent
```

**View logs:**
```bash
sudo journalctl -u veha-agent -f    # Agent logs (WebSocket, commands)
sudo journalctl -u veha-player -f   # Player logs (playback, screenshots)
```

**Restart services:**
```bash
sudo systemctl restart veha-player veha-agent
```

**Edit configuration:**
```bash
sudo nano /opt/veha/veha-player.toml
sudo nano /opt/veha/veha-agent.toml
sudo systemctl restart veha-player veha-agent
```

### Player Configuration (`veha-player.toml`)

```toml
output_backend = "window"        # window, framebuffer, or null
width = 1920                     # Display width
height = 1080                    # Display height
fullscreen = true                # Fullscreen mode
socket_path = "/run/veha/player.sock"
title = "veha-player"
```

### Agent Configuration (`veha-agent.toml`)

```toml
board_id = "board-001"
board_name = "board-001"
server_url = "http://192.168.1.17:3000"
ws_url = "ws://192.168.1.17:3000/ws/agent"
player_socket = "/run/veha/player.sock"
screenshot_interval_secs = 10    # How often to capture screenshots
status_interval_secs = 5         # How often to report status
```

### Upgrading an Edge Device

Re-run the installer. It detects the existing installation, removes the old binaries, and builds the latest version:

```bash
curl -sSfL https://raw.githubusercontent.com/rithythul/koompi-veha/main/scripts/install-edge.sh | \
  sudo SERVER_URL=http://192.168.1.17:3000 BOARD_ID=board-001 bash
```

### Uninstalling

```bash
curl -sSfL https://raw.githubusercontent.com/rithythul/koompi-veha/main/scripts/install-edge.sh | \
  sudo bash -s -- --uninstall
```

This stops services, removes binaries, config files, and systemd units.

### Troubleshooting

**Board shows "Offline" in dashboard:**
- Check the agent is running: `systemctl status veha-agent`
- Verify network connectivity to the server: `curl http://<server-ip>:3000/health`
- Check agent logs for WebSocket errors: `journalctl -u veha-agent -n 50`

**Player window not visible:**
- Ensure `DISPLAY` is set in the service: `cat /etc/systemd/system/veha-player.service`
- For Wayland desktops, the installer auto-detects XWayland display
- Check player logs: `journalctl -u veha-player -n 50`

**Black screen (no content):**
- The board has no playlist assigned. Assign content via Bookings or Schedules.
- Check resolved schedule: Board Detail > Resolved Schedule section

**Screenshots not updating:**
- Verify the agent can reach the player socket: check agent logs for socket errors
- Check `screenshot_interval_secs` in `veha-agent.toml`

---

## API Reference

### Authentication

All API endpoints require authentication via session cookie or API key.

**Session login:**
```bash
curl -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin"}'
```

**Using API key:**
```bash
curl -H 'X-API-Key: <your-key>' http://localhost:3000/api/boards
```

### Player Commands

Send commands to a board via the API:

```bash
# Play
curl -b cookies.txt -X POST http://localhost:3000/api/boards/{id}/command \
  -H 'Content-Type: application/json' \
  -d '{"command":{"type":"Play"}}'

# Pause
-d '{"command":{"type":"Pause"}}'

# Stop
-d '{"command":{"type":"Stop"}}'

# Next/Previous
-d '{"command":{"type":"Next"}}'
-d '{"command":{"type":"Previous"}}'

# Set Volume (0.0 to 1.0)
-d '{"command":{"type":"SetVolume","data":0.5}}'

# Mute/Unmute
-d '{"command":{"type":"Mute"}}'

# Load Playlist
-d '{"command":{"type":"LoadPlaylist","data":"{\"name\":\"My Playlist\",\"items\":[{\"source\":\"http://server/api/media/<id>/download\",\"name\":\"Ad Video\"}],\"loop_playlist\":true}"}}'
```

### Key Endpoints

```
GET    /health                          Health check
POST   /api/auth/login                  Login
GET    /api/boards                      List boards
GET    /api/boards/{id}                 Board detail
POST   /api/boards/{id}/command         Send player command
GET    /api/boards/live-status          Real-time fleet status
POST   /api/boards/{id}/ping           Ping board
GET    /api/media                       List media
POST   /api/media                       Upload media (multipart)
GET    /api/playlists                   List playlists
POST   /api/playlists                   Create playlist
GET    /api/campaigns                   List campaigns
POST   /api/bookings                    Create booking
GET    /api/play-logs                   View play logs
GET    /api/reports/revenue             Revenue report
GET    /api/alerts                      View alerts
```

---

*KOOMPI VEHA v0.2.0*
