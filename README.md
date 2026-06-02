# HeadsetConnect 🎧

> **Multi-Headset Sound Sync** — Stream audio to multiple Bluetooth, USB, and wired headsets simultaneously with per-device volume, delay compensation, and automatic latency calibration.

---

## Table of Contents

1. [What HeadsetConnect Does](#what-headsetconnect-does)
2. [System Architecture](#system-architecture)
3. [Project Structure](#project-structure)
4. [Backend Deep Dive](#backend-deep-dive)
   - [main.py — API Server & Message Router](#mainpy--api-server--message-router)
   - [audio_engine.py — Low-Level Audio Engine](#audio_enginepy--low-level-audio-engine)
   - [streamer.py — YouTube & Local Audio Streamer](#streamerpy--youtube--local-audio-streamer)
   - [profiles.json — Persistent Device Settings](#profilesjson--persistent-device-settings)
5. [Frontend Deep Dive](#frontend-deep-dive)
   - [App.jsx — Single-Page Application](#appjsx--single-page-application)
   - [Component Breakdown](#component-breakdown)
6. [Routing System — Full Details](#routing-system--full-details)
   - [HTTP Routes](#http-routes)
   - [WebSocket Message Protocol](#websocket-message-protocol)
   - [State Broadcast System](#state-broadcast-system)
   - [Frontend → Backend Actions (Complete List)](#frontend--backend-actions-complete-list)
   - [Backend → Frontend Message Types](#backend--frontend-message-types)
7. [Audio Pipeline](#audio-pipeline)
8. [Device Discovery & Deduplication](#device-discovery--deduplication)
9. [Auto-Calibration System](#auto-calibration-system)
10. [YouTube Streaming — Anti-Bot Details](#youtube-streaming--anti-bot-details)
11. [All Imports & Dependencies](#all-imports--dependencies)
12. [Installation & Running](#installation--running)
13. [How Data Flows — End-to-End](#how-data-flows--end-to-end)

---

## What HeadsetConnect Does

HeadsetConnect lets you **play one audio source to many headsets at once**. Imagine a party where every person plugs in their own headset and hears the same music in perfect sync — that's the goal.

**Core features:**
- Discovers all Windows output devices (Bluetooth, USB, Wired, built-in speakers)
- Plays one audio stream out of **all active devices simultaneously**
- Per-device **independent volume control**
- Per-device **delay compensation** (manual slider in milliseconds)
- **Auto-calibration**: plays a frequency chirp and measures round-trip latency using the microphone, then auto-applies the correct delay offset
- **YouTube search and streaming** — search by keyword or paste a URL
- **Local file upload** — drag & drop MP3, WAV, or FLAC files
- **Play queue** — add tracks, drag to reorder, swipe to delete (mobile)
- **Seek** anywhere in the track
- **Hot-plug detection** — new devices are detected and shown every 5 seconds without restarting

---

## System Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     USER BROWSER                         │
│  React SPA (Vite)  ·  port 5180                          │
│                                                           │
│  ┌────────────────────────────────────────────────────┐  │
│  │                    App.jsx                          │  │
│  │  ┌──────────────┐  ┌──────────────────────────┐   │  │
│  │  │  DeviceCard  │  │   Player / Queue / Lib    │   │  │
│  │  │  (per device)│  │   (Deck Manager panel)    │   │  │
│  │  └──────────────┘  └──────────────────────────┘   │  │
│  └────────────┬───────────────────────────────────────┘  │
│               │  WebSocket ws://localhost:8000/ws         │
│               │  HTTP POST http://localhost:8000/api/...  │
└───────────────┼──────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────┐
│               FASTAPI BACKEND  ·  port 8000               │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │                    main.py                           │ │
│  │                                                      │ │
│  │  ┌──────────────────┐  ┌──────────────────────────┐ │ │
│  │  │ ConnectionManager│  │  Background Loops         │ │ │
│  │  │  (WebSocket hub) │  │  progress_broadcast_loop  │ │ │
│  │  │                  │  │  device_watcher_loop       │ │ │
│  │  └──────────────────┘  └──────────────────────────┘ │ │
│  │                                                      │ │
│  │  ┌──────────────────┐  ┌──────────────────────────┐ │ │
│  │  │   audio_engine   │  │       streamer            │ │ │
│  │  │   (AudioEngine)  │◄─┤   (AudioStreamer)         │ │ │
│  │  └──────┬───────────┘  └──────────────────────────┘ │ │
│  └─────────┼───────────────────────────────────────────┘ │
│            │                                              │
│  ┌─────────▼───────────────────────────────────────────┐ │
│  │              Per-Device Playback Threads              │ │
│  │                                                      │ │
│  │  AudioDevice[0]  AudioDevice[1]  AudioDevice[N]      │ │
│  │  Thread+Stream   Thread+Stream   Thread+Stream        │ │
│  │  (sounddevice)   (sounddevice)   (sounddevice)        │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────┐
│                   EXTERNAL SERVICES                       │
│                                                           │
│  YouTube (yt-dlp → FFmpeg decode pipeline)                │
│  Local Files (uploaded to /backend/uploads/)              │
└──────────────────────────────────────────────────────────┘
```

**Key architectural facts:**
- Frontend and Backend are **completely separate processes** — no SSR, no shared state.
- All real-time communication happens over a **single persistent WebSocket** per browser tab.
- Audio is decoded by FFmpeg into raw PCM frames, stored in a shared **NumPy master buffer**, and each device has its own **playback thread** that reads from that shared buffer at its own cursor position.
- The backend is **event-driven** on the asyncio event loop for WebSocket/HTTP, and **thread-based** for audio playback (sounddevice requires blocking I/O on background threads).

---

## Project Structure

```
HeadsetConnect/
│
├── start.bat                    # One-click launcher (Windows): starts backend + frontend + opens browser
│
├── backend/
│   ├── main.py                  # FastAPI app: all HTTP/WebSocket routes, connection manager, background loops
│   ├── audio_engine.py          # Core audio: device discovery, per-device playback threads, calibration
│   ├── streamer.py              # YouTube search/streaming, local file playback, FFmpeg decode pipeline, queue
│   ├── profiles.json            # Persistent per-device settings: volume, delay, latency (auto-saved)
│   ├── requirements.txt         # Python dependencies
│   ├── run_backend.bat          # Backend-specific launch helper (called by start.bat)
│   └── uploads/                 # Uploaded local audio files are stored here and served as static files
│
└── frontend/
    ├── src/
    │   ├── main.jsx             # React entry point — mounts <App /> into #root
    │   ├── App.jsx              # Entire frontend: state, WebSocket logic, all UI components
    │   ├── App.css              # Minimal base reset
    │   └── index.css            # Full design system: CSS variables, layout, all component styles
    ├── index.html               # HTML shell — loads main.jsx
    ├── vite.config.js           # Vite config: React plugin, dev server on port 5180
    ├── package.json             # Node dependencies
    ├── run_frontend.bat         # Frontend-specific launch helper
    └── eslint.config.js         # ESLint rules
```

---

## Backend Deep Dive

### `main.py` — API Server & Message Router

**What it does:** This is the entry point for the backend. It creates the FastAPI application, wires up all HTTP endpoints, manages the WebSocket connection pool, and dispatches every incoming message to the correct handler in `audio_engine` or `streamer`.

**Key responsibilities:**
- Starts two background asyncio tasks on startup via the `lifespan` context manager
- Manages `ConnectionManager` — a list of active WebSocket connections
- Receives JSON messages over WebSocket and routes them by the `action` field
- Broadcasts state updates to **all** connected clients after every action
- Provides a thread-safe bridge (`broadcast_state_sync`) so background threads (the audio decoder) can trigger WebSocket broadcasts on the asyncio event loop

**Imports used:**

| Import | Purpose |
|--------|---------|
| `fastapi.FastAPI` | Web framework, creates the `app` object |
| `fastapi.WebSocket`, `WebSocketDisconnect` | WebSocket server endpoint |
| `fastapi.File`, `UploadFile` | Multipart file upload handling |
| `fastapi.middleware.cors.CORSMiddleware` | Allow browser cross-origin requests |
| `fastapi.staticfiles.StaticFiles` | Serve uploaded audio files at `/uploads/` |
| `uvicorn` | ASGI server that runs the FastAPI app |
| `asyncio` | Async event loop, `asyncio.gather`, `asyncio.create_task`, `asyncio.run_coroutine_threadsafe` |
| `contextlib.asynccontextmanager` | Lifespan context for startup/shutdown hooks |
| `json` | Serialize/deserialize WebSocket messages |
| `logging` | Structured logging throughout |
| `os` | File path operations, environment variable reading |
| `shutil` | Copy uploaded file bytes to disk |
| `time` | Timestamps for track IDs |
| `uuid` | Generate unique filenames for uploads |
| `pydub.AudioSegment` | Parse audio file duration on upload |
| `subprocess` | `ffprobe` fallback for duration parsing |
| `audio_engine.audio_engine` | Global AudioEngine singleton (imported from `audio_engine.py`) |
| `streamer.streamer` | Global AudioStreamer singleton (imported from `streamer.py`) |

**Background loops started at startup:**

```
lifespan()
├── asyncio.create_task(progress_broadcast_loop())   # Every 500ms while playing
└── asyncio.create_task(device_watcher_loop())       # Every 5s, checks for device changes
```

**`progress_broadcast_loop`** — every 500 ms while `audio_engine.is_playing` is True, broadcasts the current full system state to all WebSocket clients. This is what updates the seek bar in real time.

**`device_watcher_loop`** — every 5 seconds, calls `audio_engine.update_devices()` and compares the device set to the previous check. If it changed (device plugged in or disconnected), broadcasts the new state.

---

### `audio_engine.py` — Low-Level Audio Engine

**What it does:** Handles everything below the application layer — physical device discovery, per-device playback threads, the shared master buffer, volume/delay application, resampling, channel count adaptation, and auto-latency calibration.

**Imports used:**

| Import | Purpose |
|--------|---------|
| `sounddevice` (`sd`) | Open OutputStream to each audio device, record microphone for calibration |
| `numpy` (`np`) | Master PCM buffer (float32 stereo), all audio math |
| `threading` | One `Thread` + one `Event` per AudioDevice for playback |
| `time` | Sleep in playback loop, rate-limit cache refresh |
| `re` | Regex to parse Bluetooth device name strings from Windows |
| `logging` | Structured logging |
| `os` | File path for `profiles.json` |
| `json` | Read/write `profiles.json` |

**Key classes and their responsibilities:**

#### `AudioDevice`
Represents one output endpoint (one headset, one speaker). It holds:
- `index` — PortAudio device index
- `name` — cleaned human-readable name
- `volume` — float 0.0–1.0, applied as a scalar multiply on each audio chunk
- `delay_ms` — silence padding injected at the start of playback so this device's audio starts later, compensating for lower hardware latency
- `latency_ms` — measured round-trip latency from auto-calibration
- `cursor` — current read position in the master buffer (in samples)
- `master_buffer` — reference to the shared NumPy array (same array as `AudioEngine.master_buffer`)
- `stream` — the `sounddevice.OutputStream` object
- `thread` — the Python `Thread` running `_play_loop`
- `stop_event` — `threading.Event` to signal the thread to stop
- `lock` — protects cursor and master_buffer pointer swaps

**`_play_loop`** — the inner loop that runs on a background thread:
1. Opens a `sounddevice.OutputStream` for this device
2. Injects silence equal to `delay_ms` milliseconds (so this device starts playback later)
3. Reads 1024-sample chunks from the master buffer at `self.cursor`
4. If device sample rate ≠ 44100 Hz, linearly resamples the chunk using `numpy.interp`
5. If device channels ≠ 2, mixes down (mono) or pads (surround) the chunk
6. Multiplies by `self.volume` for per-device loudness
7. Writes to `self.stream` (blocking write, hence the background thread)

#### `AudioEngine`
The singleton that coordinates all `AudioDevice` instances.

**Important methods:**

| Method | What it does |
|--------|-------------|
| `update_devices()` | Query system devices, add new ones, preserve existing state, remove gone ones |
| `get_available_devices()` | Call PortAudio, deduplicate by name preferring WASAPI > DirectSound > MME, exclude WDM-KS |
| `refresh_devices_safely()` | Force PortAudio cache reinit, optionally resuming playback at the same cursor |
| `toggle_device(index, active)` | Connect/disconnect a device; if connecting while playing, starts its thread at min cursor of peers |
| `set_device_volume(index, volume)` | Update volume and persist to `profiles.json` |
| `set_device_delay(index, delay_ms)` | Update delay, compute manual_offset vs. base delay, persist to `profiles.json`; restarts the device thread if playing |
| `recalculate_delays()` | After calibration, finds the max latency device, and adds `(max - own_latency)` of silence delay to all others so they all arrive at the listener at the same time |
| `calibrate_device(index)` | Full auto-calibration procedure (see [Auto-Calibration System](#auto-calibration-system)) |
| `append_audio_data(numpy_data)` | Append decoded float32 stereo samples to master buffer; prunes old history if > 16 min to prevent memory bloat |
| `clear_buffer()` | Zero out master buffer and reset all cursors |
| `play()` | Set `is_playing = True`, start playback threads on all active devices |
| `pause()` | Set `is_playing = False`, stop all playback threads but preserve cursors |
| `seek_to_seconds(seconds)` | Restart FFmpeg decode from the given offset; clears buffer, tells streamer to replay from that position |
| `get_play_progress()` | Return current playback position in seconds = `seek_offset_seconds + (max_cursor / sample_rate)` |

**Device deduplication rules** (the "why WASAPI is preferred" logic):

Windows exposes the same physical device through 4 different Host APIs: MME, DirectSound, WASAPI, and WDM-KS. The engine:
1. **Skips WDM-KS** — it doesn't support the blocking output API that sounddevice uses
2. **Deduplicates by cleaned name**, keeping only the highest-priority entry per physical device
3. Priority order: WASAPI (0) > DirectSound (1) > MME (2)

**Bluetooth name cleaning** (`clean_device_name`):
Windows stores Bluetooth device names in an ugly string like:
```
Headset (@System32\drivers\bthhfenum.sys,#2;%1 Hands-Free%0 ;(AirPods Pro))
```
The function uses regex `;\(([^)]+)\)` to extract the alias after the last semicolon-paren group — in this case `AirPods Pro`.

---

### `streamer.py` — YouTube & Local Audio Streamer

**What it does:** Wraps `yt-dlp` for YouTube search/URL resolution and runs an FFmpeg subprocess to decode audio to raw PCM. It feeds decoded frames into `audio_engine.append_audio_data()` in real time. Also manages the play queue.

**Imports used:**

| Import | Purpose |
|--------|---------|
| `yt_dlp` | YouTube metadata extraction, search, stream URL resolution |
| `subprocess` | Spawn FFmpeg as a child process to decode audio |
| `threading` | Decode loop runs on a daemon thread |
| `numpy` (`np`) | Convert raw bytes from FFmpeg pipe to float32 stereo array |
| `logging` | Structured logging |
| `os` | `os.name` check (Windows: suppress console window) |
| `time` | Sleep during buffer regulation throttle |
| `static_ffmpeg` | Auto-resolves and adds FFmpeg binary to PATH (so users don't need to install it manually) |
| `audio_engine.audio_engine` | The global engine singleton — receives decoded audio data |

**Key class: `AudioStreamer`**

| Method | What it does |
|--------|-------------|
| `search_youtube(query)` | If query looks like a URL, resolve it directly; otherwise use `ytsearch5:query` to get 5 results. Returns list of `{id, title, duration, uploader, url, thumbnail}` |
| `get_track_info(url)` | Full stream URL extraction from a YouTube URL. Returns `{stream_url, http_headers, ...}` with the actual CDN audio URL |
| `play_track(track_info, start_seconds)` | Stop current decode thread, set `current_track`, start new daemon thread running `_stream_decode_loop` |
| `stop_track()` | Set `stop_event`, join thread (max 2s), clear engine buffer |
| `_stream_decode_loop(track_info, start_seconds)` | Main decode pipeline (described below) |
| `_wait_for_buffer_drain()` | After EOF, polls until the audio engine has consumed all buffered samples, then advances queue |
| `on_track_finished()` | Pop from queue, try to resolve and play next track. If queue empty, stop engine |
| `add_to_queue(track)` | Append track dict to `self.queue` |
| `remove_from_queue(track_id)` | Filter out by `id` |
| `reorder_queue(new_order_ids)` | Rebuild queue list in the given ID order |
| `clear_queue()` | Empty the queue |

**FFmpeg decode pipeline** (`_stream_decode_loop`):

```
YouTube CDN URL / local file path
        │
        ▼
   FFmpeg subprocess
   (spawned via subprocess.Popen)
   Arguments:
     -user_agent <UA>          ← from yt-dlp http_headers (remote only)
     -headers <extra headers>  ← from yt-dlp http_headers (remote only)
     -reconnect 1              ← auto-reconnect on network drop (remote only)
     -reconnect_streamed 1
     -reconnect_delay_max 5
     -ss <start_seconds>       ← seek offset (on seek or resume)
     -i <source URL or path>
     -f s16le                  ← raw signed 16-bit little-endian PCM output
     -ac 2                     ← force stereo
     -ar 44100                 ← normalize to 44.1 kHz
     -loglevel quiet
     - (stdout)
        │
        ▼
   Read 2048 samples (8192 bytes) at a time from subprocess stdout
        │
        ▼
   np.frombuffer(raw, dtype='<i2')   ← signed int16
        │
        ▼
   reshape(-1, 2)                    ← (N_samples, 2 channels)
        │
        ▼
   / 32768.0  → float32              ← normalize to -1.0 .. +1.0
        │
        ▼
   audio_engine.append_audio_data(float_data)
        │
        ▼
   Shared master buffer (NumPy)
        │
        ├──► AudioDevice[0]._play_loop (background thread)
        ├──► AudioDevice[1]._play_loop (background thread)
        └──► AudioDevice[N]._play_loop (background thread)
```

**Buffer regulation** — to avoid decoding the entire YouTube video into RAM:
- Measures how far ahead of the slowest active device cursor the buffer is
- If ahead by more than `MAX_BUFFER_SECONDS = 900` (15 minutes), sleeps 50ms and checks again
- Uses the **slowest** (minimum cursor) device as the reference to protect against a paused/failed device causing runaway decoding

**Anti-bot YouTube headers:**
```python
extractor_args: {
    'youtube': {
        'player_client': ['tv_embedded', 'android', 'web'],
        'player_skip': ['configs'],
    }
}
http_headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...',
    'Accept-Language': 'en-US,en;q=0.9',
}
```
`tv_embedded` and `android` are YouTube internal clients that bypass bot detection without needing browser cookies.

---

### `profiles.json` — Persistent Device Settings

Stored in `backend/profiles.json`. Auto-created and auto-saved whenever a device's volume, delay, latency, or manual_offset changes.

**Schema:**
```json
{
  "Device Name": {
    "volume": 1.0,
    "delay_ms": 0.0,
    "latency_ms": 0.0,
    "manual_offset": 0.0
  }
}
```
- `volume` — last known volume (0.0–1.0)
- `delay_ms` — total delay in milliseconds applied to this device
- `latency_ms` — measured hardware round-trip latency from auto-calibration
- `manual_offset` — extra manual offset added on top of the auto-calculated base delay

On startup, `apply_profile(dev)` loads these values back into each `AudioDevice`.

---

## Frontend Deep Dive

### `App.jsx` — Single-Page Application

The entire frontend is a **single React component file**. It contains:
- All React state
- The WebSocket connection and reconnection logic
- All event handlers that send actions to the backend
- Two rendered UI components: `App` (root) and `DeviceCard`

**Imports used:**

| Import | Purpose |
|--------|---------|
| `react` | Core React |
| `react.useState` | All application state |
| `react.useEffect` | WebSocket lifecycle (connect on mount, disconnect on unmount) |
| `react.useRef` | WebSocket ref, reconnect timer ref, touch start position ref |
| `lucide-react` (28 icons) | All UI icons — `Headphones`, `Volume2`, `VolumeX`, `Search`, `Play`, `Pause`, `RefreshCw`, `Music`, `HelpCircle`, `ListMusic`, `Wifi`, `WifiOff`, `Zap`, `Clock`, `SquareX`, `ChevronDown`, `ChevronUp`, `Activity`, `Settings2`, `Bluetooth`, `Usb`, `Cable`, `Signal`, `Trash2`, `Plus`, `Upload`, `GripVertical` |

**State variables in `App`:**

| State | Type | Purpose |
|-------|------|---------|
| `wsConnected` | boolean | Whether WebSocket is currently open |
| `devices` | array | All known output devices, received from backend |
| `isPlaying` | boolean | Whether audio engine is actively playing |
| `progress` | number | Current playback position in seconds |
| `currentTrack` | object\|null | The currently playing track metadata |
| `musicQuery` | string | YouTube search input field value |
| `deviceSearch` | string | Device panel search filter input |
| `searchResults` | array | YouTube search result tracks |
| `isSearching` | boolean | Search in progress spinner |
| `isScanning` | boolean | Device scan in progress spinner |
| `showSyncGuide` | boolean | Toggle for the calibration guide section |
| `newDeviceAlert` | string\|null | Toast message when a new device is hot-plugged |
| `hotPlugNames` | Set | Device names that arrived after initial load (shown as "Available") |
| `calibrationStates` | object | Map of `deviceIndex → {status, latency, errorMsg}` |
| `initialLoadDone` | ref | Ref flag to distinguish first load from subsequent updates |
| `queue` | array | Current play queue |
| `library` | array | Uploaded local audio files |
| `uploadProgress` | number\|null | Upload percentage (0–100), null when idle |
| `isDraggingFile` | boolean | Whether a file is being dragged over the player panel |
| `draggingIndex` | number\|null | Queue row currently being dragged for reorder |
| `swipeStates` | object | Map of `trackId → translateX` for mobile swipe-to-delete gesture |

---

### Component Breakdown

#### `DeviceCard` — Props: `{ device, isNew, calibrationState, onToggle, onVolume, onDelay, onCalibrate, onResetProfile }`

Renders a single audio output device with these sections:

1. **Header row** — device name, connection type badge (Bluetooth/USB/Wireless/Speaker/Wired), status dot, expand/collapse settings button, toggle switch
2. **Mini volume bar** — visible when active and settings are collapsed
3. **Expanded controls** (when settings toggled open):
   - Volume slider (0–100%) with mute button
   - Delay slider (0–500ms)
   - Fine-tune number input (exact milliseconds)
   - **Auto-Calibration section** with 4 states:
     - `idle` — shows "Auto Calibrate" button (and "Reset Profile" if calibrated)
     - `calibrating` — shows animated terminal-style HUD with pulsing circle
     - `success` — shows measured latency, "Active" badge, "Recalibrate" button
     - `error` — shows error message, "Retry" and "Reset" buttons

**Local state inside `DeviceCard`:**

| State | Purpose |
|-------|---------|
| `expanded` | Settings panel open/closed |
| `localVol` | Local copy of volume (avoids re-renders on every slider tick) |
| `localDelay` | Local copy of delay_ms |
| `muted` | Whether the mute button is active |
| `prevVol` / `prevDelay` | Mirrors of device props to detect external changes and sync local state |

#### `App` (Root) — UI Layout

The UI is divided into two side-by-side panels:

```
┌─────────────────────────────────────────────────────────┐
│                     App Header                           │
│  [HeadsetConnect logo]   [active count]  [Live/Offline]  │
└─────────────────────────────────────────────────────────┘
┌───────────────────────┐  ┌─────────────────────────────┐
│   LEFT: Deck Manager  │  │   RIGHT: Devices             │
│                       │  │                              │
│  [YouTube Search]     │  │  [Search devices...]  [↺]   │
│  [Search Results]     │  │                              │
│                       │  │  DeviceCard (device 0)       │
│  [Now Playing Card]   │  │  DeviceCard (device 1)       │
│    artwork, title     │  │  DeviceCard (device N)       │
│    seek bar           │  │                              │
│    play/pause/stop    │  │  [Sync Calibration Guide]    │
│    routing bar        │  │  (expandable)                │
│                       │  │                              │
│  [DJ Play Queue]      │  │                              │
│    drag-to-reorder    │  │                              │
│    swipe-to-delete    │  │                              │
│                       │  │                              │
│  [Local Audio Library]│  │                              │
│    drag & drop zone   │  │                              │
│    file list          │  │                              │
└───────────────────────┘  └─────────────────────────────┘
```

---

## Routing System — Full Details

### HTTP Routes

All HTTP routes are defined in `backend/main.py` and served by FastAPI on `http://localhost:8000`.

#### `POST /api/upload`
**Purpose:** Upload a local audio file (MP3, WAV, FLAC) to the server.

**Request:** `multipart/form-data` with a `file` field.

**Processing:**
1. Saves file to `backend/uploads/` with a UUID-based filename
2. Parses duration using `pydub.AudioSegment.from_file()` (runs in thread executor to avoid blocking)
3. Falls back to `ffprobe` subprocess if pydub fails
4. Creates a track info dict and appends it to `streamer.library`
5. Broadcasts updated system state to all WebSocket clients

**Response:**
```json
{
  "success": true,
  "track": {
    "id": "local_1748748123456",
    "title": "filename.mp3",
    "duration": 213.5,
    "uploader": "Local File",
    "stream_url": "http://localhost:8000/uploads/<uuid>.mp3",
    "url": "http://localhost:8000/uploads/<uuid>.mp3",
    "thumbnail": "",
    "is_local": true,
    "local_path": "D:/Projects/Headsetconnect/backend/uploads/<uuid>.mp3"
  }
}
```

#### `GET /health`
**Purpose:** Simple liveness check.

**Response:**
```json
{ "status": "ok", "devices_count": 3 }
```

#### `GET /uploads/<filename>` (static)
**Purpose:** Serve uploaded audio files. Mounted via `StaticFiles` at the `/uploads` path.
The frontend fetches these URLs directly when playing local files.

#### `GET /docs`
**Purpose:** Auto-generated FastAPI Swagger UI — lists all HTTP routes with schemas.

#### `GET /redoc`
**Purpose:** Auto-generated ReDoc API documentation.

---

### WebSocket Message Protocol

**Endpoint:** `ws://localhost:8000/ws`

The WebSocket is the **primary real-time channel**. One persistent connection per browser tab.

**Connection lifecycle:**
1. Client opens WebSocket
2. Server accepts, adds to `ConnectionManager.active_connections`
3. Server immediately sends full system state (`get_system_state()`)
4. Server calls `audio_engine.complete_startup()` — marks that a client is connected (affects hot-plug behavior)
5. Client sends JSON messages with `"action"` field
6. Server handles action, then broadcasts updated state to all clients
7. On disconnect: server removes client from pool

**Reconnection:** Frontend auto-reconnects after 2 seconds if the WebSocket closes.

---

### State Broadcast System

State is always a full snapshot — not diffs. Every action that changes state results in:
```
audio_engine.do_something()
    └── await manager.broadcast(get_system_state())
```

`get_system_state()` returns:
```json
{
  "type": "state_update",
  "devices": [
    {
      "index": 5,
      "name": "AirPods Pro",
      "volume": 0.8,
      "delay_ms": 45.0,
      "latency_ms": 120.0,
      "active": true,
      "connection_type": "Bluetooth"
    }
  ],
  "is_playing": true,
  "progress": 47.32,
  "current_track": {
    "id": "dQw4w9WgXcQ",
    "title": "Rick Astley - Never Gonna Give You Up",
    "duration": 212,
    "uploader": "RickAstleyVEVO",
    "stream_url": "https://...",
    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "thumbnail": "https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg"
  },
  "queue": [ ... ],
  "library": [ ... ],
  "server_time": 1748748000000.0
}
```

**Thread-safe broadcast from decoder thread:**

The decoder runs on a background `threading.Thread`. To broadcast a state update from a non-async context, `main.py` stores the asyncio event loop at startup (`main_loop = asyncio.get_running_loop()`) and uses:
```python
asyncio.run_coroutine_threadsafe(manager.broadcast(get_system_state()), main_loop)
```
This is registered as `streamer.on_state_changed = broadcast_state_sync` so `streamer.py` can trigger broadcasts when a track finishes or the queue advances.

---

### Frontend → Backend Actions (Complete List)

All sent as `JSON` over WebSocket. Every message has an `"action"` field.

#### Device Management

| Action | Payload | What happens |
|--------|---------|-------------|
| `scan_devices` | _(none)_ | Calls `audio_engine.refresh_devices_safely()` — forces PortAudio cache reinit and re-scans all devices |
| `toggle_device` | `{ index: int, active: bool }` | Enables or disables a device. If enabling while playing, starts its playback thread at the min cursor of active peers |
| `set_volume` | `{ index: int, volume: float }` | Sets per-device volume (0.0–1.0), persists to profiles.json |
| `set_delay` | `{ index: int, delay_ms: float }` | Sets per-device delay (0–500ms), computes manual_offset, persists, restarts thread if playing |
| `calibrate_device` | `{ index: int }` | Starts auto-calibration: plays a chirp + records mic. Returns `calibration_result` message |
| `reset_profile` | `{ index: int }` | Resets volume=1.0, delay=0, latency=0 for this device. Removes entry from profiles.json |

#### Playback Control

| Action | Payload | What happens |
|--------|---------|-------------|
| `play` | _(none)_ | Calls `audio_engine.play()` — starts playback threads on all active devices from their saved cursors |
| `pause` | _(none)_ | Calls `audio_engine.pause()` — stops all threads, preserves cursors |
| `stop` | _(none)_ | Same as pause (calls `audio_engine.pause()`) |
| `seek` | `{ seconds: float }` | Calls `audio_engine.seek_to_seconds(seconds)` — clears buffer, restarts FFmpeg from that offset |

#### Music / Streaming

| Action | Payload | What happens |
|--------|---------|-------------|
| `search` | `{ query: string }` | Runs `streamer.search_youtube(query)` in thread executor. Returns `search_results` message |
| `play_track` | `{ track: TrackObject }` | If `track.is_local`: calls `streamer.play_track(track)` directly. If YouTube: resolves full stream URL via `streamer.get_track_info(url)` first |
| `add_to_queue` | `{ track: TrackObject }` | Calls `streamer.add_to_queue(track)` |
| `remove_from_queue` | `{ id: string }` | Calls `streamer.remove_from_queue(id)` |
| `reorder_queue` | `{ queue: TrackObject[] }` | Calls `streamer.reorder_queue(ids)` |
| `clear_queue` | _(none)_ | Calls `streamer.clear_queue()` |

---

### Backend → Frontend Message Types

Messages pushed from server to client (broadcast to all connected clients unless noted).

#### `state_update` (broadcast)
Sent after every action and on a 500ms timer while playing. Contains full system snapshot (see schema above).

#### `search_results` (unicast — only to the requesting client)
```json
{
  "type": "search_results",
  "results": [
    {
      "id": "videoId",
      "title": "Track Title",
      "duration": 212,
      "uploader": "Artist Name",
      "url": "https://www.youtube.com/watch?v=...",
      "thumbnail": "https://img.youtube.com/vi/.../mqdefault.jpg"
    }
  ]
}
```

#### `calibration_result` (unicast — only to the requesting client)
```json
{
  "type": "calibration_result",
  "index": 5,
  "success": true,
  "latency_ms": 120.0,
  "confidence": 12.5,
  "error": ""
}
```
On failure:
```json
{
  "type": "calibration_result",
  "index": 5,
  "success": false,
  "latency_ms": 0.0,
  "confidence": 1.2,
  "error": "Signal too weak. Place headset closer to your microphone..."
}
```

#### `error` (unicast — sent on play_track failure)
```json
{
  "type": "error",
  "message": "Failed to extract streaming link from YouTube."
}
```

---

## Audio Pipeline

```
Source
  │
  ├─ YouTube URL
  │     └─ yt-dlp (stream URL + headers)
  │              └─ FFmpeg subprocess (remote stream decode)
  │
  └─ Local File
        └─ FFmpeg subprocess (local file decode)

FFmpeg stdout (raw s16le PCM, 44100 Hz, stereo)
  │
  ▼
streamer._stream_decode_loop()
  │  np.frombuffer → reshape → /32768 → float32
  ▼
audio_engine.master_buffer (numpy array, shape [N_samples, 2])
  │  (append_audio_data, with memory pruning at 16 min history)
  │
  ├─── AudioDevice[0]._play_loop (Thread)
  │      cursor advances through master_buffer
  │      → inject silence (delay_ms)
  │      → resample if needed
  │      → mix channels if needed
  │      → multiply by volume
  │      → sounddevice.OutputStream.write()
  │               → Physical hardware (Bluetooth/USB/3.5mm)
  │
  ├─── AudioDevice[1]._play_loop (Thread)
  │      (same pipeline, different device, different cursor, different volume/delay)
  │
  └─── AudioDevice[N]._play_loop (Thread)
```

**Memory management:** The master buffer can grow large for long sessions. Every time `append_audio_data` is called, if any device's cursor is > 16 minutes of audio ahead of the start of the buffer, the engine prunes the oldest 15 minutes (keeping 1 minute of played history for short seeks). The `seek_offset_seconds` is shifted accordingly so progress reporting stays accurate.

---

## Device Discovery & Deduplication

Windows exposes the same physical device via multiple Host APIs. The discovery flow:

```
sd.query_devices() → all PortAudio devices
        │
        ├── Filter: max_output_channels > 0 (output devices only)
        ├── Filter: exclude WDM-KS (blocking API unsupported)
        ├── clean_device_name(raw_name)
        │     ├── Bluetooth (bthhfenum): extract alias from ;(Name) pattern
        │     └── Others: strip (MME) / (Windows WASAPI) / (DirectSound) suffix
        ├── is_real_headset(cleaned, raw): discard mappers, empty names, driver paths
        └── detect_connection_type(cleaned, raw): Bluetooth / USB / Wireless / Speaker / Wired
        │
        ▼
Deduplicate by cleaned name
  ├── WASAPI version: priority 0  ← preferred
  ├── DirectSound version: priority 1
  └── MME version: priority 2
        │
        ▼
update_devices()
  ├── Startup scan: default device starts active, others inactive
  ├── Later rescans: existing devices keep state, new devices start inactive
  └── User-disconnected devices stay disconnected (tracked by name in _user_disconnected set)
```

---

## Auto-Calibration System

Triggered by `calibrate_device` action. Runs synchronously in a thread executor (blocking operations).

**Step-by-step:**
1. Query default microphone (`sd.query_devices(kind='input')`)
2. If no mic found, return error immediately
3. If currently playing, pause playback
4. Set device volume to 85% for reliable chirp
5. Generate a 150ms linear frequency chirp: 1000 Hz → 5000 Hz, Hanning-windowed
6. Start recording 1.5 seconds from the default microphone
7. Wait 100ms (pre-roll)
8. Play the chirp stereo through the target device
9. Wait for playback to finish
10. Cross-correlate recorded audio with the chirp template (`np.correlate`)
11. Find the peak position in the correlation array → this is the round-trip latency in samples
12. Calculate confidence = `(peak_value - mean) / std_dev` — must be > 4.0 sigma
13. Convert samples to milliseconds, subtract 100ms pre-roll offset
14. Sanity check: latency must be 10ms–1000ms
15. Save `latency_ms` to device and `profiles.json`
16. Call `recalculate_delays()` to auto-apply compensating delays to all active devices
17. Resume playback if it was playing before
18. Restore original volume

**`recalculate_delays()` logic:**
```
max_latency = max(device.latency_ms for active devices with calibration)
For each calibrated active device:
    base_delay = max_latency - device.latency_ms
    new_delay = base_delay + manual_offset
    device.delay_ms = max(0, new_delay)
```
This ensures the fastest device (lowest latency) waits for the slowest, so all audio arrives at listeners simultaneously.

---

## YouTube Streaming — Anti-Bot Details

yt-dlp is configured with two separate option sets:

**Search options** (`search_opts`) — used for `ytsearch5:` queries and URL resolution of search results:
- `format: 'bestaudio/best'`
- `extract_flat: False` (get full metadata)
- `skip_download: True`
- Anti-bot: `tv_embedded`, `android`, `web` player clients; realistic browser User-Agent

**Stream options** (`stream_opts`) — used for `get_track_info()` to get the actual CDN URL:
- `format: 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/best'` (prefers webm/m4a for smaller streams)
- Anti-bot: same headers and player clients

**Format fallback logic in `get_track_info()`:**
1. Try `info['url']` directly (present when yt-dlp already selected one format)
2. If missing, iterate `info['formats']` filtering for audio-only (`acodec != 'none'`, `vcodec == 'none'`)
3. Sort by `abr` or `tbr` descending → pick highest bitrate
4. If still nothing, use any format with a URL

The resolved `stream_url` and the `http_headers` dict (User-Agent, cookies if any) are passed to FFmpeg so it can fetch the CDN stream directly with the same headers yt-dlp would use.

---

## All Imports & Dependencies

### Backend Python Dependencies (`requirements.txt`)

| Package | Version | Usage |
|---------|---------|-------|
| `fastapi` | latest | HTTP server + WebSocket endpoint + routing |
| `uvicorn` | latest | ASGI server (runs FastAPI) |
| `sounddevice` | latest | Query PortAudio devices, open `OutputStream` per device, record mic for calibration |
| `numpy` | latest | Master audio buffer, PCM math, resampling, cross-correlation for calibration |
| `yt-dlp` | latest | YouTube search, URL extraction, stream URL resolution |
| `websockets` | latest | WebSocket support (uvicorn dependency) |
| `pydub` | latest | Parse audio file duration on upload |
| `static-ffmpeg` | latest | Bundles FFmpeg binary, adds it to PATH automatically |

**Standard library imports used across all backend files:**

| Module | Used in | Purpose |
|--------|---------|---------|
| `asyncio` | main.py | Async event loop, task creation, thread-safe bridging |
| `contextlib.asynccontextmanager` | main.py | `lifespan` context manager |
| `json` | main.py, audio_engine.py | Serialize WS messages, read/write profiles.json |
| `logging` | all | Structured log output |
| `os` | all | File paths, env vars, `os.name` |
| `shutil` | main.py, streamer.py | Copy file bytes, find ffmpeg in PATH |
| `time` | all | Timestamps, sleep, rate limiting |
| `uuid` | main.py | Unique upload filenames |
| `threading` | audio_engine.py, streamer.py | Background threads for playback and decoding |
| `re` | audio_engine.py | Bluetooth device name regex parsing |
| `subprocess` | main.py, streamer.py | ffprobe duration, FFmpeg decode process |

### Frontend Node.js Dependencies (`package.json`)

**Production dependencies:**

| Package | Version | Usage |
|---------|---------|-------|
| `react` | ^19.2.6 | Core framework |
| `react-dom` | ^19.2.6 | DOM rendering |
| `lucide-react` | ^0.379.0 | All UI icons (28 icons used) |

**Dev dependencies:**

| Package | Usage |
|---------|-------|
| `vite` ^8.0.12 | Build tool and dev server (port 5180) |
| `@vitejs/plugin-react` | Vite plugin for JSX/React Fast Refresh |
| `eslint` | Linting |
| `eslint-plugin-react-hooks` | React hooks lint rules |
| `eslint-plugin-react-refresh` | Vite HMR lint rules |
| `@types/react`, `@types/react-dom` | TypeScript type hints in editors |
| `globals` | ESLint global variable definitions |

---

## Installation & Running

### Prerequisites
- **Python 3.10+** — [python.org](https://python.org) — enable "Add to PATH" on install
- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- **FFmpeg** — handled automatically by `static-ffmpeg` (no manual install needed)

### Quick Start (Windows)
```
double-click start.bat
```
This will:
1. Check Python and Node.js are on PATH
2. Run `npm install` in `frontend/` if `node_modules` is missing
3. Launch backend in a new console window (port 8000)
4. Wait 3 seconds for backend to initialize
5. Launch frontend Vite dev server in a new console window (port 5180)
6. Wait 4 seconds for Vite to start
7. Open `http://localhost:5180` in the default browser

### Manual Start

**Backend:**
```bash
cd backend
pip install -r requirements.txt
python main.py
```

**Frontend (in a separate terminal):**
```bash
cd frontend
npm install
npm run dev
```

Open: `http://localhost:5180`

### Ports
| Service | Port | URL |
|---------|------|-----|
| Frontend (Vite) | 5180 | http://localhost:5180 |
| Backend API | 8000 | http://localhost:8000 |
| WebSocket | 8000 | ws://localhost:8000/ws |
| API Docs | 8000 | http://localhost:8000/docs |
| Static uploads | 8000 | http://localhost:8000/uploads/ |

---

## How Data Flows — End-to-End

### User searches YouTube and plays a track

```
1. User types query, clicks Search
2. Frontend: send({ action: 'search', query: 'song name' })
3. Backend WS handler:
     loop.run_in_executor(None, streamer.search_youtube, query)
4. streamer.search_youtube():
     yt-dlp → ytsearch5:song name → 5 results
5. Backend: ws.send_text({ type: 'search_results', results: [...] })
6. Frontend: setSearchResults(results) — shows track list

7. User clicks a track
8. Frontend: send({ action: 'play_track', track: { url, title, ... } })
9. Backend WS handler:
     loop.run_in_executor(None, streamer.get_track_info, url)
10. streamer.get_track_info():
     yt-dlp → resolves CDN stream URL + http_headers
11. streamer.play_track(full_info):
     - stop_track() clears old buffer
     - starts _stream_decode_loop() on daemon thread
12. _stream_decode_loop():
     - spawns FFmpeg subprocess
     - reads PCM frames in loop
     - audio_engine.append_audio_data(float_data)
     - audio_engine.is_playing=True → all active device threads read from buffer
13. progress_broadcast_loop() (every 500ms):
     - manager.broadcast(get_system_state()) → all clients update seek bar
```

### User connects a new headset

```
1. device_watcher_loop() (every 5s):
     audio_engine.update_devices()
     → detects new device index in PortAudio
     → creates AudioDevice, applies profile
     → new device starts inactive (startup_complete = True)
2. current_keys != prev_device_keys → broadcasts state_update
3. Frontend: receives state_update with new device in devices[]
4. Frontend: new device not in prev devices → adds to hotPlugNames set
5. Frontend: shows toast "New device available: AirPods Pro"
6. DeviceCard rendered with isNew=true → shows "Available" status

7. User toggles device switch ON
8. Frontend: send({ action: 'toggle_device', index: 5, active: true })
9. Backend: audio_engine.toggle_device(5, True)
     - dev.active = True
     - discards from _user_disconnected set
     - recalculate_delays()
     - if is_playing: dev.start_playback(master_buffer, cursor=min_of_peers)
10. Device thread starts, device now plays in sync with existing devices
```

### Auto-calibration

```
1. User clicks "Auto Calibrate" on a device
2. Frontend: setCalibrationStates({ [idx]: { status: 'calibrating' } })
3. Frontend: send({ action: 'calibrate_device', index: 5 })
4. Backend: loop.run_in_executor(None, audio_engine.calibrate_device, 5)
5. audio_engine.calibrate_device(5):
     - Records mic
     - Plays chirp through device
     - Cross-correlates → finds peak offset → latency_ms
     - Saves to profiles.json
     - recalculate_delays() → other devices get silence padding
6. Backend: ws.send_text({ type: 'calibration_result', success: true, latency_ms: 120 })
7. Backend: manager.broadcast(get_system_state()) → devices now have updated delay_ms
8. Frontend: receives calibration_result → setCalibrationStates success
9. Frontend: receives state_update → device.latency_ms = 120, delay_ms updated
```
