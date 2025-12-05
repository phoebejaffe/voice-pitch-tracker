# Voice Floor Tracker

A React + TypeScript web application that listens to your microphone and detects the fundamental frequency of sound, changing the background color based on pitch thresholds!

## Features

- Real-time pitch detection using autocorrelation algorithm
- Amplitude and pitch thresholds to filter out noise
- Visual feedback with color-coded background:
  - **Red**: < 130 Hz
  - **Orange**: 130-150 Hz
  - **Black**: ≥ 150 Hz

## Setup

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

## Usage

1. Open the app in your browser (default: http://localhost:5173)
2. Click "Start Listening" button
3. Grant microphone permissions when prompted
4. Speak or make sounds into your microphone
5. Watch the background color change based on pitch

## Technical Details

- Uses Web Audio API for microphone access
- Implements autocorrelation pitch detection algorithm
- Real-time audio analysis at ~60fps
- Filters sounds below amplitude threshold (0.01 RMS)
- Detects frequencies between 50-500 Hz
