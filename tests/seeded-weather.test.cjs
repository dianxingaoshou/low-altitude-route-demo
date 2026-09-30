const assert=require('node:assert/strict'),SW=require('../seeded-weather.js'),M=require('../model.js'),F=require('../flight-engine.js'),W=require('../weather-physics.js');
const near=(a,b,t=1e-6)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const options={time:7,seed:31415,sources:['radar','profiler','station']};
const a=W.decorate(M.buildField(options)),b=W.decorate(M.buildField(options)),c=W.decorate(M.buildField({...options,seed:92653}));
assert.deepEqual(a.field,b.field);assert.notDeepEqual(a.field,c.field);assert.notDeepEqual(a.field.windU,c.field.windU);
for(let i=0;i<a.field.length;i++)near(a.field.variance[i]*1.5,a.field[i]);
const event=SW.cell(31415,2);near(SW.envelope(event,event.start),0);near(SW.envelope(event,event.end),0);near(SW.envelope(event,(event.start+event.end)/2),1);assert.ok(event.end-event.start>=10&&event.end-event.start<=20);
const t=(event.start+event.end)/2,k=SW.reference(event.x,event.y,300,t,31415),k2=SW.reference(event.x+.001,event.y,300,t+.001,31415);assert.ok(Math.abs(k-k2)<.01,'Weather varies continuously');
let mean=[0,0,0],sq=[0,0,0];const n=2000;
for(let seed=0;seed<n;seed++){const q=SW.wind(5,3,7,seed,1.5),d=[q.u-q.meanU,q.v-q.meanV,q.w];d.forEach((v,j)=>{mean[j]+=v/n;sq[j]+=v*v/n;});}
for(let j=0;j<3;j++){assert.ok(Math.abs(mean[j])<.1);assert.ok(Math.abs(sq[j]-mean[j]**2-1)<.12,'Random phase ensemble variance follows 2K/3');}
const f=new F.Flight();f.configure({dynamic:false,capacity:600});f.addWaypoint({x:25,y:25});f.run();f.tick(5);f.gust('moderate');const before={position:{...f.position},elapsed:f.elapsed,charge:f.remainingWh,energy:f.usedWh,gusts:JSON.stringify(f.gusts),points:JSON.stringify(f.waypoints)};f.refreshWeather(73);assert.deepEqual(f.position,before.position);near(f.elapsed,before.elapsed);near(f.remainingWh,before.charge);near(f.usedWh,before.energy);assert.equal(JSON.stringify(f.gusts),before.gusts);assert.equal(JSON.stringify(f.waypoints),before.points);assert.equal(f.data.seed,73);assert.ok(f.decision);assert.match(f.decision.detail,/阵风|无可行/);assert.equal(f.snapshot().weather.seed,73);
const preview=new F.Flight(),clock=preview.clock;preview.previewWeather(2);near(preview.clock,clock+2);near(preview.elapsed,0);near(preview.usedWh,0);
const exp=new F.Flight();exp.configure({dynamic:false,capacity:600});exp.gust('moderate');exp.run();const end=exp.gusts[0].endAt;exp.tick(end);assert.equal(exp.data.field.events.length,0,'Effect must disappear at exact event end');near(exp.elapsed,end);assert.ok(exp.logs.some(l=>l.text.includes('阵风已结束')));while(exp.status==='running'||exp.status==='swapping')exp.tick(10);assert.equal(exp.status,'arrived');near(exp.elapsed,exp.flightSeconds+exp.swapElapsed);
const g={...W.TYPES.strong,x:10,y:10,u:-18,v:0,endAt:240};near(W.activeEvents([g],180)[0].envelope,1);near(W.activeEvents([g],210)[0].envelope,.5);assert.equal(W.activeEvents([g],240).length,0);
const dynamic=new F.Flight();dynamic.run();dynamic.tick(2);const time=dynamic.clock;dynamic.configure({dynamic:false});dynamic.tick(30);near(dynamic.clock,time);dynamic.configure({dynamic:true});dynamic.tick(2);assert.ok(dynamic.clock>time);
console.log('PASS: seeded reproducibility/random variation; continuous weather and bounded lifetimes; variance linked to TKE and ensemble check; refresh preserves mission/charge/time/manual gust; weather preview; exact manual expiry/replan; continuous clock when toggled.');

// At off-grid coordinates, velocity must use the local K amplitude, not a
// blend of velocity samples that silently reduces fluctuation variance.
for(const p of [{x:15,y:20},{x:15.43,y:20.28}]){const d=W.diagnostics(a.field,p),expected=SW.wind(p.x*M.STEP,p.y*M.STEP,a.time,a.seed,d.tke),q=W.point(a.field,p);near(d.instantaneous.u,expected.u);near(d.instantaneous.v,expected.v);near(q.u,d.instantaneous.u);near(q.v,d.instantaneous.v);near(d.tke_from_variances,d.tke);near(d.sigma**2,d.tke*2/3);near(d.mean.u+d.fluctuation.u,d.instantaneous.u);near(d.mean.v+d.fluctuation.v,d.instantaneous.v);}
const high=SW.wind(3,4,7,15,2),low=SW.wind(3,4,7,15,.5);near(high.meanU,low.meanU);near(high.meanV,low.meanV);near(high.fluctU,2*low.fluctU);near(high.fluctV,2*low.fluctV);near(high.fluctW,2*low.fluctW);
const empty=W.decorate(M.buildField({sources:[]}));assert.equal(W.diagnostics(empty.field,{x:20.5,y:16.3}).available,false);
console.log('PASS: same-point wind/TKE coupling at grid and fractional positions; vector decomposition; fourfold K doubles fluctuation amplitude; missing-data diagnostics.');
