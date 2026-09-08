/**
 * One chip color language everywhere: the dock buttons, the dragged ghost and
 * the chips lying on the felt all use the denomination tier of the amount.
 */
export const CHIP_TIERS = [
  { min: 100, css: '#191c22', pixi: 0x2a2d35 },
  { min: 25, css: '#1f7a4d', pixi: 0x2c9260 },
  { min: 10, css: '#2f6cb3', pixi: 0x3f7fc4 },
  { min: 5, css: '#a53c2c', pixi: 0xc65442 },
  { min: 1, css: '#5a6572', pixi: 0x78848f },
] as const

export function chipTierPixi(amount: number): number {
  return (CHIP_TIERS.find((tier) => amount >= tier.min) ?? CHIP_TIERS[CHIP_TIERS.length - 1]).pixi
}
