import numpy as np
import threading
import time
import re
import logging
import os
import json

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("AudioEngine")

# Try to import sounddevice. If it fails (e.g. headless server without PortAudio),
# supply a MockSoundDevice fallback so uvicorn can run on Render.
try:
    import sounddevice as sd
    # Try querying devices to ensure PortAudio compiles and initializes
    sd.query_devices()
    PORTAUDIO_AVAILABLE = True
except (ImportError, OSError, Exception) as e:
    logger.warning(
        f"PortAudio/sounddevice failed to initialize: {e}. "
        "Running in headless/mock audio mode."
    )
    PORTAUDIO_AVAILABLE = False

    class MockOutputStream:
        def __init__(self, *args, **kwargs):
            self.sample_rate = kwargs.get('samplerate', 44100)
            self.channels = kwargs.get('channels', 2)

        def start(self):
            pass

        def stop(self):
            pass

        def close(self):
            pass

        def write(self, data):
            # Simulate real-time audio playback pacing by sleeping for the chunk duration
            num_frames = len(data)
            duration = num_frames / self.sample_rate
            time.sleep(duration)

    class MockSoundDevice:
        OutputStream = MockOutputStream

        def query_devices(self, *args, **kwargs):
            if kwargs.get('kind') == 'output':
                return {"name": "Mock Cloud Output", "index": 0, "default_samplerate": 44100}
            if kwargs.get('kind') == 'input':
                return {"name": "Mock Cloud Input", "index": 0}
            return [{"name": "Mock Cloud Output", "max_output_channels": 2, "hostapi": 0, "default_samplerate": 44100}]

        def query_hostapis(self):
            return [{"name": "Mock API"}]

        def rec(self, frames, samplerate, channels, **kwargs):
            return np.zeros((frames, channels), dtype='float32')

        def play(self, data, samplerate, **kwargs):
            pass

        def wait(self):
            pass

        def _terminate(self):
            pass

        def _initialize(self):
            pass

    sd = MockSoundDevice()


def clean_device_name(raw_name: str) -> str:
    """Extract a human-readable device name from a raw Windows audio device string.

    Windows Bluetooth (bthhfenum) exposes names in two formats:

    1. Bare driver path (older):
         '@System32\\drivers\\bthhfenum.sys,#2;%1 Hands-Free%0\\r\\r\\n;(AirPods Pro)'
    2. Prefixed with device-type (newer WASAPI):
         'Headset (@System32\\drivers\\bthhfenum.sys,#2;%1 Hands-Free%0 ;(BulletsWireless Z2 ENC))'
         'Output (@System32\\drivers\\bthhfenum.sys,#4;%1 Hands-Free HF Audio%0 ;(Unmeshjoshi))'

    In both cases the real alias lives after the LAST semicolon+paren pattern: ;(Real Name)
    """
    name = raw_name.strip()

    # Only apply Bluetooth parsing when this is a bthhfenum entry
    if 'bthhfenum' in name or ('@System32' in name and '%1' in name):
        # Primary: find ;(alias) — the semicolon-paren group is the real device name
        match = re.search(r';\(([^)]+)\)', name)
        if match:
            alias = match.group(1).strip()
            if alias:
                return alias
        # Fallback: find any (alias) that's not the driver path itself
        for m in reversed(re.findall(r'\(([^)]+)\)', name)):
            m = m.strip()
            if m and not m.startswith('@') and 'System32' not in m and '%' not in m:
                return m

    # Non-BT: strip trailing host-API suffixes like "(Windows WASAPI)"
    name = re.sub(
        r'\s*\((MME|Windows WASAPI|DirectSound|ASIO|Windows WDM-KS|WDM-KS)\)\s*$',
        '', name, flags=re.IGNORECASE
    ).strip()

    return name or raw_name


