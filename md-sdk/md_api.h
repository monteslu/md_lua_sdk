// md_api.h — the mdlua runtime contract (Sega Mega Drive / Genesis, SGDK).
// Every md_* symbol here backs a Lua builtin (the emitter remaps the shared
// builtins table's gt_* names to md_* at emit time).
#ifndef MD_API_H
#define MD_API_H

#include <genesis.h>

// frame harness (called by the generated main())
void md_init(void);
void md_vsync(void);
void md_endframe(void);

// input — P8: 0-3 dpad, 4 O->B, 5 X->C; MD extras: 6 A, 7 START
int md_btn(int i, int pl);
int md_btnp(int i, int pl);

// state
void md_color(int c);
void md_camera(int cx, int cy);
void md_clip(int x, int y, int w, int h);

// palette / screen
void md_pal(int c0, int c1);
void md_backdrop(int c);
void md_screen_off(void);
void md_screen_on(void);

// bitmap verbs (SGDK BMP engine, lazy: 256x160 4bpp software framebuffer)
void md_cls(int color);
void md_pset(int x, int y, int color);
int  md_pget(int x, int y);
void md_line(int x0, int y0, int x1, int y1, int color);
void md_rect(int x0, int y0, int x1, int y1, int color);
void md_rectfill(int x0, int y0, int x1, int y1, int color);
void md_circ(int cx, int cy, int r, int color);
void md_circfill(int cx, int cy, int r, int color);

// sprites (hardware, per-frame display list)
void md_spr(int n, int x, int y, int w, int h, int flip);
void md_spr8(int t, int x, int y, int flip);
void md_sspr(int sx, int sy, int sw, int sh, int dx, int dy, int dw, int dh, int flip);
void md_spr_pal(int bank);
void md_spr_prio(int p);

// tilemap (plane B)
void md_map(const unsigned char *m, int mapw, int cx, int cy, int sx, int sy, int cw, int ch);
void md_map_show(int layer);
int  md_mget(int layer, int col, int row);
void md_mset(int layer, int col, int row, int tile);
void md_layer_scroll(int layer, int x, int y);
void md_layer_show(int layer, int on);
void md_layer_priority(int layer, int prio);

// raster
void md_hscroll(int line, int x);

// text
void md_print(const char *s, int x, int y, int color);
void md_print_int(int v, int x, int y, int color);
void md_print_num(long v, int x, int y, int color);
void md_print_cur_str(const char *s, int color);
void md_print_cur_int(int v, int color);
void md_print_cur_num(long v, int color);

// hardware misc
long md_realframes(void);
long md_realsecs(void);
void md_run(void);

// audio
void md_music(int n, int loop);
void md_sfx(int n, int ch);

// raw PCM (SGDK's standalone single-channel SND_PCM driver; distinct from XGM2)
int  md_pcm_sample(int n);   // ROM pointer of --sfx blob n, as an opaque handle
int  md_pcm_len(int n);      // byte length of --sfx blob n
void md_pcm_driver(void);    // SND_PCM_loadDriver(TRUE) once
void md_pcm_play(int n, int rate, int loop);  // whole-recipe convenience

// a minimal 2-frame animated SpriteDefinition (handle) for the SGDK sprite
// engine - lets SPR_addSprite + auto-animation exercise frame-change callbacks
int  md_demo_sprite(void);

// animation helpers (slot-based frame-range cycling — the cross-SDK contract)
int  md_anim(int slot, int first, int last, long fps);
int  md_anim_once(int slot, int first, int last, long fps);
int  md_anim_pingpong(int slot, int first, int last, long fps);
void md_anim_reset(int slot);
int  md_anim_done(int slot);

// Phase 2
void md_save(int slot, const unsigned char *arr, int n);
int  md_load(int slot, unsigned char *arr, int n);
void md_hud(int rows);
void md_shade_mode(int on);
void md_fade(long amount, int to_white);

#endif
