# Port vs v24 tolerances (S001-AC-06)

`test/sim/v24-trace.test.ts` reads the table below. Each row is the largest allowed absolute difference
between the TypeScript port and the frozen v24 prototype for one sampled signal, on the same JS engine.
`*` is the default for every signal without its own row. Tolerances are never loosened silently:
a change needs a reason in this file and Main Dev's review (sprint plan, risk "float tolerance").

| signal | tolerance | reason |
|---|---|---|
| * | 0 | The port keeps v24's math, operation order and constants (read from `src/cars/s15-drift.json`, which holds the same literals), so on one engine every double is identical. |

Notes:
- Yes/no signals (wspin, lockF, cut, auto, off, haloRear, haloWarn, haloRising, predSlip, drifting) are 0/1 and `mode` is the index into `['', 'front', 'rear', 'drift', 'spin']`, so any mismatch is a difference of at least 1.
- `predEndX` and `predEndY` are v24 screen pixels: the port's predicted end point in meters times 9 px per meter, the same multiplication v24 does.
- Cross-engine runs (another browser) are not covered by these tolerances; see the S001-T8 determinism note.
