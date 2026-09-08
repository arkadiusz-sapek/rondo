import { Container, Graphics, Matrix, Text, Texture } from 'pixi.js'
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

/* Ring layout (fractions of R), outside → in:
   wood rim 1.18..1.05 · ball track 1.04..0.93 · apron+diamonds 0.93..0.80 ·
   chrome · number band 0.79..0.63 · stepped-down pockets 0.62..0.47 · cone. */
const OUTER_TRACK = 0.985
const APRON_OUT = 0.93
const NUM_OUT = 0.79
const NUM_IN = 0.63
const POCKET_OUT = 0.62
const POCKET_IN = 0.47
const BALL_REST = 0.545
const LABEL_R = 0.71
const CONE_R = 0.46
/**
 * The bowl is a continuous slope, like a real wheel: height falls linearly
 * from the outer edge of the number band down to the inner edge of the
 * pockets — no vertical cliff, the frets lie flat ON the slope.
 */
const STEP_DROP = 0.055

function bowlHeight(r: number): number {
  if (r >= NUM_OUT) return 0
  const t = Math.min(1, (NUM_OUT - r) / (NUM_OUT - POCKET_IN))
  return -STEP_DROP * t
}

type Mode = 'idle' | 'spinning' | 'landing' | 'landed'

const LABEL_MATRIX = new Matrix()
const CONE_MATRIX = new Matrix()

function normalizeAngle(a: number) {
  return a - TAU * Math.round(a / TAU)
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function darken(color: number, factor: number): number {
  const r = ((color >> 16) & 0xff) * factor
  const g = ((color >> 8) & 0xff) * factor
  const b = (color & 0xff) * factor
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)
}

/* ------------------------------ wood material ------------------------------ */

const woodCache = new Map<string, Texture>()

/** Procedural wood: base tone + wavy grain strokes + a few heavy growth lines. */
function woodTexture(base: string, dark: string, light: string): Texture {
  const key = base + dark
  const cached = woodCache.get(key)
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = base
  ctx.fillRect(0, 0, 512, 256)

  const grain = (color: string, alpha: number, width: number) => {
    ctx.strokeStyle = color
    ctx.globalAlpha = alpha
    ctx.lineWidth = width
    const y = Math.random() * 256
    const wobble = 2 + Math.random() * 7
    ctx.beginPath()
    ctx.moveTo(-20, y)
    for (let x = 0; x <= 532; x += 32) {
      ctx.lineTo(x, y + Math.sin(x * 0.02 + y) * wobble + (Math.random() - 0.5) * 3)
    }
    ctx.stroke()
  }
  for (let i = 0; i < 70; i++) grain(i % 2 ? dark : light, 0.04 + Math.random() * 0.09, 0.5 + Math.random() * 2)
  for (let i = 0; i < 7; i++) grain(dark, 0.16 + Math.random() * 0.1, 2.5 + Math.random() * 2.5)
  ctx.globalAlpha = 1

  const texture = Texture.from(canvas)
  woodCache.set(key, texture)
  return texture
}

function woodFill(texture: Texture, halfWidth: number, halfHeight: number) {
  return {
    texture,
    matrix: new Matrix((halfWidth * 2) / 512, 0, 0, (halfHeight * 2) / 256, -halfWidth, -halfHeight),
  }
}

/**
 * Realistic pseudo-3D wheel, still 100% procedural. Static layers (wooden
 * stator with a recessed ball track, chrome rails, diamond deflectors, the
 * center turret) are drawn once; the rotor (number band, stepped-down
 * pockets, spoked cone) is the only per-frame work. The cone is drawn flat
 * a single time and spun with the same affine projection as the labels.
 */
export class Wheel3D {
  readonly view = new Container()
  private side = new Graphics()
  private stator = new Graphics()
  private cone = new Graphics()
  private pockets = new Graphics()
  private labels: Text[] = []
  private ballShadow = new Graphics()
  private ball = new Graphics()
  private turret = new Container()
  private turretG = new Graphics()

  private mode: Mode = 'idle'
  private rotation = Math.random() * TAU
  private speed = IDLE_SPEED
  private ballAngle = 0
  private target: number | null = null
  private plan: {
    t0: number
    A: number
    B: number
    C: number
    ball0: number
    w0: number
    wDrop: number
    rot0: number
    wWheel0: number
    wWheel1: number
    pocketAngle: number
  } | null = null

