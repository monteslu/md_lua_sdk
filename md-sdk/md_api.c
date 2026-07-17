// md_api.c — the mdlua runtime (Phase 1). Thin wrappers over SGDK.
//
// Frame model (immediate-mode, PICO-8-shaped): _draw() re-states everything
// each frame. Sprites are a per-frame display list of hardware sprites;
// md_endframe() links + DMA-queues the SAT and hides stale slots. Planes:
//   BG_A = text (and the BMP engine when a game uses bitmap verbs)
//   BG_B = the tilemap (map()/map_show) + per-line raster scroll
// Palettes: PAL0 = the 16 PICO-8 colors (pal() remaps live — CRAM is real),
//   PAL1 = the sprite-sheet/map palette, PAL2/PAL3 idx15 = print color cache.
#include "md_api.h"
#include "md_math.h"
#include "md_assets.h"   // generated per build: sheet/map data or stubs

// ---- PICO-8 palette -> CRAM PAL0 -------------------------------------------
static const u32 P8_RGB[16] = {
    0x000000, 0x1D2B53, 0x7E2553, 0x008751, 0xAB5236, 0x5F574F, 0xC2C3C7,
    0xFFF1E8, 0xFF004D, 0xFFA300, 0xFFEC27, 0x00E436, 0x29ADFF, 0x83769C,
    0xFF77A8, 0xFFCCAA,
};

// ---- VRAM layout -------------------------------------------------------------
#define T_SHEET  TILE_USER_INDEX
#ifdef MD_HAVE_SHEET
#define SHEET_N  sheet_tiles_count
#define SHEET_W  sheet_cells_across
#else
#define SHEET_N  4
#define SHEET_W  16
#endif
#define T_MAP    (T_SHEET + SHEET_N)
#ifdef MD_HAVE_MAP
#define MAPT_N   map_tiles_count
#endif

#ifndef MD_HAVE_SHEET
// fallback: 4 solid tiles so spr() shows something before art exists
static const u32 fallback_tiles[4 * 8] = {
    0x88888888,0x88888888,0x88888888,0x88888888,0x88888888,0x88888888,0x88888888,0x88888888,
    0xAAAAAAAA,0xAAAAAAAA,0xAAAAAAAA,0xAAAAAAAA,0xAAAAAAAA,0xAAAAAAAA,0xAAAAAAAA,0xAAAAAAAA,
    0xBBBBBBBB,0xBBBBBBBB,0xBBBBBBBB,0xBBBBBBBB,0xBBBBBBBB,0xBBBBBBBB,0xBBBBBBBB,0xBBBBBBBB,
    0xCCCCCCCC,0xCCCCCCCC,0xCCCCCCCC,0xCCCCCCCC,0xCCCCCCCC,0xCCCCCCCC,0xCCCCCCCC,0xCCCCCCCC,
};
#endif

// ---- state -------------------------------------------------------------------
static u16 joy_cur[2], joy_prev[2];
static s16 cam_x = 0, cam_y = 0;
static u16 spr_count, spr_last;
static u16 spr_palbank = PAL1, spr_priority = 1;
static s16 hs_table[224];
static u16 hs_dirty = 0, hs_mode_on = 0;
static u16 bmp_on = 0;               // BMP engine active (bitmap verbs used)
static u16 cur_color = 7;            // color() state for optional color args
static u16 cur_col_t, cur_row_t;     // print cursor (tile coords)
static s16 clip_x0 = 0, clip_y0 = 0, clip_x1 = 319, clip_y1 = 223;
static u16 hud_rows;               // WINDOW-plane HUD strip (md_hud)
static u16 xgm_up = 0;                 // XGM2 driver loaded (music/pcm sfx)
static s16 txt_cache[2] = { -1, -1 };
static u16 txt_next = 0;
// CRAM shadow: mid-frame direct PAL_setColor RACES the vblank DMA queue (the
// control/data pair gets split and the write lands at the wrong CRAM address —
// measured: a print-color write flooded the backdrop). ALL palette changes go
// through this shadow and flush as ONE queued DMA at endframe.
static u16 cram_shadow[64];
static u16 cram_dirty = 0;
static void cram_set(u16 idx, u16 val) { cram_shadow[idx & 63] = val; cram_dirty = 1; }
#define HIDE_Y ((s16)-32)
#define MD_MAX_SPR 80

