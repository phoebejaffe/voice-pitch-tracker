import { useEffect, useState, useRef, useCallback } from "react";
import { detectPitch } from "./pitchDetection";

const BELOW_FLOOR_ALERT_MS = 200;
const REFERENCE_TONE_DURATION_S = 0.35;

function playReferenceTone(audioContext: AudioContext, frequencyHz: number) {
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc.type = "sine";
  osc.frequency.value = frequencyHz;
  const now = audioContext.currentTime;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.2, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + REFERENCE_TONE_DURATION_S);
  osc.connect(gain);
  gain.connect(audioContext.destination);
  osc.start(now);
  osc.stop(now + REFERENCE_TONE_DURATION_S + 0.05);
}

const COLOR_THRESHOLDS = [
  { maxFreq: 140, color: "#990000", label: "< 150 Hz: Red" },
  { maxFreq: 165, color: "#994400", label: "150-165 Hz: Orange" },
  { maxFreq: 180, color: "#333333", label: "165-180 Hz: Grey" },
  { maxFreq: Infinity, color: "#446644", label: "High Pitches: Grey-Green" },
  { maxFreq: null, color: "#000000", label: "No pitch detected" },
];

function App() {
  const [frequency, setFrequency] = useState<number | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pitchFloorHz, setPitchFloorHz] = useState(165);
  const [alertBelowFloor, setAlertBelowFloor] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const frequencyHistoryRef = useRef<number[]>([]);
  const pitchFloorRef = useRef(pitchFloorHz);
  const alertBelowFloorRef = useRef(alertBelowFloor);
  const belowFloorSinceRef = useRef<number | null>(null);
  const alertArmedRef = useRef(true);

  pitchFloorRef.current = pitchFloorHz;
  alertBelowFloorRef.current = alertBelowFloor;

  const getBackgroundColor = (freq: number | null): string | undefined => {
    if (freq === null) {
      return COLOR_THRESHOLDS.find((threshold) => threshold.maxFreq === null)
        ?.color;
    }
    for (const threshold of COLOR_THRESHOLDS) {
      if (threshold.maxFreq && freq < threshold.maxFreq) {
        return threshold.color;
      }
    }

    return COLOR_THRESHOLDS.find((threshold) => threshold.maxFreq === Infinity)
      ?.color;
  };

  const startListening = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();

      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0.8;

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
        detectPitch(buffer, sampleRate, 85, 400) ??
        detectPitch(buffer, sampleRate, 85, 800);

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

      // Only show frequency if we have 10+ detections in the last time period
      const hasEnoughDetections = frequencyHistoryRef.current.length >= 4;
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
          playReferenceTone(ctx, floor);
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

  const stopListening = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    analyserRef.current = null;
    frequencyHistoryRef.current = [];
    belowFloorSinceRef.current = null;
    alertArmedRef.current = true;
    setIsListening(false);
    setFrequency(null);
  }, []);

  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);

  const backgroundColor = getBackgroundColor(frequency);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        margin: 0,
        padding: 0,
        backgroundColor,
        transition:
          frequency === null
            ? "background-color 1s 2s ease" // hold color during silences
            : frequency && frequency > 170
            ? "background-color 0.2s 0.2s ease" // smooth transition when pitch isn't super low
            : "none", // fast transition when pitch is super low for faster feedback
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
            marginBottom: "1.5rem",
            fontSize: "1rem",
            textAlign: "left",
            maxWidth: "22rem",
            marginLeft: "auto",
            marginRight: "auto",
            backgroundColor: "rgba(0,0,0,0.25)",
            padding: "1rem 1.25rem",
            borderRadius: "8px",
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              marginBottom: "0.75rem",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={alertBelowFloor}
              onChange={(e) => setAlertBelowFloor(e.target.checked)}
            />
            Play reference tone when voice stays below pitch floor for{" "}
            {(BELOW_FLOOR_ALERT_MS / 1000).toFixed(1)}s
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
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
        </div>

        {isListening && (
          <div>
            <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>
              {frequency !== null ? (
                <>
                  <strong>{frequency.toFixed(1)} Hz</strong>
                </>
              ) : (
                <span style={{ opacity: 0.5 }}>Listening...</span>
              )}
            </div>

            <div style={{ fontSize: "1rem", opacity: 0.7 }}>
              {COLOR_THRESHOLDS.map((threshold, index) => (
                <p key={index}>{threshold.label}</p>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