  constructor(private radius: number) {
    this.view.addChild(this.side, this.stator, this.cone, this.pockets)
    for (const num of WHEEL_NUMBERS) {
      const label = new Text({
        text: String(num),
        style: {
          fill: palette.text,
          fontSize: radius * 0.058,
          fontFamily: 'Georgia, serif',
          fontWeight: '700',
        },
      })
      label.anchor.set(0.5)
      this.labels.push(label)
      this.view.addChild(label)
    }
    this.view.addChild(this.ballShadow, this.ball, this.turret)

    this.drawStator()
    this.drawConeFlat()
    this.turret.addChild(this.turretG)
    this.ball.circle(0, 0, radius * 0.034).fill(0xf7f7f2)
    this.ball.circle(-radius * 0.009, -radius * 0.011, radius * 0.012).fill(0xffffff)
    this.ballShadow.ellipse(0, 0, radius * 0.036, radius * 0.018).fill({ color: 0x000000, alpha: 0.35 })
    this.setBallVisible(false)
  }

  private project(angle: number, r: number, h = 0) {
    return {
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r * COS_T - h * SIN_T,
    }
  }

  /** Polyline along an ellipse arc — Graphics has no partial-ellipse pen. */
  private arcPoints(r: number, from: number, to: number, h = 0): number[] {
    const points: number[] = []
    const steps = 40
    for (let i = 0; i <= steps; i++) {
      const angle = from + ((to - from) * i) / steps
      const p = this.project(angle, r, h)
      points.push(p.x, p.y)
    }
    return points
  }

  /* ------------------------------ static layers ------------------------------ */

