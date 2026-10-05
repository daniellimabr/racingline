// How each car is drawn (S002-T7): body size from its data, color by car id, a wing when it has downforce.
import type { CarParams } from '../sim/index.ts';

// Body colors per car id; both read well on the grey lot and green grass in light and dark page themes.
const CAR_COLORS: Readonly<Record<string, string>> = { 's15-drift': '#e8402f', gt3: '#2f7fe0' };
const OTHER_CAR_COLOR = '#d9a21b';
// Car files have no track width, so body width scales with wheelbase; this ratio keeps the S15 at its current 7.6 px.
const HALF_WIDTH_PER_WHEELBASE = 7.6 / 9 / 2.525; // m of half width per m of wheelbase
const OVERHANG = 0.96; // m of body past each axle

export interface CarLook {
  color: string;
  length: number; // px, bumper to bumper
  halfWidth: number; // px
  overhang: number; // px
  wing: boolean; // rear wing, drawn for cars with downforce
}

/** How a car is drawn, from its data: size from wheelbase, color from id, wing from downforce. */
export function carLook(car: CarParams, scale: number): CarLook {
  return {
    color: CAR_COLORS[car.id] ?? OTHER_CAR_COLOR,
    length: (car.wheelbase + 2 * OVERHANG) * scale,
    halfWidth: HALF_WIDTH_PER_WHEELBASE * car.wheelbase * scale,
    overhang: OVERHANG * scale,
    wing: car.downforceArea > 0,
  };
}
