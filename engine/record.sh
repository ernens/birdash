#!/bin/bash
# BirdEngine local recording — captures WAV files from RODE AI-Micro
# Files go to incoming/ directory, BirdEngine picks them up automatically

DEVICE="rode"
CHANNELS=2
SAMPLE_RATE=48000
RECORDING_LENGTH=45
OUTPUT_DIR="$HOME/birdash/engine/audio/incoming"

mkdir -p "$OUTPUT_DIR"

echo "[record] Starting recording: device=$DEVICE, channels=$CHANNELS, rate=$SAMPLE_RATE, length=${RECORDING_LENGTH}s"
echo "[record] Output: $OUTPUT_DIR"

exec arecord \
  -D "$DEVICE" \
  -f S16_LE \
  -c "$CHANNELS" \
  -r "$SAMPLE_RATE" \
  -t wav \
  --max-file-time "$RECORDING_LENGTH" \
  --use-strftime \
  "$OUTPUT_DIR/%F-birdnet-%H:%M:%S.wav"