  private drawStator() {
    const R = this.radius
    const g = this.stator
    const mahogany = woodTexture('#4a2413', '#2b1206', '#6b3a1d')
    const depth = R * 0.16

    // Side wall under the rim.
    this.side.ellipse(0, depth, R * 1.18, R * 1.18 * COS_T).fill({ color: 0x241004 })
    this.side.ellipse(0, depth * 0.55, R * 1.18, R * 1.18 * COS_T).fill({ color: 0x331a09 })

    // Wooden top rim.
    g.ellipse(0, 0, R * 1.18, R * 1.18 * COS_T)
      .fill(woodFill(mahogany, R * 1.18, R * 1.18 * COS_T))
      .stroke({ width: 2, color: 0x1c0d04 })
    // Glossy light sweep on the upper rim.
    g.poly(this.arcPoints(R * 1.11, -Math.PI * 0.88, -Math.PI * 0.12), false).stroke({
      width: R * 0.09,
      color: 0xffffff,
      alpha: 0.09,
      cap: 'round',
    })
    g.poly(this.arcPoints(R * 1.11, Math.PI * 0.2, Math.PI * 0.8), false).stroke({
      width: R * 0.07,
      color: 0x000000,
      alpha: 0.14,
      cap: 'round',
    })

    // Recessed ball track: dark channel with an inner shadow up top and a
    // faint catch-light at the bottom, framed by chrome rails.
    g.ellipse(0, 0, R * 1.04, R * 1.04 * COS_T).fill(0x21120a)
    g.poly(this.arcPoints(R * 0.995, -Math.PI * 0.95, -Math.PI * 0.05), false).stroke({
      width: R * 0.075,
      color: 0x000000,
      alpha: 0.5,
      cap: 'round',
    })
    g.poly(this.arcPoints(R * 0.975, Math.PI * 0.15, Math.PI * 0.85), false).stroke({
      width: R * 0.05,
      color: 0xffe9c9,
      alpha: 0.1,
      cap: 'round',
    })
    g.ellipse(0, 0, R * 1.043, R * 1.043 * COS_T).stroke({ width: 2.5, color: 0xcdd2da, alpha: 0.9 })
    g.ellipse(0, 0, R * 0.932, R * 0.932 * COS_T).stroke({ width: 2, color: 0xb9bec7, alpha: 0.8 })

    // Apron between track and rotor — lighter wood, carries the deflectors.
    g.ellipse(0, 0, R * APRON_OUT, R * APRON_OUT * COS_T).fill(
      woodFill(woodTexture('#5b2f18', '#38180a', '#7d4423'), R * APRON_OUT, R * APRON_OUT * COS_T),
    )
    g.poly(this.arcPoints(R * 0.865, -Math.PI * 0.9, -Math.PI * 0.1), false).stroke({
      width: R * 0.05,
      color: 0xffffff,
      alpha: 0.05,
      cap: 'round',
    })

    // Eight diamond deflectors — alternating orientation like real wheels
    // (half lie along the track, half point down the slope), each a lozenge
    // with a lit facet, a shaded facet, a ridge line and a contact shadow.
    for (let k = 0; k < 8; k++) {
      const angle = (k * TAU) / 8 + TAU / 16
      const r = R * 0.865
      const dirX = Math.cos(angle)
      const dirY = Math.sin(angle) * COS_T
      const norm = Math.hypot(dirX, dirY)
      const radX = dirX / norm
      const radY = dirY / norm
      const tanX = -radY
      const tanY = radX
      const [longX, longY, shortX, shortY] =
        k % 2 === 0 ? [tanX, tanY, radX, radY] : [radX, radY, tanX, tanY]
      const c = this.project(angle, r)
      const len = R * 0.042
      const wid = R * 0.015

      const tip1 = { x: c.x + longX * len, y: c.y + longY * len }
      const tip2 = { x: c.x - longX * len, y: c.y - longY * len }
      const side1 = { x: c.x + shortX * wid, y: c.y + shortY * wid }
      const side2 = { x: c.x - shortX * wid, y: c.y - shortY * wid }

      g.poly([tip1.x, tip1.y + R * 0.008, side1.x, side1.y + R * 0.008, tip2.x, tip2.y + R * 0.008, side2.x, side2.y + R * 0.008]).fill({
        color: 0x000000,
        alpha: 0.28,
      })
      // Lit facet (light from top-left) and shaded facet.
      const litFirst = side1.y < side2.y
      g.poly([tip1.x, tip1.y, side1.x, side1.y, tip2.x, tip2.y]).fill(litFirst ? 0xd9dde4 : 0x878d97)
      g.poly([tip1.x, tip1.y, side2.x, side2.y, tip2.x, tip2.y]).fill(litFirst ? 0x878d97 : 0xd9dde4)
      g.poly([tip1.x, tip1.y, side1.x, side1.y, tip2.x, tip2.y, side2.x, side2.y]).stroke({
        width: 1,
        color: 0x50555e,
      })
      g.moveTo(tip1.x, tip1.y).lineTo(tip2.x, tip2.y).stroke({ width: 1, color: 0xffffff, alpha: 0.65 })
    }

    // Chrome separator between stator and rotor.
    g.ellipse(0, 0, R * 0.797, R * 0.797 * COS_T).stroke({ width: 2.5, color: 0xc9ced6, alpha: 0.9 })
  }

  /** The cone is drawn FLAT once; each frame it spins via setFromMatrix. */
  private drawConeFlat() {
    const CONE_PX = 140
    const g = this.cone
    const walnut = woodTexture('#6b3d1e', '#472510', '#8a5228')
    g.circle(0, 0, CONE_PX).fill({
      texture: walnut,
      matrix: new Matrix((CONE_PX * 2) / 512, 0, 0, (CONE_PX * 2) / 256, -CONE_PX, -CONE_PX),
    })
    // Eight tapered segments — alternating sheen wedges + seam lines that
    // visibly spin with the rotor.
    for (let k = 0; k < 8; k++) {
      const a0 = (k * TAU) / 8
      const a1 = a0 + TAU / 16
      g.moveTo(0, 0)
        .arc(0, 0, CONE_PX, a0, a1)
        .lineTo(0, 0)
        .fill({ color: k % 2 ? 0xffffff : 0x000000, alpha: k % 2 ? 0.05 : 0.08 })
      g.moveTo(0, 0)
        .lineTo(Math.cos(a0) * CONE_PX, Math.sin(a0) * CONE_PX)
        .stroke({ width: 2.5, color: 0x2a1408, alpha: 0.55 })
    }
    // Radial sheen: bright center falling off to a darker edge.
    g.circle(0, 0, CONE_PX).stroke({ width: CONE_PX * 0.16, color: 0x000000, alpha: 0.22 })
    g.circle(0, 0, CONE_PX * 0.66).fill({ color: 0xffffff, alpha: 0.04 })
    g.circle(0, 0, CONE_PX * 0.4).fill({ color: 0xffffff, alpha: 0.05 })
    g.circle(0, 0, CONE_PX * 0.18).fill({ color: 0xffe9c9, alpha: 0.08 })
  }

