/**
 * Detects pitch using autocorrelation with voice-focused improvements
 * Uses peak-picking strategy to avoid octave errors (detecting half-frequency)
 */
export function detectPitch(
  buffer: Float32Array,
  sampleRate: number,
  minFrequency: number = 80, // Voice typically 80Hz+
  maxFrequency: number = 400, // Upper limit for fundamental (not harmonics)
  isMobile: boolean = false // Mobile devices get increased sensitivity
): number | null {
  // Sensitivity thresholds - mobile gets more sensitive settings
  const rmsThreshold = isMobile ? 0.004 : 0.01;
  const clipPercent = isMobile ? 0.3 : 0.5;
  const correlationThreshold = isMobile ? 0.6 : 0.7;

  // 1. RMS amplitude check
  const rms = Math.sqrt(
    buffer.reduce((sum, val) => sum + val * val, 0) / buffer.length
  );
  if (rms < rmsThreshold) return null;

  // 2. Apply simple center-clipping to emphasize periodicity
  //    This helps reject noise and aperiodic sounds
  const clipped = new Float32Array(buffer.length);
  const clipThreshold = rms * clipPercent;
  for (let i = 0; i < buffer.length; i++) {
    const v = buffer[i];
    clipped[i] = Math.abs(v) > clipThreshold ? v : 0;
  }

  // 3. Compute normalized autocorrelation for all offsets
  const minPeriod = Math.floor(sampleRate / maxFrequency);
  const maxPeriod = Math.ceil(sampleRate / minFrequency);
  const corrValues: number[] = [];

  for (
    let offset = minPeriod;
    offset < maxPeriod && offset < clipped.length / 2;
    offset++
  ) {
    let correlation = 0;
    let energy1 = 0;
    let energy2 = 0;

    for (let i = 0; i < clipped.length - offset; i++) {
      correlation += clipped[i] * clipped[i + offset];
      energy1 += clipped[i] * clipped[i];
      energy2 += clipped[i + offset] * clipped[i + offset];
    }

    // Normalized correlation (prevents bias toward longer offsets)
    const normalizedCorr = correlation / Math.sqrt(energy1 * energy2 + 1e-10);
    corrValues.push(normalizedCorr);
  }

  // 4. Find all local maxima (peaks) in the correlation
  const peaks: { offset: number; value: number }[] = [];
  for (let i = 1; i < corrValues.length - 1; i++) {
    if (
      corrValues[i] > corrValues[i - 1] &&
      corrValues[i] > corrValues[i + 1]
    ) {
      peaks.push({ offset: minPeriod + i, value: corrValues[i] });
    }
  }

  if (peaks.length === 0) return null;

  // 5. Pick the FIRST peak that exceeds threshold (favors higher frequency)
  //    This prevents octave errors where we detect half the frequency
  const globalMax = Math.max(...peaks.map((p) => p.value));
  const pickThreshold = globalMax * 0.85; // Accept peaks within 85% of max

  let bestPeak = peaks[0];
  for (const peak of peaks) {
    if (peak.value >= pickThreshold) {
      bestPeak = peak;
      break; // Take the first (smallest period = highest frequency) good peak
    }
  }

  // 6. Require strong correlation for voice (periodic signal)
  if (bestPeak.value < correlationThreshold) {
    return null; // Not periodic enough to be voice
  }

  let bestOffset = bestPeak.offset;

  // 7. Parabolic interpolation for sub-sample accuracy
  if (
    bestOffset > minPeriod &&
    bestOffset < minPeriod + corrValues.length - 1
  ) {
    const idx = bestOffset - minPeriod;
    if (idx > 0 && idx < corrValues.length - 1) {
      const y0 = corrValues[idx - 1];
      const y1 = corrValues[idx];
      const y2 = corrValues[idx + 1];
      const denom = y0 - 2 * y1 + y2;
      if (Math.abs(denom) > 1e-10) {
        const delta = (y0 - y2) / (2 * denom);
        bestOffset += delta;
      }
    }
  }

  return sampleRate / bestOffset;
}
