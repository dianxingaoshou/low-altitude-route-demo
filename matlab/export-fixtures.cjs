/* Export identical inputs for an independent MATLAB calculation. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const M = require('../model.js');
const W = require('../weather-physics.js');
const F = require('../flight-engine.js');
const result = require('../experiments/results/comparison.json');

const out = path.join(__dirname, 'fixtures');
fs.mkdirSync(out, { recursive: true });
const csv = (name, header, rows) => fs.writeFileSync(
  path.join(out, name), [header, ...rows.map(row => row.join(','))].join('\n') + '\n', 'utf8');
const cfg = {
  ...F.DEFAULTS,
  sources: [...F.DEFAULTS.sources],
  capacity: 1000,
  charge: 100,
  stationsEnabled: false,
  dynamic: false,
};
const routeRows = [], segmentRows = [], graphRows = [];
let routeId = 0;
for (const seed of result.setting.seeds) {
  const field = W.decorate(M.buildField({ seed, time: result.setting.snapshot_min,
    sources: cfg.sources }), []).field;
  const nodes = Array.from({ length: field.length }, (_, i) =>
    W.point(field, { x: i % M.NX, y: Math.floor(i / M.NX) }));
  const allowed = i => Number.isFinite(field[i]) && !field.blocked[i];
  for (let u = 0; u < nodes.length; u++) {
    if (!allowed(u)) continue;
    const x = u % M.NX, y = Math.floor(u / M.NX);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= M.NX || yy >= M.NY) continue;
      const v = yy * M.NX + xx;
      if (!allowed(v)) continue;
      if (dx && dy && (!allowed(y * M.NX + xx) || !allowed(yy * M.NX + x))) continue;
      if (!W.safeSegment(field, nodes[u], nodes[v], cfg)) continue;
      graphRows.push([seed, u + 1, v + 1, M.STEP * Math.hypot(dx, dy),
        nodes[u].value, nodes[v].value]);
    }
  }
  const routes = result.routes.filter(route => route.seed === seed);
  assert.equal(routes.length, 3);
  for (const [methodCode, route] of routes.entries()) {
    routeId++;
    routeRows.push([routeId, seed, methodCode, route.distance_km,
      route.tke_exposure_km_m2_s2, route.flight_s, route.energy_Wh,
      route.paper_cost]);
    const points = route.route_xy.map(([x, y]) => nodes[y * M.NX + x]);
    for (let j = 1; j < points.length; j++) {
      const a = points[j - 1], b = points[j];
      segmentRows.push([routeId, j, b.x - a.x, b.y - a.y,
        a.value, b.value, a.u, a.v, a.gust, b.u, b.v, b.gust]);
    }
  }
}
csv('graph_edges.csv', 'seed,u,v,d_km,tke_a,tke_b', graphRows);
csv('route_expected.csv', 'route_id,seed,method_code,distance_km,tke_exposure,flight_s,energy_Wh,paper_cost', routeRows);
csv('route_segments.csv', 'route_id,segment_id,dx_grid,dy_grid,tke_a,tke_b,u_a,v_a,gust_a,u_b,v_b,gust_b', segmentRows);

const missionRows = [];
for (const enabled of [false, true]) {
  const sim = new F.Flight();
  sim.cfg.dynamic = false;
  sim.cfg.stationsEnabled = enabled;
  sim.reset();
  const schedule = sim.schedule();
  missionRows.push([Number(enabled), Number(sim.feasible), schedule.flightSeconds,
    schedule.futureSwaps, schedule.swapSeconds, schedule.totalSeconds]);
}
csv('mission_expected.csv', 'stations_enabled,feasible,flight_s,swap_count,swap_s,total_s', missionRows);
const safetyRows = [];
for (const [caseId, u, v] of [[1, 0, 0], [2, 4, 0], [3, -10, 0],
  [4, 0, 13], [5, 15, 0], [6, -2, 8]]) {
  const a = { x: 0, y: 0, value: 0.3, u, v, gust: 0 };
  const b = { ...a, x: 1 };
  const edge = W.edge(a, b, cfg);
  safetyRows.push([caseId, u, v, Number(edge.flyable), edge.groundSpeed, edge.powerW]);
}
csv('safety_cases.csv', 'case_id,u,v,flyable,ground_speed,power_W', safetyRows);
console.log(`Exported ${graphRows.length} directed safe edges, ${routeRows.length} routes, ${segmentRows.length} segments, ${safetyRows.length} wind-safety cases.`);
