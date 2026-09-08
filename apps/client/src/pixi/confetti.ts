import { Container, Graphics } from 'pixi.js'

interface Particle {
  sprite: Graphics
  vx: number
  vy: number
  vr: number
  life: number
}

const COLORS = [0xe7c86a, 0xf5f5f0, 0x7fe3a8, 0x3aa0ff, 0xc22f2f]

/** Fire-and-forget particle burst for wins; ticked from the main loop. */
export class Confetti {
  readonly view = new Container()
  private particles: Particle[] = []

  burst(x: number, y: number, count: number) {
    for (let i = 0; i < count; i++) {
      const sprite = new Graphics()
      const size = 4 + Math.random() * 6
      sprite.rect(-size / 2, -size / 4, size, size / 2).fill(COLORS[i % COLORS.length])
      sprite.position.set(x, y)
      sprite.rotation = Math.random() * Math.PI
      this.view.addChild(sprite)
      const angle = Math.random() * Math.PI * 2
      const power = 0.15 + Math.random() * 0.45
      this.particles.push({
        sprite,
        vx: Math.cos(angle) * power,
        vy: Math.sin(angle) * power - 0.35,
        vr: (Math.random() - 0.5) * 0.02,
        life: 1600 + Math.random() * 900,
      })
    }
  }

  tick(dtMs: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.life -= dtMs
      p.vy += 0.0009 * dtMs
      p.sprite.x += p.vx * dtMs
      p.sprite.y += p.vy * dtMs
      p.sprite.rotation += p.vr * dtMs
      p.sprite.alpha = Math.min(1, p.life / 500)
      if (p.life <= 0) {
        p.sprite.destroy()
        this.particles.splice(i, 1)
      }
    }
  }
}
