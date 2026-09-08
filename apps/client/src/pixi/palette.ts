export const palette = {
  felt: 0x0d3b2e,
  feltLine: 0xd9c98d,
  red: 0xc22f2f,
  black: 0x17181d,
  green: 0x1d7a4b,
  gold: 0xe7c86a,
  chip: 0x3aa0ff,
  chipOthers: 0xf0f0f0,
  wheelRim: 0x5b3a1e,
  text: 0xffffff,
} as const

export function pocketFill(color: 'red' | 'black' | 'green'): number {
  return color === 'red' ? palette.red : color === 'black' ? palette.black : palette.green
}
