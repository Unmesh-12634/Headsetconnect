import yt_dlp
import subprocess
import threading
import numpy as np
import logging
import os
import time

# Auto-resolve ffmpeg dependency for users without system-level ffmpeg
try:
    import static_ffmpeg
    static_ffmpeg.add_paths()
    logging.getLogger("Streamer").info("static-ffmpeg dependency resolved successfully!")
except Exception as e:
    logging.getLogger("Streamer").warning(
        f"Could not load static-ffmpeg, relying on system PATH ffmpeg: {e}"
    )

logger = logging.getLogger("Streamer")


class AudioStreamer:
    def __init__(self, audio_engine):
        self.audio_engine = audio_engine
        self.download_thread = None
        self.stop_event = threading.Event()
        self.current_track = None
        self.sample_rate = 44100
        self.queue = []
        self.library = []

        # Callback so main.py can broadcast state after track ends
        self.on_state_changed = None  # set by main.py after creation

        # Options for searching — fast, minimal extraction
        self.search_opts = {
            'format': 'bestaudio/best',
            'noplaylist': True,
            'quiet': True,
            'no_warnings': True,
            'extract_flat': False,
            'skip_download': True,
        }

        # Options for extracting a real stream URL — needs full format resolution
        self.stream_opts = {
            'format': 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/best',
            'noplaylist': True,
            'quiet': True,
            'no_warnings': True,
            'skip_download': True,
        }


