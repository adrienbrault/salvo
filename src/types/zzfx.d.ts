declare module 'zzfx' {
  export const ZZFX: {
    volume: number;
    sampleRate: number;
    audioContext: AudioContext;
    buildSamples(...params: number[]): number[];
    playSamples(
      channels: number[][],
      volumeScale?: number,
      rate?: number,
      pan?: number,
      loop?: boolean,
    ): AudioBufferSourceNode;
    getNote(semitoneOffset?: number, rootNoteFrequency?: number): number;
  };
  export function zzfx(...params: number[]): AudioBufferSourceNode;
}
