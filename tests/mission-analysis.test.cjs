const assert=require('node:assert/strict');
const M=require('../model.js'),W=require('../weather-physics.js'),F=require('../flight-engine.js'),A=require('../mission-analysis.js');
const near=(a,b,t=1e-6)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
async function checks(){
  const sim=new F.Flight({cfg:{dynamic:false}}),input=A.capture(sim),before=JSON.stringify(sim.snapshot());
  const result=await A.run(input,1);assert.equal(result.rows.length,4);assert.equal(result.processed_samples,1);
  assert.equal(JSON.stringify(sim.snapshot()),before,'A comparison must never mutate live flight');
  const composite=result.rows.find(r=>r.strategy==='composite');assert.ok(composite.completed);
  const direct=new F.Flight({cfg:{dynamic:false}});direct.run();while(['running','swapping'].includes(direct.status))direct.tick(60);
  assert.equal(direct.status,'arrived');near(composite.total_s,direct.elapsed);near(composite.energy_Wh,direct.usedWh);near(composite.distance_km,direct.travelKm);near(composite.arrival_Wh,direct.remainingWh);assert.equal(composite.swap_count,direct.completedSwaps);
  for(const row of result.rows){assert.ok(row.completed);assert.ok(row.arrival_Wh>=sim.reserveWh-1e-6);
    const cfg={...input.cfg,strategy:row.strategy},data=A.dataAt(input),actual=W.annotate(row.path,data.field,cfg);
    near(row.tke_exposure,F.routeMetrics(actual,cfg).dose);near(row.distance_km,F.routeMetrics(actual,cfg).length);
    for(let i=1;i<row.path.length;i++)assert.equal(A.unsafeSegment(data.field,row.path[i-1],row.path[i],cfg),null);
  }
  assert.ok(result.rows.find(r=>r.strategy==='turbulence').tke_exposure<composite.tke_exposure);
  const repeated=await A.run(input,1);assert.deepEqual(result.rows,repeated.rows,'Seeded comparisons must repeat');
  // All four costs use the same edge safety, reserve and waypoint constraints.
  const noSwap=A.capture(new F.Flight({cfg:{dynamic:false,stationsEnabled:false}})),failed=await A.run(noSwap,1);
  for(const row of failed.rows){assert.equal(row.completed,false);assert.match(row.reason,/电量|补能/);for(const k of ['distance_km','total_s','energy_Wh','tke_exposure','swap_count'])assert.equal(row[k],null);}
  const none=await A.run({...input,cfg:{...input.cfg,sources:[]}},1);for(const row of none.rows){assert.equal(row.completed,false);assert.match(row.reason,/观测/);}
  const storm=new F.Flight({cfg:{dynamic:false}});storm.run();storm.tick(5);storm.gust('wide');const stormBefore=JSON.stringify(storm.snapshot()),report=storm.decisionAssessment();
  assert.equal(storm.status,'blocked');assert.equal(report.original.feasible,false);assert.ok(report.original.first_unsafe.segment>=1);assert.match(report.original.reason,/超限/);assert.equal(report.reroute.feasible,false);
  assert.ok(report.wait.feasible&&report.wait.can_hold);assert.equal(report.wait.wait_s,240);assert.ok(report.wait.wait_energy_Wh>0);assert.ok(report.wait.metrics.total_s>report.wait.wait_s);assert.ok(report.wait.metrics.arrival_Wh>=storm.reserveWh-1e-7);
  assert.equal(JSON.stringify(storm.snapshot()),stormBefore,'Forecasting must never advance live weather, battery or telemetry');
  const energyBeforeWait=storm.usedWh;storm.waitOutGust();storm.tick(240);assert.equal(storm.status,'running');near(storm.holdEnergyWh,report.wait.wait_energy_Wh);
  while(['running','swapping'].includes(storm.status))storm.tick(60);assert.equal(storm.status,'arrived');near(storm.elapsed-5,report.wait.metrics.total_s);near(storm.usedWh-energyBeforeWait,report.wait.metrics.energy_Wh);
  const limited={...storm.decisionInput,battery_Wh:storm.reserveWh+5};const low=A.assess(limited);assert.equal(low.wait.feasible,false);assert.equal(low.wait.can_hold,false);assert.match(low.wait.reason,/电量/);
  const originalInput=storm.decisionInput,atCore={...originalInput,start:{x:originalInput.gusts[0].x,y:originalInput.gusts[0].y}};const core=A.assess(atCore);assert.equal(core.wait.can_hold,false);assert.match(core.wait.reason,/不能安全|核心|风速/);
  const multiple=new F.Flight({cfg:{dynamic:false}});multiple.run();multiple.tick(5);multiple.gust('wide');multiple.gust('strong',{x:58,y:38});assert.equal(multiple.decisionInput.before,null,'An already blocked mission has no executable pre-injection baseline');assert.ok(multiple.decisionInput.original_legs.length);
  const moderate=new F.Flight({cfg:{dynamic:false,capacity:600}});moderate.gust('moderate');const reroute=moderate.decisionAssessment();assert.ok(reroute.reroute.feasible);assert.ok(reroute.reroute.delta);near(reroute.reroute.delta.distance_km,reroute.reroute.metrics.distance_km-moderate.decisionInput.before.length);
  const refreshInput=moderate.decisionInput;moderate.refreshWeather(42);assert.notEqual(moderate.decisionInput,refreshInput);assert.equal(moderate.decisionAssessment().seed,42);
  // Already elapsed flight is excluded; a swap in progress contributes its remaining time only.
  const swapping=new F.Flight({cfg:{dynamic:false}});swapping.run();while(swapping.status==='running')swapping.tick(10);assert.equal(swapping.status,'swapping');swapping.tick(17);const swapInput=A.capture(swapping),swapRow=A.replay(swapInput,A.dataAt(swapInput),A.STRATEGIES[3]),expected=swapping.schedule();
  assert.ok(swapRow.completed);near(swapRow.total_s,expected.totalSeconds);near(swapRow.energy_Wh,expected.energyWh);assert.equal(swapRow.swap_count,expected.futureSwaps);assert.ok(swapInput.pending_swap_s<swapping.cfg.swapSeconds);
  const wpInput=A.capture(new F.Flight({cfg:{dynamic:false,capacity:600},waypoints:[{x:21,y:30},{x:43,y:12}]}));
  const wpRow=A.replay(wpInput,A.dataAt(wpInput),A.STRATEGIES[3]);assert.ok(wpRow.completed);let last=-1;for(const p of wpInput.waypoints){const at=wpRow.path.findIndex((q,i)=>i>last&&q.x===p.x&&q.y===p.y);assert.ok(at>last);last=at;}
  // Geometry with known costs checks that energy/TKE use zero heuristic.
  const field=new Float64Array(M.NX*M.NY).fill(.3);field.u=new Float64Array(field.length);field.v=new Float64Array(field.length);field.gust=new Float64Array(field.length);field.events=[];
  for(const strategy of A.STRATEGIES){const cfg={...F.DEFAULTS,strategy:strategy.id,capacity:600,stationsEnabled:false},mission=F.planMission(field,cfg,{x:4,y:20},{x:56,y:20},[],600);assert.ok(mission);near(mission.legs[0].metrics.length,10.4);}
  const batch=await A.run(input,3);assert.equal(batch.rows.length,12);for(const s of batch.summary){assert.equal(s.cases,3);assert.equal(s.completed,3);assert.equal(s.completion_rate,1);assert.equal(s.energy_Wh.n,3);assert.ok(s.energy_Wh.q1<=s.energy_Wh.median&&s.energy_Wh.median<=s.energy_Wh.q3);}
  const mixed=A.summary([...result.rows,...failed.rows]);for(const s of mixed){assert.equal(s.cases,2);assert.equal(s.completed,1);near(s.completion_rate,.5);assert.equal(s.energy_Wh.n,1);}
  let cancel=false;const cancelled=await A.run(input,3,{progress:()=>{cancel=true;},cancelled:()=>cancel});assert.equal(cancelled.processed_samples,1);assert.ok(cancelled.cancelled);assert.equal(cancelled.rows.length,4);
  assert.match(A.csv(failed),/seed,method,completed/);assert.match(A.csv(failed),/电量|补能/);assert.ok(!A.csv(failed).includes('NaN'));
  console.log('PASS: candidate segment reasons, frozen read-only assessments, waiting forecast vs execution, no-data/core/reserve failures, strategy replay vs native counters, ordered waypoints, partial swap time, executed exposure, seeded fairness, repeated runs, batch distributions and cancellation.');
}
checks().catch(error=>{console.error(error);process.exitCode=1;});
