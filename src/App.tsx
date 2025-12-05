import { useEffect, useState, useRef } from "react";
import { detectPitch } from "./pitchDetection";

const COLOR_THRESHOLDS = [
  { maxFreq: 130, color: "#990000", label: "< 150 Hz: Red" },
  { maxFreq: 145, color: "#994400", label: "150-165 Hz: Orange" },
  { maxFreq: 165, color: "#334433", label: "165-180 Hz: Grey" },
  { maxFreq: Infinity, color: "#446644", label: "High Pitches: Grey-Green" },
  { maxFreq: null, color: "#000000", label: "No pitch detected" },
];

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
        detectPitch(buffer, sampleRate, 105, 400) ??
        detectPitch(buffer, sampleRate, 105, 800);

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

  // Spacebar listener for playing tone
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && e.target === document.body) {
        e.preventDefault();
        playTone();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toneFrequency]);

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
            marginBottom: "2rem",
            padding: "1rem",
            backgroundColor: "rgba(0,0,0,0.3)",
            borderRadius: "8px",
          }}
        >
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
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
              Tone (Space)
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
              min={165}
              max={205}
              step={10}
              value={toneFrequency}
              onChange={(e) => setToneFrequency(Number(e.target.value))}
              style={{ width: "150px" }}
            />
          </div>
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
