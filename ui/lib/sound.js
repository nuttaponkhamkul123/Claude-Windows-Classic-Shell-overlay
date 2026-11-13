// Synthesizes pleasant modern notification chimes using Web Audio API
class AudioSynthesizer {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playAttention() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    
    // Pleasant dual-tone chime (F#5 -> B5)
    this.playTone(739.99, now, 0.28, 0.15);
    this.playTone(987.77, now + 0.12, 0.45, 0.2);
  }

  playSuccess() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    // Ascending soft triad (C5 -> E5 -> G5)
    this.playTone(523.25, now, 0.2, 0.1);
    this.playTone(659.25, now + 0.08, 0.2, 0.1);
    this.playTone(783.99, now + 0.16, 0.35, 0.15);
  }

  playTone(freq, startTime, duration, maxGain) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.exponentialRampToValueAtTime(maxGain, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
  }
}

window.soundSynth = new AudioSynthesizer();

