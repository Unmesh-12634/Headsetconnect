from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import uvicorn
import asyncio
import json
import logging
import os
import shutil
import time
import uuid
from audio_engine import audio_engine, PORTAUDIO_AVAILABLE
from streamer import streamer

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("HeadsetConnectAPI")

# Global reference to main thread event loop to broadcast from daemon threads
main_loop = None


# ── Lifespan (replaces deprecated @app.on_event) ────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global main_loop
    main_loop = asyncio.get_running_loop()
    asyncio.create_task(progress_broadcast_loop())
    asyncio.create_task(device_watcher_loop())
    
    # Register Windows custom URI protocol scheme if packaged
    try:
        register_uri_scheme()
    except Exception as reg_err:
        logger.warning(f"Failed calling register_uri_scheme: {reg_err}")
        
    logger.info("Application startup complete. Audio engine ready.")
    
    # Automatically open the browser pointing to the app's local port
    async def open_browser_delayed():
        await asyncio.sleep(1.0)
        try:
            import webbrowser
            port = int(os.getenv("PORT", 8000))
            webbrowser.open(f"http://localhost:{port}")
        except Exception as browser_err:
            logger.warning(f"Could not automatically open web browser: {browser_err}")
            
    asyncio.create_task(open_browser_delayed())
    
    yield
    # Shutdown: stop all audio cleanly
    audio_engine.pause()
    logger.info("Application shutdown. Audio engine stopped.")


app = FastAPI(title="HeadsetConnect API", lifespan=lifespan)

# ── Static files & CORS ──────────────────────────────────────────────────────

import sys

# Determine base paths for packaged (frozen) vs development execution
if getattr(sys, 'frozen', False):
    # Running inside PyInstaller bundle (executable directory for user data)
    BASE_DIR = os.path.dirname(sys.executable)
    # The static files are bundled inside _MEIPASS
    BUNDLE_DIR = sys._MEIPASS
    UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
    frontend_dist = os.path.join(BUNDLE_DIR, "frontend", "dist")
else:
    # Running in development mode
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    BUNDLE_DIR = os.path.dirname(BASE_DIR)
    UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
    frontend_dist = os.path.join(BUNDLE_DIR, "frontend", "dist")

os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