// ---- input --------------------------------------------------------------------
static u16 p8_mask(int i) {
    switch (i) {
        case 0: return BUTTON_LEFT;
        case 1: return BUTTON_RIGHT;
        case 2: return BUTTON_UP;
        case 3: return BUTTON_DOWN;
        case 4: return BUTTON_B;     // P8 O
        case 5: return BUTTON_C;     // P8 X
        case 6: return BUTTON_A;     // MD extra
        case 7: return BUTTON_START; // MD extra
        case 8: return BUTTON_X;     // 6-button pad
        case 9: return BUTTON_Y;
        case 10: return BUTTON_Z;
        case 11: return BUTTON_MODE;
        default: return 0;
    }
}
int md_btn(int i, int pl)  { u16 p = (pl == 1) ? 1 : 0; return (joy_cur[p] & p8_mask(i)) != 0; }
int md_btnp(int i, int pl) {
    u16 p = (pl == 1) ? 1 : 0; u16 m = p8_mask(i);
    return (joy_cur[p] & m) && !(joy_prev[p] & m);
}

// ---- color helpers -------------------------------------------------------------
static u16 resolve_color(int c) { return (c < 0) ? cur_color : (u16)(c & 15); }
void md_color(int c) { cur_color = (u16)(c & 15); }

// pal(): live CRAM remap — the Genesis headline. pal() (args<0) resets PAL0.
void md_pal(int c0, int c1) {
    u16 i;
    if (c0 < 0) { for (i = 0; i < 16; i++) cram_set(i, RGB24_TO_VDPCOLOR(P8_RGB[i])); return; }
    cram_set((u16)(c0 & 15), RGB24_TO_VDPCOLOR(P8_RGB[c1 & 15]));
}
void md_backdrop(int c) { VDP_setBackgroundColor((u8)(c & 63)); }

// fade(amount 0..1, to_white): scale every CRAM entry from the UNfaded shadow.
// The shadow keeps the true palette; fading writes a scaled copy each call, so
// fade(0) restores exactly. Rides the queued endframe flush (race-free).
static u16 cram_true[64];
static u16 cram_true_valid = 0;
void md_fade(long amount, int to_white) {
    u16 i;
    long a = amount;
    if (a < 0) a = 0;
    if (a > 0x10000L) a = 0x10000L;
    if (!cram_true_valid) { for (i = 0; i < 64; i++) cram_true[i] = cram_shadow[i]; cram_true_valid = 1; }
    for (i = 0; i < 64; i++) {
        u16 v = cram_true[i];
        long r = (v >> 1) & 7, g = (v >> 5) & 7, b = (v >> 9) & 7;
        if (to_white) {
            r = r + (((7 - r) * a) >> 16);
            g = g + (((7 - g) * a) >> 16);
            b = b + (((7 - b) * a) >> 16);
        } else {
            r = r - ((r * a) >> 16);
            g = g - ((g * a) >> 16);
            b = b - ((b * a) >> 16);
        }
        cram_shadow[i] = (u16)((b << 9) | (g << 5) | (r << 1));
    }
    cram_dirty = 1;
    if (a == 0) cram_true_valid = 0;   // fully restored: re-snapshot on next fade
}
void md_screen_off(void) { VDP_setEnable(FALSE); }
void md_screen_on(void)  { VDP_setEnable(TRUE); }

