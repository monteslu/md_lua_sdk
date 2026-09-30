// lc_md.c - the Sega Genesis platform layer for luacretro's dynamic tier (real
// PICO-8 carts compiled to native 68000 code, SGDK underneath).
//
// Implements luacretro's runtime/lc_plat.h: the 128x128 PICO-8 screen is shown
// as 16x16 tiles in the middle of plane A (320x224), re-uploaded through the VDP
// data port on each present (PICO-8 keeps the left pixel in the LOW nibble, the
// VDP in the high one, so every byte is nibble-swapped on the way); PICO-8's
// screen palette drives CRAM palette 0; the pad maps to PICO-8 buttons; cartdata
// lives in SRAM.
//
// Memory is the Genesis' limit: 64 KB of work RAM holds PICO-8's 32 KB base RAM
// (LC_P8_MEMSIZE 0x8000: no upper memory), the heap and SGDK. Carts whose live
// Lua data outgrows the heap stop with "not enough memory".

/* the runtime headers first: their <stdint.h> tells SGDK's types.h not to
 * #define the exact-width names itself */
#include "lc.h"
#include "lc_p8.h"
#include "lc_plat.h"
#include <genesis.h>

#ifndef MDLUA_ARENA
#define MDLUA_ARENA (12 * 1024)
#endif
#ifndef MDLUA_VSLOTS
#define MDLUA_VSLOTS 320
#endif
#ifndef MDLUA_CSTACK
#define MDLUA_CSTACK 3072
#endif

#define TX0 12              /* (40 - 16) / 2 */
#define TY0 6               /* (28 - 16) / 2 */

static const u16 P8MD[32] = {
#define C9(r, g, b) ((u16)((((b) >> 5) << 9) | (((g) >> 5) << 5) | (((r) >> 5) << 1)))
  C9(0, 0, 0), C9(29, 43, 83), C9(126, 37, 83), C9(0, 135, 81),
  C9(171, 82, 54), C9(95, 87, 79), C9(194, 195, 199), C9(255, 241, 232),
  C9(255, 0, 77), C9(255, 163, 0), C9(255, 236, 39), C9(0, 228, 54),
  C9(41, 173, 255), C9(131, 118, 156), C9(255, 119, 168), C9(255, 204, 170),
  C9(41, 24, 20), C9(17, 29, 53), C9(66, 33, 54), C9(18, 83, 89),
  C9(116, 47, 41), C9(73, 51, 59), C9(162, 136, 121), C9(243, 239, 125),
  C9(190, 18, 80), C9(255, 108, 36), C9(168, 231, 46), C9(0, 181, 67),
  C9(6, 90, 181), C9(117, 70, 101), C9(255, 110, 89), C9(255, 157, 129),
#undef C9
};

/* nibble-swapped byte pairs: PICO-8 halfword -> VDP halfword, 128 KB of ROM */
#include "lc_md_swap16.h"

static void upload_screen(const uint8_t *screen) {
  vu32 *ctrl = (vu32 *)VDP_CTRL_PORT;
  vu16 *data = (vu16 *)VDP_DATA_PORT;
  VDP_setAutoInc(2);
  *ctrl = VDP_WRITE_VRAM_ADDR(TILE_USER_INDEX * 32);
  for (int ty = 0; ty < 16; ty++) {
    for (int tx = 0; tx < 16; tx++) {
      const uint8_t *p = screen + ty * 8 * 64 + tx * 4;
      for (int r = 0; r < 8; r++, p += 64) {
        *data = lc_md_swap16[((u16)p[0] << 8) | p[1]];
        *data = lc_md_swap16[((u16)p[2] << 8) | p[3]];
      }
    }
  }
}

void lc_plat_present(const uint8_t *screen, const uint8_t *pal, uint8_t mode) {
  (void)mode;
  u16 cols[16];
  for (int i = 0; i < 16; i++) {
    uint8_t p = pal[i];
    cols[i] = P8MD[(p & 0x80) ? 16 + (p & 15) : (p & 15)];
  }
  SYS_doVBlankProcess();
  PAL_setColors(0, cols, 16, CPU);
  upload_screen(screen);
}

