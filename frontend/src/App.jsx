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
} from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatTime = (secs) => {
  if (isNaN(secs) || secs == null) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
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

const getBackendUrls = () => {
  const hostname = window.location.hostname;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || !hostname;
  
  if (isLocal) {
    return {
      ws: `ws://${hostname || 'localhost'}:8000/ws`,
      upload: `http://${hostname || 'localhost'}:8000/api/upload`
    };
  } else {
    return {
      ws: `wss://headsetconnect.onrender.com/ws`,
      upload: `https://headsetconnect.onrender.com/api/upload`
    };
  }
};

// ─── DeviceCard ───────────────────────────────────────────────────────────────

function DeviceCard({ device, isNew, calibrationState, onToggle, onVolume, onDelay, onCalibrate, onResetProfile }) {
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
        </div>
      )}
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

  const [draggingIndex, setDraggingIndex] = useState(null);
  const [swipeStates, setSwipeStates] = useState({}); // { trackId: translateX }

  const [isLoading,      setIsLoading]      = useState(false);

  const wsRef        = useRef(null);
  const reconnectRef = useRef(null);
  const touchStartRef = useRef(null);

  // Web Audio Refs
  const audioContextRef = useRef(null);
  const decodedBufferRef = useRef(null);
  const activeSourcesRef = useRef({}); // index -> { sourceNode, delayNode, gainNode, audioElement }
  const startTimeRef = useRef(0);
  const startOffsetRef = useRef(0);
  const progressIntervalRef = useRef(null);
  const currentTrackRef = useRef(null);
  const isPlayingRef = useRef(false);
  const devicesRef = useRef([]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    devicesRef.current = devices;
  }, [devices]);

  // ── WebSocket ───────────────────────────────────────────────────────────────

  // Dynamic Web Audio Output & Device Discovery
  const scanBrowserDevices = async () => {
    try {
      setIsScanning(true);
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (permErr) {
        console.warn("Microphone permission denied or not available:", permErr);
      }

      const allDevices = await navigator.mediaDevices.enumerateDevices();
      
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }

      const outputDevices = allDevices.filter(d => d.kind === 'audiooutput');
      
      const mapped = outputDevices.map((d, idx) => {
        const name = d.label || `Output Device ${idx + 1}`;
        let connection_type = 'Wired';
        const lowercaseLabel = name.toLowerCase();
        if (lowercaseLabel.includes('bluetooth') || lowercaseLabel.includes('pods') || lowercaseLabel.includes('buds') || lowercaseLabel.includes('freebuds') || lowercaseLabel.includes('wireless')) {
          connection_type = 'Bluetooth';
        } else if (lowercaseLabel.includes('usb')) {
          connection_type = 'USB';
        } else if (lowercaseLabel.includes('speaker') || lowercaseLabel.includes('directsound') || lowercaseLabel.includes('realtek')) {
          connection_type = 'Speaker';
        }

        // Preserve volume and delay if already scanned previously
        const existing = devicesRef.current.find(ed => ed.index === d.deviceId);
        return {
          index: d.deviceId || String(idx),
          name: name,
          volume: existing ? existing.volume : 1.0,
          delay_ms: existing ? existing.delay_ms : 0.0,
          latency_ms: existing ? existing.latency_ms : 0.0,
          active: existing ? existing.active : false,
          connection_type: connection_type,
          deviceId: d.deviceId
        };
      });

      setDevices(mapped);
      setIsScanning(false);
    } catch (err) {
      console.error("Error scanning browser output devices:", err);
      setIsScanning(false);
    }
  };

  useEffect(() => {
    scanBrowserDevices();

    const handleDeviceChange = () => {
      console.log("Media devices changed, scanning output devices...");
      scanBrowserDevices();
    };

    if (navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    }

    return () => {
      if (navigator.mediaDevices) {
        navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
      }
      stopAllSources();
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    function connectWebSocket() {
      const urls = getBackendUrls();
      const ws = new WebSocket(urls.ws);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'state_update') {
            if (msg.queue !== undefined) setQueue(msg.queue || []);
            if (msg.library !== undefined) setLibrary(msg.library || []);

            const isNewTrack = !currentTrackRef.current || (msg.current_track && currentTrackRef.current.id !== msg.current_track.id);
            const isNoTrack = !msg.current_track;

            if (isNoTrack) {
              if (currentTrackRef.current) {
                stopAllSources();
                decodedBufferRef.current = null;
                currentTrackRef.current = null;
                setCurrentTrack(null);
                setProgress(0);
                startOffsetRef.current = 0;
              }
            } else if (isNewTrack) {
              currentTrackRef.current = msg.current_track;
              setCurrentTrack(msg.current_track);
              
              setIsLoading(true);
              stopAllSources();
              startOffsetRef.current = msg.progress || 0;
              setProgress(msg.progress || 0);

              const baseUrl = getBackendUrls().upload.replace('/api/upload', '');
              let finalStreamUrl = msg.current_track.is_local ? msg.current_track.stream_url : `${baseUrl}/api/stream?url=${encodeURIComponent(msg.current_track.url)}`;
              if (msg.current_track.is_local) {
                const hostname = window.location.hostname;
                const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || !hostname;
                if (!isLocal) {
                  finalStreamUrl = finalStreamUrl.replace('http://localhost:8000', 'https://headsetconnect.onrender.com');
                }
              }

              fetch(finalStreamUrl)
                .then(res => {
                  if (!res.ok) throw new Error("Audio stream proxy returned non-200");
                  return res.arrayBuffer();
                })
                .then(arrayBuffer => {
                  if (!audioContextRef.current) {
                    audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
                  }
                  return audioContextRef.current.decodeAudioData(arrayBuffer);
                })
                .then(decodedBuffer => {
                  decodedBufferRef.current = decodedBuffer;
                  setIsLoading(false);
                  
                  if (isPlayingRef.current) {
                    startSourcesAt(startOffsetRef.current);
                  }
                })
                .catch(err => {
                  console.error("Failed to fetch/decode track:", err);
                  setIsLoading(false);
                });
            }

            if (msg.is_playing !== undefined) {
              const wasPlaying = isPlayingRef.current;
              setIsPlaying(msg.is_playing);

              if (msg.is_playing) {
                const currentPos = startOffsetRef.current;
                const progressDiff = Math.abs((msg.progress || 0) - currentPos);

                if (!wasPlaying || progressDiff > 1.5) {
                  startOffsetRef.current = msg.progress || 0;
                  if (decodedBufferRef.current && !isLoading) {
                    startSourcesAt(msg.progress || 0);
                  }
                }
              } else {
                if (wasPlaying) {
                  stopAllSources();
                  startOffsetRef.current = msg.progress || 0;
                  setProgress(msg.progress || 0);
                }
              }
            }

            setIsScanning(false);
          } else if (msg.type === 'search_results') {
            setSearchResults(msg.results || []);
            setIsSearching(false);
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
  }, []);

  // ── Actions ─────────────────────────────────────────────────────────────────

  const send = (payload) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify(payload));
  };


  // ── Web Audio Routing & Sync Engine ─────────────────────────────────────────

  const startSourcesAt = (offset) => {
    if (!decodedBufferRef.current) return;
    
    const audioCtx = audioContextRef.current;
    const buffer = decodedBufferRef.current;
    
    stopAllSources();
    
    const activeDevices = devicesRef.current.filter(d => d.active);
    if (activeDevices.length === 0) {
      console.warn("No active audio output devices selected.");
      return;
    }
    
    const startTime = audioCtx.currentTime + 0.05; // 50ms scheduling buffer
    startTimeRef.current = startTime - offset;
    
    const newActiveSources = {};
    
    activeDevices.forEach(device => {
      try {
        const sourceNode = audioCtx.createBufferSource();
        sourceNode.buffer = buffer;
        
        const delayNode = audioCtx.createDelay(2.0);
        const totalDelaySec = (device.delay_ms + (device.latency_ms || 0)) / 1000.0;
        delayNode.delayTime.setValueAtTime(totalDelaySec, audioCtx.currentTime);
        
        const gainNode = audioCtx.createGain();
        gainNode.gain.setValueAtTime(device.volume, audioCtx.currentTime);
        
        const destNode = audioCtx.createMediaStreamDestination();
        
        sourceNode.connect(delayNode);
        delayNode.connect(gainNode);
        gainNode.connect(destNode);
        
        const audioEl = new Audio();
        audioEl.srcObject = destNode.stream;
        audioEl.muted = false;
        audioEl.volume = 1.0;
        
        if (typeof audioEl.setSinkId === 'function' && device.deviceId) {
          audioEl.setSinkId(device.deviceId).catch(err => {
            console.error(`Failed to set sink ID for device: ${device.name}`, err);
          });
        }
        
        audioEl.play().catch(err => {
          console.error("Audio element failed to play:", err);
        });
        
        sourceNode.start(startTime, offset);
        
        newActiveSources[device.index] = {
          sourceNode,
          delayNode,
          gainNode,
          audioElement: audioEl,
          destNode
        };
      } catch (err) {
        console.error(`Failed to initialize Web Audio pipeline for device: ${device.name}`, err);
      }
    });
    
    activeSourcesRef.current = newActiveSources;
    
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
    }
    progressIntervalRef.current = setInterval(() => {
      if (audioContextRef.current && isPlayingRef.current && decodedBufferRef.current) {
        const elapsed = audioContextRef.current.currentTime - startTimeRef.current;
        const currentPos = Math.min(decodedBufferRef.current.duration, elapsed);
        setProgress(currentPos);
        
        if (elapsed >= decodedBufferRef.current.duration) {
          clearInterval(progressIntervalRef.current);
          handleTrackFinished();
        }
      }
    }, 250);
  };

  const stopAllSources = () => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
    }
    
    if (activeSourcesRef.current) {
      Object.keys(activeSourcesRef.current).forEach(idx => {
        const activeSrc = activeSourcesRef.current[idx];
        try {
          activeSrc.sourceNode.stop();
          activeSrc.sourceNode.disconnect();
        } catch (e) {}
        try {
          activeSrc.delayNode.disconnect();
          activeSrc.gainNode.disconnect();
        } catch (e) {}
        if (activeSrc.audioElement) {
          try {
            activeSrc.audioElement.pause();
            activeSrc.audioElement.srcObject = null;
          } catch (e) {}
        }
      });
      activeSourcesRef.current = {};
    }
  };

  const startDevicePlayback = (idx, offset) => {
    const device = devicesRef.current.find(d => d.index === idx);
    if (!device || !decodedBufferRef.current) return;
    
    const audioCtx = audioContextRef.current;
    const buffer = decodedBufferRef.current;
    
    try {
      const sourceNode = audioCtx.createBufferSource();
      sourceNode.buffer = buffer;
      
      const delayNode = audioCtx.createDelay(2.0);
      const totalDelaySec = (device.delay_ms + (device.latency_ms || 0)) / 1000.0;
      delayNode.delayTime.setValueAtTime(totalDelaySec, audioCtx.currentTime);
      
      const gainNode = audioCtx.createGain();
      gainNode.gain.setValueAtTime(device.volume, audioCtx.currentTime);
      
      const destNode = audioCtx.createMediaStreamDestination();
      
      sourceNode.connect(delayNode);
      delayNode.connect(gainNode);
      gainNode.connect(destNode);
      
      const audioEl = new Audio();
      audioEl.srcObject = destNode.stream;
      audioEl.muted = false;
      audioEl.volume = 1.0;
      
      if (typeof audioEl.setSinkId === 'function' && device.deviceId) {
        audioEl.setSinkId(device.deviceId).catch(err => {
          console.error(`Failed to set sink ID for device: ${device.name}`, err);
        });
      }
      
      audioEl.play().catch(err => {
        console.error("Audio element failed to play:", err);
      });
      
      sourceNode.start(audioCtx.currentTime, offset);
      
      activeSourcesRef.current[idx] = {
        sourceNode,
        delayNode,
        gainNode,
        audioElement: audioEl,
        destNode
      };
    } catch (err) {
      console.error(`Failed to start individual device: ${device.name}`, err);
    }
  };

  const stopDevicePlayback = (idx) => {
    const activeSrc = activeSourcesRef.current[idx];
    if (activeSrc) {
      try {
        activeSrc.sourceNode.stop();
      } catch (e) {}
      if (activeSrc.audioElement) {
        activeSrc.audioElement.pause();
        activeSrc.audioElement.srcObject = null;
      }
      delete activeSourcesRef.current[idx];
    }
  };

  const handleTrackFinished = () => {
    if (wsConnected) {
      // Stream advances automatically via the server side sequence pacing
    } else {
      // Local queue fallback advancing
      if (queue.length > 0) {
        const nextTrack = queue[0];
        setQueue(prev => prev.slice(1));
        loadAndPlayTrackLocally(nextTrack);
      } else {
        setIsPlaying(false);
        stopAllSources();
        startOffsetRef.current = 0;
        setProgress(0);
      }
    }
  };

  // ── Standalone Fallback Player ──────────────────────────────────────────────

  const loadAndPlayTrackLocally = async (track) => {
    try {
      setIsLoading(true);
      stopAllSources();
      startOffsetRef.current = 0;
      setProgress(0);
      setCurrentTrack(track);
      currentTrackRef.current = track;

      const baseUrl = getBackendUrls().upload.replace('/api/upload', '');
      let finalStreamUrl = track.is_local ? track.stream_url : `${baseUrl}/api/stream?url=${encodeURIComponent(track.url)}`;
      if (track.is_local) {
        const hostname = window.location.hostname;
        const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || !hostname;
        if (!isLocal) {
          finalStreamUrl = finalStreamUrl.replace('http://localhost:8000', 'https://headsetconnect.onrender.com');
        }
      }

      const response = await fetch(finalStreamUrl);
      if (!response.ok) throw new Error("Failed to fetch stream");
      const arrayBuffer = await response.arrayBuffer();

      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      const audioCtx = audioContextRef.current;
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      decodedBufferRef.current = decodedBuffer;
      setIsLoading(false);

      setIsPlaying(true);
      startSourcesAt(0);
    } catch (err) {
      console.error("Failed to load and play track locally:", err);
      alert("Error loading audio. Please verify backend is online.");
      setIsLoading(false);
    }
  };

  // ── Device State Mutators ───────────────────────────────────────────────────

  const handleToggleDevice = (idx, active) => {
    setDevices(prev => prev.map(d => d.index === idx ? { ...d, active } : d));
    
    // Immediately start or stop playback for this device if actively playing
    if (isPlayingRef.current && decodedBufferRef.current) {
      if (active) {
        setTimeout(() => {
          startDevicePlayback(idx, progress);
        }, 50);
      } else {
        stopDevicePlayback(idx);
      }
    }
  };

  const handleVolumeChange = (idx, vol) => {
    setDevices(prev => prev.map(d => d.index === idx ? { ...d, volume: vol } : d));
    
    // Realtime adjustment of browser gain node
    if (activeSourcesRef.current[idx]) {
      const audioCtx = audioContextRef.current;
      activeSourcesRef.current[idx].gainNode.gain.setValueAtTime(vol, audioCtx.currentTime);
    }
  };

  const handleDelayChange = (idx, ms) => {
    setDevices(prev => prev.map(d => d.index === idx ? { ...d, delay_ms: ms } : d));
    
    // Realtime adjustment of browser delay node
    if (activeSourcesRef.current[idx]) {
      const audioCtx = audioContextRef.current;
      const delaySec = (ms + (activeSourcesRef.current[idx].latency_ms || 0)) / 1000.0;
      activeSourcesRef.current[idx].delayNode.delayTime.setValueAtTime(delaySec, audioCtx.currentTime);
    }
  };

  // ── UI Control Handlers ─────────────────────────────────────────────────────

  const handleScan = () => {
    scanBrowserDevices();
  };

  const handleSearch = (e) => {
    e.preventDefault();
    if (!musicQuery.trim()) return;
    setIsSearching(true);
    send({ action: 'search', query: musicQuery });
  };

  const handlePlayTrack = (track) => {
    setSearchResults([]);
    setMusicQuery('');
    if (wsConnected) {
      send({ action: 'play_track', track });
    } else {
      loadAndPlayTrackLocally(track);
    }
  };

  const handleTogglePlay = () => {
    if (wsConnected) {
      send({ action: isPlaying ? 'pause' : 'play' });
    } else {
      if (!decodedBufferRef.current) return;
      const nextPlaying = !isPlaying;
      setIsPlaying(nextPlaying);
      if (nextPlaying) {
        startSourcesAt(startOffsetRef.current);
      } else {
        const elapsed = audioContextRef.current.currentTime - startTimeRef.current;
        startOffsetRef.current = (startOffsetRef.current + elapsed) % decodedBufferRef.current.duration;
        stopAllSources();
      }
    }
  };

  const handleStop = () => {
    if (wsConnected) {
      send({ action: 'stop' });
    } else {
      setIsPlaying(false);
      stopAllSources();
      startOffsetRef.current = 0;
      setProgress(0);
    }
  };

  const handleSeek = (e) => {
    const s = parseFloat(e.target.value);
    setProgress(s);
    if (wsConnected) {
      send({ action: 'seek', seconds: s });
    } else {
      startOffsetRef.current = s;
      if (isPlaying) {
        stopAllSources();
        startSourcesAt(s);
      }
    }
  };

  // ── Browser-Native Auto Calibration ────────────────────────────────────────

  const handleCalibrate = async (idx) => {
    setCalibrationStates(prev => ({
      ...prev,
      [idx]: { status: 'calibrating', latency: 0, errorMsg: '' }
    }));

    const device = devicesRef.current.find(d => d.index === idx);
    if (!device) return;

    let audioStream = null;
    let recContext = null;
    let playbackContext = null;

    try {
      audioStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        } 
      });

      playbackContext = new (window.AudioContext || window.webkitAudioContext)();
      const playDest = playbackContext.createMediaStreamDestination();
      
      const playAudio = new Audio();
      playAudio.srcObject = playDest.stream;
      playAudio.muted = false;
      playAudio.volume = 1.0;
      if (typeof playAudio.setSinkId === 'function' && device.deviceId) {
        await playAudio.setSinkId(device.deviceId);
      }
      await playAudio.play();

      recContext = new (window.AudioContext || window.webkitAudioContext)();
      const recSource = recContext.createMediaStreamSource(audioStream);
      const recNode = recContext.createScriptProcessor(4096, 1, 1);
      
      const recBuffer = [];
      let isRecording = true;

      recNode.onaudioprocess = (e) => {
        if (!isRecording) return;
        const inputData = e.inputBuffer.getChannelData(0);
        recBuffer.push(new Float32Array(inputData));
      };

      recSource.connect(recNode);
      recNode.connect(recContext.destination);

      const wasPlaying = isPlayingRef.current;
      if (wasPlaying) {
        stopAllSources();
      }

      await new Promise(resolve => setTimeout(resolve, 200));
      
      const osc = playbackContext.createOscillator();
      const oscGain = playbackContext.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1000, playbackContext.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1500, playbackContext.currentTime + 0.15);
      
      oscGain.gain.setValueAtTime(0, playbackContext.currentTime);
      oscGain.gain.linearRampToValueAtTime(0.8, playbackContext.currentTime + 0.02);
      oscGain.gain.setValueAtTime(0.8, playbackContext.currentTime + 0.13);
      oscGain.gain.linearRampToValueAtTime(0, playbackContext.currentTime + 0.15);

      osc.connect(oscGain);
      oscGain.connect(playDest);

      osc.start();
      osc.stop(playbackContext.currentTime + 0.15);

      await new Promise(resolve => setTimeout(resolve, 1200));

      isRecording = false;
      audioStream.getTracks().forEach(t => t.stop());
      recSource.disconnect();
      recNode.disconnect();
      
      let totalLength = 0;
      for (const buf of recBuffer) {
        totalLength += buf.length;
      }
      const recData = new Float32Array(totalLength);
      let offset = 0;
      for (const buf of recBuffer) {
        recData.set(buf, offset);
        offset += buf.length;
      }

      const sampleRate = recContext.sampleRate;
      
      const absData = new Float32Array(recData.length);
      for (let i = 0; i < recData.length; i++) {
        absData[i] = Math.abs(recData[i]);
      }

      const baselineSamples = Math.floor(sampleRate * 0.15);
      let noiseSum = 0;
      for (let i = 0; i < baselineSamples; i++) {
        noiseSum += absData[i];
      }
      const noiseLevel = noiseSum / baselineSamples;
      const threshold = Math.max(0.02, noiseLevel * 4.0);

      let peakIndex = -1;
      for (let i = baselineSamples; i < absData.length - 100; i++) {
        if (absData[i] > threshold) {
          let localSum = 0;
          for (let j = 0; j < 50; j++) {
            localSum += absData[i + j];
          }
          if (localSum / 50 > threshold) {
            peakIndex = i;
            break;
          }
        }
      }

      if (peakIndex !== -1) {
        const elapsedSamples = peakIndex;
        const recordedTimeMs = (elapsedSamples / sampleRate) * 1000.0;
        let latency = Math.round(recordedTimeMs - 200);
        
        if (latency < 0) latency = 0;
        if (latency > 800) {
          throw new Error("Measured latency was out of bounds (> 800ms). Please ensure speakers are audible.");
        }

        console.log(`Auto Calibration Successful! Measured latency: ${latency}ms`);

        setDevices(prev => prev.map(d => d.index === idx ? { ...d, latency_ms: latency, delay_ms: latency } : d));
        
        setCalibrationStates(prev => ({
          ...prev,
          [idx]: {
            status: 'success',
            latency: latency,
            errorMsg: ''
          }
        }));

        if (wasPlaying) {
          setTimeout(() => {
            startSourcesAt(startOffsetRef.current);
          }, 300);
        }
      } else {
        throw new Error("Could not detect the calibration chirp. Please check microphone input volume and speaker loudness.");
      }

    } catch (err) {
      console.error("Calibration failed:", err);
      setCalibrationStates(prev => ({
        ...prev,
        [idx]: {
          status: 'error',
          latency: 0,
          errorMsg: err.message || "Failed to capture chirp. Please verify permissions."
        }
      }));
    } finally {
      if (playbackContext) playbackContext.close();
      if (recContext) recContext.close();
    }
  };

  const handleResetProfile = (idx) => {
    setCalibrationStates(prev => {
      const ns = { ...prev };
      delete ns[idx];
      return ns;
    });
    setDevices(prev => prev.map(d => d.index === idx ? { ...d, latency_ms: 0, delay_ms: 0 } : d));
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
    if (!['mp3', 'wav', 'flac'].includes(fileType)) {
      alert("Only MP3, WAV, and FLAC files are supported.");
      return;
    }

    if (!wsConnected) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          setIsLoading(true);
          const arrayBuffer = event.target.result;
          if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
          }
          const decodedBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
          decodedBufferRef.current = decodedBuffer;
          
          const localTrack = {
            id: `local_${Date.now()}`,
            title: file.name,
            duration: decodedBuffer.duration,
            uploader: "Local Browser File",
            is_local: true,
            thumbnail: ""
          };
          setCurrentTrack(localTrack);
          currentTrackRef.current = localTrack;
          setIsLoading(false);
          setIsPlaying(true);
          startSourcesAt(0);
        } catch (err) {
          console.error("Local decode failed:", err);
          alert("Failed to decode local file in browser.");
          setIsLoading(false);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const formData = new FormData();
      formData.append("file", file);

      try {
        setUploadProgress(0);
        
        const urls = getBackendUrls();
        const xhr = new XMLHttpRequest();
        xhr.open("POST", urls.upload, true);
        
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

  const activeCount     = devices.filter(d => d.active).length;
  const filteredDevices = devices
    .filter(d => d.name.toLowerCase().includes(deviceSearch.toLowerCase()))
    .sort((a, b) => {
      // 1. Put active/connected devices at the very top of the list
      if (a.active && !b.active) return -1;
      if (!a.active && b.active) return 1;
      // 2. Secondary sort: Alphabetical by clean name
      return a.name.localeCompare(b.name);
    });

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
          <span className={`status-badge ${wsConnected ? 'ok' : 'err'}`}>
            {wsConnected ? <><Wifi size={12} />Live</> : <><WifiOff size={12} />Offline</>}
          </span>
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
                <h3>Drop audio files here</h3>
                <p>MP3, WAV, and FLAC files will upload in sync.</p>
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <h3>{currentTrack.title}</h3>
                        {isLoading && (
                          <span className="track-loading-badge font-mono animate-pulse" style={{
                            fontSize: '0.68rem',
                            background: 'rgba(255, 120, 0, 0.15)',
                            color: 'var(--orange)',
                            padding: '2px 6px',
                            borderRadius: '3px',
                            border: '1px solid rgba(255, 120, 0, 0.3)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}>
                            <RefreshCw size={10} className="spinning" />
                            DECODING...
                          </span>
                        )}
                      </div>
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
                  accept=".mp3,.wav,.flac"
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
                    <span>&gt; DRAG & DROP AUDIO OR CLICK TO SELECT (MP3, WAV, FLAC)</span>
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
              <span className="badge">{filteredDevices.length}</span>
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
                title="Scan for new devices"
              >
                <RefreshCw size={14} />
              </button>
            </div>
          </div>

          <p className="auto-detect-note">
            <Headphones size={10} />
            All playback devices listed · Auto-refreshes every 5s
          </p>



          {/* Scrollable device list */}
          <div className="device-grid">
            {filteredDevices.length === 0 ? (
              <div className="empty-state">
                <Bluetooth size={38} />
                <p>{deviceSearch ? `No match for "${deviceSearch}"` : 'No Bluetooth headsets found'}</p>
                <p className="hint">Pair headsets in Windows Bluetooth settings, then click refresh.</p>
                {!deviceSearch && (
                  <button className="btn-outline" onClick={handleScan}>
                    <RefreshCw size={13} /> Scan Now
                  </button>
                )}
              </div>
            ) : (
              filteredDevices.map(dev => (
                <DeviceCard
                  key={dev.index}
                  device={dev}
                  isNew={hotPlugNames.has(dev.name) && !dev.active}
                  calibrationState={calibrationStates[dev.index]}
                  onToggle={handleToggleDevice}
                  onVolume={handleVolumeChange}
                  onDelay={handleDelayChange}
                  onCalibrate={handleCalibrate}
                  onResetProfile={handleResetProfile}
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
    </div>
  );
}
