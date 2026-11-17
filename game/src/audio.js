// audio.js — all sound is synthesised with WebAudio. No audio files, no network.
// V2: the engine hum gains a sub-bass oscillator for body, wind rush follows
// speed, and getting in or out of a car plays a door thud.
// Engine hum, police siren, gunshot, punch, pickup chime, mission jingle, crash.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.engineOsc = null;
    this.engineSub = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.windGain = null;
    this.windFilter = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenTimer = 0;
    this.sirenHigh = false;
  }

  // Must be called from a user gesture at least once.
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    // Master gain: every voice routes through it, so mute actually works.
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : 1;
    this.masterGain.connect(this.ctx.destination);
    // Engine: a low sawtooth through a low-pass filter, gain follows speed,
    // plus a sine sub-oscillator an octave below for body.
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;
    this.engineSub = this.ctx.createOscillator();
    this.engineSub.type = 'sine';
    this.engineSub.frequency.value = 28;
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 420;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineFilter);
    this.engineSub.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.masterGain);
    this.engineOsc.start();
    this.engineSub.start();
    // Wind: a looped noise buffer through a band-pass, gain follows speed.
    const windLen = this.ctx.sampleRate * 2;
    const windBuf = this.ctx.createBuffer(1, windLen, this.ctx.sampleRate);
    const windData = windBuf.getChannelData(0);
    for (let i = 0; i < windLen; i++) windData[i] = Math.random() * 2 - 1;
    const windSrc = this.ctx.createBufferSource();
    windSrc.buffer = windBuf;
    windSrc.loop = true;
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 900;
    this.windFilter.Q.value = 0.6;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;
    windSrc.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.masterGain);
    windSrc.start();
    // Siren: a square wave that alternates between two tones.
    this.sirenOsc = this.ctx.createOscillator();
    this.sirenOsc.type = 'triangle';
    this.sirenOsc.frequency.value = 720;
    this.sirenGain = this.ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenOsc.connect(this.sirenGain);
    this.sirenGain.connect(this.masterGain);
    this.sirenOsc.start();
  }

  setMuted(m) {
    this.muted = m;
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setValueAtTime(m ? 0 : 1, this.ctx.currentTime);
    }
  }

  // speed01: 0..1 of top speed. driving: bool.
  setEngine(speed01, driving) {
    if (!this.ctx || !this.engineOsc) return;
    const t = this.ctx.currentTime;
    this.engineOsc.frequency.setTargetAtTime(52 + speed01 * 165, t, 0.08);
    this.engineSub.frequency.setTargetAtTime(26 + speed01 * 82, t, 0.08);
    this.engineGain.gain.setTargetAtTime(driving ? 0.05 + speed01 * 0.075 : 0.0, t, 0.1);
  }

  // Wind rush while driving: louder and higher-pitched with speed.
  setWind(speed01, driving) {
    if (!this.ctx || !this.windGain) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(driving ? speed01 * speed01 * 0.09 : 0.0, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(500 + speed01 * 1400, t, 0.15);
  }

  setSiren(on, dt) {
    if (!this.ctx || !this.sirenOsc) return;
    const t = this.ctx.currentTime;
    if (!on) {
      this.sirenGain.gain.setTargetAtTime(0, t, 0.1);
      return;
    }
    this.sirenTimer += dt;
    if (this.sirenTimer > 0.42) {
      this.sirenTimer = 0;
      this.sirenHigh = !this.sirenHigh;
      this.sirenOsc.frequency.setTargetAtTime(this.sirenHigh ? 960 : 660, t, 0.05);
    }
    this.sirenGain.gain.setTargetAtTime(0.035, t, 0.1);
  }

  _noiseBurst(duration, filterFreq, gainVal, type = 'lowpass') {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const len = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.value = gainVal;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain || this.ctx.destination);
    src.start();
  }

  _tone(freq, duration, type, gainVal, when = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    const t0 = ctx.currentTime + when;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(gainVal, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(this.masterGain || this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  gunshot() {
    this._noiseBurst(0.14, 1800, 0.5, 'bandpass');
    this._tone(140, 0.1, 'sine', 0.35);
  }

  punch() {
    this._noiseBurst(0.09, 320, 0.5);
    this._tone(95, 0.09, 'sine', 0.4);
  }

  crash(strength = 1) {
    this._noiseBurst(0.25, 500, 0.35 * strength);
    this._tone(70, 0.2, 'sine', 0.4 * strength);
  }

  // Car door: a low thud with a metallic click on top.
  door() {
    this._noiseBurst(0.08, 300, 0.5);
    this._tone(68, 0.12, 'sine', 0.5);
    this._tone(1200, 0.03, 'square', 0.06, 0.02);
  }

  chime() {
    this._tone(880, 0.16, 'sine', 0.22);
    this._tone(1318, 0.24, 'sine', 0.2, 0.09);
  }

  jingle() {
    const notes = [523, 659, 784, 1046];
    notes.forEach((n, i) => this._tone(n, 0.22, 'triangle', 0.22, i * 0.11));
  }

  busted() {
    const notes = [392, 311, 262, 196];
    notes.forEach((n, i) => this._tone(n, 0.3, 'sawtooth', 0.12, i * 0.16));
  }

  click() {
    this._tone(660, 0.06, 'square', 0.08);
  }
}
