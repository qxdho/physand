/**
 * Device geometry spec — the sizes and drawing constants the device renderers
 * and the device factories share.
 *
 * WHY THIS EXISTS (phase C, and it doubles as phase D groundwork)
 * ---------------------------------------------------------------
 * The middle-tier renderers could not move because each read 5–8 loose numeric
 * globals: `GROUND_TH`, `GROUND_HATCH_STEP`, `BND_HH`, `BELT_TH`,
 * `BELT_DECO_STEP`, and the five spawn lengths.
 *
 * Tracing those constants showed they are not really renderer details. They are
 * the DEVICE SPEC: the same numbers feed
 *   - the device factory (`makeGround` sizing, `makeSpring` length clamps),
 *   - the parameter table's defaults (`rodlen.def = ROD_SPAWN_LEN`),
 *   - and the renderers.
 *
 * The legacy comments record that this sharing has already caused two bugs. The
 * spawn length and the parameter default were separate numbers, so pressing
 * "default" jumped a value to the *lower bound* of its range instead of the
 * value the device was created with (R102 for `CONV_DEF`, R125 for
 * `GROUND_SPAWN_LEN`). Both were fixed by making one reference the other.
 *
 * Naming them once, in one place, is what makes that class of bug structurally
 * harder: there is now a single definition to reference.
 *
 * WHY A MODULE AND NOT JUST CONSTANTS
 * -----------------------------------
 * Phase D wants new devices to be registrable without touching the core. A flat
 * list of numbers does not get there, but a per-device record does — each entry
 * carries the device's spawn size and the constants its drawing needs. The
 * renderer then takes the record instead of reaching for globals, which is
 * exactly the parameter-passing discipline the other extracted renderers follow.
 *
 * VALUES ARE NOT CHANGED. Every number here matches the legacy declaration; the
 * acceptance test for a migration like this is that rendering is pixel-identical.
 */

/** Geometry and drawing constants for one device kind. */
export interface DeviceSpec {
  /** Stable identifier, matching the legacy `DEVICES` table. */
  id: string;
  /** Human-readable name shown in the device palette. */
  name: string;
  /**
   * Spawn length in pixels.
   *
   * Zero means the device has no meaningful length (a hinge is a point). This is
   * the number the parameter table's `def` must reference, so that "default"
   * restores the size the device was created with.
   */
  spawnLen: number;
  /** Body thickness in pixels, where the device is drawn as a slab. */
  thickness: number;
  /** Spacing of the hatch marks that read as "ground" in engineering drawing. */
  hatchStep: number;
}

/**
 * The device table.
 *
 * Order matters: it is the order the palette renders in, and the legacy file had
 * spring, rod, belt, ground, hinge, rope.
 */
export const DEVICE_SPECS: readonly DeviceSpec[] = [
  { id: 'spring', name: '弹簧', spawnLen: 110, thickness: 0, hatchStep: 0 },
  { id: 'rod', name: '轻质杆', spawnLen: 170, thickness: 0, hatchStep: 0 },
  { id: 'belt', name: '传送带', spawnLen: 260, thickness: 20, hatchStep: 26 },
  { id: 'ground', name: '地面/墙面', spawnLen: 260, thickness: 18, hatchStep: 18 },
  { id: 'hinge', name: '光滑铰链', spawnLen: 0, thickness: 0, hatchStep: 0 },
  { id: 'rope', name: '轻绳', spawnLen: 110, thickness: 0, hatchStep: 0 },
];

/** Look up a device spec by id, or null when unknown. */
export function deviceSpec(id: string): DeviceSpec | null {
  for (const d of DEVICE_SPECS) if (d.id === id) return d;
  return null;
}

/**
 * The inward thickness of the boundary frame's ink, in pixels.
 *
 * A rendering constant rather than a device one, but it arrived here for the
 * same reason: the device renderers need it, and it lived as a loose global
 * (`BND_HH`). It is also the base the screen line width derives from
 * (`lineWidth = BND_HH * 1.55`).
 */
export const BOUNDARY_INK = 3.0;

/** Values the device renderers need, resolved from the table. */
export function groundSpec(): DeviceSpec {
  return deviceSpec('ground')!;
}

/** Values the belt renderer needs, resolved from the table. */
export function beltSpec(): DeviceSpec {
  return deviceSpec('belt')!;
}
