import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { detectPitch } from "./pitchDetection";

const BELOW_FLOOR_ALERT_MS = 400;
const REFERENCE_TONE_DURATION_S = 0.35;

/** Reference tone: fundamentals 1×–6×; each step ×0.9 level; skips partials above Nyquist. */
function playReferenceTone(
  audioContext: AudioContext,
  frequencyHz: number,
  volume01: number
) {
  const vol = Math.min(1, Math.max(0, volume01));
  if (vol < 0.001) return;

  const now = audioContext.currentTime;
  const stopAt = now + REFERENCE_TONE_DURATION_S + 0.05;
  const nyquistSafe = audioContext.sampleRate * 0.45;

  const stepDown = 0.9;
  const harmonicMults = [1, 2, 3, 4, 5, 6] as const;
  const rawWeights = harmonicMults.map((_, i) => stepDown ** i);
  const weightSum = rawWeights.reduce((a, b) => a + b, 0);
  /** Sum of partial gains at oscillator output (before master envelope). */
  const partialDriver = 0.62;
  const partialLevels = rawWeights.map((w) => (w / weightSum) * partialDriver);

  const masterPeak = 0.58 * vol;

  const masterGain = audioContext.createGain();
  masterGain.connect(audioContext.destination);
  masterGain.gain.setValueAtTime(0.0001, now);
  masterGain.gain.exponentialRampToValueAtTime(masterPeak, now + 0.02);
  masterGain.gain.exponentialRampToValueAtTime(
    0.0001,
    now + REFERENCE_TONE_DURATION_S
  );

  harmonicMults.forEach((mult, i) => {
    const f = frequencyHz * mult;
    if (f >= nyquistSafe) return;

    const osc = audioContext.createOscillator();
    const partialGain = audioContext.createGain();
    osc.type = "sine";
    osc.frequency.value = f;
    partialGain.gain.value = partialLevels[i]!;
    osc.connect(partialGain);
    partialGain.connect(masterGain);
    osc.start(now);
    osc.stop(stopAt);
  });
}

const isMobileDevice = () =>
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  ) || window.innerWidth < 768;

const COLOR_THRESHOLDS = [
  { maxFreq: 130, color: "#990000", label: "< 130 Hz: Red" },
  { maxFreq: 145, color: "#994400", label: "130-145 Hz: Orange" },
  { maxFreq: 165, color: "#334433", label: "145-165 Hz: Dark Green" },
  { maxFreq: Infinity, color: "#446644", label: "> 165 Hz: Green" },
  { maxFreq: null, color: "#000000", label: "No pitch detected" },
];

function lerpColor(color1: string, color2: string, t: number): string {
  const c1 = parseInt(color1.slice(1), 16);
  const c2 = parseInt(color2.slice(1), 16);

  const r1 = (c1 >> 16) & 0xff,
    g1 = (c1 >> 8) & 0xff,
    b1 = c1 & 0xff;
  const r2 = (c2 >> 16) & 0xff,
    g2 = (c2 >> 8) & 0xff,
    b2 = c2 & 0xff;

  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);

  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

const FREQ_MIN = 100;
const FREQ_MAX = 400;

