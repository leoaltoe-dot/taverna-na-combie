// Toca o som da janela compartilhada (PCM 16-bit, 48 kHz, estéreo) que o app do Windows envia.
// Guarda um pouquinho (40 ms) para não picotar e nunca deixa acumular mais que ~150 ms de atraso.
class PcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.cap = 48000;
    this.L = new Float32Array(this.cap);
    this.R = new Float32Array(this.cap);
    this.r = 0; this.w = 0; this.n = 0; this.ready = false;
    this.port.onmessage = (e) => this.push(e.data);
  }
  push(buf) {
    const s = new Int16Array(buf, 0, (buf.byteLength >> 2) << 1);
    for (let i = 0; i < s.length; i += 2) {
      this.L[this.w] = s[i] / 32768;
      this.R[this.w] = s[i + 1] / 32768;
      this.w = (this.w + 1) % this.cap;
      if (this.n < this.cap) this.n++; else this.r = (this.r + 1) % this.cap;
    }
    const max = 7200; // 150 ms
    if (this.n > max) { const drop = this.n - 2400; this.r = (this.r + drop) % this.cap; this.n -= drop; }
  }
  process(_inputs, outputs) {
    const out = outputs[0];
    const l = out[0], r = out[1] || out[0], len = l.length;
    if (!this.ready && this.n >= 1920) this.ready = true;
    if (!this.ready || this.n < len) { this.ready = false; l.fill(0); if (r !== l) r.fill(0); return true; }
    for (let i = 0; i < len; i++) {
      l[i] = this.L[this.r]; r[i] = this.R[this.r];
      this.r = (this.r + 1) % this.cap;
    }
    this.n -= len;
    return true;
  }
}
registerProcessor('pcm-player', PcmPlayer);
