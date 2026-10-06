# Track data licence

The track files in `src/tracks/*.json` and the saved extracts in `tools/tracks/*.osm.json` are derived from
OpenStreetMap data and are made available under the Open Database License 1.0
(https://opendatacommons.org/licenses/odbl/1-0/).

Map data © OpenStreetMap contributors (https://www.openstreetmap.org/copyright).

The game code itself is not covered by this licence. How the files are made: ADR-005; `npm run tracks`
rebuilds `src/tracks/interlagos.json` offline from `tools/tracks/interlagos.osm.json`.