function PitchIndicator({
  frequency,
  pitchFloorHz,
}: {
  frequency: number | null;
  pitchFloorHz: number;
}) {
  const height = 400;
  const width = 40;

  const [lastY, setLastY] = useState<number | null>(null);
  const [opacity, setOpacity] = useState(1);
  const fadeTimeoutRef = useRef<number | null>(null);

  const freqToY = (freq: number) => {
    const logMin = Math.log(FREQ_MIN);
    const logMax = Math.log(FREQ_MAX);
    const normalized = (Math.log(freq) - logMin) / (logMax - logMin);
    return height - normalized * height;
  };

  useEffect(() => {
    if (frequency !== null && frequency >= FREQ_MIN && frequency <= FREQ_MAX) {
      setLastY(freqToY(frequency));
      setOpacity(1);
      if (fadeTimeoutRef.current) {
        clearTimeout(fadeTimeoutRef.current);
        fadeTimeoutRef.current = null;
      }
    } else if (lastY !== null && opacity === 1) {
      fadeTimeoutRef.current = window.setTimeout(() => {
        setOpacity(0);
      }, 300);
    }
    return () => {
      if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
    };
  }, [frequency]);

  const segments: { y: number; height: number; color: string }[] = [];
  const colorThresholds = COLOR_THRESHOLDS.filter((t) => t.maxFreq !== null);

  let prevFreq = FREQ_MIN;
  for (const threshold of colorThresholds) {
    const maxFreq =
      threshold.maxFreq === Infinity ? FREQ_MAX : (threshold.maxFreq as number);
    if (prevFreq >= FREQ_MAX) break;

    const segStart = Math.max(prevFreq, FREQ_MIN);
    const segEnd = Math.min(maxFreq, FREQ_MAX);

    if (segEnd > segStart) {
      const y1 = freqToY(segEnd);
      const y2 = freqToY(segStart);
      segments.push({
        y: y1,
        height: y2 - y1,
        color: threshold.color,
      });
    }
    prevFreq = maxFreq;
  }

  const floorY =
    pitchFloorHz >= FREQ_MIN && pitchFloorHz <= FREQ_MAX
      ? freqToY(pitchFloorHz)
      : null;

  return (
    <div
      style={{
        position: "relative",
        width,
        height,
        borderRadius: 8,
        overflow: "hidden",
        border: "2px solid rgba(255,255,255,0.3)",
      }}
    >
      {segments.map((seg, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: 0,
            top: seg.y,
            width: "100%",
            height: seg.height,
            backgroundColor: seg.color,
          }}
        />
      ))}

      {floorY !== null && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: floorY - 1,
            width: "100%",
            height: 2,
            backgroundColor: "rgba(255,255,255,0.55)",
            pointerEvents: "none",
          }}
        />
      )}

      {lastY !== null && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: lastY - 2,
            width: "100%",
            height: 4,
            backgroundColor: "white",
            boxShadow: "0 0 8px rgba(255,255,255,0.8)",
            opacity,
            transition: opacity === 0 ? "opacity 0.3s ease" : "none",
          }}
        />
      )}

      <span
        style={{
          position: "absolute",
          top: 4,
          left: 4,
          fontSize: 12,
          opacity: 0.7,
        }}
      >
        {FREQ_MAX}
      </span>
      <span
        style={{
          position: "absolute",
          bottom: 4,
          left: 4,
          fontSize: 12,
          opacity: 0.7,
        }}
      >
        {FREQ_MIN}
      </span>
    </div>
  );
}

