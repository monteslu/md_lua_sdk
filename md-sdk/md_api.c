// md_api.c — mdlua runtime, spike-0 slice. Thin wrappers over SGDK.
//
// Frame model (immediate-mode, PICO-8-shaped): the game's _draw() re-states
// everything each frame. Sprites are a per-frame display list — each md_spr()
// claims the next hardware sprite slot; md_endframe() links + DMA-queues the
// slots and hides any slots the previous frame used but this one didn't
// (stale SAT entries otherwise linger — the VDP has no "count" concept).
#include "md_api.h"
#include "md_math.h"

// ---- PICO-8 palette -> CRAM PAL0 ------------------------------------------
// The 16 PICO-8 colors, RGB24. Loaded into palette line 0 at boot so color
// arguments 0-15 behave like PICO-8 out of the box. (pal() verbs later remap
// CRAM live — the Genesis headline feature.)
static const u32 P8_RGB[16] = {
    0x000000, 0x1D2B53, 0x7E2553, 0x008751, 0xAB5236, 0x5F574F, 0xC2C3C7,
    0xFFF1E8, 0xFF004D, 0xFFA300, 0xFFEC27, 0x00E436, 0x29ADFF, 0x83769C,
    0xFF77A8, 0xFFCCAA,
};

// ---- spike sprite tiles -----------------------------------------------------
// 4 solid 8x8 tiles (colors 8,10,11,12) at T_SPR so spr(0..3) shows something
// visibly distinct before the real asset pipeline lands (Phase 1).
#define T_SPR TILE_USER_INDEX
static const u32 spike_tiles[4 * 8] = {
    0x88888888, 0x88888888, 0x88888888, 0x88888888, 0x88888888, 0x88888888, 0x88888888, 0x88888888,
    0xAAAAAAAA, 0xAAAAAAAA, 0xAAAAAAAA, 0xAAAAAAAA, 0xAAAAAAAA, 0xAAAAAAAA, 0xAAAAAAAA, 0xAAAAAAAA,
    0xBBBBBBBB, 0xBBBBBBBB, 0xBBBBBBBB, 0xBBBBBBBB, 0xBBBBBBBB, 0xBBBBBBBB, 0xBBBBBBBB, 0xBBBBBBBB,
    0xCCCCCCCC, 0xCCCCCCCC, 0xCCCCCCCC, 0xCCCCCCCC, 0xCCCCCCCC, 0xCCCCCCCC, 0xCCCCCCCC, 0xCCCCCCCC,
};

// ---- input latch ------------------------------------------------------------
static u16 joy_cur[2], joy_prev[2];

// P8 button index -> SGDK BUTTON_* mask. 4=O->B, 5=X->C (the common confirm
// pair on 3-button pads; A/START get their own verbs in Phase 2).
static u16 p8_mask(int i) {
    switch (i) {
        case 0: return BUTTON_LEFT;
        case 1: return BUTTON_RIGHT;
        case 2: return BUTTON_UP;
        case 3: return BUTTON_DOWN;
        case 4: return BUTTON_B;
        case 5: return BUTTON_C;
        default: return 0;
    }
}

int md_btn(int i, int pl)  { u16 p = (pl == 1) ? 1 : 0; return (joy_cur[p] & p8_mask(i)) != 0; }
int md_btnp(int i, int pl) {
    u16 p = (pl == 1) ? 1 : 0; u16 m = p8_mask(i);
    return (joy_cur[p] & m) && !(joy_prev[p] & m);
}

// ---- sprites: per-frame display list ---------------------------------------
#define MD_MAX_SPR 80
static u16 spr_count, spr_last;
// SAT-hide: park unused slots offscreen (the shmup-template idiom).
#define HIDE_Y ((s16)-32)

void md_spr(int n, int x, int y, int w, int h, int flip) {
    u16 hf, vf;
    (void)w; (void)h;                     // spike: 8x8 only; sizes land Phase 1
    if (spr_count >= MD_MAX_SPR) return;  // loud diagnostics come with Phase 1
    hf = (flip & 1) ? 1 : 0;
    vf = (flip & 2) ? 1 : 0;
    VDP_setSprite(spr_count, (s16)x, (s16)y, SPRITE_SIZE(1, 1),
                  TILE_ATTR_FULL(PAL0, 1, vf, hf, T_SPR + (n & 3)));
    spr_count++;
}

// ---- text -------------------------------------------------------------------
static u16 cur_col, cur_row;

void md_print(const char *s, int x, int y, int color) {
    (void)color;                          // per-glyph color = Phase 1 (pal rows)
    VDP_drawTextBG(BG_A, s, (u16)(x >> 3), (u16)(y >> 3));
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
void md_print_cur_str(const char *s, int color) { (void)color; VDP_drawTextBG(BG_A, s, cur_col, cur_row); cur_row++; if (cur_row > 27) cur_row = 0; }
void md_print_cur_int(int v, int color) { char b[12]; itoa10(v, b); md_print_cur_str(b, color); }
void md_print_cur_num(long v, int color) { md_print_cur_int((int)(v >> 16), color); }

// ---- cls / frame ------------------------------------------------------------
void md_cls(int color) {
    VDP_setBackgroundColor((u8)(color & 15));
    VDP_clearPlane(BG_A, FALSE);          // text plane; FALSE = no DMA wait here
    cur_col = 0; cur_row = 0;
}

void md_init(void) {
    u16 i;
    VDP_setScreenWidth320();
    for (i = 0; i < 16; i++) PAL_setColor(i, RGB24_TO_VDPCOLOR(P8_RGB[i]));
    VDP_loadTileData(spike_tiles, T_SPR, 4, DMA);
    spr_count = 0; spr_last = 0;
    joy_cur[0] = joy_cur[1] = joy_prev[0] = joy_prev[1] = 0;
}

void md_vsync(void) {
    joy_prev[0] = joy_cur[0]; joy_prev[1] = joy_cur[1];
    joy_cur[0] = JOY_readJoypad(JOY_1);
    joy_cur[1] = JOY_readJoypad(JOY_2);
    spr_count = 0;                        // new frame's display list
}

void md_endframe(void) {
    u16 i, n;
    // hide slots the previous frame used but this one didn't
    for (i = spr_count; i < spr_last; i++)
        VDP_setSprite(i, 0, HIDE_Y, SPRITE_SIZE(1, 1), TILE_ATTR_FULL(PAL0, 1, 0, 0, T_SPR));
    n = (spr_count > spr_last) ? spr_count : spr_last;
    if (n) {
        // HARDWARE IDIOM (load-bearing): chain the SAT list before uploading —
        // VDP_setSprite does NOT set the link byte and link 0 = end-of-list.
        VDP_linkSprites(0, n);
        VDP_updateSprites(n, DMA_QUEUE);
    }
    spr_last = spr_count;
    md_time_tick();
    SYS_doVBlankProcess();
}