def is_real_headset(cleaned_name: str, raw_name: str) -> bool:
    """Filter out virtual system mappers, but allow all actual physical hardware endpoints."""
    raw_lower = raw_name.lower()

    # Filter out Windows system mappers
    if 'mapper' in raw_lower or 'primary sound' in raw_lower:
        return False

    alias = cleaned_name.strip()
    if not alias or len(alias) < 2:
        return False
    if alias.startswith('@') or '%' in alias or 'System32' in alias:
        return False

    return True


def detect_connection_type(cleaned_name: str, raw_name: str) -> str:
    """Detect whether a device is Bluetooth, USB, Wireless, Built-in Speaker, or Wired."""
    raw_lower = raw_name.lower()
    cleaned_lower = cleaned_name.lower()

    if 'bthhfenum' in raw_lower:
        return 'Bluetooth'
    if 'usb' in cleaned_lower or 'usb' in raw_lower:
        return 'USB'
    if 'wireless' in cleaned_lower:
        return 'Wireless'
    if 'speaker' in cleaned_lower or 'realtek' in cleaned_lower or 'intel' in raw_lower or 'high definition' in raw_lower:
        return 'Speaker'
    return 'Wired'


class AudioDevice:
    def __init__(self, index, name, sample_rate=44100, connection_type='Wired', channels=2):
        self.index = index
        self.name = name
        self.sample_rate = sample_rate
        self.connection_type = connection_type
        self.channels = channels
        self.volume = 1.0
        self.delay_ms = 0.0
        self.latency_ms = 0.0
        self.active = True
        self.stream = None
        self.thread = None
        self.stop_event = threading.Event()
        self.cursor = 0
        self.master_buffer = None
        # Lock only guards cursor and master_buffer pointer swaps — NOT held during I/O
        self.lock = threading.Lock()

    def start_playback(self, master_buffer, start_cursor=0):
        self.stop_playback(preserve_cursor=False)
        self.master_buffer = master_buffer
        self.stop_event.clear()
        self.cursor = start_cursor
        self.thread = threading.Thread(target=self._play_loop, daemon=True)
        self.thread.start()
        logger.info(
            f"Started playback thread for device {self.name} "
            f"(Index {self.index}) at cursor {start_cursor} with {self.channels} channels"
        )

    def stop_playback(self, preserve_cursor=True):
        """Stop the playback thread.

        Args:
            preserve_cursor: If True, keep the current cursor position so we can
                             resume from the same frame. If False, reset to 0.
        """
        self.stop_event.set()
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=2.0)
        if self.stream:
            try:
                self.stream.stop()
                self.stream.close()
            except Exception as e:
                logger.error(f"Error closing stream for {self.name}: {e}")
            self.stream = None
        self.thread = None
        if not preserve_cursor:
            self.cursor = 0
        logger.info(f"Stopped playback thread for device {self.name}")

    def _play_loop(self):
        try:
            device_index = self.index

            # Open output stream using native device channel support
            self.stream = sd.OutputStream(
                device=device_index,
                channels=self.channels,
                dtype='float32',
                samplerate=self.sample_rate,
                blocksize=1024,
            )
            self.stream.start()

            # Inject initial silence for delay compensation
            delay_samples = int((self.delay_ms / 1000.0) * self.sample_rate)
            if delay_samples > 0:
                silence_chunk = np.zeros((delay_samples, self.channels), dtype='float32')
                self.stream.write(silence_chunk)
                logger.info(
                    f"Injected {delay_samples} silence samples "
                    f"({self.delay_ms}ms delay) to device {self.name}"
                )

            chunk_size = 1024
            while not self.stop_event.is_set():
                # Read cursor and buffer length under lock — do NOT sleep while holding it
                with self.lock:
                    buf = self.master_buffer
                    cursor = self.cursor

                if buf is None:
                    time.sleep(0.005)
                    continue

                buffer_len = len(buf)
                if cursor >= buffer_len:
                    # Wait for more audio data from the decoder
                    time.sleep(0.005)
                    continue

                end_pos = min(cursor + chunk_size, buffer_len)
                chunk = buf[cursor:end_pos]

                # Advance cursor under lock
                with self.lock:
                    self.cursor = end_pos

                # Resample if native device rate differs from master rate (44100)
                if self.sample_rate != 44100 and len(chunk) > 0:
                    num_samples = len(chunk)
                    new_num_samples = int(num_samples * (self.sample_rate / 44100.0))
                    if new_num_samples > 0:
                        x = np.linspace(0, num_samples - 1, num_samples)
                        x_new = np.linspace(0, num_samples - 1, new_num_samples)
                        resampled = np.zeros((new_num_samples, 2), dtype='float32')
                        resampled[:, 0] = np.interp(x_new, x, chunk[:, 0])
                        resampled[:, 1] = np.interp(x_new, x, chunk[:, 1])
                        scaled_chunk = resampled * self.volume
                    else:
                        scaled_chunk = chunk * self.volume
                else:
                    scaled_chunk = chunk * self.volume

                # Adjust channel count to match native output device channels
                if self.channels == 1:
                    if scaled_chunk.ndim == 2 and scaled_chunk.shape[1] == 2:
                        scaled_chunk = np.mean(scaled_chunk, axis=1, keepdims=True)
                elif self.channels > 2:
                    padded = np.zeros((len(scaled_chunk), self.channels), dtype='float32')
                    padded[:, 0] = scaled_chunk[:, 0]
                    padded[:, 1] = scaled_chunk[:, 1]
                    scaled_chunk = padded

                self.stream.write(scaled_chunk.astype('float32'))

        except Exception as e:
            logger.error(f"Error in play loop for device {self.name}: {e}")
            self.active = False


