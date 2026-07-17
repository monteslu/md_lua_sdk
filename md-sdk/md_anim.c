// md_anim.c — animation helpers: turn a frame RANGE + a speed into "which frame
// to draw right now", timed automatically off the frame clock.
//
// The PICO-8 idiom is `spr(1 + flr(t()*8) % 4, x, y)` — hand-rolled timing every
// draw. That's fine until you have several actors at different speeds, one-shots
// that must stop on the last frame, and ping-pong cycles. These helpers do the
// bookkeeping in a small fixed pool of animators (no heap — static architecture):
//
//   anim(slot, first, last, fps)      -> current frame; LOOPS first..last.
//   anim_once(slot, first, last, fps) -> current frame; HOLDS on last, then done.
//   anim_pingpong(slot, first, last, fps) -> bounces first..last..first.
//   anim_reset(slot)                  -> restart slot from its first frame.
//   anim_done(slot)                   -> 1 if a once-anim has reached its last.
//
// `slot` is a small integer id (0..MD_ANIM_SLOTS-1) you pick per actor. `fps` is
// frames-PER-SECOND as 16.16 (e.g. 8.0 = 8 animation frames/sec). Timing is driven
// by the boot frame counter (md_ticks(), 60/sec), so animations are frame-rate
// independent of how the game structures its update.

#include "md_api.h"
#include "md_math.h"

#define MD_ANIM_SLOTS 32   // plenty for a game's active on-screen actors

// per-slot state. `acc` accumulates 16.16 "animation frames" advanced each query;
// we derive the integer frame from it. Storing the config per slot lets the game
// just call anim(slot, ...) each draw without threading state through Lua.
typedef struct {
    unsigned int last_tick;   // md_ticks() at the previous query (delta timing)
    long         acc;         // 16.16 accumulated animation-frames since reset
    unsigned char init;       // 0 until first use (then last_tick is valid)
    unsigned char done;       // set when a once-anim reaches its last frame
} Anim;

static Anim anims[MD_ANIM_SLOTS];

// advance slot's accumulator by (elapsed real frames * fps / 60) and return the
// number of whole animation-frames elapsed since reset (>= 0). Common to all modes.
static long anim_step(int slot, long fps)
{
    if (slot < 0 || slot >= MD_ANIM_SLOTS) return 0;
    Anim *a = &anims[slot];
    unsigned int now = md_ticks();
    if (!a->init) { a->init = 1; a->last_tick = now; a->acc = 0; a->done = 0; }
    unsigned int elapsed = now - a->last_tick;   // real frames since last query
    a->last_tick = now;
    // animation-frames = real_frames * fps / 60. fps is 16.16; keep 16.16 in acc.
    // (elapsed * fps) is 16.16; divide by 60 to convert 60Hz real -> fps.
    if (elapsed) a->acc += (long)((((long long)elapsed * fps)) / 60);
    return a->acc >> 16;   // whole animation-frames since reset
}

// anim(slot, first, last, fps): LOOPING cycle first..last, returns the current
// tile/frame index to draw. Feed it straight to spr()/spr8()/sprf().
int md_anim(int slot, int first, int last, long fps)
{
    if (last < first) { int t = first; first = last; last = t; }
    int span = last - first + 1;
    long n = anim_step(slot, fps);
    return first + (int)(n % span);
}

// anim_once(slot, first, last, fps): play first..last ONCE, then HOLD on last.
// anim_done(slot) becomes 1 once it reaches last. For explosions, one-shot FX.
int md_anim_once(int slot, int first, int last, long fps)
{
    if (last < first) { int t = first; first = last; last = t; }
    int span = last - first + 1;
    long n = anim_step(slot, fps);
    if (n >= span - 1) {
        if (slot >= 0 && slot < MD_ANIM_SLOTS) anims[slot].done = 1;
        return last;
    }
    return first + (int)n;
}

// anim_pingpong(slot, first, last, fps): bounce first->last->first->... A cycle is
// 2*span-2 frames; map the phase back onto the range.
int md_anim_pingpong(int slot, int first, int last, long fps)
{
    if (last < first) { int t = first; first = last; last = t; }
    int span = last - first + 1;
    if (span <= 1) return first;
    int period = 2 * span - 2;              // e.g. 0,1,2,3,2,1 -> period 6 for span 4
    long n = anim_step(slot, fps);
    int p = (int)(n % period);
    if (p >= span) p = period - p;          // fold the back half
    return first + p;
}

// anim_reset(slot): restart the animation from its first frame (re-arm a once-anim).
void md_anim_reset(int slot)
{
    if (slot < 0 || slot >= MD_ANIM_SLOTS) return;
    anims[slot].init = 0;   // next query re-seeds last_tick and zeroes acc
    anims[slot].acc = 0;
    anims[slot].done = 0;
}

// anim_done(slot): 1 if a once-anim has reached its last frame (else 0).
int md_anim_done(int slot)
{
    if (slot < 0 || slot >= MD_ANIM_SLOTS) return 0;
    return anims[slot].done;
}