  /**
   * The turret is part of the rotor, so it spins. A lathe shape carries no
   * rotation cue by itself — the spin is sold by: two handles orbiting the
   * column (passing behind and in front of it), knurling ticks sliding along
   * the plate rims, and jewel facets turning under a fixed light (with a
   * glint whenever a facet catches it). Redrawn per frame.
   */
  private drawTurretFrame(rotation: number) {
    const R = this.radius
    const t = this.turretG
    t.clear()

    const disc = (y: number, rx: number, height: number, wall: number, top: number, knurl = false) => {
      const ry = rx * COS_T
      t.ellipse(0, y, rx, ry).fill(wall)
      t.rect(-rx, y - height, rx * 2, height).fill(wall)
      t.rect(rx * 0.35, y - height, rx * 0.62, height).fill({ color: 0x000000, alpha: 0.3 })
      t.rect(-rx * 0.92, y - height, rx * 0.35, height).fill({ color: 0xffffff, alpha: 0.09 })
      t.ellipse(0, y - height, rx, ry).fill(top)
      t.ellipse(0, y - height, rx * 0.66, ry * 0.66).fill(darken(top, 0.75))
      const rim: number[] = []
      for (let i = 0; i <= 24; i++) {
        const a = Math.PI * 0.15 + (Math.PI * 0.7 * i) / 24
        rim.push(Math.cos(a) * rx, y - height + Math.sin(a) * ry)
      }
      t.poly(rim, false).stroke({ width: 1.2, color: 0xffffff, alpha: 0.28 })
      if (knurl) {
        // Ticks around the wall, sliding with the rotor — a strong spin cue.
        for (let k = 0; k < 18; k++) {
          const a = rotation + (k * TAU) / 18
          if (Math.sin(a) <= 0.05) continue
          const x = Math.cos(a) * rx
          const depth = Math.sin(a)
          t.moveTo(x, y - height + ry * depth)
            .lineTo(x, y - height * 0.15 + ry * depth)
            .stroke({ width: 1.2, color: 0x000000, alpha: 0.35 * depth })
        }
      }
    }

    const shaft = (y0: number, y1: number, r0: number, r1: number) => {
      t.poly([-r0, y0, r0, y0, r1, y1, -r1, y1]).fill(0x1a1d24)
      t.poly([-r0 * 0.86, y0, -r0 * 0.2, y0, -r1 * 0.2, y1, -r1 * 0.86, y1]).fill({ color: 0xffffff, alpha: 0.1 })
      t.poly([-r0 * 0.62, y0, -r0 * 0.34, y0, -r1 * 0.34, y1, -r1 * 0.62, y1]).fill({ color: 0xffffff, alpha: 0.14 })
      t.poly([r0 * 0.3, y0, r0 * 0.68, y0, r1 * 0.68, y1, r1 * 0.3, y1]).fill({ color: 0x000000, alpha: 0.24 })
      t.poly([r0 * 0.68, y0, r0, y0, r1, y1, r1 * 0.68, y1]).fill({ color: 0x000000, alpha: 0.42 })
    }

    /**
     * One orbiting handle: a TRUE 3D curve — the arm lives in the vertical
     * plane at azimuth φ; each sample is projected like everything else on
     * the wheel. Seen head-on it foreshortens into a downward-bowing arc
     * instead of collapsing to a paper line, and its tone follows a smooth
     * light function, so nothing ever snaps.
     */
    const lightAngle = -Math.PI * 0.75
    const handle = (phi: number) => {
      const samples = 14
      const points: number[] = []
      for (let i = 0; i <= samples; i++) {
        const s = i / samples
        // Radial distance from the axis and height along the arm (quadratic bow).
        const rho = R * (0.02 + (0.14 - 0.02) * Math.sin(s * Math.PI) + 0.055 * s)
        const y = -R * 0.21 + s * R * 0.195
        points.push(Math.cos(phi) * rho, y + Math.sin(phi) * rho * COS_T)
      }
      const lit = 0.5 + 0.5 * Math.cos(phi - lightAngle)
      const tone = darken(0x2e333d, 0.45 + lit * 0.55)
      t.poly(points, false).stroke({ width: R * 0.018, color: tone, cap: 'round', join: 'round' })
      t.poly(points, false).stroke({
        width: R * 0.007,
        color: 0xffffff,
        alpha: 0.08 + lit * 0.2,
        cap: 'round',
        join: 'round',
      })
    }

    // Contact shadow.
    t.ellipse(R * 0.025, R * 0.055, R * 0.2, R * 0.095).fill({ color: 0x000000, alpha: 0.32 })

    // Handle currently behind the column.
    if (Math.sin(rotation) <= 0) handle(rotation)
    else handle(rotation + Math.PI)

    disc(R * 0.03, R * 0.145, R * 0.035, 0x101318, 0x2a2e37, true)
    shaft(-R * 0.005, -R * 0.135, R * 0.032, R * 0.024)
    disc(-R * 0.135, R * 0.082, R * 0.028, 0x0d1015, 0x31353e, true)
    shaft(-R * 0.163, -R * 0.25, R * 0.02, R * 0.015)
    disc(-R * 0.25, R * 0.056, R * 0.022, 0x0d1015, 0x363a43)
    shaft(-R * 0.272, -R * 0.335, R * 0.012, R * 0.009)

    // Handle currently in front.
    if (Math.sin(rotation) > 0) handle(rotation)
    else handle(rotation + Math.PI)

    this.drawJewel(rotation, lightAngle)
  }

