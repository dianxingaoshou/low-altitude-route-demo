/* Reproducible classroom comparisons on synthetic weather, not paper data. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../model.js');
const W = require('../weather-physics.js');
const F = require('../flight-engine.js');

const seeds = [20260923, 20260924, 20260925];
const snapshotMin = 15;
const start = { ...M.START };
const end = { x: 34, y: 20 };
const alpha = 200;
const beta = 1.5;
const cfg = {
  ...F.DEFAULTS,
  sources: [...F.DEFAULTS.sources],
  capacity: 1000,
  charge: 100,
  stationsEnabled: false,
  dynamic: false,
};
const paperEdge = (a, b, d) => d * (1 + alpha * Math.pow((a + b) / 2, beta));
const round = (x, digits = 4) => Number(x.toFixed(digits));
const node = (field, i) => W.point(field, { x: i % M.NX, y: Math.floor(i / M.NX) });

function measure(pathPoints, field, seed, method) {
  const annotated = W.annotate(pathPoints, field, cfg);
  const m = F.routeMetrics(annotated, cfg);
  assert(m && Number.isFinite(m.energyWh) && m.length > 0, `${seed} ${method}: invalid metrics`);
  let paperCost = 0;
  for (let i = 1; i < annotated.length; i++) {
    const a = annotated[i - 1], b = annotated[i];
    paperCost += paperEdge(a.value, b.value, M.STEP * Math.hypot(a.x - b.x, a.y - b.y));
    assert(W.safeSegment(field, a, b, cfg), `${seed} ${method}: unsafe segment`);
  }
  return {
    seed,
    method,
    distance_km: round(m.length),
    tke_exposure_km_m2_s2: round(m.dose),
    mean_tke_m2_s2: round(m.mean),
    peak_tke_m2_s2: round(m.peak),
    flight_s: round(m.timeMinutes * 60, 2),
    energy_Wh: round(m.energyWh, 2),
    paper_cost: round(paperCost, 4),
    route_xy: pathPoints.map(p => [p.x, p.y]),
  };
}

const routes = [];
const fusion = [];
const validations = [];
for (const seed of seeds) {
  const data = W.decorate(M.buildField({ seed, time: snapshotMin, sources: cfg.sources }), []);
  const field = data.field;
  const allowed = i => !field.blocked[i];
  const edgeAllowed = (u, v) => W.safeSegment(field, node(field, u), node(field, v), cfg);
  const options = { start, end, allowed, edgeAllowed };
  const shortest = M.plan(field, 0, false, true, options);
  const paperAstar = M.plan(field, 0, false, true, { ...options, cost: paperEdge });
  const paperDijkstra = M.plan(field, 0, false, false, { ...options, cost: paperEdge });
  const improved = F.planMission(field, cfg, start, end, [], cfg.capacity);
  assert(shortest.path && paperAstar.path && paperDijkstra.path && improved?.legs?.length === 1,
    `${seed}: at least one algorithm did not find a direct route`);
  const paperAstarMetric = measure(paperAstar.path, field, seed, '论文代价 A* 二维适配');
  const paperDijkstraMetric = measure(paperDijkstra.path, field, seed, '论文代价 Dijkstra 校验');
  assert(Math.abs(paperAstarMetric.paper_cost - paperDijkstraMetric.paper_cost) < 1e-7,
    `${seed}: A* cost differs from Dijkstra`);
  validations.push({ seed, paper_astar_equals_dijkstra: true,
    paper_astar_visited: paperAstar.visited, dijkstra_visited: paperDijkstra.visited });
  routes.push(
    measure(shortest.path, field, seed, '最短距离'),
    paperAstarMetric,
    measure(improved.legs[0].path, field, seed, '演示综合代价'),
  );
  for (const [source, selected] of [
    ['雷达', ['radar']], ['风廓线', ['profiler']], ['地面站', ['station']],
    ['全部三源', cfg.sources],
  ]) {
    const estimate = M.buildField({ seed, time: snapshotMin, sources: selected });
    fusion.push({ seed, source, rmse_against_synthetic_reference: round(estimate.rmse, 6) });
  }
}

function longMission(stationsEnabled) {
  const sim = new F.Flight();
  sim.cfg.dynamic = false;
  sim.cfg.stationsEnabled = stationsEnabled;
  sim.reset();
  const s = sim.schedule();
  return {
    stations_enabled: stationsEnabled,
    feasible: sim.feasible,
    swap_count: sim.itinerary.filter(leg => leg.swap).length,
    station_ids: sim.itinerary.filter(leg => leg.swap).map(leg => leg.target.id),
    estimated_total_s: sim.feasible ? round(s.totalSeconds, 2) : null,
    reason: sim.feasible ? null : sim.reason,
  };
}
const longRange = [longMission(false), longMission(true)];
assert(!longRange[0].feasible && longRange[1].feasible,
  'Long-range comparison must show the battery-swap feasibility difference');

const result = {
  provenance: '合成气象与概念能耗模型；不是论文原始数据、实测准确率或真实飞行结果',
  paper_source: '《低空湍流监测及最优航路规划研究》PDF 第 28–29 页：Σ d_i[1+α·TKE_i^β]，α=200，β=1.5；本实验只取二维定高切片',
  setting: { seeds, snapshot_min: snapshotMin, start_xy: start, end_xy: end, grid_km: M.STEP, altitude_m: 300,
    paper_alpha: alpha, paper_beta: beta, comparison_capacity_Wh: cfg.capacity,
    comparison_swap_enabled: false, same_wind_safety_constraints: true },
  validations,
  routes,
  fusion,
  long_range: longRange,
};

const out = path.join(__dirname, 'results');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'comparison.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
const headers = ['seed','method','distance_km','tke_exposure_km_m2_s2','mean_tke_m2_s2',
  'peak_tke_m2_s2','flight_s','energy_Wh','paper_cost'];
fs.writeFileSync(path.join(out, 'routes.csv'),
  [headers.join(','), ...routes.map(r => headers.map(h => r[h]).join(','))].join('\n') + '\n', 'utf8');
fs.writeFileSync(path.join(out, 'fusion.csv'),
  ['seed,source,rmse_against_synthetic_reference',
   ...fusion.map(r => `${r.seed},${r.source},${r.rmse_against_synthetic_reference}`)].join('\n') + '\n', 'utf8');
const fmt = (v, d = 2) => Number(v).toFixed(d);
const lines = [
  '# 课程对比实验记录',
  '',
  '以下数值全部来自固定种子的合成场；不能当作萧山实测天气、论文原实验结果或无人机性能指标。',
  '',
  '## 同一任务的三种航路',
  '',
  `起点 (${start.x}, ${start.y})，终点 (${end.x}, ${end.y})；天气快照 T+${snapshotMin} min，网格 200 m，固定高度 300 m。为隔离路径代价的影响，电池设为 1000 Wh、关闭换电，三种方法使用同一风况安全约束。`,
  '',
  '| 种子 | 方法 | 航程 km | TKE 暴露 km·m²/s² | 峰值 TKE m²/s² | 飞行 s | 耗能 Wh |',
  '|---:|---|---:|---:|---:|---:|---:|',
  ...routes.map(r => `| ${r.seed} | ${r.method} | ${fmt(r.distance_km)} | ${fmt(r.tke_exposure_km_m2_s2)} | ${fmt(r.peak_tke_m2_s2)} | ${fmt(r.flight_s, 0)} | ${fmt(r.energy_Wh, 1)} |`),
  '',
  '论文代价 A* 只二维适配了原文距离＋TKE 幂次项；当前网页的综合代价另考虑能耗。每个种子的论文代价 A* 与零启发 Dijkstra 得到相同代价值，验证的是当前离散图与代价定义下的搜索实现。',
  '',
  '## 多源模拟观测消融',
  '',
  'RMSE 的参照场与模拟观测由同一合成生成器产生，只能用于程序内部一致性检查，不能代表真实气象精度。',
  '',
  '| 种子 | 单雷达 RMSE | 单风廓线 RMSE | 单地面站 RMSE | 三源 RMSE |',
  '|---:|---:|---:|---:|---:|',
  ...seeds.map(seed => {
    const rows = fusion.filter(x => x.seed === seed);
    return `| ${seed} | ${rows.map(x => fmt(x.rmse_against_synthetic_reference, 3)).join(' | ')} |`;
  }),
  '',
  '## 长航程换电功能对照',
  '',
  '| 换电站 | 任务可行 | 预计换电次数 | 预计总用时 |',
  '|---|---|---:|---:|',
  ...longRange.map(r => `| ${r.stations_enabled ? '开启' : '关闭'} | ${r.feasible ? '是' : '否'} | ${r.swap_count} | ${r.estimated_total_s == null ? '无可行方案' : fmt(r.estimated_total_s, 1) + ' s'} |`),
  '',
  '## 复现命令',
  '',
  '`node experiments/compare.cjs`。每次重跑会更新本目录 JSON、CSV 与本文档。',
  '',
  '原文涉及三维场、原始探测资料及预测模型；本实验未复现这些部分，不得把此表中的差值说成原论文的验证结果。',
  '',
];
fs.writeFileSync(path.join(out, '实验结果.md'), lines.join('\n'), 'utf8');
console.log(`PASS: ${seeds.length} fixed seeds, ${routes.length} routes, A*/Dijkstra checks, fusion ablation, battery-swap comparison`);
