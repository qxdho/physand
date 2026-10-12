/**
 * Device registry — one declaration per device kind.
 *
 * WHY THIS EXISTS (phase D: extensibility)
 * ----------------------------------------
 * Adding one device to the legacy app requires editing FOUR places:
 *
 *   1. the `DEVICES` table          (id, label, spawn length)
 *   2. `placeDevice()`              (how the id becomes a real body)
 *   3. `drawDeviceGhost()`          (what the drag preview looks like)
 *   4. `midMagnetPullGhost()`       (special-case ghost geometry)
 *
 * Places 2 and 3 are two parallel if-chains that must agree. The code comments
 * make the contract explicit — "ghost seen = result obtained" (虚影所见 = 松手所得)
 * — and the only thing enforcing it is that a human wrote both branches to call
 * the same drawing function. Nothing detects a new device added to one chain and
 * forgotten in the other; the symptom would be a preview that silently draws
 * nothing, or draws the wrong shape, which is easy to mistake for a rendering
 * bug.
 *
 * This module collapses that into ONE record per device, so the preview and the
 * spawn are two fields of the same declaration rather than two code paths that
 * have to be remembered together.
 *
 * WHAT IS AND IS NOT CLAIMED
 * --------------------------
 * The registry does not (yet) own device creation. The legacy if-chains still
 * run; this module is the declaration they will be driven from. That is
 * deliberate — moving 6 spawn paths at once is the bulk edit this project has
 * repeatedly been burned by, and the value here is that the CONTRACT between
 * preview and spawn becomes expressible in one place, which is what makes the
 * eventual migration mechanical rather than clever.
 */

/** How a device is drawn in the drag preview and what it spawns. */
export interface DeviceDefinition {
  /** Stable id, matching the legacy `DEVICES` table and the tool state. */
  id: string;
  /** Label shown in the device palette. */
  name: string;
  /**
   * Spawn length in pixels; 0 for devices that are a point (a hinge).
   *
   * This is the value the parameter table's `def` must reference, so pressing
   * "default" restores the size the device was created with. Two separate
   * numbers here previously caused R102 and R125 (the value jumped to the lower
   * bound of its range instead of the spawn size).
   */
  spawnLen: number;
  /**
   * The drawing function used for the drag preview.
   *
   * Named here so the preview and the spawned body cannot drift apart: the
   * legacy comments record that the "ghost seen = result obtained" contract holds
   * only because both sides call the same renderer. Stating the renderer once
   * makes that structural rather than a convention to remember.
   */
  preview: 'spring' | 'rod' | 'belt' | 'ground' | 'hinge' | 'rope';
  /** Whether the ghost needs a sag curve (ropes are drawn slack, rods are not). */
  ghostSlack?: number;
  /**
   * Whether the drag preview is implemented for this device.
   *
   * Defaults to true. `ground` sets it false: it genuinely draws nothing while
   * being dragged. Stated explicitly so the gap is a recorded fact rather than
   * an inconsistency a test has to be taught to ignore — and so that fixing it
   * is a one-word change here plus a branch in the legacy chain.
   */
  hasGhost?: boolean;
}

/**
 * The device table.
 *
 * Order is the palette order. Values match the legacy declarations exactly; a
 * test compares every field against them, because drift would be silent — the
 * preview would just look slightly wrong.
 */
export const DEVICE_DEFINITIONS: readonly DeviceDefinition[] = [
  { id: 'spring', name: '弹簧', spawnLen: 110, preview: 'spring' },
  { id: 'rod', name: '轻质杆', spawnLen: 170, preview: 'rod' },
  { id: 'belt', name: '传送带', spawnLen: 260, preview: 'belt' },
  /* NOTE: `ground` has NO ghost branch in the legacy code — verified by
   * rendering each device's ghost and measuring ink: ground produced 0 while
   * every other device produced 184–5200. So dragging the ground/wall device
   * gives no placement preview at all. Recorded here rather than silently
   * matched, because it is a product gap, not a registry detail. */
  { id: 'ground', name: '地面/墙面', spawnLen: 260, preview: 'ground', hasGhost: false },
  { id: 'hinge', name: '光滑铰链', spawnLen: 0, preview: 'hinge' },
  // The rope's preview carries a slack value so the ghost draws a CURVE; without
  // it a rope previews as a straight line and reads as a rod (R104-2).
  { id: 'rope', name: '轻绳', spawnLen: 110, preview: 'rope', ghostSlack: 50 },
];

/** Look up a device definition, or null. */
export function deviceDefinition(id: string): DeviceDefinition | null {
  for (const d of DEVICE_DEFINITIONS) if (d.id === id) return d;
  return null;
}

/**
 * Every id the app knows about.
 *
 * Exposed so a guard can check the legacy if-chains cover exactly this set —
 * the drift this module exists to prevent.
 */
export function deviceIds(): string[] {
  return DEVICE_DEFINITIONS.map((d) => d.id);
}
