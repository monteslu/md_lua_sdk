/* Minimal <stddef.h> for luacretro's runtime under SGDK. */
#ifndef MDLUA_STDDEF_H
#define MDLUA_STDDEF_H
typedef unsigned long size_t;
typedef signed long ptrdiff_t;
#ifndef NULL
#define NULL 0
#endif
#define offsetof(t, m) __builtin_offsetof(t, m)
#endif
