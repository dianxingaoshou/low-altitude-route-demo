/* Candidate explanations and controlled, frozen-weather mission comparisons. */
(function(root){
  'use strict';const M=root.DemoModel,W=root.WeatherPhysics;
  const STRATEGIES=[{id:'distance',name:'距离优先'},{id:'energy',name:'能耗优先'},{id:'turbulence',name:'湍流暴露优先'},{id:'composite',name:'综合规划'}];
  const F=()=>root.FlightModel;
  const xy=p=>({x:p.x,y:p.y});
  function capture(sim,extra={}){
    return {version:1,source:'教学合成场',task_elapsed_s:sim.elapsed,status:sim.status,
      cfg:{...sim.cfg,sources:[...sim.cfg.sources]},start:xy(sim.position),end:xy(sim.end),
      waypoints:sim.waypoints.slice(sim.nextWaypoint).map(xy),battery_Wh:sim.remainingWh,
      pending_swap_s:sim.swapRemaining,weather_min:sim.data.time,weather_clock_min:sim.clock,
      gusts:sim.gusts.map(g=>({...g})),
      original_legs:(extra.originalLegs||[]).map(l=>({path:l.path.map(xy),target:{...l.target},swap:!!l.swap})),
      before:extra.before?{...extra.before,profile:undefined}:null};
  }
  function dataAt(input,delta=0,seed=input.cfg.seed){
    const time=delta?input.weather_clock_min+(input.cfg.dynamic?delta/60*4:0):input.weather_min;
    return W.decorate(M.buildField({altitude:300,time,seed,sources:input.cfg.sources}),input.gusts,input.task_elapsed_s+delta);
  }
  function freezeData(data){
    const field=data.field.slice();for(const key of Object.keys(data.field))if(!/^\d+$/.test(key))field[key]=data.field[key];
    field.events=(data.field.events||[]).map(g=>({...g,endAt:undefined}));return {...data,field};
  }
  function pointReason(field,p,cfg,direction){
    if(p.x<0||p.y<0||p.x>M.NX-1||p.y>M.NY-1)return '超出教学飞行区域';
    const q=W.point(field,p);if(!Number.isFinite(q.value))return '当前位置缺少有效观测';
    const core=(field.events||[]).find(g=>g.core&&Math.hypot(p.x-g.x,p.y-g.y)*M.STEP<=g.radius*g.core+W.BUFFER);
    if(core)return `进入 ${core.id} 强风核心及安全缓冲区`;
    const wind=Math.hypot(q.u,q.v);if(wind>=W.LIMIT)return `风速 ${wind.toFixed(1)} m/s ≥ ${W.LIMIT} m/s`;
    if(cfg.hard&&q.value>=M.LIMIT)return `TKE ${q.value.toFixed(2)} ≥ ${M.LIMIT} m²/s²`;
    if(direction){const n=Math.hypot(direction.x,direction.y);if(n){const cross=Math.abs(q.u*direction.y-q.v*direction.x)/n,along=(q.u*direction.x+q.v*direction.y)/n;
      if(cross>=cfg.speed)return `侧风 ${cross.toFixed(1)} m/s 无法由 ${cfg.speed} m/s 空速补偿`;
      const speed=Math.sqrt(cfg.speed**2-cross**2)+along;if(speed<3)return `预计地速 ${speed.toFixed(1)} m/s < 3 m/s`;}}
    return null;
  }
  function unsafeSegment(field,a,b,cfg){
    const direction={x:b.x-a.x,y:b.y-a.y},steps=Math.max(1,Math.ceil(Math.hypot(direction.x,direction.y)*M.STEP/.05));
    for(let i=0;i<=steps;i++){const point={x:a.x+direction.x*i/steps,y:a.y+direction.y*i/steps},reason=pointReason(field,point,cfg,direction);if(reason)return {reason,point,from:xy(a),to:xy(b)};}
    const e=W.edge(W.point(field,a),W.point(field,b),cfg);return e.flyable?null:{reason:'航段平均风况不满足地速或侧风限制',point:xy(a),from:xy(a),to:xy(b)};
  }
  function failureReason(input,field,cfg=input.cfg,battery=input.battery_Wh){
    if(!cfg.sources.length)return '没有有效观测来源，不能判断天气或规划';
    let reason=pointReason(field,input.start,cfg);if(reason)return '出发位置不可执行：'+reason;
    for(const [i,p]of [...input.waypoints,input.end].entries()){reason=pointReason(field,p,cfg);if(reason)return (i<input.waypoints.length?'必经任务点 '+(i+1):'目的地')+' 不可到达：'+reason;}
    if(battery<cfg.capacity*cfg.reserve/100-1e-7)return '当前电量已低于保留电量，无法出发';
    // A geometry-only check separates a weather cut-off from an energy-network failure.
    const geometry=F().planMission(field,{...cfg,strategy:'distance',capacity:1e9,reserve:0,stationsEnabled:false},input.start,input.end,input.waypoints,1e9);
    return geometry?'有安全航路，但当前电量、保留电量和换电站无法组成可完成任务的补能链':'风况或强风核心阻断安全通道，无法依次到达任务点与目的地';
  }
  function measureLegs(legs,input,field,battery=input.pending_swap_s>0?input.cfg.capacity:input.battery_Wh){
    let distance=0,energy=0,flight=0,dose=0,swaps=input.pending_swap_s>0?1:0,swapTime=input.pending_swap_s,segment=0,minBattery=battery;
    for(let j=0;j<legs.length;j++){
      const l=legs[j];for(let i=1;i<l.path.length;i++){segment++;const unsafe=unsafeSegment(field,l.path[i-1],l.path[i],input.cfg);if(unsafe)return {feasible:false,reason:`航段 ${segment}（任务段 ${j+1}）超限：${unsafe.reason}`,first_unsafe:{...unsafe,segment,leg:j+1},metrics:null};}
      const m=F().routeMetrics(W.annotate(l.path,field,input.cfg),input.cfg);if(!m)return {feasible:false,reason:'缺少可检查的航路',metrics:null};
      battery-=m.energyWh;minBattery=Math.min(minBattery,battery);
      if(battery<input.cfg.capacity*input.cfg.reserve/100-1e-7)return {feasible:false,reason:`到达 ${l.target?.id||'任务点'} 前电量仅 ${battery.toFixed(1)} Wh，低于保留 ${input.cfg.capacity*input.cfg.reserve/100} Wh`,metrics:null};
      distance+=m.length;energy+=m.energyWh;flight+=m.timeMinutes*60;dose+=m.dose;
      if(l.swap){battery=input.cfg.capacity;swaps++;swapTime+=input.cfg.swapSeconds;}
    }
    return {feasible:true,reason:'所有航段通过风况与逐段电量检查',metrics:{distance_km:distance,energy_Wh:energy,flight_s:flight,wait_s:0,swap_s:swapTime,total_s:flight+swapTime,tke_exposure:dose,swap_count:swaps,arrival_Wh:battery,min_battery_Wh:minBattery}};
  }
  function forecastWait(input,initialData){
    if(input.pending_swap_s>0)return {feasible:false,can_hold:false,not_applicable:true,reason:'正在地面换电，先完成换电后重新规划，无需空中悬停等待',wait_s:0,wait_energy_Wh:0};
    const events=input.gusts.filter(g=>g.endAt>input.task_elapsed_s+1e-8);
    if(!events.length)return {feasible:false,can_hold:false,not_applicable:true,reason:'没有可等待消散的手动阵风',wait_s:0,wait_energy_Wh:0};
    let data=initialData,seconds=0,energy=0,battery=input.battery_Wh;const reserve=input.cfg.capacity*input.cfg.reserve/100;
    const until=Math.max(...events.map(g=>g.endAt))-input.task_elapsed_s;
    while(seconds<until-1e-8){
      const reason=pointReason(data.field,input.start,input.cfg);if(reason)return {feasible:false,can_hold:false,reason:'不能安全保持位置：'+reason,wait_s:seconds,wait_energy_Wh:energy};
      const w=W.windSample(data.field,input.start),power=W.hoverPower(w.tke,input.cfg,Math.hypot(w.u,w.v),W.sample(data.field.gust,input.start));
      const deadline=Math.min(until,...events.map(g=>g.endAt-input.task_elapsed_s).filter(t=>t>seconds+1e-8)),dt=Math.min(20,deadline-seconds);
      const used=power*dt/3600;if(!Number.isFinite(used)||battery-used<reserve-1e-7)return {feasible:false,can_hold:false,reason:'等待期间预计会触及保留电量，不能支撑该等待方案',wait_s:seconds+dt,wait_energy_Wh:energy+used};
      battery-=used;energy+=used;seconds+=dt;data=dataAt(input,seconds);
      if(Math.abs(seconds-deadline)<1e-7){
        const mission=F().planMission(data.field,input.cfg,input.start,input.end,input.waypoints,battery);
        if(mission){const result=measureLegs(mission.legs,{...input,battery_Wh:battery},data.field,battery);
          if(result.feasible)return {...result,can_hold:true,wait_s:seconds,wait_energy_Wh:energy,reason:'预计可等待至阵风消散并恢复航路；等待期间持续复核',metrics:{...result.metrics,wait_s:seconds,total_s:result.metrics.total_s+seconds,energy_Wh:result.metrics.energy_Wh+energy}};}
      }
    }
    return {feasible:false,can_hold:true,reason:'预计能安全等待至阵风结束，但该时刻仍没有满足电量与任务约束的后续航路',wait_s:seconds,wait_energy_Wh:energy};
  }
  function assess(input){
    const data=dataAt(input),field=data.field,original=input.original_legs.length?measureLegs(input.original_legs,input,field):{feasible:false,reason:'没有可复核的原航线',metrics:null};
    const battery=input.pending_swap_s>0?input.cfg.capacity:input.battery_Wh;
    const mission=F().planMission(field,input.cfg,input.start,input.end,input.waypoints,battery);
    const reroute=mission?measureLegs(mission.legs,input,field):{feasible:false,reason:failureReason(input,field,input.cfg,battery),metrics:null};
    if(reroute.feasible&&input.before){const oldSwaps=input.original_legs.filter(l=>l.swap).length,oldTime=input.before.timeMinutes*60+oldSwaps*input.cfg.swapSeconds+input.pending_swap_s;
      reroute.delta={distance_km:reroute.metrics.distance_km-input.before.length,total_s:reroute.metrics.total_s-oldTime,energy_Wh:reroute.metrics.energy_Wh-input.before.energyWh};}
    const wait=forecastWait(input,data);
    const recommended=original.feasible?'继续原航线或按新代价调整':reroute.feasible?'绕行并按新换电计划执行':wait.feasible?'在安全位置等待后重新规划':'当前没有预计可完成任务的方案';
    return {trigger_s:input.task_elapsed_s,seed:input.cfg.seed,weather_min:input.weather_min,original,reroute,wait,recommended,
      notes:'原航线与绕行按触发时同一风场检查；增量相对注入前计划。等待按未来 20 秒步长估算，恢复后的航路按该时刻天气规划，仍需执行中复核。'};
  }
  function replay(input,data,strategy){
    const cfg={...input.cfg,strategy:strategy.id,dynamic:false,time:input.weather_min};
    const sim=new (F().Flight)({cfg,start:input.start,end:input.end,waypoints:input.waypoints,
      frozenData:freezeData(data),batteryWh:input.pending_swap_s>0?cfg.capacity:input.battery_Wh});
    const path=sim.fullPath.map(xy);
    const row={seed:cfg.seed,strategy:strategy.id,method:strategy.name,completed:false,status:'不可完成',reason:'',distance_km:null,total_s:null,energy_Wh:null,tke_exposure:null,swap_count:null,arrival_Wh:null,path};
    if(!sim.feasible){row.reason=failureReason(input,data.field,cfg,sim.remainingWh);return row;}
    if(input.start.x===input.end.x&&input.start.y===input.end.y&&!input.waypoints.length){Object.assign(row,{completed:true,status:'完成',distance_km:0,total_s:input.pending_swap_s,energy_Wh:0,tke_exposure:0,swap_count:input.pending_swap_s>0?1:0,arrival_Wh:sim.remainingWh});return row;}
    sim.run();let steps=0;while(['running','swapping'].includes(sim.status)&&steps++<10000)sim.tick(60);
    if(sim.status!=='arrived'){row.reason=sim.reason||'回放未能完成任务';return row;}
    const total=sim.elapsed+input.pending_swap_s;
    const actualPath=[...sim.trail,sim.position].map(xy),actual=F().routeMetrics(W.annotate(actualPath,data.field,cfg),cfg);
    Object.assign(row,{completed:true,status:'完成',reason:'冻结天气下回放到达终点，满足逐段电量和任务顺序',distance_km:sim.travelKm,total_s:total,energy_Wh:sim.usedWh,tke_exposure:actual?.dose||0,swap_count:sim.completedSwaps+(input.pending_swap_s>0?1:0),arrival_Wh:sim.remainingWh,path:actualPath});return row;
  }
  function percentile(values,p){if(!values.length)return null;const a=[...values].sort((x,y)=>x-y),x=(a.length-1)*p,i=Math.floor(x);return a[i]+(a[Math.ceil(x)]-a[i])*(x-i);}
  function distribution(values){return {n:values.length,median:percentile(values,.5),q1:percentile(values,.25),q3:percentile(values,.75),min:values.length?Math.min(...values):null,max:values.length?Math.max(...values):null};}
  function summary(rows){return STRATEGIES.map(strategy=>{const all=rows.filter(r=>r.strategy===strategy.id),ok=all.filter(r=>r.completed),out={strategy:strategy.id,method:strategy.name,cases:all.length,completed:ok.length,completion_rate:all.length?ok.length/all.length:null};for(const key of ['distance_km','total_s','energy_Wh','tke_exposure','swap_count'])out[key]=distribution(ok.map(r=>r[key]));return out;});}
  async function run(input,count=1,{progress=()=>{},cancelled=()=>false}={}){
    if(!Number.isInteger(count)||count<1||count>50)throw Error('样本数必须为 1–50');
    const rows=[];for(let i=0;i<count;i++){
      if(cancelled())break;const seed=(input.cfg.seed+i)>>>0,current={...input,cfg:{...input.cfg,seed}},data=dataAt(current),seedRows=[];
      for(const strategy of STRATEGIES){if(cancelled())break;seedRows.push(replay(current,data,strategy));await new Promise(resolve=>setTimeout(resolve,0));}
      if(seedRows.length!==STRATEGIES.length)break;rows.push(...seedRows);progress({processed:i+1,total:count,rows:[...rows]});
    }
    return {version:1,mode:'frozen_weather_replay',input,requested_samples:count,processed_samples:rows.length/STRATEGIES.length,cancelled:cancelled(),rows,summary:summary(rows),
      boundary:'相同天气、剩余任务、电池、载荷、速度与安全约束；只改变路径代价。天气全程冻结，不注入新阵风，不执行等待。失败不参与成功样本的指标分布。'};
  }
  function csv(result){const headers=['seed','method','completed','distance_km','total_s','energy_Wh','tke_exposure','swap_count','arrival_Wh','reason'];const cell=v=>v===null||v===undefined?'':typeof v==='boolean'?(v?'1':'0'):'"'+String(v).replace(/"/g,'""')+'"';return [headers.join(','),...result.rows.map(row=>headers.map(k=>cell(row[k])).join(','))].join('\r\n')+'\r\n';}
  const api={STRATEGIES,capture,dataAt,freezeData,pointReason,unsafeSegment,failureReason,measureLegs,forecastWait,assess,replay,summary,run,csv};root.MissionAnalysis=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