// ---- BMP engine (bitmap verbs: 256x160 4bpp software framebuffer) --------------
// Lazy: the first bitmap verb flips it on. Costs ~41KB work RAM + plane A.
static void bmp_ensure(void) {
    if (bmp_on) return;
    BMP_init(TRUE, BG_A, PAL0, FALSE);
    bmp_on = 1;
}
static void plot_clip(int x, int y, u16 col) {
    if (x < clip_x0 || x > clip_x1 || y < clip_y0 || y > clip_y1) return;
    if ((unsigned)x >= 256u || (unsigned)y >= 160u) return;
    // SGDK BMP contract: col must be "8 bits filled" (0x00, 0x11, ... - the
    // color in BOTH nibbles). The 4bpp buffer packs 2 pixels/byte and
    // BMP_setPixel masks YOUR byte down to the target nibble; a plain 0-15
    // value colors only every other pixel (measured: striped circles).
    BMP_setPixel((u16)x, (u16)y, (u8)((col << 4) | col));
}
void md_pset(int x, int y, int color) { bmp_ensure(); plot_clip(x, y, resolve_color(color)); }
int md_pget(int x, int y) {
    if (!bmp_on) return 0;
    if ((unsigned)x >= 256u || (unsigned)y >= 160u) return 0;
    return (int)(BMP_getPixel((u16)x, (u16)y) & 0x0F);  // back to a 0-15 index
}
void md_clip(int x, int y, int w, int h) {
    if (w <= 0 || h <= 0) { clip_x0 = 0; clip_y0 = 0; clip_x1 = 319; clip_y1 = 223; return; }
    clip_x0 = (s16)x; clip_y0 = (s16)y; clip_x1 = (s16)(x + w - 1); clip_y1 = (s16)(y + h - 1);
}
void md_line(int x0, int y0, int x1, int y1, int color) {
    int dx, sx, dy, sy, err, e2;
    u16 col = resolve_color(color);
    bmp_ensure();
    dx = x1 - x0; if (dx < 0) dx = -dx;
    sx = x0 < x1 ? 1 : -1;
    dy = y1 - y0; if (dy < 0) dy = -dy;
    sy = y0 < y1 ? 1 : -1;
    err = dx - dy;
    for (;;) {
        plot_clip(x0, y0, col);
        if (x0 == x1 && y0 == y1) break;
        e2 = err << 1;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 <  dx) { err += dx; y0 += sy; }
    }
}
void md_rect(int x0, int y0, int x1, int y1, int color) {
    md_line(x0, y0, x1, y0, color); md_line(x0, y1, x1, y1, color);
    md_line(x0, y0, x0, y1, color); md_line(x1, y0, x1, y1, color);
}
void md_rectfill(int x0, int y0, int x1, int y1, int color) {
    int y, t;
    u16 col = resolve_color(color);
    bmp_ensure();
    if (x0 > x1) { t = x0; x0 = x1; x1 = t; }
    if (y0 > y1) { t = y0; y0 = y1; y1 = t; }
    for (y = y0; y <= y1; y++) {
        int x;
        for (x = x0; x <= x1; x++) plot_clip(x, y, col);
    }
}
void md_circ(int cx, int cy, int r, int color) {
    int x = r, y = 0, err = 1 - r;
    u16 col = resolve_color(color);
    bmp_ensure();
    if (r < 0) return;
    while (x >= y) {
        plot_clip(cx + x, cy + y, col); plot_clip(cx - x, cy + y, col);
        plot_clip(cx + x, cy - y, col); plot_clip(cx - x, cy - y, col);
        plot_clip(cx + y, cy + x, col); plot_clip(cx - y, cy + x, col);
        plot_clip(cx + y, cy - x, col); plot_clip(cx - y, cy - x, col);
        y++;
        if (err < 0) err += 2 * y + 1;
        else { x--; err += 2 * (y - x) + 1; }
    }
}
void md_circfill(int cx, int cy, int r, int color) {
    int x = r, y = 0, err = 1 - r;
    u16 col = resolve_color(color);
    bmp_ensure();
    if (r < 0) return;
    while (x >= y) {
        int i;
        for (i = cx - x; i <= cx + x; i++) { plot_clip(i, cy + y, col); plot_clip(i, cy - y, col); }
        for (i = cx - y; i <= cx + y; i++) { plot_clip(i, cy + x, col); plot_clip(i, cy - x, col); }
        y++;
        if (err < 0) err += 2 * y + 1;
        else { x--; err += 2 * (y - x) + 1; }
    }
}

