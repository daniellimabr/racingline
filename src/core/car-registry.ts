// Car registry (S002-T6): the selectable cars, keyed by their top-level `id` and shown by `name`.
// Generic over the car type so it works with any list of car params; order is the switch order.

export interface CarEntry {
  readonly id: string;
  readonly name: string;
}

export interface CarRegistry<C extends CarEntry> {
  readonly list: readonly C[];
  has(id: string): boolean;
  /** Throws on an unknown id. */
  get(id: string): C;
  /** The car after `id` in list order, wrapping around (a single car returns itself). */
  next(id: string): C;
}

export function createCarRegistry<C extends CarEntry>(cars: readonly C[]): CarRegistry<C> {
  if (cars.length === 0) throw new Error('car registry needs at least one car');
  const index = new Map<string, number>();
  cars.forEach((car, i) => {
    if (typeof car.id !== 'string' || car.id === '') throw new Error(`empty car id at position ${i}`);
    if (index.has(car.id)) throw new Error(`duplicate car id "${car.id}"`);
    index.set(car.id, i);
  });
  const list = Object.freeze([...cars]);
  const at = (id: string): number => {
    const i = index.get(id);
    if (i === undefined) throw new Error(`unknown car id "${id}" (known: ${[...index.keys()].join(', ')})`);
    return i;
  };
  return {
    list,
    has: (id) => index.has(id),
    get: (id) => list[at(id)]!,
    next: (id) => list[(at(id) + 1) % list.length]!,
  };
}

/** The car-switch key: the id of the car to restart with, or null when paused (the press is ignored). */
export function switchCar<C extends CarEntry>(cars: CarRegistry<C>, current: string, paused: boolean): string | null {
  return paused ? null : cars.next(current).id;
}
