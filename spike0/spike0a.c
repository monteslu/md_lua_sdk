#include <genesis.h>

// Spike 0a: prove buildGenesisC + finalizeGenesisRom + gpgx end to end.
// A filled tile plane scrolling + a moving "sprite" drawn via VDP tiles + pad input.
static u16 scrollx = 0;
int main(bool hard) {
    u16 px = 10, py = 10;
    u16 i;
    VDP_setScreenWidth320();
    PAL_setColor(0, RGB24_TO_VDPCOLOR(0x2244aa));
    PAL_setColor(1, RGB24_TO_VDPCOLOR(0xffffff));
    PAL_setColor(2, RGB24_TO_VDPCOLOR(0xffaa00));
    VDP_drawText("MDLUA SPIKE 0A", 10, 2);
    // checker row on plane B so scroll is visible
    for (i = 0; i < 64; i += 2) VDP_setTileMapXY(BG_B, TILE_ATTR_FULL(PAL0, 0, 0, 0, 1), i, 10);
    while (1) {
        u16 joy = JOY_readJoypad(JOY_1);
        if (joy & BUTTON_RIGHT) px++;
        if (joy & BUTTON_LEFT)  px--;
        scrollx++;
        VDP_setHorizontalScroll(BG_B, -scrollx);
        VDP_clearTextArea(0, 5, 40, 1);
        VDP_drawText("@", px, 5);
        SYS_doVBlankProcess();
    }
    return 0;
}