// ---- sprites --------------------------------------------------------------------
void md_camera(int cx, int cy) { cam_x = (s16)cx; cam_y = (s16)cy; }
void md_spr_pal(int bank) { spr_palbank = (u16)(bank & 3); }
void md_spr_prio(int p)   { spr_priority = p ? 1 : 0; }

// spr(n, x, y, w, h, flip): w/h in 8px cells (1..4). Multi-cell sprites compose
// from 1x1 hardware sprites (sheet tiles are row-major linear; MD multi-tile
// sprites want column-major — composing sidesteps the reorder AND keeps
// arbitrary w/h). Flips mirror the cell grid too.
static void spr_cell(int tile, int sx, int sy, u16 hf, u16 vf) {
    if (spr_count >= MD_MAX_SPR) return;
    if (sx <= -8 || sx >= 320 || sy <= -8 || sy >= 224) return;
    VDP_setSprite(spr_count, (s16)sx, (s16)sy, SPRITE_SIZE(1, 1),
                  TILE_ATTR_FULL(spr_palbank, spr_priority, vf, hf, (u16)tile));
    spr_count++;
}
void md_spr(int n, int x, int y, int w, int h, int flip) {
    int cx, cy;
    u16 hf = (flip & 1) ? 1 : 0, vf = (flip & 2) ? 1 : 0;
    if (w < 1) w = 1; if (w > 4) w = 4;
    if (h < 1) h = 1; if (h > 4) h = 4;
    x -= cam_x; y -= cam_y;
    for (cy = 0; cy < h; cy++)
        for (cx = 0; cx < w; cx++) {
            int cell = n + (hf ? (w - 1 - cx) : cx) + (vf ? (h - 1 - cy) : cy) * SHEET_W;
            spr_cell(T_SHEET + cell, x + cx * 8, y + cy * 8, hf, vf);
        }
}
void md_spr8(int t, int x, int y, int flip) {
    spr_cell(T_SHEET + t, x - cam_x, y - cam_y, (flip & 1) ? 1 : 0, (flip & 2) ? 1 : 0);
}
// sspr: MVP = UNSCALED source-rect blit rounded to cells (plan of record:
// import-time pre-scale replaces this in Phase 2; documented loudly).
void md_sspr(int sx, int sy, int sw, int sh, int dx, int dy, int dw, int dh, int flip) {
    (void)dw; (void)dh;
    md_spr((sy >> 3) * SHEET_W + (sx >> 3), dx, dy, (sw + 7) >> 3, (sh + 7) >> 3, flip);
}

// ---- tilemap: plane B ------------------------------------------------------------
void md_map(const unsigned char *m, int mapw, int cx, int cy, int sx, int sy, int cw, int ch) {
    int i, j;
    if (cw < 0) cw = 16;
    if (ch < 0) ch = 14;
    for (j = 0; j < ch; j++)
        for (i = 0; i < cw; i++) {
            unsigned char t = m[(cy + j) * mapw + (cx + i)];
            if (t)
                VDP_setTileMapXY(BG_B, TILE_ATTR_FULL(PAL1, 0, 0, 0, T_SHEET + t), (sx >> 3) + i, (sy >> 3) + j);
            else
                VDP_setTileMapXY(BG_B, TILE_ATTR_FULL(PAL0, 0, 0, 0, 0), (sx >> 3) + i, (sy >> 3) + j);
        }
}

