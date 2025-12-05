import { useEffect, useState, useRef, useMemo } from "react";
import { detectPitch } from "./pitchDetection";

// Simple mobile detection
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

// Linear interpolation between two hex colors
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

// Frequency range for the visual indicator
const FREQ_MIN = 100;
const FREQ_MAX = 400;

function PitchIndicator({ frequency }: { frequency: number | null }) {
  const height = 400;
  const width = 40;

  const [lastY, setLastY] = useState<number | null>(null);
  const [opacity, setOpacity] = useState(1);
  const fadeTimeoutRef = useRef<number | null>(null);

  // Calculate position for a given frequency (logarithmic scale, low freq at bottom)
  const freqToY = (freq: number) => {
    const logMin = Math.log(FREQ_MIN);
    const logMax = Math.log(FREQ_MAX);
    const normalized = (Math.log(freq) - logMin) / (logMax - logMin);
    return height - normalized * height;
  };

  // Handle pitch changes and fade logic
  useEffect(() => {
    if (frequency !== null && frequency >= FREQ_MIN && frequency <= FREQ_MAX) {
      // Pitch detected and within range - update position, show immediately
      setLastY(freqToY(frequency));
      setOpacity(1);
      if (fadeTimeoutRef.current) {
        clearTimeout(fadeTimeoutRef.current);
        fadeTimeoutRef.current = null;
      }
    } else if (lastY !== null && opacity === 1) {
      // Pitch lost or out of range - wait 0.3s then start fade
      fadeTimeoutRef.current = window.setTimeout(() => {
        setOpacity(0);
      }, 300);
    }
    return () => {
      if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
    };
  }, [frequency]);

  // Build color segments
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
      {/* Color segments */}
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

      {/* Pitch indicator line */}
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

      {/* Frequency labels */}
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
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const frequencyHistoryRef = useRef<number[]>([]);
  const toneContextRef = useRef<AudioContext | null>(null);
  const [isDronePlaying, setIsDronePlaying] = useState(false);
  const droneOscillatorRef = useRef<OscillatorNode | null>(null);
  const droneGainRef = useRef<GainNode | null>(null);
  const lastColorRef = useRef<string>("#000000");
  const isMobile = useMemo(() => isMobileDevice(), []);

  const stopDrone = () => {
    if (droneOscillatorRef.current) {
      droneOscillatorRef.current.stop();
      droneOscillatorRef.current = null;
    }
    droneGainRef.current = null;
    setIsDronePlaying(false);
  };

  const playTone = () => {
    // Stop drone if playing
    if (isDronePlaying) {
      stopDrone();
    }

    // Create a new AudioContext for the tone (or reuse)
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

    const BLEND_RANGE = 5; // Hz range for smooth transition
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

      // Within blend range of this threshold
      if (
        freq >= thresholdFreq - BLEND_RANGE &&
        freq < thresholdFreq + BLEND_RANGE
      ) {
        const t = (freq - (thresholdFreq - BLEND_RANGE)) / (BLEND_RANGE * 2);
        return lerpColor(threshold.color, nextColor, t);
      }

      // Below this threshold (not in blend range)
      if (freq < thresholdFreq - BLEND_RANGE) {
        return threshold.color;
      }
    }

    return (
      COLOR_THRESHOLDS.find((t) => t.maxFreq === Infinity)?.color ?? "#446644"
    );
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

      // Start analysis loop
      analyzeAudio();
    } catch (err) {
      setError(
        "Failed to access microphone. Please grant microphone permissions."
      );
      console.error("Microphone access error:", err);
    }
  };

  const analyzeAudio = () => {
    if (!analyserRef.current) return;

    const bufferLength = analyserRef.current.fftSize;
    const buffer = new Float32Array(bufferLength);

    const analyze = () => {
      if (!analyserRef.current || !audioContextRef.current) return;

      analyserRef.current.getFloatTimeDomainData(buffer);

      const sampleRate = audioContextRef.current.sampleRate;
      const detectedFreq =
        detectPitch(buffer, sampleRate, 105, 400, isMobile) ??
        detectPitch(buffer, sampleRate, 105, 800, isMobile);

      // Track frequency detections with timestamps
      const now = Date.now();
      const twoSecondsAgo = now - 2000;

      // Filter out detections older than 5 seconds
      frequencyHistoryRef.current = frequencyHistoryRef.current.filter(
        (timestamp) => timestamp > twoSecondsAgo
      );

      // Add current detection if frequency was found
      if (detectedFreq !== null) {
        frequencyHistoryRef.current.push(now);
      }

      // Only show frequency if we have enough detections in the last time period
      const hasEnoughDetections = frequencyHistoryRef.current.length >= 2;
      setFrequency(hasEnoughDetections ? detectedFreq : null);

      animationFrameRef.current = requestAnimationFrame(analyze);
    };

    analyze();
  };

  const stopListening = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    analyserRef.current = null;
    frequencyHistoryRef.current = [];
    setIsListening(false);
    setFrequency(null);
  };

  useEffect(() => {
    return () => {
      stopListening();
    };
  }, []);

  // Keep the last color when frequency is null (don't transition through black)
  if (frequency !== null) {
    lastColorRef.current = getBackgroundColor(frequency);
  }
  const backgroundColor = lastColorRef.current;

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        margin: 0,
        padding: 0,
        backgroundColor,
        transition: "background-color 0.1s ease",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        color: "white",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: "3rem", marginBottom: "2rem" }}>
          Voice Pitch Tracker
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
          <PitchIndicator frequency={frequency} />
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
        </div>
      </div>
    </div>
  );
}

export default App;
