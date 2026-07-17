// vgm-fixture.mjs — a tiny synthetic-but-VALID VGM 1.60 generator for tests.
//
// Emits a PSG-only Mega Drive VGM (SN76489 square-wave melody). PSG because
// it needs no FM patch setup, is unambiguously audible, and sounds NOTHING
// like the FM demo jingle - which is exactly what the two-song bank tests
// need (music(0) vs music(1) must be tellable apart in a recording).
// Pure JS, no deps; also exercises "tracker-generated VGM" viability for the
// future web IDE music editor.

const PSG_CLOCK = 3579545;

/** tone period register value for a frequency in Hz */
const periodOf = (hz) => Math.max(1, Math.min(0x3ff, Math.round(PSG_CLOCK / (32 * hz))));

/**
 * @param {object} [opts]
 * @param {number[]} [opts.melodyHz]  note frequencies, played in order
 * @param {number} [opts.noteSamples] samples per note at 44100 Hz
 * @param {boolean} [opts.loop]      mark the whole melody as the loop body -
 *   REQUIRED for music(n) loop semantics to differ from play-once (xgm2tool
 *   only emits an XGM2 loop command when the source VGM has a loop point)
 * @returns {Uint8Array} a complete .vgm file
 */
export function makePsgVgm({ melodyHz = [440, 554, 659, 880], noteSamples = 11025, loop = true } = {}) {
  const cmds = [];
  for (const hz of melodyHz) {
    const p = periodOf(hz);
    cmds.push(0x50, 0x80 | (p & 0x0f));          // ch0 tone latch + low bits
    cmds.push(0x50, (p >> 4) & 0x3f);            // high bits
    cmds.push(0x50, 0x90);                        // ch0 volume = max
    let left = noteSamples;
    while (left > 0) {
      const n = Math.min(left, 0xffff);
      cmds.push(0x61, n & 0xff, (n >> 8) & 0xff); // wait n samples
      left -= n;
    }
  }
  cmds.push(0x50, 0x9f);                          // ch0 volume off
  cmds.push(0x66);                                // end of stream

  const totalSamples = melodyHz.length * noteSamples;
  const data = Uint8Array.from(cmds);
  const out = new Uint8Array(0x80 + data.length);
  const dv = new DataView(out.buffer);
  out.set([0x56, 0x67, 0x6d, 0x20], 0);           // "Vgm "
  dv.setUint32(0x04, out.length - 4, true);       // EOF offset
  dv.setUint32(0x08, 0x00000160, true);           // version 1.60
  dv.setUint32(0x0c, PSG_CLOCK, true);            // SN76489 clock
  dv.setUint32(0x18, totalSamples, true);         // total samples
  if (loop) {
    dv.setUint32(0x1c, 0x80 - 0x1c, true);        // loop point = start of data
    dv.setUint32(0x20, totalSamples, true);       // loop length = whole melody
  }
  dv.setUint32(0x24, 60, true);                   // rate
  dv.setUint16(0x28, 0x0009, true);               // SN feedback
  out[0x2a] = 16;                                 // SN shift width
  dv.setUint32(0x2c, 7670453, true);              // YM2612 clock (present, unused)
  dv.setUint32(0x34, 0x80 - 0x34, true);          // data offset
  out.set(data, 0x80);
  return out;
}