#ifdef MD_HAVE_MAP
static u16 map_ram[64 * 32];          // plane-size shadow for tget/tset
#endif
void md_map_show(int layer) {
    (void)layer;   // single asset map on plane B (multi-layer maps: Phase 2)
#ifdef MD_HAVE_MAP
    u16 x, y;
    u16 w = map_cols > 64 ? 64 : map_cols;
    u16 h = map_rows > 32 ? 32 : map_rows;
    for (y = 0; y < h; y++)
        for (x = 0; x < w; x++) {
            u16 t = map_data[y * map_cols + x];
            map_ram[y * 64 + x] = t;
            VDP_setTileMapXY(BG_B, TILE_ATTR_FULL(PAL2, 0, 0, 0, T_MAP + t), x, y);
        }
#endif
}
int md_mget(int layer, int col, int row) {
    (void)layer;
#ifdef MD_HAVE_MAP
    if ((unsigned)col < 64u && (unsigned)row < 32u) return (int)map_ram[row * 64 + col];
#else
    (void)col; (void)row;
#endif
    return 0;
}
void md_mset(int layer, int col, int row, int tile) {
    (void)layer;
#ifdef MD_HAVE_MAP
    if ((unsigned)col < 64u && (unsigned)row < 32u) {
        map_ram[row * 64 + col] = (u16)tile;
        VDP_setTileMapXY(BG_B, TILE_ATTR_FULL(PAL2, 0, 0, 0, T_MAP + (u16)tile), (u16)col, (u16)row);
    }
#else
    (void)col; (void)row; (void)tile;
#endif
}
void md_layer_scroll(int layer, int x, int y) {
    VDPPlane p = layer ? BG_A : BG_B;
    VDP_setHorizontalScroll(p, (s16)-x);
    VDP_setVerticalScroll(p, (s16)y);
}
void md_layer_show(int layer, int on) { (void)layer; (void)on; }
void md_layer_priority(int layer, int prio) { (void)layer; (void)prio; }

// ---- per-line raster scroll --------------------------------------------------
void md_hscroll(int line, int x) {
    if ((unsigned int)line >= 224u) return;
    hs_table[line] = (s16)x;
    hs_dirty = 1;
}

// ---- text ----------------------------------------------------------------------
// Color: SGDK text renders with palette index 15 of the selected text palette
// line — PAL0.15 is P8 white; PAL2/PAL3 idx15 cache the 2 most recent other
// colors (LRU). 3 simultaneous text colors; the 4th evicts the oldest.
// text color: PAL0.15 = white; PAL3.15 caches ONE other color (PAL2 belongs
// to the map's palette line). Two simultaneous text colors; documented.
static u16 text_pal_for(int color) {
    u16 c = resolve_color(color);
    if (c == 7) return PAL0;
    if (txt_cache[0] != (s16)c) {
        txt_cache[0] = (s16)c;
        cram_set(63, RGB24_TO_VDPCOLOR(P8_RGB[c]));
    }
    return PAL3;
}
void md_print(const char *s, int x, int y, int color) {
    u16 row = (u16)(y >> 3);
    if (bmp_on) { BMP_drawText(s, (u16)(x >> 3), row); return; }
    VDP_setTextPalette(text_pal_for(color));
    VDP_drawTextBG(hud_rows && row < hud_rows ? WINDOW : BG_A, s, (u16)(x >> 3), row);
}
static void itoa10(int v, char *out) {
    char tmp[12]; int i = 0, j = 0; unsigned int u = (v < 0) ? (unsigned int)(-v) : (unsigned int)v;
    if (v < 0) out[j++] = '-';
    do { tmp[i++] = (char)('0' + (u % 10)); u /= 10; } while (u);
    while (i) out[j++] = tmp[--i];
    out[j] = 0;
}
void md_print_int(int v, int x, int y, int color) { char b[12]; itoa10(v, b); md_print(b, x, y, color); }
void md_print_num(long v, int x, int y, int color) { md_print_int((int)(v >> 16), x, y, color); }
void md_print_cur_str(const char *s, int color) {
    md_print(s, cur_col_t << 3, cur_row_t << 3, color);
    cur_row_t++; if (cur_row_t > 27) cur_row_t = 0;
}
void md_print_cur_int(int v, int color) { char b[12]; itoa10(v, b); md_print_cur_str(b, color); }
void md_print_cur_num(long v, int color) { md_print_cur_int((int)(v >> 16), color); }

