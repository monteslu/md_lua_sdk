# Changelog

## 0.4.0

- `mdlua pico8 <cart>`: build unmodified PICO-8 carts (`.p8`, `.p8.png`) to a
  Genesis ROM through luacretro 0.2.0's dynamic tier (`compiler/build-p8.mjs`,
  `md-sdk/lc_md.c`). PICO-8 audio on the PSG through luacretro's fast synth
  sequencer (squares + noise); 10 KB heap, so small carts only.
- Needs luacretro 0.2.0.
