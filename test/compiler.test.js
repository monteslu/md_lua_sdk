import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compile } from "../compiler/index.js";

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const LOOP = "function _update60()\nend\nfunction _draw()\nend\n";

function errorsOf(src) {
  return compile(src, "t.lua").diagnostics
    .filter((d) => d.severity === "error")
    .map((d) => d.message);
}

function cOf(src) {
  const r = compile(src, "t.lua");
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics, null, 2));
  return r.c;
}

// ---- examples --------------------------------------------------------------

for (const ex of ["mvp", "hello", "anim", "starfall", "raster", "platformer", "sgdk_direct", "parity", "coroutine", "pcm", "vint_callback", "sprite_callback", "music"]) {
  test(`example ${ex} compiles`, () => {
    const src = readFileSync(path.join(REPO, `examples/${ex}/main.lua`), "utf8");
    const r = compile(src, "main.lua", { target: "md" });
    assert.equal(r.ok, true, JSON.stringify(r.diagnostics, null, 2));
    assert.match(r.c, /int main\(bool hard\)/);
  });
}

// ---- the md target harness ---------------------------------------------------

test("harness is SGDK-shaped: main(bool hard) + md_init/md_vsync/md_endframe", () => {
  const c = cOf(LOOP);
  assert.match(c, /int main\(bool hard\)/);
  assert.match(c, /md_init\(\);/);
  assert.match(c, /md_vsync\(\);/);
  assert.match(c, /md_endframe\(\);/);
  assert.match(c, /#include "md_api\.h"/);
});

test("NO GameTank residue in emitted C (banking/zp/gt_ names)", () => {
  const c = cOf("local x = 0\nfunction _update60()\n  x += 1\nend\nfunction _draw()\n  cls(1)\n  spr(0, x, 10)\nend\n");
  assert.doesNotMatch(c, /\bgt_[a-z]/);      // final remap catches every raw gt_*
  assert.doesNotMatch(c, /gt_bank|FLASH2M|\.PC02/);
  assert.match(c, /md_cls\(1\)/);
  assert.match(c, /md_spr\(0, /);
});

// ---- the remap-pass regression the gbalua fork carries ------------------------

test("flr(rnd(n)) emits md_rnd_int (the raw-template name is remapped)", () => {
  const c = cOf("local x = 0\nfunction _update60()\n  x = flr(rnd(10))\nend\n" + "function _draw()\nend\n");
  assert.match(c, /md_rnd_int\(10\)/);
  assert.doesNotMatch(c, /gt_p8_rnd_int/);   // the exact symbol gbalua fails to link
});

test("abs/sgn emit md_* helpers; fixed mid calls md_midf (int mid inlines)", () => {
  const c = cOf("local a = -3\nlocal b = 0\nfunction _update60()\n  b = abs(a) + sgn(a)\nend\n" + "function _draw()\nend\n");
  assert.match(c, /md_absi\(/);
  assert.match(c, /md_sgni\(/);
  const cf = cOf("local a = 1.5\nlocal b = 0.0\nfunction _update60()\n  b = mid(0.5, a, 2.5)\nend\n" + "function _draw()\nend\n");
  assert.match(cf, /md_midf\(/);
});

test("fixed multiply/divide inline with a 64-bit intermediate (no runtime call)", () => {
  const c = cOf("local a = 1.5\nlocal b = 2.5\nlocal r = 0.0\nfunction _update60()\n  r = a * b\nend\n" + "function _draw()\nend\n");
  assert.match(c, /long long/);
  assert.doesNotMatch(c, /md_fmul/);          // inlined, not the cdecl fallback
});

// ---- Genesis-flavor verbs -------------------------------------------------------

test("pal() with and without args (CRAM remap + reset sentinel)", () => {
  const c = cOf(LOOP.replace("function _draw()\nend", "function _draw()\n  pal(8, 10)\n  pal()\nend"));
  assert.match(c, /md_pal\(8, 10\)/);
  assert.match(c, /md_pal\(-1, -1\)/);
});

test("hscroll(line, x) emits md_hscroll", () => {
  const c = cOf("function _update60()\n  for l = 0, 223 do\n    hscroll(l, 4)\n  end\nend\nfunction _draw()\nend\n");
  assert.match(c, /md_hscroll\(/);
});

test("music/sfx emit md_music/md_sfx (XGM2/PSG runtime)", () => {
  const c = cOf("function _update60()\n  music(0)\n  sfx(3)\nend\nfunction _draw()\nend\n");
  assert.match(c, /md_music\(0, 1\)/);       // loop defaults on
  assert.match(c, /md_sfx\(3, -1\)/);        // auto channel
});

test("anim family keeps the cross-SDK slot contract (slot, first, last, fps)", () => {
  const c = cOf("local f = 0\nfunction _update60()\n  f = anim(0, 1, 4, 8)\nend\nfunction _draw()\n  spr(f, 10, 10)\nend\n");
  assert.match(c, /md_anim\(0, 1, 4, /);
});

test("GBA-only verbs are GONE (mode7/sprr/blend do not exist here)", () => {
  const errs = errorsOf("function _update60()\n  mode7(0)\nend\nfunction _draw()\nend\n");
  assert.ok(errs.some((m) => /mode7/.test(m)), errs.join("\n"));
});

// ---- core dialect (the shared front-end, spot checks) ---------------------------

test("!= is ~=; \\\\ floor division; += compound", () => {
  const c = cOf("local x = 8\nfunction _update60()\n  if x != 2 then\n    x \\= 2\n    x += 1\n  end\nend\nfunction _draw()\nend\n");
  assert.match(c, /!=/);
});

test("constant integer exponent expands to repeated multiplication", () => {
  const c = cOf("local d = 0\nlocal a = 3\nfunction _update60()\n  d = a ^ 2\nend\n" + "function _draw()\nend\n");
  assert.doesNotMatch(c, /pow/);
});

test("string escapes survive into one literal", () => {
  const c = cOf('function _update60()\nend\nfunction _draw()\n  print("a\\"b", 0, 0, 7)\nend\n');
  const printCall = c.match(/md_print\([^\n]*\)/)?.[0] ?? "";
  assert.ok(printCall.includes('\\"'), printCall);
  assert.ok(printCall.startsWith('md_print("a'), printCall);
});

test("spr flips pack into one arg (bit0 X, bit1 Y)", () => {
  const c = cOf(LOOP.replace("function _draw()\nend", "function _draw()\n  spr(1, 8, 8, 1, 1, 1, 1)\nend"));
  assert.match(c, /md_spr\(1, 8, 8, 1, 1, .*\| .*<< 1\)/);   // both flips packed into one arg
});

test("map() special routes the __p8map hexdata array to md_map", () => {
  const src = 'local __p8map = hexdata("0102")\n' + "function _update60()\nend\nfunction _draw()\n  map(0, 0, 0, 0, 2, 1)\nend\n";
  const c = cOf(src);
  assert.match(c, /md_map\(gtl___p8map, 128, 0, 0, 0, 0, 2, 1\)/);
});

test("btn/btnp with player arg", () => {
  const c = cOf("local x = 0\nfunction _update60()\n  if btn(4) then x += 1 end\n  if btnp(5, 1) then x -= 1 end\nend\n" + "function _draw()\nend\n");
  assert.match(c, /md_btn\(4, 0\)/);
  assert.match(c, /md_btnp\(5, 1\)/);
});

// ---- static-model diagnostics (unchanged front-end contracts) --------------------

test("gt.* namespace is refused", () => {
  const errs = errorsOf("function _update60()\n  gt.rgb(1, 2, 3)\nend\nfunction _draw()\nend\n");
  assert.ok(errs.length > 0);
});

test("closures still refused (static model)", () => {
  const errs = errorsOf("local f = 0\nfunction _update60()\n  f = function() end\nend\nfunction _draw()\nend\n");
  assert.ok(errs.some((m) => /anonymous functions/.test(m)), errs.join("\n"));
});

test("pool/add/del/all compile (SoA model intact)", () => {
  const c = cOf(
    "local ps = pool(8)\nfunction _update60()\n  add(ps, {x = 1, y = 2})\n  for e in all(ps) do\n    e.x += 1\n    if e.x > 10 then del(ps, e) end\n  end\nend\nfunction _draw()\nend\n"
  );
  assert.match(c, /ps_x\[/);
  assert.match(c, /ps_used\[/);
});

// ---- SGDK coroutines (task.h) via the "fn" callback kind ---------------------

test("callback kind: TSK_userSet(fn) emits &gtl_<name> and keeps the function", () => {
  const c = cOf(
    "local n = 0\nfunction worker()\n  n += 1\nend\n" +
    "function _init()\n  TSK_init()\n  TSK_userSet(worker)\nend\n" +
    "function _update60()\n  TSK_userYield()\nend\nfunction _draw()\nend\n"
  );
  assert.match(c, /TSK_userSet\(\(void\*\)&gtl_worker\)/);   // address-of, not a call
  assert.match(c, /gtl_worker\(void\)\s*\{/);                 // NOT dead-code eliminated
  assert.match(c, /TSK_init\(\)/);
  assert.match(c, /TSK_userYield\(\)/);
});

test("callback kind: passing a non-function is an error", () => {
  const errs = errorsOf(
    "local n = 0\nfunction _init()\n  TSK_userSet(n)\nend\n" +
    "function _update60()\nend\nfunction _draw()\nend\n"
  );
  assert.ok(errs.some((m) => /must be a top-level function name/.test(m)), errs.join("\n"));
});

test("callback function is NOT rejected as a value at the call site", () => {
  // regression: typeOf() over builtin args tripped 'functions are not values'
  const r = compile(
    "function cb()\nend\nfunction _init()\n  SYS_setVIntCallback(cb)\nend\n" +
    "function _update60()\nend\nfunction _draw()\nend\n",
    "t.lua", { target: "md" }
  );
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics, null, 2));
  assert.match(r.c, /SYS_setVIntCallback\(\(void\*\)&gtl_cb\)/);
});

test("SYS_setVIntCallback: installs a Lua fn as the vblank hook, keeps it live", () => {
  // the callback bumps a memory-backed array (as the interrupt handler must) -
  // and is reached ONLY via the callback, so it must survive dead-code elim.
  const c = cOf(
    "local v = array(2)\nfunction on_vblank()\n  v[0] = v[0] + 1\nend\n" +
    "function _init()\n  v[0] = 0\n  SYS_setVIntCallback(on_vblank)\nend\n" +
    "function _update60()\nend\nfunction _draw()\n  print(v[0], 8, 8, 7)\nend\n"
  );
  assert.match(c, /SYS_setVIntCallback\(\(void\*\)&gtl_on_vblank\)/);  // address-of
  assert.match(c, /gtl_on_vblank\(void\)\s*\{/);                        // NOT eliminated
});

test("SPR_setFrameChangeCallback: sprite-engine callback + pointer-return handle", () => {
  // the SGDK sprite engine: SPR_addSprite RETURNS a Sprite* (cast to int handle,
  // retptr), and the frame-change callback takes that handle + a Lua fn.
  const c = cOf(
    "local s = 0\nfunction on_frame()\nend\n" +
    "function _init()\n  SPR_init()\n  s = SPR_addSprite(demo_sprite(), 100, 100, 0)\n" +
    "  SPR_setFrameChangeCallback(s, on_frame)\nend\n" +
    "function _update60()\n  SPR_update()\nend\nfunction _draw()\nend\n"
  );
  assert.match(c, /s = \(int\)SPR_addSprite\(/);                        // pointer return -> (int)
  assert.match(c, /SPR_setFrameChangeCallback\(\(void\*\)\(gtl_s\), \(void\*\)&gtl_on_frame\)/);
  assert.match(c, /gtl_on_frame\(void\)\s*\{/);                         // callback kept live
});

test("pointer-returning SGDK calls cast to int (retptr, assigns cleanly)", () => {
  // regression: SPR_addSprite/etc. return Sprite*; without the (int) cast the
  // assignment to an int global is -Wint-conversion under -Werror.
  const c = cOf(
    "local m = 0\nfunction _update60()\n  m = SPR_addSprite(demo_sprite(), 0, 0, 0)\nend\nfunction _draw()\nend\n"
  );
  assert.match(c, /\(int\)SPR_addSprite\(/);
});

// ---- raw PCM (SND_PCM driver) ------------------------------------------------

test("SND_PCM_startPlay: pointer arg casts to void*, bool arg accepts false", () => {
  const c = cOf(
    "function _init()\n  pcm_driver()\n" +
    "  SND_PCM_startPlay(pcm_sample(0), pcm_len(0), 3, 128, false)\nend\n" +
    "function _update60()\nend\nfunction _draw()\nend\n"
  );
  assert.match(c, /SND_PCM_startPlay\(\(void\*\)\(/);   // optr -> (void*)(...)
  assert.match(c, /\(\(0\) \? 1 : 0\)\)/);               // false -> flip kind
  assert.match(c, /md_pcm_driver\(\)/);
});

test("curated pcm_play convenience verb compiles", () => {
  const c = cOf(
    "function _init()\n  pcm_play(0, 3, false)\nend\n" +
    "function _update60()\nend\nfunction _draw()\nend\n"
  );
  assert.match(c, /md_pcm_play\(0, 3, /);
});

test("SGDK bool params accept Lua booleans (flip kind)", () => {
  // a scalar `bool` param (DMA_setAutoFlush(bool)) must take true/false, not
  // just ints - the generator maps bool -> the "flip" kind for exactly this.
  const c = cOf(
    "function _update60()\n  DMA_setAutoFlush(false)\nend\nfunction _draw()\nend\n"
  );
  assert.match(c, /DMA_setAutoFlush\(\(\(0\) \? 1 : 0\)\)/);
});

test("SGDK pointer-handle params cast to void* (Sprite* under -Werror)", () => {
  const c = cOf(
    "local s = 0\n" +
    "function _update60()\n  s = SPR_addSprite(0, 0, 0, 0)\n  SPR_setPosition(s, 10, 20)\nend\nfunction _draw()\nend\n"
  );
  assert.match(c, /SPR_setPosition\(\(void\*\)\(/);   // handle -> void*
});
