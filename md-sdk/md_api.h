// md_api.h — the mdlua runtime contract (Sega Mega Drive / Genesis, SGDK).
// The emitted C calls these md_* functions; each is a thin wrapper over SGDK.
// Spike-0 surface: frame harness, input, cls, print, immediate-mode sprites.
#ifndef MD_API_H
#define MD_API_H

#include <genesis.h>

// frame harness (called by the generated main())
void md_init(void);
void md_vsync(void);       // top of frame: latch input
void md_endframe(void);    // bottom of frame: flush sprites + SYS_doVBlankProcess

// input — PICO-8 indices: 0=left 1=right 2=up 3=down 4=O 5=X (O->B, X->C)
int md_btn(int i, int pl);
int md_btnp(int i, int pl);

// drawing (spike slice)
void md_cls(int color);
void md_print(const char *s, int x, int y, int color);
void md_print_int(int v, int x, int y, int color);
void md_print_num(long v, int x, int y, int color);
void md_print_cur_str(const char *s, int color);
void md_print_cur_int(int v, int color);
void md_print_cur_num(long v, int color);
void md_spr(int n, int x, int y, int w, int h, int flip);

// spike-1 surface: Genesis flavor
void md_pal(int c0, int c1);           // CRAM remap; c0<0 = reset all 16
void md_hscroll(int line, int x);      // per-scanline H-scroll of plane B
void md_music(int n, int loop);        // XGM2 module (FM) via the Z80 driver
void md_sfx(int n, int ch);            // (stub until PCM lands in Phase 2)
void md_spike_bg(void);          // temporary checker plane (Phase 1 removes)

#endif
