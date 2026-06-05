import React, { useState, useEffect, useRef } from 'react';
import {
  Headphones,
  Volume2,
  VolumeX,
  Search,
  Play,
  Pause,
  RefreshCw,
  Music,
  HelpCircle,
  ListMusic,
  Wifi,
  WifiOff,
  Zap,
  Clock,
  SquareX,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Activity,
  Settings2,
  Bluetooth,
  Usb,
  Cable,
  Signal,
  Trash2,
  Plus,
  Upload,
  GripVertical,
  Video,
  Tv,
  Maximize,
  Minimize,
} from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatTime = (secs) => {
  if (isNaN(secs) || secs == null) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

const hasVideoSupport = (track) => {
  if (!track) return false;
  if (!track.is_local) return true;
  if (track.is_video) return true;
  const ext = (track.title || '').split('.').pop().toLowerCase();
  return ['mp4', 'webm', 'mkv', 'mov', 'avi', 'flv', '3gp', 'mpeg', 'mpg'].includes(ext);
};

const getYouTubeId = (url) => {
  if (!url) return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
};

let ytApiPromise = null;
const loadYTApi = () => {
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve(window.YT);
      return;
    }
    const existingScript = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    if (!existingScript) {
      const tag = document.createElement('script');
      tag.src = "https://www.youtube.com/iframe_api";
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    }
    const checkYT = setInterval(() => {
      if (window.YT && window.YT.Player) {
        clearInterval(checkYT);
        resolve(window.YT);
      }
    }, 100);
  });
  return ytApiPromise;
};

const getConnectionIcon = (type) => {
  switch ((type || '').toLowerCase()) {
    case 'bluetooth': return Bluetooth;
    case 'usb':       return Usb;
    case 'wireless':  return Signal;
    case 'speaker':   return Volume2;
    default:          return Cable;
  }
};

const getConnectionColor = (type) => {
  switch ((type || '').toLowerCase()) {
    case 'bluetooth': return 'conn-bluetooth';
    case 'usb':       return 'conn-usb';
    case 'wireless':  return 'conn-wireless';
    case 'speaker':   return 'conn-wireless';
    default:          return 'conn-wired';
  }
};

// Get initially resolved backend host (host:port or domain)
const getInitialBackendHost = () => {
  // 1. User-saved override (from Settings modal) takes highest priority
  const saved = localStorage.getItem('hc_backend_host');
  if (saved) return saved;

  // 2. Build-time env var — set VITE_BACKEND_URL in Vercel project settings
  //    to point at your Render backend (e.g. "headsetconnect.onrender.com")
  if (import.meta.env.VITE_BACKEND_URL) {
    return import.meta.env.VITE_BACKEND_URL;
  }

  // 3. Local development — connect to local backend port
  const isLocalhost = window.location.hostname === 'localhost' ||
                      window.location.hostname === '127.0.0.1' ||
                      window.location.hostname.startsWith('192.168.') ||
                      window.location.hostname.startsWith('10.') ||
                      window.location.hostname.startsWith('172.');

  if (isLocalhost) {
    return `${window.location.hostname}:8000`;
  }

  // 4. Last resort: same host (only works when frontend + backend are co-deployed, e.g. Render)
  return window.location.host;
};

// Rewrite local media source URLs dynamically if connecting to a remote backend host
const getLocalVideoSrc = (track, backendHost) => {
  if (!track || !track.url) return '';
  if (track.is_local && track.url.includes('/uploads/')) {
    const filename = track.url.split('/uploads/').pop();
    const protocol = window.location.protocol; // will be 'http:' or 'https:'
    return `${protocol}//${backendHost}/uploads/${filename}`;
  }
  return track.url;
};

// ─── DeviceCard ───────────────────────────────────────────────────────────────

