/**
 * Detects pitch using autocorrelation with voice-focused improvements
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

  // 3. Normalized autocorrelation (NSDF-style)
  const minPeriod = Math.floor(sampleRate / maxFrequency);
  const maxPeriod = Math.ceil(sampleRate / minFrequency);

  let bestOffset = -1;
  let bestNormalizedCorr = 0;

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

    if (normalizedCorr > bestNormalizedCorr) {
      bestNormalizedCorr = normalizedCorr;
      bestOffset = offset;
    }
  }

  // 4. Require strong correlation for voice (periodic signal)
  if (bestOffset === -1 || bestNormalizedCorr < correlationThreshold) {
    return null; // Not periodic enough to be voice
  }

  // 5. Parabolic interpolation for sub-sample accuracy
  if (bestOffset > minPeriod && bestOffset < maxPeriod - 1) {
    // Recalculate neighbors for interpolation
    const getCorr = (off: number) => {
      let c = 0;
      for (let i = 0; i < clipped.length - off; i++) {
        c += clipped[i] * clipped[i + off];
      }
      return c;
    };
    const y0 = getCorr(bestOffset - 1);
    const y1 = getCorr(bestOffset);
    const y2 = getCorr(bestOffset + 1);
    const delta = (y0 - y2) / (2 * (y0 - 2 * y1 + y2));
    bestOffset += delta;
  }

  return sampleRate / bestOffset;
}
