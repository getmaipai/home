export function encodeWav(samples: Float32Array, sampleRate = 16000): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2), v = new DataView(out.buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  str(0,"RIFF"); v.setUint32(4,36+samples.length*2,true); str(8,"WAVE"); str(12,"fmt "); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true); v.setUint32(24,sampleRate,true); v.setUint32(28,sampleRate*2,true); v.setUint16(32,2,true); v.setUint16(34,16,true); str(36,"data"); v.setUint32(40,samples.length*2,true);
  for(let i=0;i<samples.length;i++) v.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,samples[i]))*32767),true);
  return out;
}
/** Incremental PCM WAV reader. Ignores declared data size because Stack streams use a placeholder. */
export class StreamingWavReader {
  private bytes = new Uint8Array(0); private header = false; private offset = 0; private dataStart = 0;
  push(part: Uint8Array): Int16Array {
    const joined = new Uint8Array(this.bytes.length + part.length); joined.set(this.bytes); joined.set(part,this.bytes.length); this.bytes = joined;
    if(!this.header) { if(this.bytes.length<44) return new Int16Array(); this.header=true; this.dataStart=44; this.offset=44; }
    const n = Math.floor((this.bytes.length-this.offset)/2); if(n<=0) return new Int16Array();
    const result = new Int16Array(n), view = new DataView(this.bytes.buffer,this.bytes.byteOffset,this.bytes.byteLength);
    for(let i=0;i<n;i++) result[i]=view.getInt16(this.offset+i*2,true);
    this.offset += n*2; return result;
  }
}
