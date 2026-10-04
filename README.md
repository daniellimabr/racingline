# RacingLine

Web racing game whose core mechanic is a player-drawn racing line: brake/throttle and steering on the keyboard, and a projected line in front of the car shows the planned trajectory and the remaining tire grip.

## Run the prototype (zero install)

From this folder (`game/`), with Python 3:

```
python -m http.server 8000 --bind 127.0.0.1 --directory prototype
```

Open <http://127.0.0.1:8000/prototype-v24.html> and click the canvas to focus. (`npm run serve` runs the same command.) The server listens on localhost only. The file is self-contained, so opening it directly in a browser also works.

**Controls:** W/S or ↑/↓ throttle/brake (ramped) · A/D or ←/→ steering · `,` downshift · `.` upshift · M auto/manual · P pause.

`prototype/prototype-v24.html` is the frozen behavior reference (its UI text is Portuguese). A test locks it byte-for-byte; never edit it. The port lives in `src/` from Sprint 001.

## Develop

```
npm ci --ignore-scripts   # install from the lockfile
npm run dev               # Vite dev server on http://127.0.0.1:5173 (localhost only)
npm run typecheck         # strict TypeScript, no emit
npm test                  # Vitest
npm run coverage          # Vitest + coverage gate (>= 80% on src/sim, src/input)
npm run build             # production bundle in dist/
npm run scan              # secret scan of tracked files
```

## Contributing

- Branches: `main` (approved releases) ← `sprint/XXX-<theme>` ← `sprint/XXX-<theme>--<agent>-<task>` (a `/` is impossible: Git cannot hold both `a` and `a/b` as branches). No direct commits to `main`, no force-push.
- Enable the hooks once per clone: `git config core.hooksPath .githooks` (pre-commit secret scan, blocks commits on `main`).
- Conventional Commits with an `Agent: <name>` trailer.