def find_key_recursive(data, key):
    results = []
    if isinstance(data, dict):
        if key in data:
            results.append(data[key])
        for k, v in data.items():
            results.extend(find_key_recursive(v, key))
    elif isinstance(data, list):
        for item in data:
            results.extend(find_key_recursive(item, key))
    return results


    # ── YouTube search / info ────────────────────────────────────────────────

    def search_youtube(self, query):
        """Search YouTube or resolve direct URL, return metadata for top matches."""
        query_str = query.strip()
        is_url = (
            query_str.startswith("http://")
            or query_str.startswith("https://")
            or "youtube.com" in query_str
            or "youtu.be" in query_str
        )
        
        if not is_url:
            # High-speed browser emulation scraper to prevent rate limit blocks on public clouds
            try:
                import requests
                import re
                import urllib.parse
                import json
                
                logger.info(f"Using high-speed scrape search for query: {query_str}")
                url = f"https://www.youtube.com/results?search_query={urllib.parse.quote(query_str)}"
                headers = {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
                    "Accept-Language": "en-US,en;q=0.9",
                }
                r = requests.get(url, headers=headers, timeout=6)
                if r.status_code == 200:
                    pattern = r"var ytInitialData\s*=\s*({.*?});"
                    match = re.search(pattern, r.text)
                    if match:
                        data = json.loads(match.group(1))
                        video_renderers = find_key_recursive(data, "videoRenderer")
                        results = []
                        for video in video_renderers:
                            video_id = video.get("videoId")
                            if not video_id:
                                continue
                            title = video.get("title", {}).get("runs", [{}])[0].get("text", "Unknown Title")
                            duration_text = video.get("lengthText", {}).get("simpleText", "0:00")
                            
                            duration_secs = 0
                            try:
                                parts = list(map(int, duration_text.split(":")))
                                if len(parts) == 2:
                                    duration_secs = parts[0] * 60 + parts[1]
                                elif len(parts) == 3:
                                    duration_secs = parts[0] * 3600 + parts[1] * 60 + parts[2]
                            except Exception:
                                pass
                                
                            uploader = video.get("ownerText", {}).get("runs", [{}])[0].get("text", "Unknown Artist")
                            
                            results.append({
                                "id": video_id,
                                "title": title,
                                "duration": duration_secs,
                                "uploader": uploader,
                                "url": f"https://www.youtube.com/watch?v={video_id}",
                                "thumbnail": f"https://img.youtube.com/vi/{video_id}/mqdefault.jpg",
                            })
                            if len(results) >= 5:
                                break
                        if results:
                            logger.info(f"Scraper resolved {len(results)} search results instantly.")
                            return results
            except Exception as scraper_err:
                logger.warning(f"High-speed scraping search failed: {scraper_err}. Falling back to yt-dlp...")

        # Fallback to standard yt-dlp search/extract (direct URL resolution)
        logger.info(f"Searching YouTube via yt-dlp: {query_str}")
        try:
            with yt_dlp.YoutubeDL(self.search_opts) as ydl:
                if is_url:
                    info = ydl.extract_info(query_str, download=False)
                    if not info:
                        return []
                    entries = info.get("entries") or [info]
                    results = []
                    for entry in entries[:5]:
                        if not entry:
                            continue
                        results.append({
                            "id": entry.get("id"),
                            "title": entry.get("title"),
                            "duration": entry.get("duration", 0),
                            "uploader": entry.get("uploader", "Unknown Artist"),
                            "url": f"https://www.youtube.com/watch?v={entry.get('id')}",
                            "thumbnail": entry.get("thumbnail")
                                or f"https://img.youtube.com/vi/{entry.get('id')}/mqdefault.jpg",
                        })
                    return results
                else:
                    res = ydl.extract_info(f"ytsearch5:{query_str}", download=False)
                    if not res or 'entries' not in res:
                        return []
                    results = []
                    for entry in res['entries']:
                        if not entry:
                            continue
                        results.append({
                            "id": entry.get("id"),
                            "title": entry.get("title"),
                            "duration": entry.get("duration", 0),
                            "uploader": entry.get("uploader", "Unknown Artist"),
                            "url": f"https://www.youtube.com/watch?v={entry.get('id')}",
                            "thumbnail": entry.get("thumbnail")
                                or f"https://img.youtube.com/vi/{entry.get('id')}/mqdefault.jpg",
                        })
                    return results
        except Exception as e:
            logger.error(f"Error searching YouTube: {e}")
            return []

    def get_track_info(self, url):
        """Extract stream url and metadata for a direct YouTube URL."""
        logger.info(f"Extracting info for URL: {url}")
        try:
            with yt_dlp.YoutubeDL(self.stream_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                if not info:
                    logger.error("yt-dlp returned no info")
                    return None

                stream_url = info.get("url")
                if not stream_url:
                    formats = info.get("formats") or []
                    audio_formats = [
                        f for f in formats
                        if f.get("url") and f.get("acodec") != "none"
                        and f.get("vcodec") in (None, "", "none")
                    ]
                    if not audio_formats:
                        audio_formats = [f for f in formats if f.get("url")]
                    if audio_formats:
                        audio_formats.sort(
                            key=lambda f: f.get("abr") or f.get("tbr") or 0,
                            reverse=True,
                        )
                        stream_url = audio_formats[0]["url"]

                if not stream_url:
                    logger.error("Could not find a usable stream URL in yt-dlp response")
                    return None

                logger.info(f"Resolved stream URL for: {info.get('title')}")
                return {
                    "id": info.get("id"),
                    "title": info.get("title"),
                    "duration": info.get("duration", 0),
                    "uploader": info.get("uploader", "Unknown Artist"),
                    "stream_url": stream_url,
                    "url": url,
                    "thumbnail": info.get("thumbnail")
                        or f"https://img.youtube.com/vi/{info.get('id')}/mqdefault.jpg",
                    "http_headers": info.get("http_headers"),
                }
        except Exception as e:
            logger.error(f"Error extracting track info: {e}")
            return None

    # ── Playback control ─────────────────────────────────────────────────────

    def play_track(self, track_info, start_seconds=0):
        """Start streaming and decoding an audio track into the audio engine."""
        self.stop_track()

        self.current_track = track_info
        self.stop_event.clear()

        self.download_thread = threading.Thread(
            target=self._stream_decode_loop,
            args=(track_info, start_seconds),
            daemon=True,
        )
        self.download_thread.start()

    def stop_track(self):
        """Stop the current decode thread, clear buffer, and reset state."""
        self.stop_event.set()
        if self.download_thread and self.download_thread.is_alive():
            self.download_thread.join(timeout=2.0)
        self.download_thread = None
        self.audio_engine.clear_buffer()
        self.current_track = None
        logger.info("Track streaming stopped and buffer cleared")

    # ── FFmpeg decode loop ───────────────────────────────────────────────────

    def _stream_decode_loop(self, track_info, start_seconds):
        """
        Real-time FFmpeg → numpy decode pipeline.

        Key design decisions:
        - Buffer regulation is based on samples already consumed by the AUDIO
          ENGINE (via device cursors), not on wall time.  This means if a device
          stream fails, the pacing does NOT incorrectly throttle to near-zero and
          cause FFmpeg to finish early.
        - We keep a MAX_BUFFER_SECONDS ahead of the farthest-behind device,
          which avoids memory bloat while guaranteeing smooth playback.
        - stop_event can be set externally at any time to abort cleanly.
        """
        MAX_BUFFER_SECONDS = 900.0   # Buffer up to 15 minutes ahead of playback to eliminate network drops during play
        PACE_CHECK_SLEEP   = 0.05   # sleep interval when throttling (50ms)

        source = (
            track_info.get("local_path")
            or track_info.get("stream_url")
            or track_info.get("url")
        )
        if not source:
            logger.error("No source URL or local path found for streaming")
            return

        logger.info(f"Starting real-time FFmpeg decode pipeline for: {track_info.get('title')}")

        import shutil
        ffmpeg_bin = shutil.which('ffmpeg') or 'ffmpeg'
        command = [ffmpeg_bin]

        # Pass HTTP headers for remote streaming to prevent connection drops/throttling
        if not track_info.get("is_local") and track_info.get("http_headers"):
            headers_list = []
            user_agent = None
            for k, v in track_info["http_headers"].items():
                if k.lower() == "user-agent":
                    user_agent = v
                else:
                    headers_list.append(f"{k}: {v}")
            
            if user_agent:
                command.extend(['-user_agent', user_agent])
            if headers_list:
                headers_str = "\r\n".join(headers_list) + "\r\n"
                command.extend(['-headers', headers_str])

        # Network reconnection options for remote streams to automatically recover from hiccups
        if not track_info.get("is_local"):
            command.extend([
                '-reconnect', '1',
                '-reconnect_streamed', '1',
                '-reconnect_delay_max', '5'
            ])

        if start_seconds > 0:
            command.extend(['-ss', str(start_seconds)])
        command.extend([
            '-i', source,
            '-f', 's16le',
            '-ac', '2',
            '-ar', str(self.sample_rate),
            '-loglevel', 'quiet',
            '-',
        ])

        kwargs = {}
        if os.name == 'nt':
            kwargs['creationflags'] = subprocess.CREATE_NO_WINDOW

        process = None
        try:
            process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                bufsize=1024 * 128,  # 128 KB pipe buffer
                **kwargs,
            )

            bytes_per_frame = 4  # 2 channels × 2 bytes (int16)
            chunk_size = 2048    # samples per read (larger = less overhead)
            bytes_to_read = chunk_size * bytes_per_frame

            # If engine is already in playing state, restart device threads so
            # they begin reading from the new buffer immediately.
            if self.audio_engine.is_playing:
                self.audio_engine.play()

            while not self.stop_event.is_set():
                # ── Buffer regulation ──────────────────────────────────────
                # Measure how far ahead we are versus the SLOWEST active device.
                # Using the slowest (min cursor) guards against one device being
                # paused/failed and causing runaway buffering.
                total_buffered = len(self.audio_engine.master_buffer) / self.sample_rate

                active_devices = [
                    d for d in self.audio_engine.devices.values()
                    if d.active and d.thread and d.thread.is_alive()
                ]
                if active_devices:
                    min_cursor = min(d.cursor for d in active_devices)
                    slowest_progress = self.audio_engine.seek_offset_seconds + (
                        min_cursor / self.sample_rate
                    )
                else:
                    # No active threads yet (waiting for user to press Play).
                    # Use total buffered as the progress reference so we don't
                    # over-buffer before playback starts.
                    slowest_progress = total_buffered

                cached_ahead = total_buffered - slowest_progress

                if cached_ahead > MAX_BUFFER_SECONDS:
                    # Throttle: wait a bit then re-check rather than reading
                    time.sleep(PACE_CHECK_SLEEP)
                    continue

                # ── Read and decode ────────────────────────────────────────
                raw_data = process.stdout.read(bytes_to_read)
                if not raw_data:
                    logger.info("FFmpeg decoding finished (EOF).")
                    break

                int_data = np.frombuffer(raw_data, dtype='<i2')
                if len(int_data) % 2 != 0:
                    int_data = int_data[:-1]
                stereo_data = int_data.reshape(-1, 2)
                float_data = stereo_data.astype('float32') / 32768.0

                self.audio_engine.append_audio_data(float_data)

        except Exception as e:
            logger.error(f"Error in stream decode loop: {e}")
        finally:
            # Always clean up the FFmpeg process
            if process and process.poll() is None:
                try:
                    process.terminate()
                    process.wait(timeout=2.0)
                except Exception:
                    pass

        # ── Post-EOF handling ────────────────────────────────────────────────
        if not self.stop_event.is_set():
            logger.info("Track completed naturally. Waiting for audio to drain before next track...")
            # Wait for the remaining buffered audio to be consumed before
            # advancing the queue — this prevents cutting off the track tail.
            self._wait_for_buffer_drain()

            if not self.stop_event.is_set():
                logger.info("Buffer drained. Advancing queue.")
                threading.Thread(target=self.on_track_finished, daemon=True).start()

    def _wait_for_buffer_drain(self):
        """Block until all buffered audio has been consumed by device threads,
        or until stop_event is set, with a dynamic timeout based on the remaining audio in the buffer."""
        poll_interval = 0.1
        elapsed = 0.0

        # Calculate a dynamic timeout to allow the entire pre-decoded song to play
        total_buffered = len(self.audio_engine.master_buffer) / self.sample_rate
        active_devices = [
            d for d in self.audio_engine.devices.values()
            if d.active and d.thread and d.thread.is_alive()
        ]
        if active_devices:
            max_cursor = max(d.cursor for d in active_devices)
            consumed = self.audio_engine.seek_offset_seconds + (max_cursor / self.sample_rate)
            remaining = total_buffered - consumed
            timeout = max(60.0, remaining + 15.0)  # Dynamic timeout with 15s margin, at least 60s
        else:
            timeout = 60.0

        while not self.stop_event.is_set() and elapsed < timeout:
            total_buffered = len(self.audio_engine.master_buffer) / self.sample_rate
            active_devices = [
                d for d in self.audio_engine.devices.values()
                if d.active and d.thread and d.thread.is_alive()
            ]
            if not active_devices:
                # Not playing — don't wait
                break
            max_cursor = max(d.cursor for d in active_devices)
            consumed = self.audio_engine.seek_offset_seconds + (max_cursor / self.sample_rate)
            remaining = total_buffered - consumed
            if remaining <= 0.2:  # 200ms margin
                break
            time.sleep(poll_interval)
            elapsed += poll_interval

    # ── Queue management ─────────────────────────────────────────────────────

    def on_track_finished(self):
        """Advance the queue when the current track ends naturally.

        Iterative — not recursive — to avoid stack overflow when many
        queued YouTube tracks fail to resolve.
        """
        while self.queue:
            next_track = self.queue.pop(0)
            logger.info(f"Advancing queue → {next_track.get('title')!r}")

            if next_track.get("is_local"):
                self.play_track(next_track)
                self._notify_state_changed()
                return

            full_info = self.get_track_info(next_track.get("url"))
            if full_info:
                self.play_track(full_info)
                self._notify_state_changed()
                return

            logger.error(f"Could not load {next_track.get('title')!r} — skipping.")

        # Queue exhausted — stop cleanly
        logger.info("Queue exhausted. Stopping playback engine.")
        self.current_track = None
        # Stop the engine so is_playing → False and UI shows correct state
        self.audio_engine.pause()
        self.audio_engine.clear_buffer()
        self._notify_state_changed()

    def _notify_state_changed(self):
        """Fire the registered state-change callback (set by main.py)."""
        if callable(self.on_state_changed):
            try:
                self.on_state_changed()
            except Exception as e:
                logger.error(f"Error in state-change callback: {e}")

    def add_to_queue(self, track):
        self.queue.append(track)
        logger.info(f"Added to queue: {track.get('title')!r}")

    def remove_from_queue(self, track_id):
        self.queue = [t for t in self.queue if t.get("id") != track_id]
        logger.info(f"Removed from queue: {track_id!r}")

    def reorder_queue(self, new_order_ids):
        id_to_track = {t.get("id"): t for t in self.queue}
        self.queue = [id_to_track[tid] for tid in new_order_ids if tid in id_to_track]
        logger.info("Queue reordered")

    def clear_queue(self):
        self.queue = []
        logger.info("Queue cleared")


# Global streamer instance
from audio_engine import audio_engine
streamer = AudioStreamer(audio_engine)