class AudioEngine:
    def __init__(self):
        self.devices = {}        # index -> AudioDevice
        self.master_buffer = np.empty((0, 2), dtype='float32')
        self.buffer_lock = threading.Lock()
        self.sample_rate = 44100
        self.is_playing = False
        self.on_audio_data = None
        self._last_play_time = 0.0
        # Devices the user explicitly disconnected — keyed by NAME (stable across rescans)
        self._user_disconnected: set = set()
        # True after first websocket connects — new hot-plugged devices stay inactive
        self._startup_complete: bool = False
        import sys
        if getattr(sys, 'frozen', False):
            self.profiles_path = os.path.join(os.path.dirname(sys.executable), "profiles.json")
        else:
            self.profiles_path = os.path.join(os.path.dirname(__file__), "profiles.json")
        self.profiles = self.load_profiles()
        self._last_refresh_time = 0.0
        self.seek_offset_seconds = 0.0
        self.update_devices()

    def complete_startup(self):
        """Finalize the startup phase. Future discovered devices will start as inactive."""
        if not self._startup_complete:
            self._startup_complete = True
            logger.info("Startup phase complete. Newly arrived devices will default to inactive.")

    # ── Profile management ──────────────────────────────────────────────────────

    def load_profiles(self):
        if os.path.exists(self.profiles_path):
            try:
                with open(self.profiles_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.error(f"Error loading profiles: {e}")
        return {}

    def save_profiles(self):
        try:
            with open(self.profiles_path, "w", encoding="utf-8") as f:
                json.dump(self.profiles, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Error saving profiles: {e}")

    def apply_profile(self, dev):
        """Apply stored volume, delay, and latency profile to a device if present."""
        profile = self.profiles.get(dev.name, {})
        dev.volume = float(profile.get("volume", 1.0))
        dev.latency_ms = float(profile.get("latency_ms", 0.0))
        dev.delay_ms = float(profile.get("delay_ms", 0.0))
        logger.info(
            f"Loaded profile for {dev.name!r}: "
            f"vol={dev.volume:.2f}, delay={dev.delay_ms:.1f}ms, latency={dev.latency_ms:.1f}ms"
        )

    # ── Device discovery ────────────────────────────────────────────────────────

    def get_available_devices(self):
        """Query host system output devices, deduplicated by cleaned name.

        Returns an empty list when running in cloud/headless mode (no PortAudio),
        so the mock device never appears in the UI.
        """
        if not PORTAUDIO_AVAILABLE:
            return []

        try:
            # Refresh PortAudio device cache only when idle and stale
            now = time.time()
            if not self.is_playing and (now - self._last_refresh_time > 5.0):
                try:
                    logger.debug("Refreshing Windows PortAudio device cache...")
                    sd._terminate()
                    sd._initialize()
                    self._last_refresh_time = now
                except Exception as term_err:
                    logger.warning(f"Error re-initializing sounddevice: {term_err}")

            device_info = sd.query_devices()
            host_apis = sd.query_hostapis()
            api_name_map = {i: ha['name'].lower() for i, ha in enumerate(host_apis)}

            # Priority: WASAPI > DirectSound > MME > other  (WDM-KS excluded)
            HOST_API_PRIORITY = {
                'wasapi': 0,
                'directsound': 1,
                'mme': 2,
            }

            best: dict = {}
            for i, dev in enumerate(device_info):
                if dev['max_output_channels'] <= 0:
                    continue

                api_name = api_name_map.get(dev.get('hostapi', -1), '')

                # Exclude WDM-KS — blocking API not supported (PaErrorCode -9999)
                if 'wdm-ks' in api_name:
                    continue

                cleaned = clean_device_name(dev['name'])
                if not is_real_headset(cleaned, dev['name']):
                    continue

                priority = next(
                    (prio for key, prio in HOST_API_PRIORITY.items() if key in api_name),
                    99
                )

                existing = best.get(cleaned)
                if existing is None or priority < existing['_priority']:
                    best[cleaned] = {
                        "index": i,
                        "name": cleaned,
                        "raw_name": dev['name'],
                        "sample_rate": int(dev['default_samplerate']),
                        "channels": min(dev['max_output_channels'], 2),  # cap at stereo
                        "connection_type": detect_connection_type(cleaned, dev['name']),
                        "_priority": priority,
                    }

            output_devices = sorted(best.values(), key=lambda d: d['index'])
            for d in output_devices:
                d.pop('_priority', None)
            return output_devices

        except Exception as e:
            logger.error(f"Error querying audio devices: {e}")
            return []

    def update_devices(self):
        """Re-sync system devices with our active device map.

        Rules:
        - Startup scan  → the system default device activates automatically.
        - Startup scan  → all other devices start inactive.
        - Later rescans → existing devices keep their current state.
        - Later rescans → brand-new devices start inactive.
        - User-disconnected devices remain disconnected across rescans.
        """
        sys_devices = self.get_available_devices()

        try:
            default_info = sd.query_devices(kind='output')
            default_cleaned = clean_device_name(default_info['name'])
            
            # Only log system default device if it changed or on startup
            if not hasattr(self, '_prev_default_device') or self._prev_default_device != default_cleaned:
                logger.info(f"System default playback device: {default_cleaned!r}")
                self._prev_default_device = default_cleaned
            else:
                logger.debug(f"System default playback device: {default_cleaned!r}")
        except Exception as e:
            default_cleaned = None
            logger.warning(f"Could not query default system device: {e}")

        existing_by_name = {d.name: d for d in self.devices.values()}
        new_device_map = {}
        devices_changed = False

        for dev in sys_devices:
            idx = dev['index']
            name = dev['name']
            conn_type = dev.get('connection_type', 'Wired')
            sr = dev.get('sample_rate', 44100)
            channels = dev.get('channels', 2)

            if name in existing_by_name:
                # Known device — preserve state, refresh metadata only
                existing = existing_by_name[name]
                existing.index = idx
                existing.connection_type = conn_type
                existing.sample_rate = sr
                existing.channels = channels
                new_device_map[idx] = existing
                
                # Downgrade periodic check of existing devices to debug
                logger.debug(
                    f"{'Startup' if not self._startup_complete else 'Hot-plug'} device: "
                    f"{name!r} ({conn_type}) active={existing.active}"
                )
            else:
                # New device (first time seen)
                new_dev = AudioDevice(idx, name, sr, conn_type, channels)
                self.apply_profile(new_dev)
                if not self._startup_complete:
                    is_default = bool(default_cleaned and name == default_cleaned)
                    new_dev.active = is_default and (name not in self._user_disconnected)
                else:
                    new_dev.active = False
                new_device_map[idx] = new_dev
                devices_changed = True
                logger.info(
                    f"{'Startup' if not self._startup_complete else 'Hot-plug'} NEW device: "
                    f"{name!r} ({conn_type}) active={new_dev.active}"
                )

        # Check if any device was removed
        removed_devices = set(existing_by_name.keys()) - set(d['name'] for d in sys_devices)
        if removed_devices:
            devices_changed = True
            logger.info(f"Devices removed: {removed_devices}")

        # Check if the active devices changed
        old_active = set(d.name for d in self.devices.values() if d.active)
        new_active = set(d.name for d in new_device_map.values() if d.active)

        self.devices = new_device_map
        self.recalculate_delays()
        
        # Only log active devices when the active set changes, during changes, or on startup
        if old_active != new_active or devices_changed or not self._startup_complete:
            logger.info(f"Active devices: {list(new_active)}")

    def refresh_devices_safely(self):
        """Force PortAudio cache refresh and re-scan devices.

        If playing, captures current cursors, stops all streams, re-initializes
        PortAudio, rescans, then resumes from exactly the same frame positions.
        """
        was_playing = self.is_playing
        if was_playing:
            logger.info("Temporarily pausing playback to refresh PortAudio cache...")
            active_cursors = {}
            for idx, dev in self.devices.items():
                if dev.active and dev.thread:
                    with dev.lock:
                        active_cursors[dev.name] = dev.cursor
                    dev.stop_playback(preserve_cursor=True)

            try:
                sd._terminate()
                sd._initialize()
                self._last_refresh_time = time.time()
                logger.info("PortAudio cache re-initialized during active playback.")
            except Exception as term_err:
                logger.error(f"Failed to re-initialize PortAudio: {term_err}")

            self.update_devices()

            with self.buffer_lock:
                for idx, dev in self.devices.items():
                    if dev.active:
                        old_cursor = active_cursors.get(dev.name, 0)
                        dev.start_playback(self.master_buffer, start_cursor=old_cursor)
        else:
            try:
                sd._terminate()
                sd._initialize()
                self._last_refresh_time = time.time()
                logger.info("PortAudio cache re-initialized.")
            except Exception as term_err:
                logger.error(f"Failed to re-initialize PortAudio: {term_err}")
            self.update_devices()

    # ── Delay / latency ─────────────────────────────────────────────────────────

    def recalculate_delays(self):
        """Recalculate delay_ms for all active devices based on their calibrated latency."""
        active_devices = [d for d in self.devices.values() if d.active]
        has_latency = any(getattr(d, 'latency_ms', 0.0) > 0.0 for d in active_devices)
        if not has_latency:
            return

        max_latency = max(getattr(d, 'latency_ms', 0.0) for d in active_devices)
        for d in active_devices:
            dev_latency = getattr(d, 'latency_ms', 0.0)
            if dev_latency > 0.0:
                profile = self.profiles.get(d.name, {})
                manual_offset = float(profile.get("manual_offset", 0.0))
                new_delay = max(0.0, (max_latency - dev_latency) + manual_offset)
                if new_delay != d.delay_ms:
                    old_delay = d.delay_ms
                    d.delay_ms = new_delay
                    logger.info(
                        f"Delay for {d.name!r} updated {old_delay:.1f}ms → {new_delay:.1f}ms "
                        f"(latency={dev_latency:.1f}ms, offset={manual_offset:.1f}ms)"
                    )
                    if d.thread and self.is_playing:
                        with self.buffer_lock:
                            current_cursor = d.cursor
                            d.start_playback(self.master_buffer, start_cursor=current_cursor)

    # ── Device control ──────────────────────────────────────────────────────────

    def toggle_device(self, index, active):
        if index not in self.devices:
            logger.warning(f"toggle_device: index {index} not found")
            return
        dev = self.devices[index]
        dev.active = active
        logger.info(f"Device {dev.name!r} set active={active}")

        if active:
            self._user_disconnected.discard(dev.name)
        else:
            self._user_disconnected.add(dev.name)

        self.recalculate_delays()

        if active and self.is_playing:
            with self.buffer_lock:
                active_threads = [d for d in self.devices.values() if d.active and d.thread]
                new_cursor = min(d.cursor for d in active_threads) if active_threads else 0
                dev.start_playback(self.master_buffer, start_cursor=new_cursor)
        elif not active:
            dev.stop_playback(preserve_cursor=False)

    def set_device_volume(self, index, volume):
        if index not in self.devices:
            return
        dev = self.devices[index]
        dev.volume = max(0.0, min(1.0, volume))
        profile = self.profiles.setdefault(dev.name, {})
        profile["volume"] = dev.volume
        self.save_profiles()
        logger.info(f"Volume for {dev.name!r} set to {dev.volume:.2f}")

    def set_device_delay(self, index, delay_ms):
        if index not in self.devices:
            return
        dev = self.devices[index]
        if getattr(dev, 'latency_ms', 0.0) > 0.0:
            active_devices = [d for d in self.devices.values() if d.active]
            max_latency = max(getattr(d, 'latency_ms', 0.0) for d in active_devices) if active_devices else dev.latency_ms
            base_delay = max_latency - dev.latency_ms
            manual_offset = delay_ms - base_delay
            profile = self.profiles.setdefault(dev.name, {})
            profile["manual_offset"] = manual_offset
            profile["delay_ms"] = delay_ms
            dev.delay_ms = max(0.0, delay_ms)
        else:
            profile = self.profiles.setdefault(dev.name, {})
            profile["delay_ms"] = delay_ms
            profile["manual_offset"] = 0.0
            dev.delay_ms = max(0.0, delay_ms)

        self.save_profiles()
        logger.info(f"Delay for {dev.name!r} set to {dev.delay_ms}ms")

        if dev.active and self.is_playing:
            with self.buffer_lock:
                current_cursor = dev.cursor
                dev.start_playback(self.master_buffer, start_cursor=current_cursor)

    def reset_device_profile(self, index):
        """Reset a device's volume, delay, and latency settings to defaults."""
        if index not in self.devices:
            return {"success": False, "error": "Device not found."}
        dev = self.devices[index]
        dev.volume = 1.0
        dev.delay_ms = 0.0
        dev.latency_ms = 0.0
        if dev.name in self.profiles:
            del self.profiles[dev.name]
            self.save_profiles()
        self.recalculate_delays()
        if dev.active and self.is_playing:
            with self.buffer_lock:
                current_cursor = dev.cursor
                dev.start_playback(self.master_buffer, start_cursor=current_cursor)
        return {"success": True}

    # ── Calibration ─────────────────────────────────────────────────────────────

    def calibrate_device(self, index):
        """Measure round-trip latency of the selected device using a sweep chirp.

        Returns a dict: {"success": bool, "latency_ms": float, "confidence": float, "error": str}
        """
        if index not in self.devices:
            return {"success": False, "error": "Device not found."}
        dev = self.devices[index]

        try:
            mic_info = sd.query_devices(kind='input')
            mic_index = mic_info['index']
            logger.info(f"Using default input device: {mic_info['name']} (Index {mic_index})")
        except Exception as e:
            logger.error(f"No microphone detected: {e}")
            return {"success": False, "error": "No default microphone detected. Please plug in or enable a mic."}

        was_playing = self.is_playing
        if was_playing:
            self.pause()
            time.sleep(0.2)

        original_volume = dev.volume
        try:
            self.set_device_volume(index, 0.85)

            sr = 44100
            duration = 0.15
            t = np.linspace(0, duration, int(sr * duration), endpoint=False)
            f0, f1 = 1000.0, 5000.0
            chirp = np.sin(2 * np.pi * (f0 + (f1 - f0) * t / (2 * duration)) * t).astype('float32')
            chirp *= np.hanning(len(chirp))
            chirp_stereo = np.column_stack((chirp, chirp))

            rec_duration = 1.5
            rec_frames = int(rec_duration * sr)
            logger.info(f"Starting auto-calibration for {dev.name!r}...")

            recorded = sd.rec(
                frames=rec_frames,
                samplerate=sr,
                channels=1,
                device=mic_index,
                dtype='float32',
            )
            time.sleep(0.1)
            sd.play(chirp_stereo, samplerate=sr, device=dev.index)
            sd.wait()

            recorded_mono = recorded.flatten()
            correlation = np.correlate(recorded_mono, chirp, mode='valid')
            abs_correlation = np.abs(correlation)
            peak_idx = int(np.argmax(abs_correlation))
            peak_val = abs_correlation[peak_idx]
            mean_val = np.mean(abs_correlation)
            std_val = np.std(abs_correlation)
            confidence = float((peak_val - mean_val) / std_val) if std_val > 0 else 0.0

            logger.info(f"Calibration analysis: peak_index={peak_idx}, confidence={confidence:.2f}")

            if confidence < 4.0:
                logger.warning(f"Calibration signal too weak: confidence={confidence:.2f}")
                return {
                    "success": False,
                    "error": "Signal too weak. Place headset closer to your microphone and try again in a quiet room.",
                }

            latency_ms = (peak_idx / sr) * 1000.0 - 100.0
            if latency_ms < 10.0 or latency_ms > 1000.0:
                return {
                    "success": False,
                    "error": f"Implausible latency ({latency_ms:.0f}ms). Make sure you selected the correct headset and retry.",
                }

            dev.latency_ms = float(latency_ms)
            profile = self.profiles.setdefault(dev.name, {})
            profile["latency_ms"] = dev.latency_ms
            self.recalculate_delays()
            self.save_profiles()

            return {"success": True, "latency_ms": dev.latency_ms, "confidence": confidence}

        except Exception as e:
            logger.error(f"Error during calibration: {e}")
            return {"success": False, "error": f"System error: {e}"}

        finally:
            self.set_device_volume(index, original_volume)
            if was_playing:
                self.play()

    # ── Buffer management ───────────────────────────────────────────────────────

    def append_audio_data(self, numpy_data):
        """Append decoded stereo float32 numpy data to master buffer.
        Includes a memory-safe historical pruning mechanism to support infinite/10+ hour continuous streaming.
        """
        with self.buffer_lock:
            if numpy_data.ndim == 1:
                numpy_data = np.column_stack((numpy_data, numpy_data))

            # Memory protection: prune played history if it grows excessively large (e.g., > 15 minutes of played history)
            # This handles 1-10+ hour streams cleanly by capping memory usage at ~350 MB maximum.
            active_devices = [d for d in self.devices.values() if d.active and d.thread]
            min_cursor = min(d.cursor for d in active_devices) if active_devices else 0
            
            PRUNE_THRESHOLD = self.sample_rate * 60 * 16  # 16 minutes
            if min_cursor > PRUNE_THRESHOLD:
                # Keep 1 minute of played history for short backwards seeks, discard the rest
                prune_samples = min_cursor - (self.sample_rate * 60 * 1)
                
                # Slice the master buffer
                self.master_buffer = self.master_buffer[prune_samples:]
                
                # Adjust cursors of active playback threads under their locks
                for d in self.devices.values():
                    if d.active and d.thread:
                        with d.lock:
                            d.cursor = max(0, d.cursor - prune_samples)
                            d.master_buffer = self.master_buffer
                
                # Shift seek offset by the pruned duration to maintain exact UI progress reporting
                self.seek_offset_seconds += prune_samples / self.sample_rate
                logger.info(
                    f"Pruned {prune_samples} historical samples from buffer to conserve memory. "
                    f"New seek offset: {self.seek_offset_seconds:.1f}s"
                )

            self.master_buffer = np.vstack((self.master_buffer, numpy_data))
            # Update buffer reference in each playing device (lock-safe swap)
            for dev in self.devices.values():
                if dev.active and dev.thread:
                    with dev.lock:
                        dev.master_buffer = self.master_buffer

            on_data_cb = getattr(self, 'on_audio_data', None)

        if on_data_cb:
            on_data_cb(numpy_data)

    def clear_buffer(self, keep_seek_offset=False):
        with self.buffer_lock:
            self.master_buffer = np.empty((0, 2), dtype='float32')
            if not keep_seek_offset:
                self.seek_offset_seconds = 0.0
            for dev in self.devices.values():
                if dev.active and dev.thread:
                    with dev.lock:
                        dev.master_buffer = self.master_buffer
                        dev.cursor = 0

    # ── Playback control ─────────────────────────────────────────────────────────

    def play(self):
        if self.is_playing:
            return
        self.is_playing = True
        logger.info("Master playback started")
        from streamer import streamer
        is_yt_direct = getattr(streamer, 'yt_direct_mode', False)
        if not PORTAUDIO_AVAILABLE or is_yt_direct:
            self._last_play_time = time.time()
        if is_yt_direct:
            return
        with self.buffer_lock:
            for dev in self.devices.values():
                if dev.active:
                    dev.start_playback(self.master_buffer)

    def pause(self):
        if not self.is_playing:
            return
        self.is_playing = False
        logger.info("Master playback paused")
        from streamer import streamer
        is_yt_direct = getattr(streamer, 'yt_direct_mode', False)
        if not PORTAUDIO_AVAILABLE or is_yt_direct:
            now = time.time()
            self.seek_offset_seconds += (now - self._last_play_time)
            self._last_play_time = now
        if is_yt_direct:
            return
        for dev in self.devices.values():
            dev.stop_playback(preserve_cursor=True)

    def get_play_progress(self):
        """Return the current playback position in seconds."""
        from streamer import streamer
        is_yt_direct = getattr(streamer, 'yt_direct_mode', False)
        if not PORTAUDIO_AVAILABLE or is_yt_direct:
            if self.is_playing:
                now = time.time()
                return self.seek_offset_seconds + (now - self._last_play_time)
            return self.seek_offset_seconds

        active_devices = [d for d in self.devices.values() if d.active and d.thread]
        if not active_devices:
            return self.seek_offset_seconds
        max_cursor = max(d.cursor for d in active_devices)
        return self.seek_offset_seconds + (max_cursor / self.sample_rate)

    def seek_to_seconds(self, seconds):
        """Seek playback by restarting ffmpeg from the target offset."""
        from streamer import streamer
        if not streamer.current_track:
            return
        logger.info(f"Seeking to {seconds}s...")
        was_playing = self.is_playing
        self.seek_offset_seconds = seconds
        is_yt_direct = getattr(streamer, 'yt_direct_mode', False)
        if not PORTAUDIO_AVAILABLE or is_yt_direct:
            self._last_play_time = time.time()
        if is_yt_direct:
            if not was_playing:
                self.pause()
            return
        self.clear_buffer(keep_seek_offset=True)
        streamer.play_track(streamer.current_track, start_seconds=seconds, keep_seek_offset=True)
        if not was_playing:
            self.pause()


# Global audio engine instance
audio_engine = AudioEngine()
