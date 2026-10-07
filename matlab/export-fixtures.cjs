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
const routeRows = [], segmentRows = [], graphRows = [], fieldRows = [], pointRows = [];
let routeId = 0;
for (const seed of result.setting.seeds) {
  const field = W.decorate(M.buildField({ seed, time: result.setting.snapshot_min,
    sources: cfg.sources }), []).field;
  const nodes = Array.from({ length: field.length }, (_, i) =>
    W.point(field, { x: i % M.NX, y: Math.floor(i / M.NX) }));
  for (const p of nodes) fieldRows.push([seed, p.x, p.y, p.value, p.u, p.v]);
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
    points.forEach((p, j) => pointRows.push([routeId, j, p.x, p.y]));
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
csv('field_snapshots.csv', 'seed,x_grid,y_grid,tke,u,v', fieldRows);
csv('route_points.csv', 'route_id,point_id,x_grid,y_grid', pointRows);

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

// Export a speed/load/TKE sweep from JS; MATLAB recomputes every value.
const sweepRows = [];
for (const payload of [0, 1, 3]) for (const tke of [0.3, 1.5]) {
  for (let speed = 5; speed <= 20; speed++) {
    const a = { x: 0, y: 0, value: tke, u: 0, v: 0, gust: 0 };
    const e = W.edge(a, { ...a, x: 1 }, { ...cfg, payload, speed });
    sweepRows.push([speed, payload, tke, e.powerW, e.whPerKm, 6000 / speed]);
  }
}
csv('parameter_sweep.csv', 'speed,payload,tke,power_W,Wh_per_km,six_km_seconds', sweepRows);

// Actual static mission replay. These are software traces, not flight telemetry.
const statusCodes = { ready: 0, running: 1, swapping: 2, waiting: 3, arrived: 4, blocked: 5, paused: 6 };
const relay = new F.Flight();
relay.configure({ dynamic: false });
relay.run();
const traceRows = [];
function record(sim) {
  traceRows.push([sim.elapsed, sim.flightSeconds, sim.holdSeconds, sim.swapElapsed,
    sim.batteryWh, sim.usedWh, sim.travelKm, sim.position.x, sim.position.y,
    sim.completedSwaps, statusCodes[sim.status]]);
}
record(relay);
for (let step = 0; step < 6000 && ['running', 'swapping'].includes(relay.status); step++) {
  relay.tick(1);
  record(relay);
}
assert.equal(relay.status, 'arrived');
csv('relay_trace.csv', 'elapsed_s,flight_s,hold_s,swap_s,battery_Wh,used_Wh,flown_km,x_grid,y_grid,completed_swaps,status_code', traceRows);
csv('swap_records.csv', 'completed_at_s,duration_s,before_Wh',
  relay.swaps.map(s => [s.at, s.duration, s.before_Wh]));

// Wide gust: verify protected stop, then replay 240 seconds of safe waiting.
const hold = new F.Flight();
hold.configure({ dynamic: false });
hold.run(); hold.tick(5);
hold.gust('wide');
assert.equal(hold.status, 'blocked');
const stopped = { t: hold.elapsed, e: hold.usedWh, p: { ...hold.position } };
hold.tick(30);
const blockedDeltas = [hold.elapsed - stopped.t, hold.usedWh - stopped.e,
  M.STEP * 1000 * Math.hypot(hold.position.x - stopped.p.x, hold.position.y - stopped.p.y)];
assert.deepEqual(blockedDeltas, [0, 0, 0]);
const beforeHold = { t: hold.elapsed, battery: hold.batteryWh, p: { ...hold.position } };
assert(hold.waitOutGust().allowed);
const holdRows = [];
for (let step = 0; step < 1000 && hold.status === 'waiting'; step++) {
  const start = hold.elapsed, p = { ...hold.position }, w = hold.windAt(p);
  const tke = W.sample(hold.data.field, p), gust = W.sample(hold.data.field.gust, p);
  const energyBefore = hold.holdEnergyWh;
  hold.tick(1);
  holdRows.push([start, hold.elapsed, p.x, p.y, hold.position.x, hold.position.y,
    tke, w.u, w.v, gust, hold.holdEnergyWh - energyBefore,
    hold.holdEnergyWh, hold.batteryWh, statusCodes[hold.status]]);
}
assert.equal(hold.status, 'running');
assert.equal(hold.holdSeconds, 240);
csv('hold_steps.csv', 'start_s,end_s,x_before,y_before,x_after,y_after,tke,u,v,gust,energy_increment_Wh,hold_energy_Wh,battery_Wh,status_code', holdRows);
csv('hold_summary.csv', 'start_s,end_s,initial_battery_Wh,final_battery_Wh,wait_s,wait_energy_Wh,final_status_code,blocked_time_delta,blocked_energy_delta,blocked_motion_m',
  [[beforeHold.t, hold.elapsed, beforeHold.battery, hold.batteryWh, hold.holdSeconds,
    hold.holdEnergyWh, statusCodes[hold.status], ...blockedDeltas]]);
console.log(`Exported ${graphRows.length} directed safe edges, ${routeRows.length} routes, ${segmentRows.length} segments, ${safetyRows.length} wind-safety cases, ${sweepRows.length} sweep cases, ${traceRows.length} replay points and ${holdRows.length} waiting steps.`);
