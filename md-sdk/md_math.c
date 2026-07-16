// md_math.c — the 16.16 fixed-point math runtime for gbalua.
//
// PICO-8 number model: 16.16 fixed point. On the ARM7TDMI these are cheap —
// hardware multiply + fast divide — so fmul/fdiv are plain C with a 64-bit
// intermediate (NO asm, unlike the GameTank's hand-tuned 6502 versions). sin/cos
// are a 256-entry table (PICO-8 screen-space-inverted); atan2/rnd/time reuse the
// portable gt-lua logic. The emitter inlines fixed *,/,% directly; these back the
// math BUILTINS (sin/cos/sqrt/atan2/rnd/t) the emitter calls as md_f*.

#include "md_math.h"
#include "md_sintab.h"   // md_sintab[256], 16.16, P8-inverted

typedef long fx;   // 16.16

fx md_fmul(fx a, fx b) { return (fx)(((long long)a * b) >> 16); }
fx md_fdiv(fx a, fx b) { if (b == 0) return a < 0 ? (fx)0x80000000 : (fx)0x7FFFFFFF; return (fx)((((long long)a) << 16) / b); }

fx md_fsin(fx turns) { return md_sintab[(unsigned char)(((unsigned long)turns >> 8) & 0xFF)]; }
fx md_fcos(fx turns) { return -md_sintab[(unsigned char)((((unsigned long)turns + 0x4000UL) >> 8) & 0xFF)]; }

// integer sqrt of a 16.16 value -> 16.16 (Newton's method, a few iterations).
fx md_fsqrt(fx x) {
    if (x <= 0) return 0;
    // sqrt(x) in 16.16 = sqrt(x_raw * 65536) = sqrt(x_raw) << 8 (x_raw is the int).
    // Do it in 64-bit: result r with r*r ~= x<<16.
    unsigned long long v = ((unsigned long long)(unsigned long)x) << 16;
    unsigned long long r = v, last;
    if (r == 0) return 0;
    // initial guess
    unsigned long long g = 1;
    while (g * g < v) g <<= 1;
    r = g;
    do { last = r; r = (r + v / r) >> 1; } while (r < last);
    return (fx)last;
}

// atan2 -> PICO-8 turns [0,1) in 16.16. Reuses the gt-lua first-octant approx.
fx md_fatan2(fx dx, fx dy) {
    unsigned char swap = 0, mirror = 0, negate = 0;
    fx mx = dx, my = -dy;
    fx ax, ay, r, a;
    if (dx == 0 && dy == 0) return 0xC000L;
    if (mx < 0) { mirror = 1; ax = -mx; } else ax = mx;
    if (my < 0) { negate = 1; ay = -my; } else ay = my;
    if (ay > ax) { swap = 1; r = md_fdiv(ax, ay); }
    else         {           r = md_fdiv(ay, ax); }
    a = md_fmul(r, 0x2000L + md_fmul(0x0B20L, 0x10000L - r));
    if (swap) a = 0x4000L - a;
    if (mirror) a = 0x8000L - a;
    if (negate) a = -a;
    return a & 0xFFFFL;
}

// ---- rng (16-bit xorshift) ----
static unsigned int rng_state = 0xABCDu;
static unsigned int rng_next(void) {
    unsigned int x = rng_state;
    x ^= x << 7; x ^= x >> 9; x ^= x << 8;
    rng_state = x ? x : 0xABCDu;
    return rng_state;
}

// rnd(x): frac in [0,1) from 16 random bits, scaled by x. 16.16.
fx md_rnd(fx x) {
    unsigned int s = rng_next();
    if (x <= 0) return 0;
    return md_fmul((fx)s, x);
}
void md_srand(fx seed) {
    rng_state = (unsigned int)(seed >> 16) ^ (unsigned int)seed;
    if (rng_state == 0) rng_state = 0xABCDu;
}

// ---- t()/time(): seconds since boot, advanced each frame ----
static fx time_acc = 0;
static unsigned char time_rem = 0;
// frame counter since boot (advanced with time). The animation helpers time off
// this; ticks() also reads it. Reset on run()/reset via md_time_reset().
static unsigned int frame_no = 0;
void md_time_tick(void) {
    time_acc += 1092L;                 // 1/60 s in 16.16 = 1092 + 16/60
    time_rem += 16;
    if (time_rem >= 60) { time_rem -= 60; time_acc += 1; }
    frame_no++;
}
fx md_time(void) { return time_acc; }
unsigned int md_ticks(void) { return frame_no; }
void md_time_reset(void) { time_acc = 0; time_rem = 0; frame_no = 0; }

// ---- small helpers the emitter references directly ---------------------------
// (raw names in emit templates arrive as md_* via the final remap pass)
int md_rnd_int(int n) {                      // flr(rnd(n)) fast path
    unsigned int s = rng_next();
    if (n <= 0) return 0;
    return (int)(((unsigned long)s * (unsigned int)n) >> 16);
}
int  md_absi(int v)              { return v < 0 ? -v : v; }
long md_absf(long v)             { return v < 0 ? -v : v; }
int  md_sgni(int v)              { return v > 0 ? 1 : (v < 0 ? -1 : 0); }
long md_sgnf(long v)             { return v > 0 ? 0x10000L : (v < 0 ? -0x10000L : 0); }
int  md_midi(int a, int b, int c) {
    int t;
    if (a > b) { t = a; a = b; b = t; }
    if (b > c) { b = c; }
    return a > b ? a : b;
}
long md_midf(long a, long b, long c) {
    long t;
    if (a > b) { t = a; a = b; b = t; }
    if (b > c) { b = c; }
    return a > b ? a : b;
}
// PICO-8 \ (floor div) and % (floor mod) on ints — sign-correct floor semantics.
int md_ifdiv(int a, int b) {
    int q;
    if (b == 0) return a < 0 ? -32768 : 32767;
    q = a / b;
    if ((a % b != 0) && ((a < 0) != (b < 0))) q--;
    return q;
}
int md_ifmod(int a, int b) {
    int r;
    if (b == 0) return 0;
    r = a % b;
    if (r != 0 && ((r < 0) != (b < 0))) r += b;
    return r;
}
long md_ffmod(long a, long b) {
    long r;
    if (b == 0) return 0;
    r = a % b;
    if (r != 0 && ((r < 0) != (b < 0))) r += b;
    return r;
}
