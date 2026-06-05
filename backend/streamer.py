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

        # ── Anti-bot bypass configuration ────────────────────────────────────
        # YouTube bot detection bypass WITHOUT needing browser cookies.
        # 'tv_embedded' and 'mweb' are YouTube internal API clients that YouTube
        # does not aggressively protect with bot checks, unlike the 'web' client.
        _common_anti_bot = {
            # Realistic browser user-agent so requests look like a real browser
            'http_headers': {
                'User-Agent': (
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                    'AppleWebKit/537.36 (KHTML, like Gecko) '
                    'Chrome/125.0.0.0 Safari/537.36'
                ),
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            # android_embedded is the most reliable client for bypassing bot checks
            # on both search and playback. tv_embedded is kept as fallback.
            'extractor_args': {
                'youtube': {
                    'player_client': ['android_embedded', 'tv_embedded', 'android', 'web'],
                    'player_skip': ['webpage', 'configs', 'js'],
                }
            },
        }

        # Dynamic cookies check to bypass cloud IP blocks (e.g. Render)
        import sys

        # Check for YOUTUBE_COOKIES env variable first (Render/cloud deployment friendly)
        youtube_cookies_env = os.getenv("YOUTUBE_COOKIES")
        if youtube_cookies_env:
            try:
                temp_cookies_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
                os.makedirs(temp_cookies_dir, exist_ok=True)
                temp_cookies_path = os.path.join(temp_cookies_dir, "cookies_env.txt")
                with open(temp_cookies_path, "w", encoding="utf-8") as f:
                    f.write(youtube_cookies_env)
                logger.info(f"Loaded YouTube cookies from YOUTUBE_COOKIES env var")
                _common_anti_bot['cookiefile'] = temp_cookies_path
            except Exception as cookies_err:
                logger.error(f"Failed to write YOUTUBE_COOKIES env var: {cookies_err}")
        else:
            # Check for manual cookies.txt file
            if getattr(sys, 'frozen', False):
                cookies_path = os.path.join(os.path.dirname(sys.executable), "cookies.txt")
            else:
                cookies_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cookies.txt")

            if os.path.exists(cookies_path):
                logger.info(f"Using YouTube cookies from: {cookies_path}")
                _common_anti_bot['cookiefile'] = cookies_path
            else:
                # Auto-detect browser cookies on local installs (Windows desktop).
                # yt-dlp reads directly from the browser's cookie store — no manual
                # export needed. Works as long as the user is logged into YouTube
                # in any of these browsers.
                _browsers = ['chrome', 'edge', 'firefox', 'brave', 'opera', 'chromium']
                for _browser in _browsers:
                    try:
                        _test_opts = {
                            'cookiesfrombrowser': (_browser, None, None, None),
                            'quiet': True, 'no_warnings': True,
                        }
                        with yt_dlp.YoutubeDL(_test_opts) as _ydl:
                            _jar = _ydl.cookiejar
                            _yt_cookies = [
                                c for c in _jar
                                if 'youtube.com' in c.domain or 'google.com' in c.domain
                            ]
                        if _yt_cookies:
                            _common_anti_bot['cookiesfrombrowser'] = (_browser, None, None, None)
                            logger.info(
                                f"Auto-detected {len(_yt_cookies)} YouTube cookies from {_browser}"
                            )
                            break
                    except Exception:
                        pass  # browser not installed or no cookies

        # Proxy check (helpful for Render/datacenter IP bans)
        youtube_proxy_env = os.getenv("YOUTUBE_PROXY") or os.getenv("PROXY_URL")
        if youtube_proxy_env:
            logger.info(f"Routing YouTube traffic via proxy: {youtube_proxy_env}")
            _common_anti_bot['proxy'] = youtube_proxy_env

        # Options for searching — use extract_flat for speed; avoids full
        # format resolution which is a second choke-point for bot detection.
        self.search_opts = {
            **_common_anti_bot,
            'format': 'bestaudio/best',
            'noplaylist': True,
            'quiet': True,
            'no_warnings': True,
            'extract_flat': 'in_playlist',  # only fetch video metadata, not stream URLs
            'skip_download': True,
            'ignoreerrors': True,           # skip unplayable/age-gated entries silently
        }

        # Options for extracting a real stream URL — try ios first (very low bot detection),
        # then android_embedded, then tv_embedded, then android as last yt-dlp attempt.
        self.stream_opts = {
            **_common_anti_bot,
            'format': 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/best',
            'noplaylist': True,
            'quiet': True,
            'no_warnings': True,
            'skip_download': True,
            'ignoreerrors': True,
            'extractor_args': {
                'youtube': {
                    'player_client': ['ios', 'mweb', 'android_embedded', 'tv_embedded', 'android'],
                    'player_skip': ['webpage', 'configs'],
                }
            },
        }

    def _build_track_entry(self, video_id, title, duration, uploader):
        """Build a standard track metadata dict from components."""
        return {
            "id": video_id,
            "title": title,
            "duration": duration,
            "uploader": uploader or "Unknown Artist",
            "url": f"https://www.youtube.com/watch?v={video_id}",
            "thumbnail": f"https://img.youtube.com/vi/{video_id}/mqdefault.jpg",
        }

    def search_invidious_fallback(self, query):
        """Fallback to searching via Invidious public instances if yt-dlp is blocked."""
        import urllib.parse
        import urllib.request
        import json
        import re

        # Expanded list of active Invidious instances (checked June 2025)
        instances = [
            "https://yewtu.be",
            "https://invidious.flokinet.to",
            "https://invidious.projectsegfau.lt",
            "https://inv.tux.im",
            "https://invidious.privacydev.net",
            "https://vid.priv.au",
            "https://invidious.perennialte.ch",
            "https://invidious.io.lol",
        ]
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}

        video_id_match = re.search(
            r'(?:v=|\/embed\/|\/v\/|youtu\.be\/|\/watch\?v=|&v=)([a-zA-Z0-9_-]{11})', query
        )
        video_id = video_id_match.group(1) if video_id_match else None

        if video_id:
            for instance in instances:
                try:
                    req = urllib.request.Request(
                        f"{instance}/api/v1/videos/{video_id}", headers=headers
                    )
                    with urllib.request.urlopen(req, timeout=6) as resp:
                        item = json.loads(resp.read().decode('utf-8'))
                        logger.info(f"Invidious video info OK ({instance})")
                        return [self._build_track_entry(
                            video_id,
                            item.get("title", "Unknown"),
                            item.get("lengthSeconds", 0),
                            item.get("author"),
                        )]
                except Exception as e:
                    logger.warning(f"Invidious {instance} video info failed: {e}")
        else:
            encoded_query = urllib.parse.quote(query)
            for instance in instances:
                try:
                    req = urllib.request.Request(
                        f"{instance}/api/v1/search?q={encoded_query}&type=video",
                        headers=headers,
                    )
                    with urllib.request.urlopen(req, timeout=6) as resp:
                        data = json.loads(resp.read().decode('utf-8'))
                        results = [
                            self._build_track_entry(
                                item.get("videoId"),
                                item.get("title", "Unknown"),
                                item.get("lengthSeconds", 0),
                                item.get("author"),
                            )
                            for item in data[:5]
                            if item.get("type") == "video" and item.get("videoId")
                        ]
                        if results:
                            logger.info(f"Invidious search OK ({instance}): {len(results)} results")
                            return results
                except Exception as e:
                    logger.warning(f"Invidious {instance} search failed: {e}")

        logger.warning("All Invidious instances failed. Trying Piped API fallback...")
        return self.search_piped_fallback(query)

    def search_piped_fallback(self, query):
        """Last-resort fallback using Piped.video public API instances."""
        import urllib.parse
        import urllib.request
        import json
        import re

        piped_instances = [
            "https://pipedapi.kavin.rocks",
            "https://pipedapi.adminforge.de",
            "https://pipedapi.coldify.de",
            "https://piped-api.garudalinux.org",
        ]
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        encoded_query = urllib.parse.quote(query)

        for instance in piped_instances:
            try:
                req = urllib.request.Request(
                    f"{instance}/search?q={encoded_query}&filter=videos",
                    headers=headers,
                )
                with urllib.request.urlopen(req, timeout=6) as resp:
                    data = json.loads(resp.read().decode('utf-8'))
                    items = data.get("items", [])
                    results = []
                    for item in items[:5]:
                        v_url = item.get("url", "")
                        # Piped returns /watch?v=VIDEO_ID format
                        vid_match = re.search(r'[?&]v=([a-zA-Z0-9_-]{11})', v_url)
                        if not vid_match:
                            continue
                        v_id = vid_match.group(1)
                        results.append(self._build_track_entry(
                            v_id,
                            item.get("title", "Unknown"),
                            item.get("duration", 0),
                            item.get("uploaderName"),
                        ))
                    if results:
                        logger.info(f"Piped search OK ({instance}): {len(results)} results")
                        return results
            except Exception as e:
                logger.warning(f"Piped instance {instance} failed: {e}")

        logger.error("All fallback search attempts exhausted (yt-dlp + Invidious + Piped).")
        return []

    def _parse_ydl_entries(self, info):
        """Extract a list of track dicts from a yt-dlp info dict."""
        entries = info.get("entries") or [info]
        results = []
        for entry in entries[:5]:
            if not entry or not entry.get("id"):
                continue
            results.append({
                "id": entry.get("id"),
                "title": entry.get("title") or "Unknown",
                "duration": entry.get("duration", 0),
                "uploader": entry.get("uploader") or entry.get("channel") or "Unknown Artist",
                "url": f"https://www.youtube.com/watch?v={entry.get('id')}",
                "thumbnail": entry.get("thumbnail")
                    or f"https://img.youtube.com/vi/{entry.get('id')}/mqdefault.jpg",
            })
        return results

    def _ydl_search(self, search_prefix, query):
        """Try a single yt-dlp search prefix (e.g. 'ytsearch5' or 'ytmsearch5').
        Returns a list of track dicts, or empty list on failure."""
        try:
            with yt_dlp.YoutubeDL(self.search_opts) as ydl:
                res = ydl.extract_info(f"{search_prefix}:{query}", download=False)
                if res and 'entries' in res:
                    results = self._parse_ydl_entries(res)
                    if results:
                        return results
        except Exception as e:
            logger.warning(f"yt-dlp search failed with prefix '{search_prefix}': {e}")
        return []

    def search_youtube(self, query):
        """Search YouTube or resolve direct URL, return metadata for top matches.

        Search strategy (most to least reliable):
          1. Direct URL → yt-dlp extraction
          2. ytsearch5 (YouTube Web) via android_embedded client
          3. ytmsearch5 (YouTube Music) — different API endpoint, often not bot-blocked
          4. Invidious public API instances
          5. Piped public API instances
        """
        logger.info(f"Searching YouTube for: {query}")
        query_str = query.strip()
        is_url = (
            query_str.startswith("http://")
            or query_str.startswith("https://")
            or "youtube.com" in query_str
            or "youtu.be" in query_str
        )

        if is_url:
            try:
                with yt_dlp.YoutubeDL(self.search_opts) as ydl:
                    info = ydl.extract_info(query_str, download=False)
                    if info:
                        results = self._parse_ydl_entries(info)
                        if results:
                            return results
            except Exception as e:
                logger.warning(f"yt-dlp URL extraction failed: {e}")
            # URL extraction failed — fall through to Invidious with video ID
            return self.search_invidious_fallback(query_str)

        # ── Keyword search: try multiple strategies in order ─────────────────

        # Strategy 1: ytsearch (standard YouTube search)
        results = self._ydl_search("ytsearch5", query_str)
        if results:
            logger.info(f"ytsearch5 returned {len(results)} results")
            return results

        # Strategy 2: YouTube Music search (separate API endpoint, less bot-filtered)
        logger.info("ytsearch5 failed — trying YouTube Music (ytmsearch5)...")
        results = self._ydl_search("ytmsearch5", query_str)
        if results:
            logger.info(f"ytmsearch5 returned {len(results)} results")
            return results

        # Strategy 3: Invidious + Piped fallbacks
        logger.info("yt-dlp search failed entirely — falling back to Invidious/Piped API...")
        return self.search_invidious_fallback(query_str)

    def _extract_video_id(self, url):
        """Extract the 11-character YouTube video ID from a URL."""
        import re
        match = re.search(r'(?:v=|youtu\.be/|/embed/|/v/)([a-zA-Z0-9_-]{11})', url)
        return match.group(1) if match else None

    def _get_stream_via_invidious(self, video_id, title_hint="", uploader_hint=""):
        """Try to get a playable audio stream URL from Invidious API."""
        import urllib.request, json
        instances = [
            "https://yewtu.be",
            "https://invidious.flokinet.to",
            "https://invidious.projectsegfau.lt",
            "https://inv.tux.im",
            "https://invidious.privacydev.net",
            "https://vid.priv.au",
            "https://invidious.perennialte.ch",
            "https://invidious.io.lol",
        ]
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        for instance in instances:
            try:
                req = urllib.request.Request(
                    f"{instance}/api/v1/videos/{video_id}?fields=title,author,lengthSeconds,adaptiveFormats,formatStreams",
                    headers=headers,
                )
                with urllib.request.urlopen(req, timeout=7) as resp:
                    data = json.loads(resp.read().decode('utf-8'))

                # Prefer audio-only adaptive formats (opus/webm), sorted by bitrate
                adaptive = data.get("adaptiveFormats", [])
                audio_formats = [
                    f for f in adaptive
                    if f.get("type", "").startswith("audio/")
                    and f.get("url")
                ]
                if not audio_formats:
                    # Fall back to muxed formatStreams
                    audio_formats = [f for f in data.get("formatStreams", []) if f.get("url")]

                if not audio_formats:
                    continue

                audio_formats.sort(key=lambda f: int(f.get("bitrate", 0)), reverse=True)
                stream_url = audio_formats[0]["url"]
                logger.info(f"Invidious stream URL resolved ({instance}): {data.get('title')}")
                return {
                    "id": video_id,
                    "title": data.get("title") or title_hint or "Unknown",
                    "duration": data.get("lengthSeconds", 0),
                    "uploader": data.get("author") or uploader_hint or "Unknown Artist",
                    "stream_url": stream_url,
                    "url": f"https://www.youtube.com/watch?v={video_id}",
                    "thumbnail": f"https://img.youtube.com/vi/{video_id}/mqdefault.jpg",
                    "http_headers": None,
                }
            except Exception as e:
                logger.warning(f"Invidious stream fetch failed ({instance}): {e}")
        return None

    def _get_stream_via_piped(self, video_id, title_hint="", uploader_hint=""):
        """Try to get a playable audio stream URL from Piped API."""
        import urllib.request, json
        piped_instances = [
            "https://pipedapi.kavin.rocks",
            "https://pipedapi.adminforge.de",
            "https://pipedapi.coldify.de",
            "https://piped-api.garudalinux.org",
            "https://pipedapi.tokhmi.xyz",
            "https://api.piped.projectsegfau.lt",
            "https://pipedapi.moomoo.me",
        ]
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        for instance in piped_instances:
            try:
                req = urllib.request.Request(
                    f"{instance}/streams/{video_id}", headers=headers
                )
                with urllib.request.urlopen(req, timeout=7) as resp:
                    data = json.loads(resp.read().decode('utf-8'))

                audio_streams = data.get("audioStreams", [])
                if not audio_streams:
                    continue

                # Sort by bitrate descending
                audio_streams.sort(key=lambda s: s.get("bitrate", 0), reverse=True)
                stream_url = audio_streams[0].get("url")
                if not stream_url:
                    continue

                logger.info(f"Piped stream URL resolved ({instance}): {data.get('title')}")
                return {
                    "id": video_id,
                    "title": data.get("title") or title_hint or "Unknown",
                    "duration": data.get("duration", 0),
                    "uploader": data.get("uploader") or uploader_hint or "Unknown Artist",
                    "stream_url": stream_url,
                    "url": f"https://www.youtube.com/watch?v={video_id}",
                    "thumbnail": f"https://img.youtube.com/vi/{video_id}/mqdefault.jpg",
                    "http_headers": None,
                }
            except Exception as e:
                logger.warning(f"Piped stream fetch failed ({instance}): {e}")
        return None

    def get_track_info(self, url, title_hint="", uploader_hint=""):
        """Extract stream URL and metadata for a YouTube video URL.

        Extraction strategy:
          1. yt-dlp with android_embedded client
          2. Invidious API (direct audio stream URLs)
          3. Piped API (direct audio stream URLs)
        """
        logger.info(f"Extracting info for URL: {url}")
        video_id = self._extract_video_id(url)

        # ── Strategy 1: yt-dlp ──────────────────────────────────────────────
        try:
            with yt_dlp.YoutubeDL(self.stream_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                if info:
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

                    if stream_url:
                        logger.info(f"yt-dlp resolved stream for: {info.get('title')}")
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
            logger.warning(f"yt-dlp stream extraction failed: {e}")

        if not video_id:
            logger.error("Could not parse video ID from URL — cannot use API fallbacks")
            return None

        # ── Strategy 2: Invidious ────────────────────────────────────────────
        logger.info(f"yt-dlp blocked for playback — trying Invidious API for {video_id}...")
        result = self._get_stream_via_invidious(video_id, title_hint, uploader_hint)
        if result:
            return result

        # ── Strategy 3: Piped ────────────────────────────────────────────────
        logger.info(f"Invidious failed — trying Piped API for {video_id}...")
        result = self._get_stream_via_piped(video_id, title_hint, uploader_hint)
        if result:
            return result

        logger.error(f"All stream extraction strategies failed for {video_id}")
        return None

    # ── Playback control ─────────────────────────────────────────────────────

    def play_track(self, track_info, start_seconds=0, keep_seek_offset=False):
        """Start streaming and decoding an audio track into the audio engine."""
        self.stop_track(keep_seek_offset=keep_seek_offset)

        self.current_track = track_info
        self.stop_event.clear()

        self.download_thread = threading.Thread(
            target=self._stream_decode_loop,
            args=(track_info, start_seconds),
            daemon=True,
        )
        self.download_thread.start()

    def stop_track(self, keep_seek_offset=False):
        """Stop the current decode thread, clear buffer, and reset state."""
        self.stop_event.set()
        if self.download_thread and self.download_thread.is_alive():
            self.download_thread.join(timeout=2.0)
        self.download_thread = None
        self.audio_engine.clear_buffer(keep_seek_offset=keep_seek_offset)
        if not keep_seek_offset:
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
            '-vn',
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
                from audio_engine import PORTAUDIO_AVAILABLE
                # In cloud mode, pause decoding if master is paused
                if not PORTAUDIO_AVAILABLE and not self.audio_engine.is_playing:
                    time.sleep(0.05)
                    continue

                # ── Buffer regulation ──────────────────────────────────────
                # Measure how far ahead we are versus the SLOWEST active device.
                # Using the slowest (min cursor) guards against one device being
                # paused/failed and causing runaway buffering.
                total_buffered = len(self.audio_engine.master_buffer) / self.sample_rate

                if not PORTAUDIO_AVAILABLE:
                    slowest_progress = self.audio_engine.get_play_progress()
                    cached_ahead = total_buffered - slowest_progress
                    if cached_ahead > 5.0:
                        time.sleep(PACE_CHECK_SLEEP)
                        continue
                else:
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
            if not self.audio_engine.is_playing:
                time.sleep(poll_interval)
                continue

            total_buffered = len(self.audio_engine.master_buffer) / self.sample_rate
            active_devices = [
                d for d in self.audio_engine.devices.values()
                if d.active and d.thread and d.thread.is_alive()
            ]
            if not active_devices:
                # Not playing and no active devices under active play state -> break
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