// ---- cls / frame ------------------------------------------------------------
void md_cls(int color) {
    u16 c = (color < 0) ? 0 : (u16)(color & 15);
    VDP_setBackgroundColor((u8)c);
    if (bmp_on) BMP_clear();
    else VDP_clearPlane(BG_A, FALSE);
    cur_col_t = 0; cur_row_t = 0;
}

// ---- misc hardware ------------------------------------------------------------
long md_realframes(void) { return (long)md_ticks(); }
long md_realsecs(void)   { return (long)(((unsigned long long)md_ticks() << 16) / 60); }
void md_run(void) { SYS_hardReset(); }

// ---- audio ----------------------------------------------------------------------
// music(n, [loop]): play song n from the --music bank (bank order = n).
// music(-1) stops. loop defaults ON (the P8/gbalua contract); loop=false plays
// the song once (XGM2_setLoopNumber(0) = single play, -1 = endless).
extern const unsigned char *const md_song_bank[];
extern const int md_song_count;
void md_music(int n, int loop) {
    if (!xgm_up) { XGM2_loadDriver(TRUE); xgm_up = 1; }
    if (n < 0) { XGM2_stop(); return; }
    if (md_song_count <= 0) return;
    if (n >= md_song_count) n = md_song_count - 1;
    XGM2_setLoopNumber(loop ? -1 : 0);
    XGM2_play(md_song_bank[n]);
}
// sfx: PCM samples through XGM2 (channels 2-4; music may own 1) when a --sfx
// bank exists; PSG blip fallback otherwise. 8-bit signed 13.3 kHz, 256-aligned.
extern const unsigned char *const md_sfx_bank[];
extern const unsigned long md_sfx_len[];
extern const int md_sfx_count;
void md_sfx(int n, int ch) {
    if (md_sfx_count > 0) {
        SoundPCMChannel chan = (ch >= 2 && ch <= 4) ? (SoundPCMChannel)ch : SOUND_PCM_CH3;
        int idx = n;
        if (idx < 0) idx = 0;
        if (idx >= md_sfx_count) idx = md_sfx_count - 1;
        if (!xgm_up) { XGM2_loadDriver(TRUE); xgm_up = 1; }
        XGM2_playPCM(md_sfx_bank[idx], md_sfx_len[idx], chan);
        return;
    }
    {
        u16 chan = (ch >= 0 && ch < 3) ? (u16)ch : 0;
        u16 freq = 200 + ((u16)(n & 15)) * 120;
        PSG_setFrequency(chan, freq);
        PSG_setEnvelope(chan, PSG_ENVELOPE_MAX);
    }
}

// ---- raw PCM (SGDK single-channel SND_PCM driver) -----------------------------
// The same --sfx blobs, but played by SGDK's standalone Z80 PCM driver instead
// of XGM2. pcm_sample/pcm_len hand the ROM blob to SND_PCM_startPlay; pcm_driver
// loads it once; pcm_play is the whole-recipe convenience wrapper.
static u16 pcm_up = 0;
int md_pcm_sample(int n) {
    int idx = n;
    if (md_sfx_count <= 0) return 0;
    if (idx < 0) idx = 0;
    if (idx >= md_sfx_count) idx = md_sfx_count - 1;
    return (int)md_sfx_bank[idx];   // ROM pointer as an opaque handle
}
int md_pcm_len(int n) {
    int idx = n;
    if (md_sfx_count <= 0) return 0;
    if (idx < 0) idx = 0;
    if (idx >= md_sfx_count) idx = md_sfx_count - 1;
    return (int)md_sfx_len[idx];
}
void md_pcm_driver(void) {
    if (!pcm_up) { SND_PCM_loadDriver(TRUE); pcm_up = 1; }
}
void md_pcm_play(int n, int rate, int loop) {
    if (md_sfx_count <= 0) return;
    md_pcm_driver();
    SND_PCM_startPlay((const u8 *)md_pcm_sample(n), (u32)md_pcm_len(n),
                      (SoundPcmSampleRate)rate, SOUND_PAN_CENTER, loop ? TRUE : FALSE);
}

