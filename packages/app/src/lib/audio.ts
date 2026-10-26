/**
 * Browser-side audio shaping for Muse Voice Transcribe.
 *
 * MediaRecorder gives a compressed container (WebM/Opus in Chromium). Meta accepts only RIFF/WAVE
 * with mono, 16-bit PCM at 16 kHz or 24 kHz, so the recording is decoded, mixed, resampled and
 * written in memory. Nothing here writes a file.
 */

export const DICTATION_SAMPLE_RATE = 16_000;

export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  view.setUint32(4, 36 + dataBytes, true);
  bytes.set([0x57, 0x41, 0x56, 0x45], 8);
  bytes.set([0x66, 0x6d, 0x74, 0x20], 12);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.set([0x64, 0x61, 0x74, 0x61], 36);
  view.setUint32(40, dataBytes, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return bytes;
}

export function mixToMono(buffer: AudioBuffer): Float32Array {
  const channels = Math.max(1, buffer.numberOfChannels);
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      mono[index] = (mono[index] ?? 0) + (data[index] ?? 0) / channels;
    }
  }
  return mono;
}

/** Linear resampling is enough for dictation and avoids a second async audio graph. */
export function resampleMono(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate <= 0 || toRate <= 0) throw new Error("Sample rates must be positive.");
  if (fromRate === toRate) return new Float32Array(input);
  const length = Math.max(1, Math.round((input.length * toRate) / fromRate));
  const output = new Float32Array(length);
  const ratio = fromRate / toRate;
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(input.length - 1, left + 1);
    const fraction = position - left;
    output[index] = (input[left] ?? 0) * (1 - fraction) + (input[right] ?? 0) * fraction;
  }
  return output;
}

/** Decode a MediaRecorder blob and return the WAV bytes the provider documents. */
export async function recordedBlobToWav(
  blob: Blob,
  sampleRate: number = DICTATION_SAMPLE_RATE
): Promise<Uint8Array> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    return encodeWav(resampleMono(mixToMono(decoded), decoded.sampleRate, sampleRate), sampleRate);
  } finally {
    await context.close().catch(() => {});
  }
}
