const assert=require('node:assert/strict');
require('../model.js');
const F=require('../flight-engine.js'),W=require('../weather-physics.js');
const near=(a,b,t=1e-6)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
function validate(f){
  const rows=f.telemetry.rows(f);assert.ok(rows.length>1);near(rows[0].time_s,0);near(rows.at(-1).time_s,f.elapsed);
  let integrated=0;
  rows.forEach((row,i)=>{
    near(row.time_s,row.flight_time_s+row.wait_time_s+row.swap_time_s);
    near(row.battery_pct,row.battery_Wh/f.cfg.capacity*100);
    if(i){const prev=rows[i-1],dt=row.time_s-prev.time_s;assert.ok(dt>=-1e-7);assert.ok(row.energy_used_Wh>=prev.energy_used_Wh-1e-7);integrated+=dt*(row.power_W+prev.power_W)/2/3600;}
    if(row.status==='waiting')assert.equal(row.ground_speed_mps,0);
    if(row.status==='swapping'){assert.equal(row.ground_speed_mps,0);assert.equal(row.power_W,0);}
  });
  near(rows.at(-1).energy_used_Wh,f.usedWh);near(rows.at(-1).battery_Wh,f.remainingWh);
  near(integrated,f.usedWh,1e-5);
  // Every whole task second remains available, including long ticks and swaps.
  const seconds=new Set(rows.filter(r=>Math.abs(r.time_s-Math.round(r.time_s))<1e-6).map(r=>Math.round(r.time_s)));
  for(let t=0;t<=Math.floor(f.elapsed);t++)assert.ok(seconds.has(t),`Missing task second ${t}`);
  return rows;
}

let baseline;
for(const dt of [0.17,7.3,50]){
  const f=new F.Flight();f.configure({dynamic:false,capacity:600,stationsEnabled:false});f.setPoint('end',{x:10,y:20});
  assert.equal(f.telemetry.rows(f).length,1);assert.equal(f.telemetry.rows(f)[0].power_W,0);
  f.run();while(f.status==='running')f.tick(dt);assert.equal(f.status,'arrived');validate(f);
  if(baseline){near(f.elapsed,baseline.elapsed);near(f.usedWh,baseline.usedWh);}else baseline=f;
}

// A real completed relay retains both sides of the instantaneous battery replacement.
const relay=new F.Flight();relay.configure({dynamic:false});relay.run();
while(['running','swapping'].includes(relay.status))relay.tick(37.7);
assert.equal(relay.status,'arrived');const relayRows=validate(relay);
assert.ok(relayRows.some((r,i)=>i&&Math.abs(r.time_s-relayRows[i-1].time_s)<1e-7&&r.battery_Wh>relayRows[i-1].battery_Wh+1));
assert.ok(relay.telemetry.events.some(e=>e.type==='swap'&&e.label.includes('开始换电')));
assert.ok(relay.telemetry.events.some(e=>e.type==='swap'&&e.label.includes('换电完成')));
near(relay.elapsed,1029.349653524449,0.01);

// Pause and playback settings never add task time, then live speed changes stay on the same timeline.
const live=new F.Flight();live.configure({dynamic:false,capacity:600});live.run();live.tick(5.3);live.pause();
const elapsed=live.elapsed,battery=live.remainingWh,count=live.telemetry.samples.length;
live.tick(90);near(live.elapsed,elapsed);near(live.remainingWh,battery);assert.equal(live.telemetry.samples.length,count);
live.cfg.playback=40;live.run();live.configure({speed:15});live.tick(20.7);validate(live);
assert.ok(live.telemetry.rows(live).some(r=>r.cruise_setpoint_mps===15));
const local=live.telemetry.rows(live).at(-1),w=W.diagnostics(live.data.field,live.position);
near(local.wind_speed_mps,w.horizontal_speed);near(local.tke_m2ps2,w.tke);

const hold=new F.Flight();hold.configure({dynamic:false});hold.run();hold.tick(5);hold.gust('wide');
assert.equal(hold.status,'blocked');assert.ok(hold.waitOutGust().allowed);hold.tick(60);hold.pause();hold.tick(50);hold.run();hold.tick(180);
assert.equal(hold.status,'running');const holdRows=validate(hold),waiting=holdRows.filter(r=>r.status==='waiting');
assert.ok(waiting.length>=240);assert.ok(waiting.some(r=>r.power_W>0));
near(waiting[0].latitude_deg,waiting.at(-1).latitude_deg);near(waiting[0].longitude_deg,waiting.at(-1).longitude_deg);
assert.ok(waiting.at(-1).battery_Wh<waiting[0].battery_Wh);
for(const type of ['gust','wait','replan','control'])assert.ok(hold.telemetry.events.some(e=>e.type===type));
assert.ok(hold.telemetry.events.some(e=>e.type==='gust'&&e.label.includes('结束')));

const snap=hold.snapshot();assert.equal(snap.version,7);assert.equal(snap.flight_history.sample_interval_s,1);
assert.equal(snap.flight_history.samples.length,holdRows.length);
const csv=hold.telemetry.csv(hold),lines=csv.trim().split('\r\n');assert.equal(lines.length,holdRows.length+1);
assert.match(lines[0],/^time_s,status,cruise_setpoint_mps,ground_speed_mps,power_W/);
assert.ok(csv.includes('阵风'));assert.ok(csv.includes('等待'));
const readCount=hold.telemetry.samples.length;hold.snapshot();hold.telemetry.csv(hold);assert.equal(hold.telemetry.samples.length,readCount);
hold.reset();assert.equal(hold.elapsed,0);assert.equal(hold.telemetry.rows(hold).length,1);assert.equal(hold.telemetry.events.length,1);

// Missing observations are blank, not NaN, in an export.
const noData=new F.Flight();noData.configure({sources:[]});assert.equal(noData.telemetry.rows(noData)[0].tke_m2ps2,null);
assert.ok(!noData.telemetry.csv(noData).includes('NaN'));
console.log('PASS: full flight history; one-second coverage and exact power integral for fractional/large ticks; unchanged mission ETA/energy; swaps with battery jumps; safe wait, pause, speed change, event timestamps, local weather, CSV/JSON and reset.');