  /**
   * The jewel is a real solid now: a brilliant-cut with an octagonal table,
   * trapezoid crown facets and a front pavilion, defined as 3D vertices,
   * rotated about the VERTICAL axis and projected like the rest of the wheel.
   * Facets foreshorten and change shape as it turns — the old screen-plane
   * fan read as a 2D pinwheel; this reads as a stone.
   */
  private drawJewel(rotation: number, lightAngle: number) {
    const R = this.radius
    const t = this.turretG
    const N = 8

    const girdleR = R * 0.055
    const girdleY = -R * 0.372
    const tableR = R * 0.032
    const tableY = -R * 0.418
    const culetY = -R * 0.335

    // Project a point on a horizontal ring of the (vertical) stone.
    const ring = (angle: number, r: number, y: number) => ({
      x: Math.cos(angle) * r,
      y: y + Math.sin(angle) * r * COS_T,
    })
    const angleAt = (k: number) => rotation + (k * TAU) / N + TAU / 16

    // Collet: a small turned cup with prongs gripping the girdle.
    t.ellipse(0, girdleY + R * 0.012, girdleR * 0.95, girdleR * 0.95 * COS_T).fill(0x101318)
    t.ellipse(0, girdleY + R * 0.006, girdleR * 0.8, girdleR * 0.8 * COS_T).fill(0x272b33)

    // Front pavilion facets (only the camera-facing half is visible).
    for (let k = 0; k < N; k++) {
      const a0 = angleAt(k)
      const a1 = angleAt(k + 1)
      const mid = (a0 + a1) / 2
      if (Math.sin(mid) < -0.15) continue
      const p0 = ring(a0, girdleR, girdleY)
      const p1 = ring(a1, girdleR, girdleY)
      const lit = 0.5 + 0.5 * Math.cos(mid - lightAngle)
      // Adjacent pavilion facets flip bright/dark — the brilliant signature.
      const flash = k % 2 === 0 ? 0.5 + lit * 0.5 : 0.18 + lit * 0.28
      const shade = Math.round(0x3a + flash * 0x9a)
      const color = (shade << 16) | (Math.min(255, shade + 18) << 8) | Math.min(255, shade + 70)
      t.poly([p0.x, p0.y, p1.x, p1.y, 0, culetY])
        .fill({ color, alpha: 0.97 })
        .stroke({ width: 0.8, color: 0x44546e, alpha: 0.8 })
    }

    // Crown facets: trapezoids from the girdle up to the table ring.
    let bestLit = 0
    let bestPoint = { x: 0, y: 0 }
    for (let k = 0; k < N; k++) {
      const a0 = angleAt(k)
      const a1 = angleAt(k + 1)
      const mid = (a0 + a1) / 2
      const g0 = ring(a0, girdleR, girdleY)
      const g1 = ring(a1, girdleR, girdleY)
      const t0 = ring(a0, tableR, tableY)
      const t1 = ring(a1, tableR, tableY)
      const lit = 0.5 + 0.5 * Math.cos(mid - lightAngle)
      // Sky reflection on facets tipping toward the camera.
      const sky = Math.max(0, Math.sin(mid)) * 0.35
      const level = Math.min(1, 0.3 + lit * 0.6 + sky)
      const shade = Math.round(0x6a + level * 0x92)
      const color =
        (Math.min(255, shade) << 16) | (Math.min(255, shade + 14) << 8) | Math.min(255, shade + 46)
      t.poly([g0.x, g0.y, g1.x, g1.y, t1.x, t1.y, t0.x, t0.y])
        .fill({ color, alpha: 0.97 })
        .stroke({ width: 0.8, color: 0x5a6c8a, alpha: 0.85 })
      if (lit > bestLit) {
        bestLit = lit
        bestPoint = { x: (g0.x + g1.x + t0.x + t1.x) / 4, y: (g0.y + g1.y + t0.y + t1.y) / 4 }
      }
    }

    // The table: a bright octagon that keeps its elliptical foreshortening.
    const table: number[] = []
    for (let k = 0; k < N; k++) {
      const p = ring(angleAt(k), tableR, tableY)
      table.push(p.x, p.y)
    }
    t.poly(table).fill({ color: 0xe9f2fc, alpha: 0.95 }).stroke({ width: 0.8, color: 0x9db4d4 })
    // A soft moving reflection inside the table.
    const rx = Math.cos(rotation + 0.7) * tableR * 0.35
    t.ellipse(rx, tableY + tableR * 0.1 * COS_T, tableR * 0.5, tableR * 0.3).fill({
      color: 0xffffff,
      alpha: 0.75,
    })

    // Bright girdle line.
    t.ellipse(0, girdleY, girdleR, girdleR * COS_T).stroke({ width: 1, color: 0xdfe9f5, alpha: 0.8 })

    // Glint flares when the best-lit crown facet sweeps the light.
    const glint = Math.pow(bestLit, 12)
    if (glint > 0.3) {
      const s = R * 0.024 * glint
      t.rect(bestPoint.x - s, bestPoint.y - s * 0.13, s * 2, s * 0.26).fill({ color: 0xffffff, alpha: glint })
      t.rect(bestPoint.x - s * 0.13, bestPoint.y - s, s * 0.26, s * 2).fill({ color: 0xffffff, alpha: glint })
      t.circle(bestPoint.x, bestPoint.y, s * 0.22).fill({ color: 0xffffff, alpha: glint })
    }
  }

