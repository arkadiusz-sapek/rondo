import { Container, Graphics, Text } from 'pixi.js'
import { WHEEL_NUMBERS, colorOf } from '@rondo/protocol'
import { palette, pocketFill } from './palette'

const STEP = (Math.PI * 2) / WHEEL_NUMBERS.length
const TILT = (55 * Math.PI) / 180
const COS_T = Math.cos(TILT)
const SIN_T = Math.sin(TILT)

const IDLE_SPEED = 0.0004
const SPIN_SPEED = 0.0016
const BALL_SPEED = -0.0042

const OUTER_TRACK = 0.98
const POCKET_OUT = 0.92
const POCKET_IN = 0.7
const BALL_REST = 0.8
const LABEL_R = 0.81

type Mode = 'idle' | 'spinning' | 'landing' | 'landed'

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3)
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function normalizeAngle(a: number) {
  return ((a + Math.PI) % (Math.PI * 2)) - Math.PI + (a < -Math.PI ? Math.PI * 2 : 0)
}

/**
 * Pseudo-3D wheel: every pocket is a quad between two ellipses under a ~55°
 * camera tilt, redrawn each frame (no meshes, no assets, no three.js). The
 * rotor never fully stops — like a real table it keeps idling — and the ball
 * lands wherever the winning pocket happens to be, then rides the rotor.
 */
export class Wheel3D {
  readonly view = new Container()
  private side = new Graphics()
  private pockets = new Graphics()
  private labels: Text[] = []
  private ballShadow = new Graphics()
  private ball = new Graphics()

  private mode: Mode = 'idle'
  private rotation = Math.random() * Math.PI * 2
  private speed = IDLE_SPEED
  private ballAngle = 0
  private ballSpeed = BALL_SPEED
  private target: number | null = null
  private landing: { startedAt: number; duration: number } | null = null

  constructor(private radius: number) {
    this.view.addChild(this.side, this.pockets)
    for (const num of WHEEL_NUMBERS) {
      const label = new Text({
        text: String(num),
        style: { fill: palette.text, fontSize: radius * 0.075, fontFamily: 'Arial', fontWeight: '700' },
      })
      label.anchor.set(0.5)
      this.labels.push(label)
      this.view.addChild(label)
    }
    this.view.addChild(this.ballShadow, this.ball)
    this.ball.circle(0, 0, radius * 0.038).fill(0xf7f7f2)
    this.ball.circle(-radius * 0.01, -radius * 0.012, radius * 0.014).fill(0xffffff)
    this.ballShadow.ellipse(0, 0, radius * 0.04, radius * 0.02).fill({ color: 0x000000, alpha: 0.35 })
    this.setBallVisible(false)
  }

  private project(angle: number, r: number, h = 0) {
    return {
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r * COS_T - h * SIN_T,
    }
  }

  startSpin() {
    this.mode = 'spinning'
    this.target = null
    this.landing = null
    this.ballAngle = this.rotation + Math.PI
    this.ballSpeed = BALL_SPEED
    this.setBallVisible(true)
  }

  landOn(number: number, duration: number, now: number) {
    this.mode = 'landing'
    this.target = number
    this.landing = { startedAt: now, duration }
  }

  reset() {
    this.mode = 'idle'
    this.target = null
    this.landing = null
    this.setBallVisible(false)
  }

  tick(dtMs: number, now: number) {
    let ballR = OUTER_TRACK
    let bounce = 0

    switch (this.mode) {
      case 'idle':
        this.speed += (IDLE_SPEED - this.speed) * 0.05
        break
      case 'spinning':
        this.speed += (SPIN_SPEED - this.speed) * 0.04
        this.ballAngle += this.ballSpeed * dtMs
        break
      case 'landing': {
        const { startedAt, duration } = this.landing!
        const a = Math.min(1, (now - startedAt) / duration)
        this.speed += (IDLE_SPEED * 1.6 - this.speed) * 0.03
        this.ballSpeed = BALL_SPEED * (1 - easeOutCubic(a) * 0.85)
        this.ballAngle += this.ballSpeed * dtMs
        ballR = OUTER_TRACK - (OUTER_TRACK - BALL_REST) * smoothstep(0.3, 0.85, a)
        // Converge onto the pocket wherever it currently is.
        const pocketIndex = WHEEL_NUMBERS.indexOf(this.target! as (typeof WHEEL_NUMBERS)[number])
        const targetAngle = this.rotation + pocketIndex * STEP
        const blend = smoothstep(0.55, 0.97, a)
        this.ballAngle += normalizeAngle(targetAngle - this.ballAngle) * blend
        bounce = Math.abs(Math.sin(a * Math.PI * 5)) * (1 - a) * smoothstep(0.6, 0.8, a) * 0.05
        if (a >= 1) this.mode = 'landed'
        break
      }
      case 'landed':
        this.speed += (IDLE_SPEED - this.speed) * 0.02
        ballR = BALL_REST
        break
    }

    this.rotation += this.speed * dtMs

    if (this.mode === 'landed' && this.target !== null) {
      const pocketIndex = WHEEL_NUMBERS.indexOf(this.target as (typeof WHEEL_NUMBERS)[number])
      this.ballAngle = this.rotation + pocketIndex * STEP
    }

    this.draw(ballR, bounce)
  }