def register_uri_scheme():
    """Register custom protocol handler headsetconnect:// under HKEY_CURRENT_USER for Windows launcher.
    Does not require admin privileges.
    """
    import sys
    if sys.platform != 'win32':
        return
        
    try:
        import winreg
        if getattr(sys, 'frozen', False):
            exe_path = os.path.abspath(sys.executable)
        else:
            return
            
        key_path = r"Software\Classes\headsetconnect"
        
        # Create/open key
        key = winreg.CreateKey(winreg.HKEY_CURRENT_USER, key_path)
        winreg.SetValue(key, "", winreg.REG_SZ, "URL:HeadsetConnect Protocol")
        winreg.SetValueEx(key, "URL Protocol", 0, winreg.REG_SZ, "")
        
        # DefaultIcon key
        icon_key = winreg.CreateKey(key, "DefaultIcon")
        winreg.SetValue(icon_key, "", winreg.REG_SZ, f'"{exe_path}",0')
        
        # shell\open\command key
        cmd_key = winreg.CreateKey(key, r"shell\open\command")
        winreg.SetValue(cmd_key, "", winreg.REG_SZ, f'"{exe_path}" "%1"')
        
        logger.info(f"Registered custom URI protocol 'headsetconnect://' to: {exe_path}")
    except Exception as e:
        logger.warning(f"Could not register custom URI protocol: {e}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Upload endpoint ──────────────────────────────────────────────────────────

from pydub import AudioSegment

@app.post("/api/upload")
async def upload_audio_file(request: Request, file: UploadFile = File(...)):
    try:
        file_ext = os.path.splitext(file.filename)[1]
        unique_filename = f"{uuid.uuid4()}{file_ext}"
        file_path = os.path.join(UPLOAD_DIR, unique_filename)

        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        logger.info(f"Saved uploaded file: {unique_filename}")

        duration = 0.0
        try:
            loop = asyncio.get_running_loop()
            def get_duration():
                audio = AudioSegment.from_file(file_path)
                return len(audio) / 1000.0
            duration = await loop.run_in_executor(None, get_duration)
        except Exception as pydub_err:
            logger.warning(f"pydub failed parsing duration: {pydub_err}. Trying ffprobe...")
            try:
                import subprocess
                cmd = [
                    "ffprobe", "-v", "error",
                    "-show_entries", "format=duration",
                    "-of", "default=noprint_wrappers=1:nokey=1",
                    file_path,
                ]
                res = subprocess.check_output(cmd, timeout=10).decode().strip()
                duration = float(res)
            except Exception as ffprobe_err:
                logger.error(f"ffprobe fallback failed: {ffprobe_err}")
                duration = 180.0  # default 3 min

        # Derive base URL from request so this works on both localhost and Render cloud
        base_url = str(request.base_url).rstrip("/")

        is_video = file_ext.lower() in [".mp4", ".webm", ".mkv", ".mov", ".avi", ".flv", ".3gp", ".mpeg", ".mpg"]
        track_info = {
            "id": f"local_{int(time.time() * 1000)}",
            "title": file.filename,
            "duration": duration,
            "uploader": "Local File",
            "stream_url": f"{base_url}/uploads/{unique_filename}",
            "url": f"{base_url}/uploads/{unique_filename}",
            "thumbnail": "",
            "is_local": True,
            "local_path": file_path,
            "is_video": is_video,
        }
        streamer.library.append(track_info)
        await manager.broadcast(get_system_state())
        return {"success": True, "track": track_info}

    except Exception as e:
        logger.error(f"Error handling upload: {e}")
        return {"success": False, "error": str(e)}



# ── WebSocket connection manager ─────────────────────────────────────────────

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"New client connected. Total clients: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(f"Client disconnected. Total clients: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        if not self.active_connections:
            return
        payload = json.dumps(message)
        results = await asyncio.gather(
            *[conn.send_text(payload) for conn in self.active_connections],
            return_exceptions=True,
        )
        # Remove connections that errored
        to_remove = [
            conn for conn, result in zip(self.active_connections, results)
            if isinstance(result, Exception)
        ]
        for conn in to_remove:
            self.disconnect(conn)

    async def broadcast_bytes(self, payload: bytes):
        if not self.active_connections:
            return
        results = await asyncio.gather(
            *[conn.send_bytes(payload) for conn in self.active_connections],
            return_exceptions=True,
        )
        # Remove connections that errored
        to_remove = [
            conn for conn, result in zip(self.active_connections, results)
            if isinstance(result, Exception)
        ]
        for conn in to_remove:
            self.disconnect(conn)


manager = ConnectionManager()


def broadcast_state_sync():
    """Synchronous callback wrapper to broadcast current state to all connected WS clients.
    Thread-safe; can be called from background decoder thread safely.
    """
    try:
        global main_loop
        if main_loop and main_loop.is_running():
            asyncio.run_coroutine_threadsafe(manager.broadcast(get_system_state()), main_loop)
        else:
            # Fallback if loop is not stored or running
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    asyncio.run_coroutine_threadsafe(manager.broadcast(get_system_state()), loop)
                else:
                    asyncio.run(manager.broadcast(get_system_state()))
            except RuntimeError:
                logger.warning("No running event loop available to broadcast state change.")
    except Exception as e:
        logger.error(f"Failed to broadcast state from callback: {e}")


def broadcast_audio_chunk(numpy_data):
    """Callback triggered from backend AudioEngine when raw PCM audio frames are decoded.
    Broadcasts the raw audio bytes as a binary WebSocket message to all clients in cloud mode.
    """
    if not PORTAUDIO_AVAILABLE:
        try:
            raw_bytes = numpy_data.tobytes()
            global main_loop
            if main_loop and main_loop.is_running():
                asyncio.run_coroutine_threadsafe(manager.broadcast_bytes(raw_bytes), main_loop)
        except Exception as e:
            logger.error(f"Failed to broadcast audio chunk: {e}")


streamer.on_state_changed = broadcast_state_sync
audio_engine.on_audio_data = broadcast_audio_chunk


# ── State snapshot ───────────────────────────────────────────────────────────

def get_system_state() -> dict:
    """Serialize the current state of the audio engine and streamer.

    Does NOT call update_devices() — that is handled exclusively by
    device_watcher_loop() every 5 seconds to avoid hammering PortAudio.
    """
    device_list = []
    for idx, dev in audio_engine.devices.items():
        device_list.append({
            "index": idx,
            "name": dev.name,
            "volume": dev.volume,
            "delay_ms": dev.delay_ms,
            "latency_ms": getattr(dev, 'latency_ms', 0.0),
            "active": dev.active,
            "connection_type": getattr(dev, 'connection_type', 'Wired'),
        })

    return {
        "type": "state_update",
        "devices": device_list,
        "is_playing": audio_engine.is_playing,
        "progress": audio_engine.get_play_progress(),
        "current_track": streamer.current_track,
        "queue": streamer.queue,
        "library": streamer.library,
        "server_time": time.time() * 1000.0,
        # Tells the frontend whether the backend has real audio hardware.
        # When False, the frontend handles YouTube playback via IFrame API.
        "cloud_mode": not PORTAUDIO_AVAILABLE,
        "yt_direct_mode": getattr(streamer, 'yt_direct_mode', False),
    }


# ── Background loops ─────────────────────────────────────────────────────────

async def progress_broadcast_loop():
    """Broadcast playback progress to all clients every 500ms while playing."""
    while True:
        try:
            if audio_engine.is_playing and manager.active_connections:
                await manager.broadcast(get_system_state())
        except Exception as e:
            logger.error(f"Error in progress broadcast loop: {e}")
        await asyncio.sleep(0.5)


async def device_watcher_loop():
    """Poll for device changes every 5 seconds and broadcast if the set changes."""
    prev_device_keys: set = set()
    # Wait before first poll so startup completes cleanly
    await asyncio.sleep(5)
    while True:
        try:
            audio_engine.update_devices()
            current_keys = set(audio_engine.devices.keys())
            if current_keys != prev_device_keys:
                logger.info(f"Device change detected – new set: {current_keys}")
                await manager.broadcast(get_system_state())
                prev_device_keys = current_keys
        except Exception as e:
            logger.error(f"Error in device watcher loop: {e}")
        await asyncio.sleep(5)


# ── WebSocket endpoint ───────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)

    # Send initial state immediately
    await websocket.send_text(json.dumps(get_system_state()))

    # Mark startup complete on first real connection
    audio_engine.complete_startup()

    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            action = message.get("action")
            logger.info(f"Received action: {action}")

            if action == "scan_devices":
                audio_engine.refresh_devices_safely()
                await manager.broadcast(get_system_state())

            elif action == "toggle_device":
                idx = message.get("index")
                active = message.get("active", False)
                audio_engine.toggle_device(idx, active)
                await manager.broadcast(get_system_state())

            elif action == "set_volume":
                idx = message.get("index")
                volume = float(message.get("volume", 1.0))
                audio_engine.set_device_volume(idx, volume)
                await manager.broadcast(get_system_state())

            elif action == "set_delay":
                idx = message.get("index")
                delay_ms = float(message.get("delay_ms", 0.0))
                audio_engine.set_device_delay(idx, delay_ms)
                await manager.broadcast(get_system_state())

            elif action == "calibrate_device":
                idx = message.get("index")
                logger.info(f"Triggering calibration for device index: {idx}")
                loop = asyncio.get_running_loop()
                result = await loop.run_in_executor(None, audio_engine.calibrate_device, idx)
                await websocket.send_text(json.dumps({
                    "type": "calibration_result",
                    "index": idx,
                    "success": result.get("success", False),
                    "latency_ms": result.get("latency_ms", 0.0),
                    "confidence": result.get("confidence", 0.0),
                    "error": result.get("error", ""),
                }))
                await manager.broadcast(get_system_state())

            elif action == "reset_profile":
                idx = message.get("index")
                audio_engine.reset_device_profile(idx)
                await manager.broadcast(get_system_state())

            elif action == "search":
                query = message.get("query", "")
                loop = asyncio.get_running_loop()
                results = await loop.run_in_executor(None, streamer.search_youtube, query)
                await websocket.send_text(json.dumps({
                    "type": "search_results",
                    "results": results,
                }))

            elif action == "play_track":
                track = message.get("track")
                if track:
                    logger.info(f"Playing track: {track.get('title')}")
                    if track.get("is_local"):
                        streamer.play_track(track)
                        await manager.broadcast(get_system_state())
                    else:
                        loop = asyncio.get_running_loop()
                        full_info = await loop.run_in_executor(
                            None, streamer.get_track_info, track.get("url")
                        )
                        if full_info:
                            streamer.play_track(full_info)
                            await manager.broadcast(get_system_state())
                        else:
                            logger.warning(f"YouTube extraction failed for {track.get('title')}. Falling back to direct browser IFrame play.")
                            streamer.yt_direct_mode = True
                            streamer.current_track = track
                            audio_engine.is_playing = True
                            await websocket.send_text(json.dumps({
                                "type": "youtube_play_direct",
                                "track": track,
                            }))
                            await manager.broadcast(get_system_state())

            elif action == "add_to_queue":
                track = message.get("track")
                if track:
                    streamer.add_to_queue(track)
                    await manager.broadcast(get_system_state())

            elif action == "remove_from_queue":
                tid = message.get("id")
                streamer.remove_from_queue(tid)
                await manager.broadcast(get_system_state())

            elif action == "reorder_queue":
                order = message.get("queue", [])
                streamer.reorder_queue(order)
                await manager.broadcast(get_system_state())

            elif action == "clear_queue":
                streamer.clear_queue()
                await manager.broadcast(get_system_state())

            elif action == "play":
                audio_engine.play()
                await manager.broadcast(get_system_state())

            elif action == "pause":
                audio_engine.pause()
                await manager.broadcast(get_system_state())

            elif action == "seek":
                seconds = float(message.get("seconds", 0.0))
                audio_engine.seek_to_seconds(seconds)
                await manager.broadcast(get_system_state())

            elif action == "stop":
                audio_engine.pause()
                await manager.broadcast(get_system_state())

            else:
                logger.warning(f"Unknown action received: {action!r}")

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"Error handling WebSocket message: {e}")
        manager.disconnect(websocket)


# ── Health check ─────────────────────────────────────────────────────────────

@app.get("/health")
def health_check():
    return {"status": "ok", "devices_count": len(audio_engine.devices)}


# Serve compiled React frontend if the folder exists (for standalone desktop mode)
if os.path.exists(frontend_dist):
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
    logger.info(f"Mounted built React frontend from: {frontend_dist}")
else:
    logger.warning(f"React frontend build folder not found at: {frontend_dist}. Running in API-only mode.")


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    if getattr(sys, 'frozen', False):
        uvicorn.run(app, host="0.0.0.0", port=port)
    else:
        uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