void lc_plat_vsync(void) { SYS_doVBlankProcess(); }

uint8_t lc_plat_buttons(int player) {
  if (player > 1) return 0;
  u16 j = JOY_readJoypad(player == 0 ? JOY_1 : JOY_2);
  uint8_t r = 0;
  if (j & BUTTON_LEFT) r |= 1;
  if (j & BUTTON_RIGHT) r |= 2;
  if (j & BUTTON_UP) r |= 4;
  if (j & BUTTON_DOWN) r |= 8;
  if (j & (BUTTON_A | BUTTON_C)) r |= 16;   /* O */
  if (j & BUTTON_B) r |= 32;                /* X */
  if (j & BUTTON_START) r |= 64;
  return r;
}

/* cartdata: "LC" + 64-byte id + 256 bytes in SRAM */
int lc_plat_cartdata_load(const char *id, uint8_t *data256) {
  SRAM_enableRO();
  int ok = SRAM_readByte(0) == 'L' && SRAM_readByte(1) == 'C';
  for (int i = 0; ok && i < 64; i++) {
    if ((char)SRAM_readByte(2 + i) != id[i]) ok = 0;
    if (!id[i]) break;
  }
  if (ok) for (int i = 0; i < 256; i++) data256[i] = SRAM_readByte(66 + i);
  SRAM_disable();
  return ok;
}

void lc_plat_cartdata_save(const char *id, const uint8_t *data256) {
  SRAM_enable();
  SRAM_writeByte(0, 'L');
  SRAM_writeByte(1, 'C');
  int i = 0;
  for (; i < 63 && id[i]; i++) SRAM_writeByte(2 + i, (u8)id[i]);
  for (; i < 64; i++) SRAM_writeByte(2 + i, 0);
  for (int k = 0; k < 256; k++) SRAM_writeByte(66 + k, data256[k]);
  SRAM_disable();
}

uint32_t lc_plat_seed(void) {
#ifdef MDLUA_SEED
  return MDLUA_SEED;
#else
  return ((uint32_t)random() << 16) ^ random();
#endif
}

void lc_plat_datetime(int out[6]) {
  out[0] = 2024; out[1] = 1; out[2] = 1; out[3] = 12; out[4] = 0; out[5] = 0;
}

void lc_plat_log(const char *s, size_t len) { (void)s; (void)len; }

_Noreturn void lc_plat_fatal(const char *msg) {
  lc_p8mem[P8_SCRMAP] = 0x60;
  for (int i = 0; i < 16; i++) lc_p8mem[P8_SCREENPAL + i] = (uint8_t)i;
  lc_p8mem[P8_COLORMASK] = 0xff;
  lc_p8_reset_drawstate();
  lc_p8_cls(0);
  uint32_t n = 0;
  while (msg[n]) n++;
  lc_p8_print((const uint8_t *)"runtime error", 13, 1, 0, 0, 1, 8);
  lc_p8_print((const uint8_t *)msg, n, 1, 0, 8, 1, 7);
  for (;;) lc_plat_present(lc_p8_screenbuf(), lc_p8mem + P8_SCREENPAL, 0);
}

static uint64_t arena[MDLUA_ARENA / 8];
static uint64_t vstack[MDLUA_VSLOTS];

int main(bool hard) {
  char base;
  (void)hard;
  VDP_setScreenWidth320();
  VDP_setPlaneSize(64, 32, TRUE);
  PAL_setColor(0, 0);
  VDP_setBackgroundColor(0);
  for (int ty = 0; ty < 16; ty++)
    for (int tx = 0; tx < 16; tx++)
      VDP_setTileMapXY(BG_A, TILE_ATTR_FULL(PAL0, 0, 0, 0, TILE_USER_INDEX + ty * 16 + tx), TX0 + tx, TY0 + ty);
  for (u32 i = 0; i < LC_P8_MEMSIZE; i++) lc_p8mem[i] = 0;
  lc_p8_run(arena, sizeof arena, vstack, MDLUA_VSLOTS, &base, MDLUA_CSTACK);
  return 0;
}
