/* Export web outputs for cases with closed-form answers, not random weather. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const M = require('../model.js');
const W = require('../weather-physics.js');
const F = require('../flight-engine.js');
const cfg = {...F.DEFAULTS, payload: 0, speed: 12, basePower: 650};
const cases = [['calm',0,0], ['tailwind',6,0], ['headwind',-6,0],
  ['crosswind',0,6], ['uncompensable_crosswind',0,12],
  ['zero_groundspeed',-12,0], ['wind_limit',14,0]];
const rows = cases.map(([id,u,v]) => {
  const a = {x:0,y:0,value:0,u,v,gust:0};
  const b = {...a,x:30}; // Exactly 6 km east, constant local field.
  const e = W.edge(a,b,cfg);
  return [id,u,v,e.groundSpeed,e.powerW,+e.flyable,
    e.flyable?e.seconds:NaN,e.flyable?e.energyWh:NaN];
});
const field = new Float64Array(M.NX*M.NY).fill(0.3);
const opts = {start:{x:4,y:20},end:{x:34,y:20}};
const ordinary = M.plan(field,8,false,true,opts).path;
const paper = M.plan(field,8,false,true,{...opts,
  cost:(a,b,d)=>d*(1+200*((a+b)/2)**1.5)}).path;
assert(ordinary && paper);
function paperCost(p) {return p.slice(1).reduce((s,b,i)=>
  s+M.STEP*Math.hypot(b.x-p[i].x,b.y-p[i].y)*(1+200*0.3**1.5),0);}
const folder=path.join(__dirname,'fixtures'); fs.mkdirSync(folder,{recursive:true});
fs.writeFileSync(path.join(folder,'analytic_wind_cases.csv'),
  ['case_id,u,v,ground_speed,power_W,flyable,seconds,energy_Wh',
    ...rows.map(r=>r.join(','))].join('\n')+'\n');
fs.writeFileSync(path.join(folder,'analytic_scalar_cases.csv'),
  ['case_id,JS_value',
    ['uniform_distance_km',M.metrics(ordinary,8).length],
    ['uniform_demo_cost',M.metrics(ordinary,8).cost],
    ['uniform_paper_cost',paperCost(paper)],
    ['hover_power_W',W.hoverPower(0,cfg)],
    ['sigma_at_TKE_0_3',M.wind(1,1,0,20260923,0.3).sigma],
    ['sigma_at_TKE_1_5',M.wind(1,1,0,20260923,1.5).sigma],
  ].map(r=>Array.isArray(r)?r.join(','):r).join('\n')+'\n');
console.log('Exported seven closed-form wind cases and six scalar web outputs.');
