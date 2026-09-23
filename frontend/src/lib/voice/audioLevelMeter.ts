// VOICE-LIVE-02 (the owner's ruling, 2026-09-23: the Element's own rings
// scale from a local AnalyserNode level, nothing sent anywhere - no
// third-party visualizer, never the browser's own speech recognition).
// A tiny reusable reader over any AudioNode already live in an
// AudioContext: mic-capture.ts's own source while listening,
// sentenceSpeechScheduler.ts's own playback while speaking - the same
// meter shape either way, so VoiceConversation's `amplitude` prop never
// cares which one is driving it.
export interface LevelMeter {
  /** Current level, 0 to 1 - call on an animation frame, never awaited. */
  read(): number;
  stop(): void;
}

export function createLevelMeter(context: AudioContext, source: AudioNode): LevelMeter {
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.6;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  let stopped = false;
  return {
    read() {
      if (stopped) return 0;
      analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (let i = 0; i < data.length; i++) {
        const centered = (data[i]! - 128) / 128;
        sumSquares += centered * centered;
      }
      // RMS is usually a small fraction of 1 for ordinary speech - scaled
      // up so the Element's own rings (VoiceConversation.tsx: `0.72 +
      // level * 0.28`) move visibly rather than sitting near their floor.
      const rms = Math.sqrt(sumSquares / data.length);
      return Math.min(1, rms * 4);
    },
    stop() {
      stopped = true;
      try {
        analyser.disconnect();
      } catch {
        /* ignore */
      }
    },
  };
}
