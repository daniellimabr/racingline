// S004 T6: the key hint shown when the game has focus names every key, including R (put the car back).
import { expect, it } from 'vitest';
import { KEY_HINT } from '../../src/ui/key-hint.ts';

it('names every driving and game key, including R', () => {
  for (const key of ['W/S', 'A/D', ', ', '. ', 'M ', 'C ', 'R ', 'P ']) expect(KEY_HINT).toContain(key);
  expect(KEY_HINT).toMatch(/R reposiciona/);
});
