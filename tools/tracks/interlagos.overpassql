/* Autodromo Jose Carlos Pace (Interlagos), Sao Paulo: motor raceway ways, their circuit relation(s) and nodes.
   Run once by tools/tracks/fetch-osm.mjs; the answer is saved as interlagos.osm.json (ADR-005). */
[out:json][timeout:90];
way["highway"="raceway"]["sport"="motor"](-23.715,-46.705,-23.695,-46.688)->.track;
(rel(bw.track)["type"="circuit"];)->.circuit;
.circuit out body;
.track out body;
node(w.track);
out body;
