/* Minimal <stdint.h> for luacretro's runtime under SGDK (the Genesis build has
 * no libc headers). Types match SGDK's own (u8/u16/u32/s32...), which types.h
 * may already have #defined these names to. */
#ifndef MDLUA_STDINT_H
#define MDLUA_STDINT_H
typedef signed char int8_t;
typedef unsigned char uint8_t;
typedef signed short int16_t;
typedef unsigned short uint16_t;
typedef signed long int32_t;
typedef unsigned long uint32_t;
typedef signed long long int64_t;
typedef unsigned long long uint64_t;
typedef signed long intptr_t;
typedef unsigned long uintptr_t;
#define __int8_t_defined 1
#define __int16_t_defined 1
#define __int32_t_defined 1
#define INT32_MAX 0x7fffffffL
#define UINT32_MAX 0xffffffffUL
#endif
