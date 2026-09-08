import { Container, Graphics, Text } from 'pixi.js'
import { WHEEL_NUMBERS, colorOf } from '@rondo/protocol'
import { palette, pocketFill } from './palette'

const STEP = (Math.PI * 2) / WHEEL_NUMBERS.length
const MARKER_ANGLE = -Math.PI / 2

type Mode = 'idle' | 'spinning' | 'landed'

/**
 * Procedurally drawn European wheel (no external assets). The rotor spins as a
 * whole; the ball is animated separately and eased into the winning pocket
 * once spin_result names the target.
 */
export class Wheel {
  readonly view = new Container()
  private rotor = new Container()
  private ball = new Graphics()
  private mode: Mode = 'idle'
  private rotation = 0
  private ballAngle = 0
  private anim: {
    startedAt: number
    duration: number
    fromRotation: number
    toRotation: number
    fromBall: number
    toBall: number
  } | null = null

  constructor(private radius: number) {
    this.view.addChild(this.drawStator())
    this.view.addChild(this.rotor)
    this.drawRotor()
    this.ball.circle(0, 0, radius * 0.045).fill(0xf5f5f5)
    this.ball.visible = false
    this.view.addChild(this.ball)
    this.view.addChild(this.drawMarker())
  }

  /** Advance one frame; dtMs comes straight from the Pixi ticker. */
  tick(dtMs: number, now: number) {
    if (this.mode === 'idle') {
      this.rotation += dtMs * 0.0002
    } else if (this.anim) {
      const t = Math.min(1, (now - this.anim.startedAt) / this.anim.duration)
      const eased = 1 - Math.pow(1 - t, 4)
      this.rotation = this.anim.fromRotation + (this.anim.toRotation - this.anim.fromRotation) * eased
      this.ballAngle = this.anim.fromBall + (this.anim.toBall - this.anim.fromBall) * eased
      if (t >= 1) {
        this.mode = 'landed'
        this.anim = null
      }
    } else if (this.mode === 'spinning') {
      // Target not revealed yet: rotor accelerates, ball orbits the other way.
      this.rotation += dtMs * 0.0035
      this.ballAngle -= dtMs * 0.006
      this.ball.visible = true
    }
    this.rotor.rotation = this.rotation
    const ballRadius = this.radius * (this.mode === 'landed' ? 0.62 : 0.86)
    const angle = this.mode === 'landed' ? this.rotation + this.landedPocketAngle : this.ballAngle
    this.ball.position.set(Math.cos(angle) * ballRadius, Math.sin(angle) * ballRadius)
  }

  private landedPocketAngle = 0

  startSpin() {
    this.mode = 'spinning'
    this.ball.visible = true
    this.ballAngle = this.rotation + Math.PI
  }

  /** Ease rotor and ball so `number` sits under the top marker after `duration`. */
  landOn(number: number, duration: number, now: number) {
    const index = WHEEL_NUMBERS.indexOf(number as (typeof WHEEL_NUMBERS)[number])
    const pocketAngle = index * STEP
    this.landedPocketAngle = pocketAngle
    const currentNorm = this.rotation % (Math.PI * 2)
    let toRotation = MARKER_ANGLE - pocketAngle
    while (toRotation < currentNorm) toRotation += Math.PI * 2
    toRotation += this.rotation - currentNorm + Math.PI * 2 * 3

    this.mode = 'spinning'
    this.ball.visible = true
    this.anim = {
      startedAt: now,
      duration,
      fromRotation: this.rotation,
      toRotation,
      fromBall: this.ballAngle,
      toBall: MARKER_ANGLE - Math.PI * 2 * 2,
    }
  }

  reset() {
    this.mode = 'idle'
    this.anim = null
    this.ball.visible = false
  }

  private drawRotor() {
    const sectors = new Graphics()
    const r = this.radius
    WHEEL_NUMBERS.forEach((num, index) => {
      const from = index * STEP - STEP / 2
      const to = index * STEP + STEP / 2
      sectors
        .moveTo(0, 0)
        .arc(0, 0, r * 0.94, from, to)
        .lineTo(0, 0)
        .fill(pocketFill(colorOf(num)))
        .stroke({ width: 1, color: 0x000000, alpha: 0.35 })
    })
    sectors.circle(0, 0, r * 0.55).fill(palette.wheelRim)
    sectors.circle(0, 0, r * 0.52).fill(0x24140a)
    sectors.circle(0, 0, r * 0.1).fill(palette.gold)
    this.rotor.addChild(sectors)

    WHEEL_NUMBERS.forEach((num, index) => {
      const label = new Text({
        text: String(num),
        style: { fill: palette.text, fontSize: r * 0.085, fontFamily: 'Arial', fontWeight: '700' },
      })
      label.anchor.set(0.5)
      const angle = index * STEP
      label.position.set(Math.cos(angle) * r * 0.78, Math.sin(angle) * r * 0.78)
      label.rotation = angle + Math.PI / 2
      this.rotor.addChild(label)
    })
  }

  private drawStator() {
    const g = new Graphics()
    g.circle(0, 0, this.radius * 1.06).fill(palette.wheelRim)
    g.circle(0, 0, this.radius * 0.97).fill(0x1d1006)
    return g
  }

  private drawMarker() {
    const g = new Graphics()
    const r = this.radius
    g.moveTo(0, -r * 1.08)
      .lineTo(-r * 0.05, -r * 1.2)
      .lineTo(r * 0.05, -r * 1.2)
      .closePath()
      .fill(palette.gold)
    return g
  }
}