function DeviceCard({ device, isNew, calibrationState, onToggle, onVolume, onDelay, onCalibrate, onResetProfile, cloudMode }) {
  const [expanded, setExpanded]     = useState(false);
  const [localVol, setLocalVol]     = useState(device.volume);
  const [localDelay, setLocalDelay] = useState(device.delay_ms);
  const [muted, setMuted]           = useState(false);

  // High-performance render-state resync pattern (avoids cascading useEffect renders)
  const [prevVol, setPrevVol]       = useState(device.volume);
  const [prevDelay, setPrevDelay]   = useState(device.delay_ms);

  if (device.volume !== prevVol) {
    setLocalVol(device.volume);
    setPrevVol(device.volume);
  }
  if (device.delay_ms !== prevDelay) {
    setLocalDelay(device.delay_ms);
    setPrevDelay(device.delay_ms);
  }

  const connIconRef = getConnectionIcon(device.connection_type);
  const connClass   = getConnectionColor(device.connection_type);
  const connLabel   = device.connection_type || 'Wired';
  const volPct      = muted ? 0 : Math.round(localVol * 100);

  const handleMute = () => {
    const next = !muted;
    setMuted(next);
    onVolume(device.index, next ? 0 : localVol);
  };

  return (
    <div className={`device-card ${device.active ? 'active' : 'inactive'}`}>

      {/* ── Header row ── */}
      <div className="device-header">
        <div className={`device-icon-wrap ${device.active ? 'on' : 'off'}`}>
          <Headphones size={20} />
          {device.active && <span className="pulse-ring" />}
        </div>

        <div className="device-meta">
          <h4 className="device-name" title={device.name}>{device.name}</h4>
          <div className="device-sub-row">
            <span className={`conn-badge ${connClass}`}>
              {React.createElement(connIconRef, { size: 10 })}
              {connLabel}
            </span>
            <span className="device-status-text">
              {device.active
                ? <><span className="dot green" />Connected</>
                : isNew
                  ? <><span className="dot amber" />Available</>  
                  : <><span className="dot grey" />Off</>
              }
            </span>
          </div>
        </div>

        <div className="device-actions">
          {device.active && (
            <button
              className="icon-btn small"
              onClick={() => setExpanded(p => !p)}
              title="Adjust settings"
            >
              <Settings2 size={12} />
              {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            </button>
          )}
          <label className="switch" title={device.active ? 'Disconnect' : 'Connect'}>
            <input
              type="checkbox"
              checked={device.active}
              onChange={(e) => onToggle(device.index, e.target.checked)}
            />
            <span className="slider" />
          </label>
        </div>
      </div>

      {/* ── Mini volume bar (collapsed + active) ── */}
      {device.active && !expanded && (
        <div className="device-vol-row">
          <Volume2 size={11} className="vol-ico" />
          <div className="mini-vol-track">
            <div className="mini-vol-fill" style={{ width: `${volPct}%` }} />
          </div>
          <span className="vol-pct">{volPct}%</span>
        </div>
      )}

      {/* ── Expanded controls ── */}
      {device.active && expanded && (
        <div className="device-controls">
          {/* Volume */}
          <div className="ctrl-row">
            <button className={`icon-btn micro ${muted ? 'muted' : ''}`} onClick={handleMute} title={muted ? 'Unmute' : 'Mute'}>
              {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
            </button>
            <span className="ctrl-label">Volume</span>
            <input
              type="range" min="0" max="1" step="0.01"
              value={muted ? 0 : localVol}
              disabled={muted}
              onChange={(e) => { const v = parseFloat(e.target.value); setLocalVol(v); onVolume(device.index, v); }}
              className="range-input"
              style={{ '--value-percent': `${(muted ? 0 : localVol) * 100}%` }}
            />
            <span className="ctrl-val">{muted ? 'Muted' : `${Math.round(localVol * 100)}%`}</span>
          </div>

          {/* Delay */}
          <div className="ctrl-row">
            <span className="icon-static"><Clock size={13} /></span>
            <span className="ctrl-label">Delay</span>
            <input
              type="range" min="0" max="500" step="5"
              value={localDelay}
              onChange={(e) => { const d = parseFloat(e.target.value); setLocalDelay(d); onDelay(device.index, d); }}
              className="range-input"
              style={{ '--value-percent': `${(localDelay / 500) * 100}%` }}
            />
            <span className="ctrl-val">{localDelay}ms</span>
          </div>

          {/* Fine tune */}
          <div className="ctrl-row fine-tune">
            <span className="icon-static"><Zap size={13} /></span>
            <span className="ctrl-label">Fine tune</span>
            <input
              type="number" min="0" max="500" step="1"
              value={localDelay}
              onChange={(e) => { const d = Math.max(0, Math.min(500, parseFloat(e.target.value) || 0)); setLocalDelay(d); onDelay(device.index, d); }}
              className="number-input"
            />
            <span className="ctrl-val">ms</span>
          </div>

          {/* Calibration HUD Section */}
          {!cloudMode && (
            <div className="calibration-section">
              <div className="cal-section-header">
                <span className="cal-title">Auto Calibration</span>
                {device.latency_ms > 0 && (
                  <span className="cal-badge success">
                    <Activity size={10} />
                    Calibrated ({Math.round(device.latency_ms)}ms)
                  </span>
                )}
              </div>
              
              {(!calibrationState || calibrationState.status === 'idle') && (
                <div className="cal-idle">
                  <p className="cal-desc">
                    Auto-syncs this headset by playing a frequency sweep chirp and capturing it with your default microphone.
                  </p>
                  <div className="cal-actions" style={{ marginTop: '8px' }}>
                    <button
                      className="btn-cal-primary"
                      onClick={() => onCalibrate(device.index)}
                    >
                      <Zap size={12} />
                      Auto Calibrate
                    </button>
                    {device.latency_ms > 0 && (
                      <button
                        className="btn-cal-secondary"
                        onClick={() => onResetProfile(device.index)}
                      >
                        Reset Profile
                      </button>
                    )}
                  </div>
                </div>
              )}
              
              {calibrationState && calibrationState.status === 'calibrating' && (
                <div className="cal-terminal running">
                  <div className="pulse-circle">
                    <span className="pulse-core" />
                    <span className="pulse-wave" />
                  </div>
                  <div className="terminal-lines">
                    <div className="line font-mono text-amber">&gt; [SYS] PAUSING STREAMS...</div>
                    <div className="line font-mono text-amber">&gt; [SYS] PLAYING SWEEP PULSE (150ms)...</div>
                    <div className="line font-mono text-amber">&gt; [SYS] RECORDING MICROPHONE FEEDBACK...</div>
                  </div>
                </div>
              )}

              {calibrationState && calibrationState.status === 'success' && (
                <div className="cal-terminal success-state">
                  <div className="cal-result-info">
                    <h5 className="text-green" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span className="dot green" /> Sync Successful!
                    </h5>
                    <p className="font-mono text-dim" style={{ marginTop: '3px' }}>
                      Measured Latency: <strong>+{Math.round(calibrationState.latency)}ms</strong>
                    </p>
                    <p className="cal-note">Relative dynamic delay auto-applied.</p>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    <button
                      className="btn-cal-primary"
                      style={{ background: 'var(--green)', color: '#050a14' }}
                      disabled
                    >
                      Active
                    </button>
                    <button
                      className="btn-cal-secondary small"
                      onClick={() => onCalibrate(device.index)}
                    >
                      Recalibrate
                    </button>
                  </div>
                </div>
              )}
              
              {calibrationState && calibrationState.status === 'error' && (
                <div className="cal-terminal error-state">
                  <div className="cal-result-info">
                    <h5 className="text-amber" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span className="dot amber" /> Calibration Failed
                    </h5>
                    <p className="cal-error-msg" style={{ marginTop: '4px', fontSize: '0.74rem', lineHeight: '1.4' }}>{calibrationState.errorMsg}</p>
                  </div>
                  <div className="cal-actions" style={{ marginTop: '8px' }}>
                    <button
                      className="btn-cal-primary error"
                      onClick={() => onCalibrate(device.index)}
                    >
                      Retry
                    </button>
                    <button
                      className="btn-cal-secondary"
                      onClick={() => onResetProfile(device.index)}
                    >
                      Reset
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── SyncedVideoPlayer ───────────────────────────────────────────────────────

function SyncedVideoPlayer({ track, isPlaying, progress, latency, onClose, onTogglePlay, onSeek, backendHost, cloudMode, onProgress, ytDirectMode }) {
  const isYouTube = !track.is_local;
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  
  const [ytPlayer, setYtPlayer] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLagging, setIsLagging] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const isProgrammaticSeekRef = useRef(false);

  // Target time for the video player (adjusted for headset latency)
  const videoTargetTime = Math.max(0, progress - (latency / 1000.0));

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().catch(err => {
        console.error("Fullscreen request failed:", err);
      });
    } else {
      document.exitFullscreen();
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') {
        return;
      }
      switch (e.key.toLowerCase()) {
        case ' ':
          e.preventDefault();
          onTogglePlay();
          break;
        case 'arrowleft':
          e.preventDefault();
          onSeek(Math.max(0, progress - 10));
          break;
        case 'arrowright':
          e.preventDefault();
          onSeek(Math.min(track.duration || 100, progress + 10));
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
        default:
          break;
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [progress, track.duration, onTogglePlay, onSeek]);

  useEffect(() => {
    if (isYouTube) return;
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.play().catch(err => console.log("Local video playback blocked:", err));
    } else {
      video.pause();
    }
  }, [isPlaying, isYouTube]);

  useEffect(() => {
    if (isYouTube) return;
    const video = videoRef.current;
    if (!video) return;

    const diff = Math.abs(video.currentTime - videoTargetTime);
    if (diff > 0.4) {
      video.currentTime = videoTargetTime;
      setIsLagging(true);
      const timer = setTimeout(() => setIsLagging(false), 300);
      return () => clearTimeout(timer);
    }
  }, [videoTargetTime, isYouTube]);

  useEffect(() => {
    if (!isYouTube) return;
    const videoId = getYouTubeId(track.url);
    if (!videoId) return;

    let playerInstance = null;
    let destroyed = false;

    loadYTApi().then((YT) => {
      if (destroyed) return;
      
      playerInstance = new YT.Player('yt-player-target', {
        height: '100%',
        width: '100%',
        videoId: videoId,
        playerVars: {
          autoplay: isPlaying ? 1 : 0,
          controls: 1,
          disablekb: 0,
          fs: 1,
          rel: 0,
          showinfo: 0,
          iv_load_policy: 3,
          modestbranding: 1
        },
        events: {
          onReady: (event) => {
            if (destroyed) {
              event.target.destroy();
              return;
            }
            // Muted in streaming mode, unmuted in direct browser play mode
            if (ytDirectMode) {
              event.target.unMute();
              event.target.setVolume(100);
            } else {
              event.target.mute();
            }
            isProgrammaticSeekRef.current = true;
            event.target.seekTo(videoTargetTime, true);
            setTimeout(() => {
              isProgrammaticSeekRef.current = false;
            }, 1000);
            if (isPlaying) {
              event.target.playVideo();
            } else {
              event.target.pauseVideo();
            }
            setYtPlayer(event.target);
          },
          onStateChange: (event) => {
            const playerState = event.data;
            // 1 = PLAYING, 2 = PAUSED
            if (playerState === 2 && isPlaying) {
              onTogglePlay();
            } else if (playerState === 1 && !isPlaying) {
              onTogglePlay();
            }
          }
        }
      });
    });

    return () => {
      destroyed = true;
      if (playerInstance && typeof playerInstance.destroy === 'function') {
        try {
          playerInstance.destroy();
        } catch (e) {
          console.error("Error destroying YT player:", e);
        }
      }
      setYtPlayer(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.url, isYouTube]);

  useEffect(() => {
    if (!isYouTube || !ytPlayer) return;
    try {
      const state = ytPlayer.getPlayerState();
      if (isPlaying && state !== 1) {
        ytPlayer.playVideo();
      } else if (!isPlaying && state === 1) {
        ytPlayer.pauseVideo();
      }
    } catch (e) {
      console.warn("YouTube playState sync error:", e);
    }
  }, [isPlaying, ytPlayer, isYouTube]);

  useEffect(() => {
    if (!isYouTube || !ytPlayer) return;
    try {
      if (ytDirectMode) {
        ytPlayer.unMute();
        ytPlayer.setVolume(100);
      } else {
        ytPlayer.mute();
      }
    } catch (e) {
      console.warn("YouTube mute state sync error:", e);
    }
  }, [ytDirectMode, ytPlayer, isYouTube]);

  // Sync YouTube player progress with backend when it drifts
  useEffect(() => {
    if (!isYouTube || !ytPlayer) return;
    try {
      const ytTime = ytPlayer.getCurrentTime();
      const diff = Math.abs(ytTime - videoTargetTime);
      if (diff > 0.4) {
        isProgrammaticSeekRef.current = true;
        ytPlayer.seekTo(videoTargetTime, true);
        const timer = setTimeout(() => {
          isProgrammaticSeekRef.current = false;
        }, 1000);
        
        setIsLagging(true);
        const lagTimer = setTimeout(() => setIsLagging(false), 300);
        return () => {
          clearTimeout(timer);
          clearTimeout(lagTimer);
        };
      }
    } catch (e) {
      console.warn("YouTube progress sync error:", e);
    }
  }, [videoTargetTime, ytPlayer, isYouTube]);

  // Poll YouTube player progress to detect manual seek by user
  useEffect(() => {
    if (!isYouTube || !ytPlayer) return;

    const interval = setInterval(() => {
      try {
        const ytTime = ytPlayer.getCurrentTime();
        const diff = Math.abs(ytTime - videoTargetTime);
        if (diff > 2.0 && !isProgrammaticSeekRef.current) {
          console.log(`Detected manual seek to ${ytTime}s (target was ${videoTargetTime}s)`);
          onSeek(ytTime);
        }
      } catch (e) {
        // Player might not be ready
      }
    }, 250);

    return () => clearInterval(interval);
  }, [isYouTube, ytPlayer, videoTargetTime, onSeek]);



  const handleSliderSeek = (e) => {
    const time = parseFloat(e.target.value);
    onSeek(time);
  };

  const sliderPercent = ((videoTargetTime / (track.duration || 100)) * 100);

  return (
    <div className="video-overlay-backdrop">
      <div className="video-theater-container" ref={containerRef}>
        <div className="video-theater-header">
          <div className="video-title-wrap">
            <Tv size={16} className="text-cyan" />
            <h3>{track.title}</h3>
          </div>
          <button className="btn-ghost-sm" onClick={onClose}>Close Theater</button>
        </div>

        <div className="video-theater-body">
          {isYouTube ? (
            <div id="yt-player-target" className="video-player-node"></div>
          ) : (
            <video
              ref={videoRef}
              src={getLocalVideoSrc(track, backendHost)}
              className="video-player-node"
              muted
              playsInline
            />
          )}

          {/* Clickable area for play/pause toggle */}
          <div className="video-click-detector" onClick={onTogglePlay} />

          <div className="video-hud-overlay">
            <div className="video-hud-top">
              <span className={`sync-status-indicator ${isLagging ? 'lagging' : ''}`}>
                {cloudMode
                  ? (isLagging ? 'Syncing...' : '🔊 Playing via Browser')
                  : (isLagging ? 'Syncing...' : 'Muted - Headsets Synced')
                }
              </span>
            </div>

            {/* Video Controls HUD */}
            <div className="video-hud-controls-container">
              {/* Timeline Scrubber */}
              <div className="video-hud-timeline-row">
                <div className="custom-slider-container">
                  <div className="custom-slider-track" />
                  <div 
                    className={`custom-slider-fill ${isDragging ? '' : 'animated'}`} 
                    style={{ width: `${sliderPercent}%` }} 
                  />
                  <div 
                    className={`custom-slider-thumb ${isDragging ? '' : 'animated'}`} 
                    style={{ left: `${sliderPercent}%` }} 
                  />
                  <input
                    type="range"
                    min="0"
                    max={track.duration || 100}
                    value={videoTargetTime}
                    onMouseDown={() => setIsDragging(true)}
                    onMouseUp={() => setIsDragging(false)}
                    onTouchStart={() => setIsDragging(true)}
                    onTouchEnd={() => setIsDragging(false)}
                    onChange={handleSliderSeek}
                    className="transparent-range"
                  />
                </div>
              </div>

              <div className="video-hud-actions-row">
                <div className="video-hud-left-actions">
                  <button className="video-hud-icon-btn" onClick={() => onSeek(Math.max(0, progress - 10))} title="Rewind 10s">
                    <ChevronLeft size={16} fill="var(--text-1)" />
                  </button>
                  <button className="video-hud-icon-btn" onClick={onTogglePlay} title={isPlaying ? 'Pause' : 'Play'}>
                    {isPlaying ? <Pause size={16} fill="var(--text-1)" /> : <Play size={16} fill="var(--text-1)" />}
                  </button>
                  <button className="video-hud-icon-btn" onClick={() => onSeek(Math.min(track.duration || 100, progress + 10))} title="Forward 10s">
                    <ChevronRight size={16} fill="var(--text-1)" />
                  </button>
                  <span className="video-hud-time font-mono">
                    {formatTime(videoTargetTime)} / {formatTime(track.duration)}
                  </span>
                </div>

                <div className="video-hud-right-actions">
                  <button className="video-hud-icon-btn" onClick={toggleFullscreen} title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}>
                    {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
                  </button>
                  <button className="video-hud-icon-btn close-btn" onClick={onClose} title="Close Theater">
                    <span>Close</span>
                  </button>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [wsConnected,    setWsConnected]    = useState(false);
  const [devices,        setDevices]        = useState([]);
  const [isPlaying,      setIsPlaying]      = useState(false);
  const [progress,       setProgress]       = useState(0);
  const [currentTrack,   setCurrentTrack]   = useState(null);
  const [musicQuery,     setMusicQuery]     = useState('');
  const [deviceSearch,   setDeviceSearch]   = useState('');
  const [searchResults,  setSearchResults]  = useState([]);
  const [isSearching,    setIsSearching]    = useState(false);
  const [isScanning,     setIsScanning]     = useState(false);
  const [showSyncGuide,  setShowSyncGuide]  = useState(false);
  const [newDeviceAlert, setNewDeviceAlert] = useState(null);
  // Names of devices that hot-plugged in AFTER the initial load (shown as 'Available' not 'Off')
  const [hotPlugNames,   setHotPlugNames]   = useState(new Set());
  const [calibrationStates, setCalibrationStates] = useState({});
  const initialLoadDone = useRef(false);

  // Queue, local audio library states
  const [queue,          setQueue]          = useState([]);
  const [library,        setLibrary]        = useState([]);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [showVideo,      setShowVideo]      = useState(false);

  const [draggingIndex, setDraggingIndex] = useState(null);

  // True when the Render backend is running in headless/cloud mode (no PortAudio).
  // In cloud mode, YouTube playback is handled by the browser's IFrame API instead
  // of being streamed server-side via yt-dlp + ffmpeg + sounddevice.
  const [cloudMode, setCloudMode] = useState(false);
  const [ytDirectMode, setYtDirectMode] = useState(false);

  const [backendHost, setBackendHost] = useState(getInitialBackendHost);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [tempHost, setTempHost] = useState(backendHost);

  // ─── Web Audio API (Cloud Mode Streaming) ───────────────────────────────────
  const [browserDevices, setBrowserDevices] = useState([]);
  const [localProfiles, setLocalProfiles] = useState(() => {
    try {
      const saved = localStorage.getItem('hc_browser_profiles');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });

  const audioCtxRef = useRef(null);
  const nextPlaybackTimeRef = useRef(0);
  const activeSourcesRef = useRef([]);
  const deviceNodesRef = useRef({});

  // Helper to detect device connection type from browser label
  const detectBrowserDeviceType = (label) => {
    const lower = (label || '').toLowerCase();
    if (lower.includes('bluetooth') || lower.includes('wireless') || lower.includes('buds') || lower.includes('airpods') || lower.includes('hands-free')) return 'Bluetooth';
    if (lower.includes('usb')) return 'USB';
    if (lower.includes('speaker') || lower.includes('realtek') || lower.includes('intel') || lower.includes('high definition')) return 'Speaker';
    return 'Wired';
  };

  const updateBrowserDevices = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return;
    }
    try {
      // Trigger temporary microphone request to grant label reading access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
      if (stream) {
        stream.getTracks().forEach(t => t.stop()); // close microphone stream immediately
      }
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const outputs = allDevices.filter(d => d.kind === 'audiooutput');
      setBrowserDevices(outputs);
    } catch (err) {
      console.error("Failed browser device enumeration:", err);
    }
  };

  const syncWebAudioDevices = async () => {
    if (!cloudMode) return;
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
    }
    const ctx = audioCtxRef.current;
    
    // Find active local browser devices
    const activeDevs = browserDevices.filter(d => {
      const profile = localProfiles[d.deviceId];
      return profile && profile.active;
    });

    const newNodes = {};

    for (const dev of activeDevs) {
      const dId = dev.deviceId;
      const profile = localProfiles[dId] || { volume: 1.0, delay_ms: 0.0 };

      if (deviceNodesRef.current[dId]) {
        // Update existing nodes
        const nodes = deviceNodesRef.current[dId];
        nodes.gainNode.gain.setValueAtTime(profile.volume, ctx.currentTime);
        nodes.delayNode.delayTime.setValueAtTime(profile.delay_ms / 1000.0, ctx.currentTime);
        newNodes[dId] = nodes;
      } else {
        // Build new nodes
        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(profile.volume, ctx.currentTime);

        const delayNode = ctx.createDelay(1.0); // max delay 1s
        delayNode.delayTime.setValueAtTime(profile.delay_ms / 1000.0, ctx.currentTime);

        const destinationNode = ctx.createMediaStreamDestination();

        const audioElement = new Audio();
        audioElement.srcObject = destinationNode.stream;
        audioElement.play().catch(e => console.warn("Local audio playback blocked by user interaction:", e));

        if (typeof audioElement.setSinkId === 'function') {
          try {
            await audioElement.setSinkId(dId);
            console.log(`Web Audio: sinkId set to ${dId} for ${dev.label}`);
          } catch (e) {
            console.error(`Web Audio: failed setSinkId to ${dId}:`, e);
          }
        }

        gainNode.connect(delayNode);
        delayNode.connect(destinationNode);

        newNodes[dId] = {
          gainNode,
          delayNode,
          destinationNode,
          audioElement,
        };
      }
    }

    // Clean up deactivated nodes
    Object.keys(deviceNodesRef.current).forEach(dId => {
      if (!newNodes[dId]) {
        const nodes = deviceNodesRef.current[dId];
        try {
          nodes.audioElement.pause();
          nodes.audioElement.srcObject = null;
          nodes.gainNode.disconnect();
          nodes.delayNode.disconnect();
        } catch (e) {}
      }
    });

    deviceNodesRef.current = newNodes;
  };

  const handleIncomingAudioChunk = (arrayBuffer) => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
    }
    const ctx = audioCtxRef.current;

    const floatData = new Float32Array(arrayBuffer);
    const numFrames = floatData.length / 2;
    if (numFrames === 0) return;

    const audioBuffer = ctx.createBuffer(2, numFrames, 44100);
    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.getChannelData(1);
    for (let i = 0; i < numFrames; i++) {
      left[i] = floatData[i * 2];
      right[i] = floatData[i * 2 + 1];
    }

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;

    let connectedAny = false;
    Object.values(deviceNodesRef.current).forEach(({ gainNode }) => {
      source.connect(gainNode);
      connectedAny = true;
    });

    if (!connectedAny) {
      source.connect(ctx.destination);
    }

    let playTime = nextPlaybackTimeRef.current;
    const now = ctx.currentTime;
    if (playTime < now) {
      playTime = now + 0.05; // 50ms scheduling gap to avoid pops
    }
    source.start(playTime);
    nextPlaybackTimeRef.current = playTime + audioBuffer.duration;

    activeSourcesRef.current.push(source);
    source.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== source);
    };
  };

  // Reset/Clear buffers on seeks or track changes
  const clearWebAudioBuffer = () => {
    activeSourcesRef.current.forEach(src => {
      try { src.stop(); } catch (e) {}
    });
    activeSourcesRef.current = [];
    nextPlaybackTimeRef.current = 0;
  };

  // Sync browser devices to browser outputs
  useEffect(() => {
    if (cloudMode) {
      updateBrowserDevices();
    }
  }, [cloudMode]);

  // Sync Web Audio graph on changes
  useEffect(() => {
    if (cloudMode) {
      syncWebAudioDevices();
    }
  }, [browserDevices, localProfiles, cloudMode]);

  // Handle play/pause browser state changes
  useEffect(() => {
    if (!cloudMode) return;
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    if (isPlaying) {
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
    } else {
      if (ctx.state === 'running') {
        ctx.suspend();
      }
      activeSourcesRef.current.forEach(src => {
        try { src.stop(); } catch (e) {}
      });
      activeSourcesRef.current = [];
    }
  }, [isPlaying, cloudMode]);

  useEffect(() => {
    if (showSettingsModal) {
      setTimeout(() => setTempHost(backendHost), 0);
    }
  }, [showSettingsModal, backendHost]);

  useEffect(() => {
    if (currentTrack && !hasVideoSupport(currentTrack)) {
      setTimeout(() => setShowVideo(false), 0);
    }
  }, [currentTrack]);
  const [swipeStates, setSwipeStates] = useState({}); // { trackId: translateX }

  const wsRef        = useRef(null);
  const reconnectRef = useRef(null);
  const touchStartRef = useRef(null);

  // Refs to avoid closing over stale state inside ws.onmessage without causing reconnects
  const currentTrackRef = useRef(currentTrack);
  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  const ytDirectModeRef = useRef(ytDirectMode);
  useEffect(() => {
    ytDirectModeRef.current = ytDirectMode;
  }, [ytDirectMode]);

  // ── WebSocket ───────────────────────────────────────────────────────────────

  useEffect(() => {
    function connectWebSocket() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${backendHost}/ws`);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
      };

      ws.onmessage = (evt) => {
        if (evt.data instanceof ArrayBuffer) {
          handleIncomingAudioChunk(evt.data);
          return;
        }
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'state_update') {
            const incoming = msg.devices || [];
            setDevices(prev => {
              const prevNames = new Set(prev.map(d => d.name));
              const added     = incoming.filter(d => !prevNames.has(d.name));

              if (added.length > 0 && initialLoadDone.current) {
                // Hot-plug: device arrived after the app was already running
                setHotPlugNames(s => { const ns = new Set(s); added.forEach(d => ns.add(d.name)); return ns; });
                setNewDeviceAlert(`New device available: ${added.map(d => d.name).join(', ')}`);
                setTimeout(() => setNewDeviceAlert(null), 5000);
              }

              if (!initialLoadDone.current && incoming.length > 0) {
                initialLoadDone.current = true;
              }
              return incoming;
            });
            setIsPlaying(msg.is_playing);
            setProgress(msg.progress || 0);
            
            const nextDirectMode = msg.yt_direct_mode || false;
            if (msg.current_track?.id !== currentTrackRef.current?.id) {
              clearWebAudioBuffer();
              if (nextDirectMode) {
                setShowVideo(true);
              }
            } else if (nextDirectMode && !ytDirectModeRef.current) {
              setShowVideo(true);
            }
            setYtDirectMode(nextDirectMode);

            setCurrentTrack(msg.current_track);
            setIsScanning(false);
            if (msg.cloud_mode !== undefined) setCloudMode(msg.cloud_mode);

            // Play Queue, Local Library
            if (msg.queue !== undefined) setQueue(msg.queue || []);
            if (msg.library !== undefined) setLibrary(msg.library || []);
          } else if (msg.type === 'youtube_play_direct') {
            // Cloud mode fallback: play YouTube in browser IFrame directly.
            setCurrentTrack(msg.track);
            setIsPlaying(true);
            setYtDirectMode(true);
            setShowVideo(true);  // auto-open theater so the IFrame plays with audio
          } else if (msg.type === 'search_results') {
            setSearchResults(msg.results || []);
            setIsSearching(false);
          } else if (msg.type === 'calibration_result') {
            const idx = msg.index;
            setCalibrationStates(prev => ({
              ...prev,
              [idx]: msg.success ? {
                status: 'success',
                latency: msg.latency_ms,
                errorMsg: ''
              } : {
                status: 'error',
                latency: 0,
                errorMsg: msg.error || 'Calibration failed.'
              }
            }));
          }
        } catch (e) {
          console.error('WS parse error:', e);
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        reconnectRef.current = setTimeout(connectWebSocket, 2000);
      };

      ws.onerror = () => {};
    }

    connectWebSocket();
    return () => { wsRef.current?.close(); clearTimeout(reconnectRef.current); };
  }, [backendHost]);

  // ── Actions ─────────────────────────────────────────────────────────────────



  const send = (payload) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify(payload));
  };

  const handleScan = () => {
    if (cloudMode) {
      updateBrowserDevices();
    } else {
      setIsScanning(true);
      send({ action: 'scan_devices' });
      setTimeout(() => setIsScanning(false), 3000);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    if (!musicQuery.trim()) return;
    setIsSearching(true);
    send({ action: 'search', query: musicQuery });
  };

  const handlePlayTrack  = (track) => {
    if (cloudMode) clearWebAudioBuffer();
    setYtDirectMode(false);
    send({ action: 'play_track', track });
    setSearchResults([]);
    setMusicQuery('');
  };
  const handleTogglePlay = ()       => send({ action: isPlaying ? 'pause' : 'play' });
  const handleStop       = ()       => send({ action: 'stop' });
  const handleSeek       = (e)      => { const s = parseFloat(e.target.value); setProgress(s); if (cloudMode) clearWebAudioBuffer(); send({ action: 'seek', seconds: s }); };

  const handleCalibrate = (idx) => {
    setCalibrationStates(prev => ({
      ...prev,
      [idx]: { status: 'calibrating', latency: 0, errorMsg: '' }
    }));
    send({ action: 'calibrate_device', index: idx });
  };

  const handleResetProfile = (idx) => {
    setCalibrationStates(prev => {
      const ns = { ...prev };
      delete ns[idx];
      return ns;
    });
    send({ action: 'reset_profile', index: idx });
  };

  const handleToggleDevice = (idx, val) => {
    if (cloudMode) {
      setLocalProfiles(prev => {
        const next = { ...prev, [idx]: { ...prev[idx], active: val } };
        localStorage.setItem('hc_browser_profiles', JSON.stringify(next));
        return next;
      });
    } else {
      send({ action: 'toggle_device', index: idx, active: val });
    }
  };

  const handleVolumeDevice = (idx, vol) => {
    if (cloudMode) {
      setLocalProfiles(prev => {
        const next = { ...prev, [idx]: { ...prev[idx], volume: vol } };
        localStorage.setItem('hc_browser_profiles', JSON.stringify(next));
        return next;
      });
    } else {
      send({ action: 'set_volume', index: idx, volume: vol });
    }
  };

  const handleDelayDevice = (idx, ms) => {
    if (cloudMode) {
      setLocalProfiles(prev => {
        const next = { ...prev, [idx]: { ...prev[idx], delay_ms: ms } };
        localStorage.setItem('hc_browser_profiles', JSON.stringify(next));
        return next;
      });
    } else {
      send({ action: 'set_delay', index: idx, delay_ms: ms });
    }
  };

  const handleResetBrowserProfile = (idx) => {
    if (cloudMode) {
      setLocalProfiles(prev => {
        const next = { ...prev };
        delete next[idx];
        localStorage.setItem('hc_browser_profiles', JSON.stringify(next));
        return next;
      });
    } else {
      handleResetProfile(idx);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDraggingFile(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDraggingFile(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDraggingFile(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files);
    }
  };

  const handleFileUpload = async (files) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const fileType = file.name.split('.').pop().toLowerCase();
    const allowed = ['mp3', 'wav', 'flac', 'mp4', 'webm', 'mkv', 'mov', 'avi', 'flv', '3gp', 'mpeg', 'mpg'];
    if (!allowed.includes(fileType)) {
      alert("Only audio files (MP3, WAV, FLAC) and video files (MP4, WEBM, MKV, MOV, AVI) are supported.");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    try {
      setUploadProgress(0);
      
      const xhr = new XMLHttpRequest();
      const protocol = window.location.protocol; // 'http:' or 'https:'
      xhr.open("POST", `${protocol}//${backendHost}/api/upload`, true);
      
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const pct = Math.round((event.loaded / event.total) * 100);
          setUploadProgress(pct);
        }
      };

      xhr.onload = () => {
        try {
          const res = JSON.parse(xhr.responseText);
          if (res.success) {
            setUploadProgress(null);
          } else {
            alert(`Upload failed: ${res.error}`);
            setUploadProgress(null);
          }
        } catch (err) {
          console.error("Upload response parse error:", err);
          alert("Error parsing upload response.");
          setUploadProgress(null);
        }
      };

      xhr.onerror = () => {
        alert("Network error uploading file.");
        setUploadProgress(null);
      };

      xhr.send(formData);
    } catch (error) {
      console.error("Upload error:", error);
      alert("Error initiating upload.");
      setUploadProgress(null);
    }
  };


  // Touch Swipe-to-delete implementations for Play Queue
  const handleTouchStart = (e) => {
    touchStartRef.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e, trackId) => {
    if (touchStartRef.current === null) return;
    const diff = e.touches[0].clientX - touchStartRef.current;
    if (diff < 0) {
      setSwipeStates(prev => ({ ...prev, [trackId]: Math.max(-100, diff) }));
    }
  };

  const handleTouchEnd = (e, trackId) => {
    if (touchStartRef.current === null) return;
    const finalDiff = e.changedTouches[0].clientX - touchStartRef.current;
    touchStartRef.current = null;

    if (finalDiff < -70) {
      setSwipeStates(prev => {
        const next = { ...prev };
        delete next[trackId];
        return next;
      });
      send({ action: 'remove_from_queue', id: trackId });
    } else {
      setSwipeStates(prev => {
        const next = { ...prev };
        delete next[trackId];
        return next;
      });
    }
  };

  // ── Computed ─────────────────────────────────────────────────────────────────

  const activeCount     = cloudMode
    ? browserDevices.filter(d => localProfiles[d.deviceId]?.active).length
    : devices.filter(d => d.active).length;
    
  const activeDevices   = cloudMode
    ? browserDevices.filter(d => localProfiles[d.deviceId]?.active)
    : devices.filter(d => d.active);

  const maxLatencyMs    = cloudMode
    ? (activeDevices.length > 0 ? Math.max(...activeDevices.map(d => localProfiles[d.deviceId]?.latency_ms || 0)) : 0)
    : (activeDevices.length > 0 ? Math.max(...activeDevices.map(d => d.latency_ms || 0)) : 0);

  const filteredDevices = devices
    .filter(d => d.name.toLowerCase().includes(deviceSearch.toLowerCase()))
    .sort((a, b) => {
      // 1. Put active/connected devices at the very top of the list
      if (a.active && !b.active) return -1;
      if (!a.active && b.active) return 1;
      // 2. Secondary sort: Alphabetical by clean name
      return a.name.localeCompare(b.name);
    });

  const displayedDevices = cloudMode
    ? browserDevices.map(d => ({
        index: d.deviceId,
        name: d.label || 'Default Output Device',
        volume: localProfiles[d.deviceId]?.volume ?? 1.0,
        delay_ms: localProfiles[d.deviceId]?.delay_ms ?? 0.0,
        latency_ms: localProfiles[d.deviceId]?.latency_ms ?? 0.0,
        active: !!localProfiles[d.deviceId]?.active,
        connection_type: detectBrowserDeviceType(d.label),
      })).filter(d => d.name.toLowerCase().includes(deviceSearch.toLowerCase()))
         .sort((a, b) => {
           if (a.active && !b.active) return -1;
           if (!a.active && b.active) return 1;
           return a.name.localeCompare(b.name);
         })
    : filteredDevices;

  // ── Render ───────────────────────────────────────────────────────────────────



  return (
    <div className="app-root">

      {/* Toast */}
      {newDeviceAlert && (
        <div className="device-toast">
          <Bluetooth size={14} />
          {newDeviceAlert}
        </div>
      )}

      {/* ── Header ── */}
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon"><Headphones size={26} /></div>
          <div>
            <h1 className="brand-title">HeadsetConnect</h1>
            <p className="brand-sub">Multi-Headset Sound Sync</p>
          </div>
        </div>
        <div className="header-right">
          <div className="stat-pill">
            <Activity size={12} />
            <span>{activeCount} active</span>
          </div>
          <span 
            className={`status-badge ${wsConnected ? 'ok' : 'err'} interactive`}
            onClick={() => setShowSettingsModal(true)}
            title="Configure backend host connection"
            style={{ cursor: 'pointer' }}
          >
            {wsConnected ? <><Wifi size={12} />Connected</> : <><WifiOff size={12} />Disconnected</>}
          </span>
          {!wsConnected && (
            <button 
              className="btn-outline small text-cyan animate-pulse header-connect-local-btn"
              style={{ fontSize: '0.72rem', padding: '3px 8px', height: '24px', marginLeft: '6px', cursor: 'pointer' }}
              onClick={() => {
                localStorage.setItem('hc_backend_host', 'localhost:8000');
                setBackendHost('localhost:8000');
              }}
              title="Connect to the backend running on your local computer (localhost:8000)"
            >
              Connect to Local System
            </button>
          )}
          <button 
            className="icon-btn small header-settings-btn"
            onClick={() => setShowSettingsModal(true)}
            title="Connection Settings"
            style={{ marginLeft: '6px', height: '24px', width: '24px', padding: 0, justifyContent: 'center', display: 'flex', alignItems: 'center' }}
          >
            <Settings2 size={13} />
          </button>
        </div>
      </header>

      <div className="app-body">

        {/* ══ LEFT: Player, Queue, and Local Library ══ */}
        <section
          className="panel player-panel"
          onDragOver={handleDragOver}
          onDragEnter={handleDragOver}
        >
          {/* Glowing Absolute Drag Overlay */}
          {isDraggingFile && (
            <div
              className="file-drag-overlay"
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              <div className="overlay-content">
                <Upload size={48} className="animate-bounce text-orange" />
                <h3>Drop media files here</h3>
                <p>MP3, WAV, FLAC, and video files will upload in sync.</p>
              </div>
            </div>
          )}

          <div className="panel-head">
            <div className="panel-title">
              <ListMusic size={17} />
              <h2>Deck Manager</h2>
            </div>
            {activeCount > 0 && (
              <div className="routing-bar-inline">
                <Headphones size={12} />
                <span>→ {activeCount} device{activeCount !== 1 ? 's' : ''}</span>
              </div>
            )}
          </div>

          {/* Internal scroll body */}
          <div className="player-scroll-body" onDragOver={handleDragOver}>

            {!wsConnected && (
              <div className="connection-warning-card font-mono" style={{ marginBottom: '1.5rem', padding: '16px', border: '1px dashed var(--red)', borderRadius: '8px', background: 'rgba(255, 82, 82, 0.03)' }}>
                <h4 className="text-red" style={{ margin: '0 0 8px 0', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
                  <WifiOff size={14} /> Server Connection Lost
                </h4>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-2)', lineHeight: '1.45', margin: '0 0 10px 0' }}>
                  The frontend is unable to connect to the HeadsetConnect server. Retrying connection...
                </p>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <span className="dot amber pulse-ring" />
                  <span className="text-dim" style={{ fontSize: '0.72rem' }}>Reconnecting...</span>
                </div>
              </div>
            )}


            {/* YouTube Search */}
            <div className="search-section-hud" style={{ marginTop: 0 }}>
              <div className="section-header-hud" style={{ marginTop: 0 }}>
                <div className="sec-title">
                  <Search size={14} className="text-cyan" />
                  <h3>Discover YouTube Streams</h3>
                </div>
              </div>

              <form onSubmit={handleSearch} className="search-bar">
                <div className="search-wrap">
                  <Search className="search-ico" size={16} />
                  <input
                    id="search-input"
                    type="text"
                    placeholder="Search songs or paste a YouTube URL…"
                    value={musicQuery}
                    onChange={e => setMusicQuery(e.target.value)}
                    className="search-field"
                  />
                </div>
                <button id="search-btn" type="submit" className="btn-primary" disabled={isSearching}>
                  {isSearching ? 'Searching…' : 'Search'}
                </button>
              </form>

              {/* Search Results */}
              {searchResults.length > 0 && (
                <div className="results-section">
                  <div className="results-header">
                    <span className="results-count">{searchResults.length} results</span>
                    <button className="btn-ghost-sm" onClick={() => setSearchResults([])}>Clear</button>
                  </div>
                  <div className="results-list">
                    {searchResults.map((track) => (
                      <div key={track.id} className="track-row">
                        <div className="track-row-click" onClick={() => handlePlayTrack(track)}>
                          <img src={track.thumbnail} alt={track.title} className="track-thumb" />
                          <div className="track-info">
                            <h5 className="truncate">{track.title}</h5>
                            <p>{track.uploader} · {formatTime(track.duration)}</p>
                          </div>
                        </div>
                        <div className="track-actions-row">
                          <button
                            className="icon-btn micro"
                            onClick={() => send({ action: 'add_to_queue', track })}
                            title="Queue stream"
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Now Playing */}
            <div className="now-playing-card" style={{ marginTop: '1.2rem' }}>
              {currentTrack ? (
                <>
                  <div className="track-display">
                    <div className="art-wrap">
                      {currentTrack.thumbnail ? (
                        <img src={currentTrack.thumbnail} alt={currentTrack.title} className="track-art" />
                      ) : (
                        <div className="track-art fallback">
                          <Music size={28} className="text-orange" />
                        </div>
                      )}
                      {isPlaying && <div className="art-playing-ring" />}
                    </div>
                    <div className="track-details">
                      <h3>{currentTrack.title}</h3>
                      <p>{currentTrack.uploader || 'Local Library File'}</p>
                      <div className={`wave ${isPlaying ? 'playing' : ''}`}>
                        {[...Array(8)].map((_, i) => (
                          <span key={i} className="bar" style={{ animationDelay: `${i * 0.1}s` }} />
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="progress-section">
                    <input
                      type="range" min="0" max={currentTrack.duration || 100}
                      value={progress} onChange={handleSeek}
                      className="range-input full-width" id="seek-bar"
                      style={{ '--value-percent': `${(progress / (currentTrack.duration || 100)) * 100}%` }}
                    />
                    <div className="progress-times">
                      <span>{formatTime(progress)}</span>
                      <span>{formatTime(currentTrack.duration)}</span>
                    </div>
                  </div>

                  <div className="player-controls">
                    <button id="play-pause-btn" className="btn-play" onClick={handleTogglePlay} title={isPlaying ? 'Pause' : 'Play'}>
                      {isPlaying
                        ? <Pause size={24} fill="#050a14" />
                        : <Play  size={24} fill="#050a14" style={{ transform: 'translateX(2px)' }} />
                      }
                    </button>
                    <button id="stop-btn" className="btn-control" onClick={handleStop} title="Stop">
                      <SquareX size={18} /><span>Stop</span>
                    </button>
                    {hasVideoSupport(currentTrack) && (
                      <button 
                        id="watch-video-btn" 
                        className="btn-control" 
                        onClick={() => setShowVideo(p => !p)} 
                        title="Watch Video"
                        style={{ 
                          borderColor: showVideo ? 'var(--cyan)' : 'var(--border)', 
                          color: showVideo ? 'var(--cyan)' : 'var(--text-2)',
                          boxShadow: showVideo ? '0 0 10px rgba(0, 229, 255, 0.2)' : 'none'
                        }}
                      >
                        <Video size={18} />
                        <span>{showVideo ? 'Watching' : 'Watch'}</span>
                      </button>
                    )}
                  </div>

                  {activeCount > 0 && (
                    <div className="routing-bar">
                      <Headphones size={13} />
                      <span>Routing to <strong>{activeCount}</strong> device{activeCount !== 1 ? 's' : ''}:</span>
                      <div className="routing-chips">
                        {devices.filter(d => d.active).map(d => (
                          <span key={d.index} className="chip">{d.name}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="no-track">
                  <Music size={48} />
                  <h3>No stream active</h3>
                  <p>Load your library, search YouTube, or queue tracks to start playing.</p>
                </div>
              )}
            </div>

            {/* ── Play Queue Section ── */}
            <div className="queue-section">
              <div className="section-header-hud">
                <div className="sec-title">
                  <ListMusic size={14} className="text-orange" />
                  <h3>DJ Play Queue</h3>
                  {queue.length > 0 && <span className="sec-badge">{queue.length}</span>}
                </div>
                {queue.length > 0 && (
                  <button className="btn-ghost-sm text-red" onClick={() => send({ action: 'clear_queue' })}>
                    Clear Queue
                  </button>
                )}
              </div>

              {queue.length === 0 ? (
                <div className="queue-empty-state font-mono">
                  &gt; [SYS] QUEUE EMPTY. ADD TRACKS ABOVE.
                </div>
              ) : (
                <div className="queue-list">
                  {queue.map((track, index) => {
                    const transX = swipeStates[track.id] || 0;
                    return (
                      <div
                        key={track.id}
                        className={`queue-row ${draggingIndex === index ? 'dragging' : ''}`}
                        style={{ transform: `translateX(${transX}px)` }}
                        draggable
                        onDragStart={(e) => {
                          setDraggingIndex(index);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragOver={(e) => e.preventDefault()}
                        onDragEnter={() => {
                          if (draggingIndex !== null && draggingIndex !== index) {
                            const newQueue = [...queue];
                            const draggedItem = newQueue[draggingIndex];
                            newQueue.splice(draggingIndex, 1);
                            newQueue.splice(index, 0, draggedItem);
                            setDraggingIndex(index);
                            send({ action: 'reorder_queue', queue: newQueue });
                          }
                        }}
                        onDragEnd={() => setDraggingIndex(null)}
                        onTouchStart={(e) => handleTouchStart(e, track.id)}
                        onTouchMove={(e) => handleTouchMove(e, track.id)}
                        onTouchEnd={(e) => handleTouchEnd(e, track.id)}
                      >
                        <div className="drag-handle-hud">
                          <GripVertical size={13} />
                        </div>
                        {track.thumbnail ? (
                          <img src={track.thumbnail} alt={track.title} className="queue-thumb" />
                        ) : (
                          <div className="queue-thumb fallback">
                            <Music size={12} className="text-orange" />
                          </div>
                        )}
                        <div className="queue-info">
                          <h4 className="truncate">{track.title}</h4>
                          <p>{track.uploader || 'Local'} · {formatTime(track.duration)}</p>
                        </div>
                        <button
                          className="icon-btn micro btn-delete-row"
                          onClick={() => send({ action: 'remove_from_queue', id: track.id })}
                          title="Delete track"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Local Audio Library Section ── */}
            <div className="library-section">
              <div className="section-header-hud">
                <div className="sec-title">
                  <Upload size={14} className="text-orange" />
                  <h3>Local Audio Library</h3>
                  {library.length > 0 && <span className="sec-badge">{library.length}</span>}
                </div>
              </div>

              {/* Upload Dashed Box */}
              <div
                className="dropzone-box"
                onClick={() => document.getElementById('local-file-picker').click()}
              >
                <input
                  id="local-file-picker"
                  type="file"
                  accept=".mp3,.wav,.flac,.mp4,.webm,.mkv,.mov,.avi,.flv,.3gp,.mpeg,.mpg"
                  style={{ display: 'none' }}
                  onChange={(e) => handleFileUpload(e.target.files)}
                />
                {uploadProgress !== null ? (
                  <div className="upload-progress-hud">
                    <div className="upload-progress-text font-mono">
                      &gt; UPLOADING LOCAL DECK FILE: {uploadProgress}%
                    </div>
                    <div className="upload-progress-bar">
                      <div className="upload-progress-fill" style={{ width: `${uploadProgress}%` }} />
                    </div>
                  </div>
                ) : (
                  <div className="dropzone-content font-mono">
                    <Upload size={18} className="text-orange" />
                    <span>&gt; DRAG & DROP MEDIA OR CLICK TO SELECT (MP3, WAV, FLAC, MP4, WEBM, MKV)</span>
                  </div>
                )}
              </div>

              {library.length > 0 && (
                <div className="library-list">
                  {library.map((track) => (
                    <div key={track.id} className="library-row">
                      <div className="lib-click-area" onClick={() => handlePlayTrack(track)}>
                        <Music size={14} className="text-dim" />
                        <div className="lib-info">
                          <h4 className="truncate">{track.title}</h4>
                          <p>{formatTime(track.duration)} · Local Storage</p>
                        </div>
                      </div>
                      <div className="lib-actions">
                        <button
                          className="icon-btn micro"
                          onClick={() => send({ action: 'add_to_queue', track })}
                          title="Queue track"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>{/* end player-scroll-body */}
        </section>

        {/* ══ RIGHT: Bluetooth Devices & Party Room ══ */}
        <section className="panel device-panel">
          <div className="panel-head">
            <div className="panel-title">
              <Bluetooth size={16} />
              <h2>Devices</h2>
              <span className="badge">{displayedDevices.length}</span>
            </div>
            <div className="panel-head-actions">
              <div className="device-search-wrap">
                <Search size={12} className="device-search-ico" />
                <input
                  id="device-search-input"
                  type="text"
                  placeholder="Search…"
                  value={deviceSearch}
                  onChange={e => setDeviceSearch(e.target.value)}
                  className="device-search-field"
                />
              </div>
              <button
                id="refresh-btn"
                className={`icon-btn refresh-btn ${isScanning ? 'spinning' : ''}`}
                onClick={handleScan}
                disabled={isScanning}
                title={cloudMode ? "Scan local outputs" : "Scan for new devices"}
              >
                <RefreshCw size={14} />
              </button>
            </div>
          </div>

          <p className="auto-detect-note">
            <Headphones size={10} />
            {cloudMode ? "All local browser outputs listed · Auto-refreshes on plug" : "All playback devices listed · Auto-refreshes every 5s"}
          </p>

          {/* Scrollable device list */}
          <div className="device-grid">
            {cloudMode && browserDevices.length === 0 ? (
              <div className="empty-state" style={{ padding: '2rem 1rem', textAlign: 'center' }}>
                <Headphones size={38} style={{ opacity: 0.4, marginBottom: '1rem' }} />
                <p style={{ fontWeight: 600, marginBottom: '6px' }}>Cloud Mode — No Local Outputs Found</p>
                <p className="hint" style={{ lineHeight: '1.5', marginBottom: '1.2rem' }}>
                  Please grant media/microphone permissions so the browser can enumerate and name your connected headsets.
                </p>
                <button
                  className="btn-outline"
                  style={{ fontSize: '0.8rem' }}
                  onClick={handleScan}
                >
                  <RefreshCw size={12} /> Scan & Grant Permissions
                </button>
              </div>
            ) : displayedDevices.length === 0 ? (
              <div className="empty-state">
                <Bluetooth size={38} />
                <p>{deviceSearch ? `No match for "${deviceSearch}"` : 'No audio outputs found'}</p>
                <p className="hint">Plug in headsets or turn on Bluetooth devices, then click refresh.</p>
                {!deviceSearch && (
                  <button className="btn-outline" onClick={handleScan}>
                    <RefreshCw size={13} /> Scan Now
                  </button>
                )}
              </div>
            ) : (
              displayedDevices.map(dev => (
                <DeviceCard
                  key={dev.name}
                  device={dev}
                  isNew={hotPlugNames.has(dev.name) && !dev.active}
                  calibrationState={calibrationStates[dev.index]}
                  onToggle={handleToggleDevice}
                  onVolume={handleVolumeDevice}
                  onDelay={handleDelayDevice}
                  onCalibrate={handleCalibrate}
                  onResetProfile={handleResetBrowserProfile}
                  cloudMode={cloudMode}
                />
              ))
            )}
          </div>

          {/* Sync guide pinned at bottom */}
          <div className="sync-card">
            <div className="sync-card-head" onClick={() => setShowSyncGuide(p => !p)}>
              <HelpCircle size={14} className="icon-green" />
              <span>Sync Calibration Guide</span>
              {showSyncGuide ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </div>
            {showSyncGuide && (
              <ol className="sync-steps font-mono">
                <li>1. Enable headsets with the toggle on each card.</li>
                <li>2. Play a rhythmic track (drums/vocals work best).</li>
                <li>3. If you hear an echo, use <strong>Auto Calibrate</strong>.</li>
                <li>4. Fine-tune manually in milliseconds if required.</li>
              </ol>
            )}
          </div>
        </section>

      </div>

      {showVideo && currentTrack && hasVideoSupport(currentTrack) && (
        <SyncedVideoPlayer
          track={currentTrack}
          isPlaying={isPlaying}
          progress={progress}
          latency={maxLatencyMs}
          onClose={() => setShowVideo(false)}
          onTogglePlay={handleTogglePlay}
          onSeek={(seconds) => send({ action: 'seek', seconds })}
          backendHost={backendHost}
          cloudMode={cloudMode}
          onProgress={(t) => setProgress(t)}
          ytDirectMode={ytDirectMode}
        />
      )}

      {showSettingsModal && (
        <div className="video-overlay-backdrop modal-overlay" onClick={() => setShowSettingsModal(false)}>
          <div className="connection-modal-container" onClick={e => e.stopPropagation()}>
            <div className="connection-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Settings2 size={18} className="text-cyan" />
                <h3>Backend Connection Settings</h3>
              </div>
              <button className="btn-ghost-sm" onClick={() => setShowSettingsModal(false)}>Close</button>
            </div>
            <div className="connection-modal-body">
              <p className="font-mono text-dim" style={{ fontSize: '0.78rem', marginBottom: '1rem', lineHeight: '1.4' }}>
                Configure the IP address or host name of the computer running the HeadsetConnect local Python server.
              </p>
              
              <div className="form-group" style={{ marginBottom: '1.2rem' }}>
                <label className="font-mono" style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.78rem', color: 'var(--text-2)' }}>
                  Backend Server IP / Address
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    className="search-field"
                    style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.9rem', padding: '0.4rem 0.6rem' }}
                    value={tempHost}
                    onChange={e => setTempHost(e.target.value)}
                    placeholder="e.g. localhost:8000 or 192.168.1.15:8000"
                  />
                  <button 
                    className="btn-primary" 
                    onClick={() => {
                      if (tempHost.trim()) {
                        localStorage.setItem('hc_backend_host', tempHost.trim());
                        setBackendHost(tempHost.trim());
                        setShowSettingsModal(false);
                      }
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>

              <div className="connection-instructions font-mono" style={{ fontSize: '0.72rem', border: '1px solid var(--border)', padding: '10px', borderRadius: '4px', background: 'rgba(5, 10, 20, 0.4)' }}>
                <h5 className="text-orange" style={{ margin: '0 0 6px 0', fontSize: '0.78rem' }}>&gt; MULTI-DEVICE SETUP INSTRUCTIONS:</h5>
                <ol style={{ paddingLeft: '14px', margin: 0, listStyleType: 'decimal' }}>
                  <li style={{ marginBottom: '4px' }}>Find your host computer's local IP address (e.g. run <code>ipconfig</code> in CMD/PowerShell on Windows).</li>
                  <li style={{ marginBottom: '4px' }}>Look for the IPv4 Address (e.g. <code>192.168.1.15</code>).</li>
                  <li style={{ marginBottom: '4px' }}>Enter that IP address followed by <code>:8000</code> in this field (e.g. <code>192.168.1.15:8000</code>).</li>
                  <li>Open the public Vercel/tunnel link on your phone/tablet, open this settings menu, and enter the exact same address!</li>
                </ol>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '1.2rem' }}>
                <button 
                  className="btn-ghost-sm text-dim"
                  style={{ fontSize: '0.75rem', padding: 0 }}
                  onClick={() => {
                    const defaultHost = getInitialBackendHost();
                    localStorage.removeItem('hc_backend_host');
                    setBackendHost(defaultHost);
                    setTempHost(defaultHost);
                    setShowSettingsModal(false);
                  }}
                >
                  Reset to Default Address
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