  /* --------------------------------- control --------------------------------- */

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

    const rot0 = this.rotation
    const wWheel0 = this.speed
    const wWheel1 = IDLE_SPEED * 1.5
    const wheelAngleAt = (t: number) => rot0 + wWheel0 * t + ((wWheel1 - wWheel0) * t * t) / (2 * duration)

    const tCapture = A + B
    const targetAtCapture = wheelAngleAt(tCapture) + pocketAngle
    const wDrop = BALL_LAUNCH * 0.32

    const ball0 = this.ballAngle
    const sweepB = (wDrop / 2) * B
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

  /** Late joins / dropped frames: put the ball straight into the pocket. */
  snapTo(number: number) {
    this.mode = 'landed'
    this.target = number
    this.plan = null
    this.setBallVisible(true)
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

        this.rotation = plan.rot0 + plan.wWheel0 * t + ((plan.wWheel1 - plan.wWheel0) * t * t) / (2 * D)
        this.speed = plan.wWheel0 + ((plan.wWheel1 - plan.wWheel0) * t) / D

        if (t <= A) {
          this.ballAngle = plan.ball0 + w0 * t + ((wDrop - w0) * t * t) / (2 * A)
          ballR = OUTER_TRACK
        } else if (t <= A + B) {
          const tb = t - A
          const sweepA = ((w0 + wDrop) / 2) * A
          this.ballAngle = plan.ball0 + sweepA + wDrop * tb + ((0 - wDrop) * tb * tb) / (2 * B)
          ballR = OUTER_TRACK - (OUTER_TRACK - BALL_REST) * smoothstep(0, 1, tb / B)
        } else {
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

  /* ------------------------------ per-frame draw ------------------------------ */

  private draw(ballR: number, bounce: number) {
    const R = this.radius
    const g = this.pockets

    g.clear()

    const at = (angle: number, r: number) => this.project(angle, R * r, R * bowlHeight(r))

    for (let i = 0; i < WHEEL_NUMBERS.length; i++) {
      const a0 = this.rotation + i * STEP - STEP / 2
      const a1 = this.rotation + i * STEP + STEP / 2
      const color = pocketFill(colorOf(WHEEL_NUMBERS[i]))

      // Number band — the upper part of the slope.
      const n1 = at(a0, NUM_IN)
      const n2 = at(a0, NUM_OUT)
      const n3 = at(a1, NUM_OUT)
      const n4 = at(a1, NUM_IN)
      g.poly([n1.x, n1.y, n2.x, n2.y, n3.x, n3.y, n4.x, n4.y]).fill(color)

      // Pocket — same surface continuing down the slope, shaded by tilt.
      const p1 = at(a0, POCKET_IN)
      const p2 = at(a0, NUM_IN)
      const p3 = at(a1, NUM_IN)
      const p4 = at(a1, POCKET_IN)
      g.poly([p1.x, p1.y, p2.x, p2.y, p3.x, p3.y, p4.x, p4.y]).fill(darken(color, 0.68))

      // Chrome fret lying flat on the slope — with a linear ramp its
      // projection is a single straight segment.
      const f1 = at(a0, NUM_OUT)
      const f2 = at(a0, POCKET_IN)
      g.moveTo(f1.x, f1.y).lineTo(f2.x, f2.y).stroke({ width: 1.4, color: 0xc9ced6, alpha: 0.75 })
    }

    // Thin seam ring where numbers meet pockets (a tone change, not a cliff).
    g.ellipse(0, -R * bowlHeight(NUM_IN) * SIN_T, R * NUM_IN, R * NUM_IN * COS_T).stroke({
      width: 1,
      color: 0x000000,
      alpha: 0.25,
    })

    // Winner highlight: ONE closed outline hugging the whole wedge — outer
    // edge on the number band, down the fret, inner edge on the pocket band —
    // built from the exact same projected points as the bands themselves.
    if (this.target !== null && this.mode === 'landed') {
      const i = WHEEL_NUMBERS.indexOf(this.target as (typeof WHEEL_NUMBERS)[number])
      const a0 = this.rotation + i * STEP - STEP / 2
      const a1 = this.rotation + i * STEP + STEP / 2
      // On the ramp the whole wedge is a single quad in projection.
      const c1 = at(a0, NUM_OUT)
      const c2 = at(a1, NUM_OUT)
      const c3 = at(a1, POCKET_IN)
      const c4 = at(a0, POCKET_IN)
      g.poly([c1.x, c1.y, c2.x, c2.y, c3.x, c3.y, c4.x, c4.y]).stroke({ width: 2.5, color: palette.gold })
    }

    // Inner shadow where the (stepped-down) rotor meets the cone — the ring
    // must sit on the SAME lowered plane as the pocket band.
    g.ellipse(0, R * STEP_DROP * SIN_T, R * POCKET_IN, R * POCKET_IN * COS_T).stroke({
      width: R * 0.014,
      color: 0x000000,
      alpha: 0.32,
    })

    // Labels: painted on the number band with the full affine projection.
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
        Math.sin(mid) * R * LABEL_R * COS_T - R * bowlHeight(LABEL_R) * SIN_T,
      )
      label.setFromMatrix(LABEL_MATRIX)
    }

    // Cone: flat drawing spun by the same projection.
    const cs = (R * CONE_R) / 140
    const ccos = Math.cos(this.rotation)
    const csin = Math.sin(this.rotation)
    CONE_MATRIX.set(ccos * cs, csin * cs * COS_T, -csin * cs, ccos * cs * COS_T, 0, R * STEP_DROP * SIN_T)
    this.cone.setFromMatrix(CONE_MATRIX)

    this.drawTurretFrame(this.rotation)

    // Ball follows the bowl's slope on its way down.
    const drop = bowlHeight(ballR)
    const ballPos = this.project(this.ballAngle, R * ballR, R * (bounce + drop))
    const shadowPos = this.project(this.ballAngle, R * ballR, R * drop)
    this.ball.position.set(ballPos.x, ballPos.y - R * 0.018)
    this.ballShadow.position.set(shadowPos.x, shadowPos.y)
    this.ballShadow.alpha = Math.max(0.15, 0.35 - bounce * 3)
  }
}
