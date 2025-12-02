/**
 * Detects pitch using autocorrelation algorithm
 * Returns frequency in Hz or null if no clear pitch detected
 */
export function detectPitch(
  buffer: Float32Array,
  sampleRate: number,
  minFrequency: number = 50,
  maxFrequency: number = 500
): number | null {
  // Calculate amplitude threshold
  const rms = Math.sqrt(buffer.reduce((sum, val) => sum + val * val, 0) / buffer.length);
  const amplitudeThreshold = 0.01; // Minimum RMS amplitude to consider
  
  if (rms < amplitudeThreshold) {
    return null; // Sound too quiet
  }

  // Autocorrelation
  const minPeriod = Math.floor(sampleRate / maxFrequency);
  const maxPeriod = Math.ceil(sampleRate / minFrequency);
  
  let bestOffset = -1;
  let bestCorrelation = 0;
  
  for (let offset = minPeriod; offset < maxPeriod && offset < buffer.length; offset++) {
    let correlation = 0;
    for (let i = 0; i < buffer.length - offset; i++) {
      correlation += buffer[i] * buffer[i + offset];
    }
    
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestOffset = offset;
    }
  }
  
  // Check if we found a strong enough correlation
  const correlationThreshold = 0.5;
  let selfCorrelation = 0;
  for (let i = 0; i < buffer.length; i++) {
    selfCorrelation += buffer[i] * buffer[i];
  }
  
  if (bestOffset === -1 || bestCorrelation < selfCorrelation * correlationThreshold) {
    return null;
  }
  
  // Refine the pitch using parabolic interpolation
  const frequency = sampleRate / bestOffset;
  
  return frequency;
}