// ---- demo animated sprite (for SGDK sprite-engine callbacks) ------------------
// mdlua's own sprite verbs drive VDP hardware sprites directly; the SGDK sprite
// ENGINE (SPR_*) needs a SpriteDefinition, which the PICO-8 asset path doesn't
// build. demo_sprite() returns a minimal 2-frame animated definition (one 8x8
// tile, both frames, short per-frame timer) so SPR_addSprite + auto-animation +
// SPR_update() actually advance frames - which is what fires a frame-change
// callback. Enough to exercise SPR_setFrameChangeCallback end to end.
static const u32 md_ds_tiles[8] = {   // one solid 8x8 tile (color index 1)
    0x11111111, 0x11111111, 0x11111111, 0x11111111,
    0x11111111, 0x11111111, 0x11111111, 0x11111111,
};
static TileSet md_ds_tileset = { 0 /*no compression*/, 1 /*numTile*/, (u32 *)md_ds_tiles };
// two frames, each one 8x8 VDP sprite, timer=8 (advance every 8 vblanks).
static AnimationFrame md_ds_frame0 = { 1, 8, &md_ds_tileset, NULL, { { 0, 0, SPRITE_SIZE(1, 1), 0, 0, 1 } } };
static AnimationFrame md_ds_frame1 = { 1, 8, &md_ds_tileset, NULL, { { 0, 0, SPRITE_SIZE(1, 1), 0, 0, 1 } } };
static AnimationFrame *md_ds_frames[2] = { &md_ds_frame0, &md_ds_frame1 };
static Animation md_ds_anim = { 2 /*numFrame*/, 0 /*loop to frame 0*/, md_ds_frames };
static Animation *md_ds_anims[1] = { &md_ds_anim };
static SpriteDefinition md_ds_def = {
    8, 8, NULL /*palette*/, 1 /*numAnimation*/, md_ds_anims, 1 /*maxNumTile*/, 1 /*maxNumSprite*/
};
int md_demo_sprite(void) { return (int)&md_ds_def; }

// ---- frame harness ------------------------------------------------------------
void md_init(void) {
    u16 i;
    VDP_setScreenWidth320();
    for (i = 0; i < 64; i++) cram_shadow[i] = 0;
    for (i = 0; i < 16; i++) { cram_shadow[i] = RGB24_TO_VDPCOLOR(P8_RGB[i]); PAL_setColor(i, cram_shadow[i]); }
#ifdef MD_HAVE_SHEET
    VDP_loadTileData((const u32 *)sheet_tiles, T_SHEET, SHEET_N, DMA);
    for (i = 0; i < 16; i++) cram_shadow[16 + i] = sheet_pal[i];
    PAL_setColors(16, (const u16 *)sheet_pal, 16, DMA);
#else
    VDP_loadTileData(fallback_tiles, T_SHEET, 4, DMA);
    for (i = 0; i < 16; i++) { cram_shadow[16 + i] = RGB24_TO_VDPCOLOR(P8_RGB[i]); PAL_setColor(16 + i, cram_shadow[16 + i]); }
#endif
#ifdef MD_HAVE_MAP
    VDP_loadTileData((const u32 *)map_tiles, T_MAP, MAPT_N, DMA);
    for (i = 0; i < 16; i++) cram_shadow[32 + i] = map_pal[i];   // PAL2 = the map's line
    PAL_setColors(32, (const u16 *)map_pal, 16, DMA);
#endif
    spr_count = 0; spr_last = 0;
    joy_cur[0] = joy_cur[1] = joy_prev[0] = joy_prev[1] = 0;
}

