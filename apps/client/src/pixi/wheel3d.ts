import { Container, Graphics, Matrix, Text } from 'pixi.js'
import { WHEEL_NUMBERS, colorOf } from '@rondo/protocol'
import { palette, pocketFill } from './palette'

const STEP = (Math.PI * 2) / WHEEL_NUMBERS.length
const TAU = Math.PI * 2
const TILT = (55 * Math.PI) / 180
const COS_T = Math.cos(TILT)
const SIN_T = Math.sin(TILT)

const IDLE_SPEED = 0.0004
const SPIN_SPEED = 0.0014
const BALL_LAUNCH = -0.0042

const OUTER_TRACK = 0.98
const POCKET_OUT = 0.92
const POCKET_IN = 0.7
const BALL_REST = 0.8
const LABEL_R = 0.81

type Mode = 'idle' | 'spinning' | 'landing' | 'landed'

const LABEL_MATRIX = new Matrix()

/** Shortest signed angular distance, always in [-π, π]. */
function normalizeAngle(a: number) {
  return a - TAU * Math.round(a / TAU)
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/**
 * The landing is a boundary problem solved backwards: the target pocket is
 * known when the flight starts, so we derive the launch velocity that makes
 * plain kinematics — rim orbit, spiral drop, pocket capture with damped
 * bounces — arrive exactly in that pocket. Linear ω profiles integrate to
 * quadratics, so the required initial speed falls out of a linear equation;
 * the free integer (extra revolutions) is chosen to keep it natural.
 */
interface FlightPlan {
  t0: number
  /** Phase durations: rim orbit / spiral drop / capture-bounce. */
  A: number
  B: number
  C: number
  ball0: number
  w0: number
  wDrop: number
  /** Deterministic rotor profile during the flight. */
  rot0: number
  wWheel0: number
  wWheel1: number
  pocketAngle: number
}

export class Wheel3D {
  readonly view = new Container()
  private side = new Graphics()
  private pockets = new Graphics()
  private labels: Text[] = []
  private ballShadow = new Graphics()
  private ball = new Graphics()

  private mode: Mode = 'idle'
  private rotation = Math.random() * TAU
  private speed = IDLE_SPEED
  private ballAngle = 0
  private target: number | null = null
  private plan: FlightPlan | null = null

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
    this.plan = null
    this.ballAngle = this.rotation + Math.PI
    this.setBallVisible(true)
  }

  landOn(number: number, duration: number, now: number) {
    const index = WHEEL_NUMBERS.indexOf(number as (typeof WHEEL_NUMBERS)[number])
    const pocketAngle = index * STEP

    const C = Math.min(900, duration * 0.22)
    const B = Math.min(1300, duration * 0.3)
    const A = duration - B - C

    // Rotor: linear decel from its current speed for the whole flight.
    const rot0 = this.rotation
    const wWheel0 = this.speed
    const wWheel1 = IDLE_SPEED * 1.5
    const wheelAngleAt = (t: number) => rot0 + wWheel0 * t + ((wWheel1 - wWheel0) * t * t) / (2 * duration)

    // Boundary: ball angle at capture (end of phase B) must equal the pocket's
    // absolute angle at that moment, modulo full turns.
    const tCapture = A + B
    const targetAtCapture = wheelAngleAt(tCapture) + pocketAngle
    const wDrop = BALL_LAUNCH * 0.32
    const wEnd = 0

    const ball0 = this.ballAngle
    const sweepB = ((wDrop + wEnd) / 2) * B
    // sweep needed in phase A, then w0 from the linear relation sweepA = (w0+wDrop)/2 · A.
    const base = normalizeAngle(targetAtCapture - ball0) - sweepB
    let bestW0 = BALL_LAUNCH
    let bestDiff = Infinity
    for (let m = 0; m < 14; m++) {
      const sweepA = base - TAU * m
      const w0 = (2 * sweepA) / A - wDrop
      const diff = Math.abs(w0 - BALL_LAUNCH)
      if (w0 < 0 && diff < bestDiff) {
        bestDiff = diff
        bestW0 = w0
      }
    }

    this.mode = 'landing'
    this.target = number
    this.plan = { t0: now, A, B, C, ball0, w0: bestW0, wDrop, rot0, wWheel0, wWheel1, pocketAngle }
  }

  reset() {
    this.mode = 'idle'
    this.target = null
    this.plan = null
    this.setBallVisible(false)
  }

  tick(dtMs: number, now: number) {
    let ballR = OUTER_TRACK
    let bounce = 0

    switch (this.mode) {
      case 'idle':
        this.speed += (IDLE_SPEED - this.speed) * 0.05
        this.rotation += this.speed * dtMs
        break
      case 'spinning':
        this.speed += (SPIN_SPEED - this.speed) * 0.04
        this.rotation += this.speed * dtMs
        this.ballAngle += BALL_LAUNCH * dtMs
        break
      case 'landing': {
        const plan = this.plan!
        const { A, B, C, w0, wDrop, pocketAngle } = plan
        const D = A + B + C
        const t = Math.min(D, now - plan.t0)

        // Deterministic rotor.
        this.rotation = plan.rot0 + plan.wWheel0 * t + ((plan.wWheel1 - plan.wWheel0) * t * t) / (2 * D)
        this.speed = plan.wWheel0 + ((plan.wWheel1 - plan.wWheel0) * t) / D

        if (t <= A) {
          // Rim orbit, linear friction.
          this.ballAngle = plan.ball0 + w0 * t + ((wDrop - w0) * t * t) / (2 * A)
          ballR = OUTER_TRACK
        } else if (t <= A + B) {
          // Spiral drop toward the pockets.
          const tb = t - A
          const sweepA = ((w0 + wDrop) / 2) * A
          this.ballAngle = plan.ball0 + sweepA + wDrop * tb + ((0 - wDrop) * tb * tb) / (2 * B)
          ballR = OUTER_TRACK - (OUTER_TRACK - BALL_REST) * smoothstep(0, 1, tb / B)
        } else {
          // Captured: damped separator bounces, then ride the rotor.
          const tc = (t - A - B) / C
          const decay = Math.exp(-4.5 * tc)
          const wobble = Math.sin(tc * Math.PI * 4.4) * decay
          this.ballAngle = this.rotation + pocketAngle + wobble * STEP * 0.45
          ballR = BALL_REST + Math.abs(wobble) * 0.03
          bounce = Math.abs(Math.sin(tc * Math.PI * 4.4)) * decay * 0.045
        }
        if (t >= D) this.mode = 'landed'
        break
      }
      case 'landed':
        this.speed += (IDLE_SPEED - this.speed) * 0.02
        this.rotation += this.speed * dtMs
        if (this.target !== null) {
          const index = WHEEL_NUMBERS.indexOf(this.target as (typeof WHEEL_NUMBERS)[number])
          this.ballAngle = this.rotation + index * STEP
        }
        ballR = BALL_REST
        break
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

    if (this.target !== null && this.mode === 'landed') {
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

    g.ellipse(0, 0, R * POCKET_IN, R * POCKET_IN * COS_T).fill(0x2b1a0c)
    g.ellipse(0, -R * 0.02 * SIN_T, R * 0.5, R * 0.5 * COS_T).fill(0x3a2410)
    g.ellipse(0, -R * 0.07 * SIN_T, R * 0.12, R * 0.12 * COS_T).fill(palette.gold)

    for (let i = 0; i < this.labels.length; i++) {
      const label = this.labels[i]
      const mid = this.rotation + i * STEP
      const rot = mid + Math.PI / 2
      const cos = Math.cos(rot)
      const sin = Math.sin(rot)
      LABEL_MATRIX.set(
        cos,
        sin * COS_T,
        -sin,
        cos * COS_T,
        Math.cos(mid) * R * LABEL_R,
        Math.sin(mid) * R * LABEL_R * COS_T,
      )
      label.setFromMatrix(LABEL_MATRIX)
    }

    const ballPos = this.project(this.ballAngle, R * ballR, bounce * R)
    const shadowPos = this.project(this.ballAngle, R * ballR)
    this.ball.position.set(ballPos.x, ballPos.y - R * 0.02)
    this.ballShadow.position.set(shadowPos.x, shadowPos.y)
    this.ballShadow.alpha = Math.max(0.15, 0.35 - bounce * 3)
  }
}
