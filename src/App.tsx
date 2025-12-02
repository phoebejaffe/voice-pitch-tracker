import { useEffect, useState, useRef } from "react";
import { detectPitch } from "./pitchDetection";

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
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

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
      const detectedFreq = detectPitch(buffer, sampleRate, 85, 800);

      setFrequency(detectedFreq);

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
    setIsListening(false);
    setFrequency(null);
  };

  useEffect(() => {
    return () => {
      stopListening();
    };
  }, []);

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
            : frequency && frequency > 180
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
                backgroundColor: "#f44336",
                color: "white",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
              }}
            >
              Stop Listening
            </button>
          )}
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
