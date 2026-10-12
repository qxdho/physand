/**
 * Particle rendering — extracted from the legacy file as the first concrete
 * demonstration of the `render/` boundary.
 *
 * WHY THIS ONE
 * ------------
 * The boundary survey found 17 draw functions that read the canvas context and
 * write no shared state. This is the smallest of them (13 lines), which makes it
 * the honest place to prove the seam works before moving anything larger: if the
 * pattern does not hold here, it will not hold for `drawSpring` or `drawFieldE`.
 *
 * WHAT CHANGED, AND WHAT DID NOT
 * ------------------------------
 * The drawing code is unchanged, character for character. What changed is that
 * the two dependencies became PARAMETERS instead of free variables:
 *
 *   before:  function drawParticles()          // reads `particles` and `cvx`
 *   after:   export function drawParticles(surface, particles)
 *
 * That is the whole point of the boundary. A function that takes its inputs can
 * be tested, moved and reordered; one that reads globals can only be moved
 * together with everything else that reads the same globals — which is how the
 * original file ended up as one 476-function component.
 *
 * The colours and geometry are deliberately byte-identical to the original,
 * because the acceptance test for this extraction is that the canvas output does
 * not change.
 */

import type { DrawSurface } from './surface.ts';

/** A particle, as the simulation produces them. */
export interface Particle {
  x: number;
  y: number;
  r: number;
  alpha: number;
  /** Hot particles (sparks, impacts) render in a warm colour. */
  hot?: boolean;
}

/** Canvas calls this renderer needs. */
interface ParticleSurface extends DrawSurface {
  fillStyle: string | CanvasGradient | CanvasPattern;
  beginPath(): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  fill(): void;
}

/**
 * Draw every particle.
 *
 * Returns false when there is no surface, so a caller can distinguish "drew
 * nothing" from "could not draw" — the legacy version would have thrown on a
 * null context.
 */
export function drawParticles(surface: DrawSurface | null, particles: readonly Particle[]): boolean {
  if (!surface) return false;
  const ctx = surface as ParticleSurface;

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i]!;
    // Colour choice preserved exactly: hot particles are warm, others are the
    // dark ink colour. Kept as string concatenation to match the original's
    // output byte for byte.
    ctx.fillStyle = p.hot ? 'rgba(255,224,150,' + p.alpha + ')' : 'rgba(38,34,28,' + p.alpha + ')';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, 6.2832);
    ctx.fill();
  }
  return true;
}
