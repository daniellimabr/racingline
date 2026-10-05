// HUD car facts (S002-T7): everything the HUD shows about the active car comes from its data, so a
// car switch changes the name, tacho red zone, gear count and rpm chart scale together.
import type { CarParams } from '../sim/index.ts';

export interface CarHud {
  name: string;
  label: string; // accessible text, e.g. "Carro: GT3"
  idleRpm: number;
  redlineRpm: number;
  cutRpm: number;
  gearCount: number;
  rpmScale: number; // top of the telemetry rpm axis: the rev cut rounded up to the next 1000 rpm
}

export function carHud(car: CarParams): CarHud {
  return {
    name: car.name,
    label: 'Carro: ' + car.name,
    idleRpm: car.idleRpm,
    redlineRpm: car.redlineRpm,
    cutRpm: car.cutRpm,
    gearCount: car.gears.length,
    rpmScale: Math.ceil(car.cutRpm / 1000) * 1000,
  };
}

/** Gear readout out of the car's gear count, e.g. "3ª/6" (gear is 0-based as in the sim). */
export const gearText = (gear: number, gearCount: number): string => `${gear + 1}ª/${gearCount}`;

/** Telemetry legend entry for the rpm line. */
export const rpmLegend = (car: CarParams): string => `RPM (0–${carHud(car).rpmScale})`;
