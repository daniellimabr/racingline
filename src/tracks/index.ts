// The tracks the game ships (ADR-005). Each file is built offline by tools/tracks/convert-track.mjs from a
// saved OpenStreetMap extract and checked here before use; the game never calls OpenStreetMap at runtime.
import { parseTrack, type Track } from '../data/track.ts';
import interlagos from './interlagos.json';

export const TRACKS: readonly Track[] = Object.freeze([parseTrack(interlagos, 'interlagos.json')]);