void md_vsync(void) {
    joy_prev[0] = joy_cur[0]; joy_prev[1] = joy_cur[1];
    joy_cur[0] = JOY_readJoypad(JOY_1);
    joy_cur[1] = JOY_readJoypad(JOY_2);
    spr_count = 0;
    spr_palbank = PAL1; spr_priority = 1;   // draw state resets each frame (P8 model)
}

void md_endframe(void) {
    u16 i, n;
    if (cram_dirty) { PAL_setColors(0, cram_shadow, 64, DMA_QUEUE); cram_dirty = 0; }
    if (!hs_dirty && !hs_mode_on) VDP_setHorizontalScroll(BG_B, (s16)-cam_x);
    VDP_setVerticalScroll(BG_B, (s16)cam_y);
    if (hs_dirty) {
        if (!hs_mode_on) { VDP_setScrollingMode(HSCROLL_LINE, VSCROLL_PLANE); hs_mode_on = 1; }
        VDP_setHorizontalScrollLine(BG_B, 0, hs_table, 224, DMA_QUEUE);
        hs_dirty = 0;
    }
    for (i = spr_count; i < spr_last; i++)
        VDP_setSprite(i, 0, HIDE_Y, SPRITE_SIZE(1, 1), TILE_ATTR_FULL(PAL0, 1, 0, 0, T_SHEET));
    n = (spr_count > spr_last) ? spr_count : spr_last;
    if (n) {
        VDP_linkSprites(0, n);       // link byte is load-bearing: 0 = end of list
        VDP_updateSprites(n, DMA_QUEUE);
    }
    spr_last = spr_count;
    if (bmp_on) BMP_flip(TRUE);
    md_time_tick();
    SYS_doVBlankProcess();
}

// ---- Phase 2: SRAM, window-plane HUD, shadow/highlight ------------------------

// save/load: (slot, array8, count) — 256-byte slots in battery SRAM, the
// cross-SDK contract (gbalua's shape). SRAM on MD is byte-wide on odd addresses;
// SGDK's SRAM_* handles the addressing.
// Slot layout (cross-SDK contract, matches gbalua): [magic][len][data...].
// load() returns 0 for a never-written slot (fresh SRAM is garbage) — the
// caller doesn't have to keep its own magic byte.
#define MD_SAVE_MAGIC 0xA5
void md_save(int slot, const unsigned char *arr, int n) {
    int i;
    u32 base = (u32)(slot & 0xFF) << 8;
    if (n > 254) n = 254;                     // 2 bytes reserved for magic+len
    SRAM_enable();
    SRAM_writeByte(base, MD_SAVE_MAGIC);
    SRAM_writeByte(base + 1, (u8)n);
    for (i = 0; i < n; i++) SRAM_writeByte(base + 2 + (u32)i, arr[i]);
    SRAM_disable();
}
int md_load(int slot, unsigned char *arr, int n) {
    int i, len;
    u32 base = (u32)(slot & 0xFF) << 8;
    SRAM_enableRO();
    if (SRAM_readByte(base) != MD_SAVE_MAGIC) { SRAM_disable(); return 0; }  // never saved
    len = SRAM_readByte(base + 1);
    if (len > n) len = n;
    if (len > 254) len = 254;
    for (i = 0; i < len; i++) arr[i] = SRAM_readByte(base + 2 + (u32)i);
    SRAM_disable();
    return len;
}

// hud(rows): the VDP WINDOW plane replaces plane A for the top N tile rows —
// a rock-solid unscrolled HUD strip (the classic Genesis status bar). Text
// lands there automatically when its tile row is inside the strip.
void md_hud(int rows) {
    if (rows < 0) rows = 0;
    if (rows > 27) rows = 27;
    hud_rows = (u16)rows;
    VDP_setWindowVPos(FALSE, (u16)rows);   // window covers rows ABOVE `rows`
}

// shadow/highlight: VDP mode bit. In this mode, low-priority planes shadow;
// PAL3 colors 14/15 act as hilight/shadow operators on sprites (documented).
void md_shade_mode(int on) { VDP_setHilightShadow(on ? TRUE : FALSE); }