  private setBallVisible(visible: boolean) {
    this.ball.visible = visible
    this.ballShadow.visible = visible
  }

  private draw(ballR: number, bounce: number) {
    const R = this.radius
    const g = this.pockets
    const depth = R * 0.14

    this.side.clear()
    // Rim depth: the same ellipses pushed down paint the wooden side wall.
    this.side.ellipse(0, depth, R * 1.12, R * 1.12 * COS_T).fill(0x3d2713)
    this.side.ellipse(0, depth * 0.5, R * 1.12, R * 1.12 * COS_T).fill(0x4a2f18)

    g.clear()
    g.ellipse(0, 0, R * 1.12, R * 1.12 * COS_T).fill(palette.wheelRim)
    g.ellipse(0, 0, R * 1.02, R * 1.02 * COS_T).fill(0x241407)
    g.ellipse(0, 0, R * OUTER_TRACK, R * OUTER_TRACK * COS_T).fill(0x160c04)

    for (let i = 0; i < WHEEL_NUMBERS.length; i++) {
      const a0 = this.rotation + i * STEP - STEP / 2
      const a1 = this.rotation + i * STEP + STEP / 2
      const p1 = this.project(a0, R * POCKET_IN)
      const p2 = this.project(a0, R * POCKET_OUT)
      const p3 = this.project(a1, R * POCKET_OUT)
      const p4 = this.project(a1, R * POCKET_IN)
      g.poly([p1.x, p1.y, p2.x, p2.y, p3.x, p3.y, p4.x, p4.y])
        .fill(pocketFill(colorOf(WHEEL_NUMBERS[i])))
        .stroke({ width: 1, color: 0x000000, alpha: 0.4 })
    }

    if (this.target !== null && (this.mode === 'landed' || this.mode === 'landing')) {
      const i = WHEEL_NUMBERS.indexOf(this.target as (typeof WHEEL_NUMBERS)[number])
      const a0 = this.rotation + i * STEP - STEP / 2
      const a1 = this.rotation + i * STEP + STEP / 2
      const p1 = this.project(a0, R * POCKET_IN)
      const p2 = this.project(a0, R * POCKET_OUT)
      const p3 = this.project(a1, R * POCKET_OUT)
      const p4 = this.project(a1, R * POCKET_IN)
      g.poly([p1.x, p1.y, p2.x, p2.y, p3.x, p3.y, p4.x, p4.y]).stroke({
        width: 2.5,
        color: palette.gold,
      })
    }

    // Cone and hub.
    g.ellipse(0, 0, R * POCKET_IN, R * POCKET_IN * COS_T).fill(0x2b1a0c)
    g.ellipse(0, -R * 0.02 * SIN_T, R * 0.5, R * 0.5 * COS_T).fill(0x3a2410)
    g.ellipse(0, -R * 0.07 * SIN_T, R * 0.12, R * 0.12 * COS_T).fill(palette.gold)

    for (let i = 0; i < this.labels.length; i++) {
      const label = this.labels[i]
      const mid = this.rotation + i * STEP
      const pos = this.project(mid, R * LABEL_R)
      label.position.set(pos.x, pos.y)
      const dx = -Math.sin(mid)
      const dy = Math.cos(mid) * COS_T
      label.rotation = Math.atan2(dy, dx) + Math.PI / 2
      // Foreshortening: pockets on the near side face the camera more.
      label.scale.set(1, 0.75 + 0.25 * Math.sin(mid) * 0)
    }

    const ballPos = this.project(this.ballAngle, R * ballR, bounce * R)
    const shadowPos = this.project(this.ballAngle, R * ballR)
    this.ball.position.set(ballPos.x, ballPos.y - R * 0.02)
    this.ballShadow.position.set(shadowPos.x, shadowPos.y)
    this.ballShadow.alpha = Math.max(0.15, 0.35 - bounce * 3)
  }
}