function App() {
  const [frequency, setFrequency] = useState<number | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toneFrequency, setToneFrequency] = useState(165);
  const [pitchFloorHz, setPitchFloorHz] = useState(165);
  const [alertBelowFloor, setAlertBelowFloor] = useState(false);
  const [referenceToneVolume, setReferenceToneVolume] = useState(100);
  const [keepScreenOn, setKeepScreenOn] = useState(false);
  const [isDronePlaying, setIsDronePlaying] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const frequencyHistoryRef = useRef<number[]>([]);
  const toneContextRef = useRef<AudioContext | null>(null);
  const droneOscillatorRef = useRef<OscillatorNode | null>(null);
  const droneGainRef = useRef<GainNode | null>(null);
  const lastColorRef = useRef<string>("#000000");
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const pitchFloorRef = useRef(pitchFloorHz);
  const alertBelowFloorRef = useRef(alertBelowFloor);
  const referenceToneVolumeRef = useRef(referenceToneVolume);
  const belowFloorSinceRef = useRef<number | null>(null);
  const alertArmedRef = useRef(true);

  const isMobile = useMemo(() => isMobileDevice(), []);

  pitchFloorRef.current = pitchFloorHz;
  alertBelowFloorRef.current = alertBelowFloor;
  referenceToneVolumeRef.current = referenceToneVolume;

  const stopDrone = useCallback(() => {
    if (droneOscillatorRef.current) {
      droneOscillatorRef.current.stop();
      droneOscillatorRef.current = null;
    }
    droneGainRef.current = null;
    setIsDronePlaying(false);
  }, []);

  useEffect(() => {
    const acquireWakeLock = async () => {
      if (!("wakeLock" in navigator)) return;
      try {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
      } catch (err) {
        console.error("Wake Lock error:", err);
      }
    };

    const releaseWakeLock = async () => {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
    };

    const handleVisibilityChange = () => {
      if (keepScreenOn && document.visibilityState === "visible") {
        acquireWakeLock();
      }
    };

    if (keepScreenOn) {
      acquireWakeLock();
      document.addEventListener("visibilitychange", handleVisibilityChange);
    } else {
      releaseWakeLock();
    }

    return () => {
      releaseWakeLock();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [keepScreenOn]);

  const playTone = () => {
    if (isDronePlaying) {
      stopDrone();
    }

    if (!toneContextRef.current || toneContextRef.current.state === "closed") {
      toneContextRef.current = new AudioContext();
    }
    const ctx = toneContextRef.current;

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(toneFrequency, ctx.currentTime);

    gainNode.gain.setValueAtTime(0.5, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 1);
  };

  const startDrone = () => {
    if (!toneContextRef.current || toneContextRef.current.state === "closed") {
      toneContextRef.current = new AudioContext();
    }
    const ctx = toneContextRef.current;

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(toneFrequency, ctx.currentTime);
    gainNode.gain.setValueAtTime(0.1, ctx.currentTime);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start(ctx.currentTime);

    droneOscillatorRef.current = oscillator;
    droneGainRef.current = gainNode;
    setIsDronePlaying(true);
  };

  const getBackgroundColor = (freq: number | null): string => {
    if (freq === null) {
      return (
        COLOR_THRESHOLDS.find((t) => t.maxFreq === null)?.color ?? "#000000"
      );
    }

    const BLEND_RANGE = 5;
    const thresholds = COLOR_THRESHOLDS.filter(
      (t) => t.maxFreq !== null && t.maxFreq !== Infinity
    );

    for (let i = 0; i < thresholds.length; i++) {
      const threshold = thresholds[i];
      const thresholdFreq = threshold.maxFreq as number;
      const nextColor =
        thresholds[i + 1]?.color ??
        COLOR_THRESHOLDS.find((t) => t.maxFreq === Infinity)?.color ??
        "#446644";

      if (
        freq >= thresholdFreq - BLEND_RANGE &&
        freq < thresholdFreq + BLEND_RANGE
      ) {
        const t = (freq - (thresholdFreq - BLEND_RANGE)) / (BLEND_RANGE * 2);
        return lerpColor(threshold.color, nextColor, t);
      }

      if (freq < thresholdFreq - BLEND_RANGE) {
        return threshold.color;
      }
    }

    return (
      COLOR_THRESHOLDS.find((t) => t.maxFreq === Infinity)?.color ?? "#446644"
    );
  };

  const analyzeAudio = () => {
    if (!analyserRef.current) return;

    const bufferLength = analyserRef.current.fftSize;
    const buffer = new Float32Array(bufferLength);

    const analyze = () => {
      if (!analyserRef.current || !audioContextRef.current) return;

      analyserRef.current.getFloatTimeDomainData(buffer);

      const sampleRate = audioContextRef.current.sampleRate;
      const minHz = isMobile ? 105 : 85;
      const detectedFreq =
        detectPitch(buffer, sampleRate, minHz, 400) ??
        detectPitch(buffer, sampleRate, minHz, 800);

      const now = Date.now();
      const twoSecondsAgo = now - 2000;

      frequencyHistoryRef.current = frequencyHistoryRef.current.filter(
        (timestamp) => timestamp > twoSecondsAgo
      );

      if (detectedFreq !== null) {
        frequencyHistoryRef.current.push(now);
      }

      const hasEnoughDetections = frequencyHistoryRef.current.length >= 2;
      const displayFreq = hasEnoughDetections ? detectedFreq : null;
      setFrequency(displayFreq);

      const floor = pitchFloorRef.current;
      const alertOn = alertBelowFloorRef.current;
      const ctx = audioContextRef.current;

      if (!alertOn || !ctx) {
        belowFloorSinceRef.current = null;
        alertArmedRef.current = true;
      } else if (!alertArmedRef.current) {
        if (displayFreq === null || displayFreq >= floor) {
          alertArmedRef.current = true;
        }
        belowFloorSinceRef.current = null;
      } else if (displayFreq !== null && displayFreq < floor) {
        const t = performance.now();
        if (belowFloorSinceRef.current === null) {
          belowFloorSinceRef.current = t;
        } else if (t - belowFloorSinceRef.current >= BELOW_FLOOR_ALERT_MS) {
          playReferenceTone(ctx, floor, referenceToneVolumeRef.current / 100);
          alertArmedRef.current = false;
          belowFloorSinceRef.current = null;
        }
      } else {
        belowFloorSinceRef.current = null;
      }

      animationFrameRef.current = requestAnimationFrame(analyze);
    };

    analyze();
  };

  const startListening = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();

      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.3;

      source.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      setIsListening(true);
      setError(null);

      analyzeAudio();
    } catch (err) {
      setError(
        "Failed to access microphone. Please grant microphone permissions."
      );
      console.error("Microphone access error:", err);
    }
  };

  const stopListening = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    analyserRef.current = null;
    frequencyHistoryRef.current = [];
    belowFloorSinceRef.current = null;
    alertArmedRef.current = true;
    stopDrone();
    setIsListening(false);
    setFrequency(null);
  }, [stopDrone]);

  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);

  if (frequency !== null) {
    lastColorRef.current = getBackgroundColor(frequency);
  }
  const backgroundColor = lastColorRef.current;

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        minHeight: "100dvh",
        margin: 0,
        padding:
          "max(1rem, env(safe-area-inset-top)) max(0.75rem, env(safe-area-inset-right)) max(2rem, env(safe-area-inset-bottom)) max(0.75rem, env(safe-area-inset-left))",
        backgroundColor,
        transition: "background-color 0.1s ease",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
        color: "white",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: "3rem", marginBottom: "2rem" }}>
          Voice Floor Tracker
        </h1>

        {error && (
          <div
            style={{
              backgroundColor: "rgba(255, 0, 0, 0.2)",
              border: "1px solid red",
              padding: "1rem",
              borderRadius: "8px",
              marginBottom: "2rem",
            }}
          >
            {error}
          </div>
        )}

        <div style={{ marginBottom: "2rem" }}>
          {!isListening ? (
            <button
              onClick={startListening}
              style={{
                padding: "1rem 2rem",
                fontSize: "1.2rem",
                backgroundColor: "#4CAF50",
                color: "white",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
              }}
            >
              Start Listening
            </button>
          ) : (
            <button
              onClick={stopListening}
              style={{
                padding: "1rem 2rem",
                fontSize: "1.2rem",
                backgroundColor: "rgba(0,0,0,0.5)",
                color: "white",
                border: "2px solid rgba(75,75,75,0.5)",
                borderRadius: "8px",
                cursor: "pointer",
              }}
            >
              Stop Listening
            </button>
          )}
        </div>

        <div
          style={{
            display: "flex",
            gap: "2rem",
            alignItems: "center",
            width: "300px",
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          <PitchIndicator frequency={frequency} pitchFloorHz={pitchFloorHz} />
          <div>
            <div
              style={{
                fontSize: "2rem",
                marginBottom: "1rem",
                textAlign: "left",
              }}
            >
              {frequency !== null ? (
                <>
                  <strong>{Math.round(frequency)} Hz</strong>
                </>
              ) : (
                <span style={{ opacity: 0.5 }}>
                  {isListening ? "Listening" : "Not Listening"}
                </span>
              )}
            </div>

            <div style={{ fontSize: "1rem", opacity: 0.7, textAlign: "left" }}>
              {COLOR_THRESHOLDS.map((threshold, index) => (
                <p key={index} style={{ margin: "0.25rem 0" }}>
                  {threshold.label}
                </p>
              ))}
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: "2rem",
            padding: "1rem",
            backgroundColor: "rgba(0,0,0,0.3)",
            borderRadius: "8px",
            width: "300px",
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: "0.5rem",
              marginBottom: "1rem",
              justifyContent: "center",
            }}
          >
            <button
              onClick={playTone}
              style={{
                padding: "0.75rem 1.5rem",
                fontSize: "1rem",
                backgroundColor: "#2196F3",
                color: "white",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
              }}
            >
              Tone
            </button>
            <button
              onClick={isDronePlaying ? stopDrone : startDrone}
              style={{
                padding: "0.75rem 1.5rem",
                fontSize: "1rem",
                backgroundColor: isDronePlaying ? "#f44336" : "#9C27B0",
                color: "white",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
              }}
            >
              {isDronePlaying ? "Stop" : "Drone"}
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <label htmlFor="toneFreq">Tone: {toneFrequency} Hz</label>
            <input
              id="toneFreq"
              type="range"
              min={155}
              max={205}
              step={10}
              value={toneFrequency}
              onChange={(e) => setToneFrequency(Number(e.target.value))}
              style={{ width: "150px" }}
            />
          </div>

          <div
            style={{
              marginTop: "1rem",
              paddingTop: "1rem",
              borderTop: "1px solid rgba(255,255,255,0.15)",
              textAlign: "left",
            }}
          >
            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "0.5rem",
                marginBottom: "0.75rem",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={alertBelowFloor}
                onChange={(e) => setAlertBelowFloor(e.target.checked)}
                style={{ marginTop: "0.2rem" }}
              />
              <span>
                Reference tone if voice stays below pitch floor for{" "}
                {(BELOW_FLOOR_ALERT_MS / 1000).toFixed(1)}s (while listening)
              </span>
            </label>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                marginBottom: "0.75rem",
              }}
            >
              <span style={{ whiteSpace: "nowrap" }}>Pitch floor (Hz)</span>
              <input
                type="number"
                min={80}
                max={400}
                step={1}
                value={pitchFloorHz}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isFinite(v)) return;
                  setPitchFloorHz(Math.min(400, Math.max(80, Math.round(v))));
                }}
                style={{
                  width: "5rem",
                  padding: "0.35rem 0.5rem",
                  borderRadius: "4px",
                  border: "1px solid rgba(255,255,255,0.35)",
                  backgroundColor: "rgba(0,0,0,0.35)",
                  color: "inherit",
                }}
              />
            </label>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                flexWrap: "wrap",
              }}
            >
              <label htmlFor="refToneVol" style={{ whiteSpace: "nowrap" }}>
                Reference volume: {referenceToneVolume}%
              </label>
              <input
                id="refToneVol"
                type="range"
                min={0}
                max={100}
                step={1}
                value={referenceToneVolume}
                onChange={(e) =>
                  setReferenceToneVolume(Number(e.target.value))
                }
                style={{ flex: "1 1 140px", minWidth: "120px" }}
              />
            </div>
          </div>
        </div>

        {"wakeLock" in navigator && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              marginTop: "1.5rem",
              justifyContent: "center",
            }}
          >
            <input
              id="keepScreenOn"
              type="checkbox"
              checked={keepScreenOn}
              onChange={(e) => setKeepScreenOn(e.target.checked)}
              style={{ width: "18px", height: "18px", cursor: "pointer" }}
            />
            <label htmlFor="keepScreenOn" style={{ cursor: "pointer" }}>
              Keep screen on
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
