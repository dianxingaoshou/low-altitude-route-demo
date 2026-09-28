/* 2-D teaching simulator: ordered waypoints, battery-swap network, rolling routing. */
(function(root){
  'use strict';const M=root.DemoModel,W=root.WeatherPhysics||(typeof require!=='undefined'?require('./weather-physics.js'):null);
  const DEFAULTS={altitude:300,time:0,seed:20260923,lambda:8,energyWeight:2,hard:false,sources:['radar','profiler','station'],payload:1,capacity:220,charge:95,reserve:20,speed:12,basePower:650,playback:20,dynamic:true,stationsEnabled:true,swapSeconds:120},MAX_GUSTS=8;
  const STATIONS=[{id:'S1',name:'西部换电站',x:17,y:18},{id:'S2',name:'中心换电站',x:31,y:25},{id:'S3',name:'东部换电站',x:46,y:18}];
  const origin={lat:30.145,lng:120.210},latMeters=111320,lonMeters=111320*Math.cos(30.181*Math.PI/180),CELL=M.STEP*1000;
  const toLatLng=p=>[origin.lat+p.y*CELL/latMeters,origin.lng+p.x*CELL/lonMeters];
  const fromLatLngExact=ll=>({x:(ll.lng-origin.lng)*lonMeters/CELL,y:(ll.lat-origin.lat)*latMeters/CELL});
  const fromLatLng=ll=>({x:Math.round((ll.lng-origin.lng)*lonMeters/CELL),y:Math.round((ll.lat-origin.lat)*latMeters/CELL)});
  const same=(a,b)=>a.x===b.x&&a.y===b.y;
  const valid=p=>p&&Number.isInteger(p.x)&&Number.isInteger(p.y)&&p.x>=0&&p.y>=0&&p.x<M.NX&&p.y<M.NY;
  function power(tke,cfg){return W.power(tke,cfg);}
  function energy(a,b,d,cfg){return power((a+b)/2,cfg)*d*1000/cfg.speed/3600;}
  function cost(a,b,d,cfg){return M.edgeCost(a,b,d,cfg.lambda)+cfg.energyWeight*energy(a,b,d,cfg)/20;}
  function routeMetrics(path,cfg){const m=M.metrics(path,cfg.lambda);if(!m)return null;let wh=0,j=0,seconds=0;for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i],d=M.STEP*Math.hypot(a.x-b.x,a.y-b.y),e=b.segment||W.edge(a,b,cfg),dt=d*1000/Math.max(.01,e.groundSpeed),en=e.powerW*dt/3600;wh+=en;seconds+=dt;j+=M.edgeCost(a.value,b.value,d,cfg.lambda)+cfg.energyWeight*en/20;}return {...m,energyWh:wh,cost:j,timeMinutes:seconds/60};}
  function flatten(legs){return legs.flatMap((l,i)=>i?l.path.slice(1):l.path);}
  // Pareto labels on the small station/waypoint graph. Each edge offers a
  // weighted A* path and a minimum-energy path, rather than all possible paths.
  function planMission(field,cfg,from,end,waypoints,battery){
    if(!W.safePoint(field,from,cfg))return null;
    const stations=cfg.stationsEnabled?STATIONS:[],cache=new Map(),reserve=cfg.capacity*cfg.reserve/100,edges=new Map(),nodes=Array.from({length:field.length},(_,i)=>W.point(field,{x:i%M.NX,y:Math.floor(i/M.NX)}));
    function gridEdge(u,v){const key=u*field.length+v;if(!edges.has(key)){const e=W.edge(nodes[u],nodes[v],cfg);e.safe=e.flyable&&W.safeSegment(field,nodes[u],nodes[v],cfg);edges.set(key,e);}return edges.get(key);}
    function routes(a,b){const key=`${a.x},${a.y}:${b.x},${b.y}`;if(cache.has(key))return cache.get(key);const opts={start:a,end:b};
      const choices=[];const starts=[];for(const x of new Set([Math.floor(a.x),Math.ceil(a.x)]))for(const y of new Set([Math.floor(a.y),Math.ceil(a.y)]))starts.push({x,y});
      for(const start of starts){if(!W.safeSegment(field,a,start,cfg))continue;for(const energyOnly of [false,true]){
        const p=M.plan(field,cfg.lambda,cfg.hard,!energyOnly,{...opts,start,allowed:i=>!field.blocked?.[i],edgeAllowed:(u,v)=>gridEdge(u,v).safe,cost:(x,y,d,u,v)=>{const e=gridEdge(u,v);return energyOnly?e.energyWh:M.edgeCost(x,y,d,cfg.lambda)+cfg.energyWeight*e.energyWh/20;}}).path;
        if(p){const path=W.annotate(same(a,start)?p:[a,...p],field,cfg);choices.push({path,metrics:routeMetrics(path,cfg)});}
      }}
      const paths=[];if(choices.length){const byCost=[...choices].sort((a,b)=>a.metrics.cost-b.metrics.cost)[0],byEnergy=[...choices].sort((a,b)=>a.metrics.energyWh-b.metrics.energyWh)[0];paths.push(byCost);if(byEnergy.metrics.energyWh<byCost.metrics.energyWh-1e-7)paths.push(byEnergy);}
      cache.set(key,paths);return paths;
    }
    const labels=new Map(),queue=[];let seq=0;
    function push(label){const key=`${label.point.x},${label.point.y}|${label.progress}`,list=labels.get(key)||[];
      if(list.some(l=>l.score<=label.score+1e-9&&l.battery>=label.battery-1e-9))return;
      for(const l of list)if(label.score<=l.score+1e-9&&label.battery>=l.battery-1e-9)l.dead=true;
      label.seq=seq++;labels.set(key,[...list.filter(l=>!l.dead),label]);queue.push(label);
    }
    push({point:from,progress:0,battery,score:0,legs:[]});
    while(queue.length){queue.sort((a,b)=>a.score-b.score||a.seq-b.seq);const cur=queue.shift();if(cur.dead)continue;
      if(cur.progress===waypoints.length&&same(cur.point,end))return {legs:cur.legs,score:cur.score,arrivalWh:cur.battery};
      const goal=cur.progress<waypoints.length?{...waypoints[cur.progress],type:'waypoint',id:'W'+(cur.progress+1)}:{...end,type:'end',id:'B'};
      for(const target of [goal,...stations.map(s=>({...s,type:'station'}))]){
        if(target.type==='station'&&same(cur.point,target)&&cur.battery>=cfg.capacity-1e-7)continue;
        for(const route of routes(cur.point,target)){
          const left=cur.battery-route.metrics.energyWh;if(left<reserve-1e-7)continue;
          const swap=target.type==='station';let progress=cur.progress;
          while(progress<waypoints.length&&same(target,waypoints[progress]))progress++;
          // A destination coincident with a station is delivered without an unnecessary swap.
          const actuallySwap=swap&&!(progress===waypoints.length&&same(target,end));
          const leg={...route,target,swap:actuallySwap};
          push({point:target,progress,battery:actuallySwap?cfg.capacity:left,score:cur.score+route.metrics.cost+(actuallySwap?cfg.swapSeconds*cfg.speed/1000:0),legs:[...cur.legs,leg]});
        }
      }
    }
    return null;
  }
  class Flight{
    constructor(){this.cfg={...DEFAULTS,sources:[...DEFAULTS.sources]};this.start={...M.START};this.end={...M.END};this.waypoints=[];this.reset();}
    reset(){this.status='ready';this.elapsed=0;this.weatherElapsed=0;this.flightSeconds=0;this.holdSeconds=0;this.holdEnergyWh=0;this.swapElapsed=0;this.completedSwaps=0;this.swaps=[];this.swapRemaining=0;this.activeStation=null;this.resumeStatus=null;this.waitUntil=null;this.usedWh=0;this.batteryWh=this.cfg.capacity*this.cfg.charge/100;this.travelKm=0;this.node={...this.start};this.position={...this.start};this.trail=[{...this.start}];this.replans=0;this.fieldRevision=0;this.logs=[];this.lastReplan=-1e9;this.lastField=-1e9;this.pending=false;this.index=0;this.edgeProgress=0;this.gusts=[];this.nextGustId=1;this.gustReferencePath=null;this.decision=null;this.nextWaypoint=0;this.visits=[];this.path=null;this.itinerary=[];this.replan('初始化任务');}
    get remainingWh(){return Math.max(0,this.batteryWh);}
    get reserveWh(){return this.cfg.capacity*this.cfg.reserve/100;}
    get clock(){return this.cfg.time+(this.weatherElapsed||0);}
    log(text){this.logs.unshift({at:this.elapsed,text});}
    activeGusts(){return this.gusts.filter(g=>Number.isFinite(g.endAt)&&g.endAt>this.elapsed+1e-8);}
    canInjectGust(){return !['arrived','waiting'].includes(this.status)&&this.resumeStatus!=='waiting'&&this.activeGusts().length<MAX_GUSTS&&(this.remainingPath().length>=2||this.gustReferencePath?.length>=2);}
    updateField(){this.data=W.decorate(M.buildField({altitude:300,time:this.clock,seed:this.cfg.seed,sources:this.cfg.sources}),this.gusts,this.elapsed);this.fieldRevision++;this.lastField=this.elapsed;}
    markWaypoints(){let changed=false;while(this.nextWaypoint<this.waypoints.length&&same(this.node,this.waypoints[this.nextWaypoint])){this.visits.push({index:this.nextWaypoint,at:this.elapsed,point:{...this.node}});this.log('已到达途经点 W'+(this.nextWaypoint+1));this.nextWaypoint++;changed=true;}return changed;}
    replan(reason='滚动更新'){
      if(this.elapsed>0&&!same(this.trail[this.trail.length-1],this.node))this.trail.push({...this.node});
      this.previousPath=this.fullPath?.map(p=>({...p}))||null;this.markWaypoints();this.updateField();
      const mission=planMission(this.data.field,this.cfg,this.node,this.end,this.waypoints.slice(this.nextWaypoint),this.remainingWh);
      this.itinerary=mission?.legs||[];this.path=this.itinerary[0]?.path||null;this.fullPath=flatten(this.itinerary);this.metrics=routeMetrics(this.fullPath.length?this.fullPath:null,this.cfg);this.feasible=!!mission;
      this.planMode=mission?(this.itinerary.some(l=>l.swap)?'换电接力':'直达 / 途经'):'不可执行';
      this.reason=mission?null:!this.cfg.sources.length?'没有观测数据，无法规划。':this.data.field.events.length?'阵风、必经任务点与电量约束下无可行避险航路。保护停演：清除阵风或重置修改任务；这不是实际悬停。':'当前风况、电量与换电站无法构成可行航路，请增加电量、减载或调整途经点。';
      let from=this.node,baseline=[];for(const p of [...this.waypoints.slice(this.nextWaypoint),this.end]){const start={x:Math.round(from.x),y:Math.round(from.y)},path=M.plan(this.data.field,0,false,true,{start,end:p}).path;if(!path){baseline=[];break;}if(!baseline.length&&!same(start,from))baseline.push(W.point(this.data.field,from));baseline.push(...(baseline.length?path.slice(same(start,from)?1:0):path));from=p;}
      this.baseline=baseline;this.baselineMetrics=routeMetrics(baseline.length?baseline:null,this.cfg);
      this.index=0;this.edgeProgress=0;this.position={...this.node};this.lastReplan=this.elapsed;this.pending=false;this.replans++;
      if(!mission&&(this.elapsed>0||this.status==='running'))this.status='blocked';
      if(this.decision){if(!mission){this.decision.action='无可行路线 · 保护停演';this.decision.detail=this.reason;}else if(this.decision.action==='换电后避险'){this.decision.action='换电完成 · 已更新避险航路';this.decision.detail='已用最新风场与满电电池重新校验剩余任务。';}}
      this.log(`${reason} · ${mission?this.planMode+' / 预计再换电 '+this.itinerary.filter(l=>l.swap).length+' 次':this.reason}`);
    }
    configure(patch){if(Object.keys(patch).length===1&&'speed'in patch){const speed=Number(patch.speed);if(!Number.isFinite(speed)||speed<5||speed>20)throw Error('巡航空速需在 5–20 m/s。');if(this.status==='arrived')throw Error('任务已到达，请重置后调速。');this.cfg.speed=speed;if(this.status==='waiting'||this.resumeStatus==='waiting'||this.swapRemaining>0){this.pending=true;this.log('巡航空速改为 '+speed+' m/s；当前等待结束后重规划');return;}const blocked=this.status==='blocked';this.node={...this.position};this.replan('巡航空速调整为 '+speed+' m/s');if(blocked&&this.feasible)this.status='paused';return;}const locked=['payload','capacity','charge','reserve','basePower','altitude','stationsEnabled','swapSeconds'];if((this.elapsed>0||['running','swapping'].includes(this.status))&&locked.some(k=>k in patch))throw Error('请重置任务后调整机体、换电或任务设置。');Object.assign(this.cfg,patch);if(this.elapsed===0)this.batteryWh=this.cfg.capacity*this.cfg.charge/100;if(['running','swapping','waiting'].includes(this.status)||this.edgeProgress>0||this.swapRemaining>0)this.pending=true;else this.replan('参数变化');}
    assertEditable(){if(this.elapsed>0||['running','swapping'].includes(this.status))throw Error('请重置任务后设置任务点。');}
    setPoint(which,p){this.assertEditable();if(!valid(p))throw Error('请在教学区域边框内选择。');const other=which==='start'?this.end:this.start;if(same(p,other))throw Error('起点与终点不能重合。');if(this.waypoints.some(w=>same(w,p)))throw Error('起终点不能与途经点重合。');this[which]={...p};this.reset();}
    addWaypoint(p){this.assertEditable();if(this.waypoints.length>=3)throw Error('最多设置 3 个途经点。');if(!valid(p))throw Error('请在教学区域边框内选择。');if(same(p,this.start)||same(p,this.end)||this.waypoints.some(w=>same(w,p)))throw Error('请选择与已有任务点不同的位置。');this.waypoints.push({...p});this.reset();}
    removeWaypoint(i){this.assertEditable();this.waypoints.splice(i,1);this.reset();}
    moveWaypoint(i,delta){this.assertEditable();const j=i+delta;if(j<0||j>=this.waypoints.length)return;[this.waypoints[i],this.waypoints[j]]=[this.waypoints[j],this.waypoints[i]];this.reset();}
    setWaypoint(i,p){this.assertEditable();if(!valid(p)||same(p,this.start)||same(p,this.end)||this.waypoints.some((w,j)=>j!==i&&same(w,p)))throw Error('请在区域内选择不重复的任务点。');this.waypoints[i]={...p};this.reset();}
    run(){if(this.status==='arrived')return;if(this.status==='paused'&&this.resumeStatus==='waiting'&&this.waitUntil>this.elapsed){this.status='waiting';this.resumeStatus=null;this.log('继续安全位置等待');return;}if(this.swapRemaining>0){this.status='swapping';this.log('继续换电');return;}if(this.edgeProgress===0)this.replan('出发前校验');if(!this.feasible){this.status='blocked';return;}this.status='running';this.log('开始 / 继续模拟飞行');}
    pause(){if(['running','swapping','waiting'].includes(this.status)){this.resumeStatus=this.status;this.status='paused';this.log('暂停模拟（计时与耗电暂停）');}}
    gust(kind='strong',center=null){
      const spec=W.TYPES[kind]||W.TYPES.strong,currentPath=this.remainingPath();if(currentPath.length>=2)this.gustReferencePath=currentPath.map(p=>({...p}));const oldPath=currentPath.length>=2?currentPath:this.gustReferencePath;if(!oldPath||oldPath.length<2)return false;
      if(this.activeGusts().length>=MAX_GUSTS)throw Error(`同时最多注入 ${MAX_GUSTS} 处阵风；请先移除一处。`);
      if(center&&(!Number.isFinite(center.x)||!Number.isFinite(center.y)||center.x<0||center.y<0||center.x>M.NX-1||center.y>M.NY-1))throw Error('阵风中心必须位于教学地图边框内。');
      const before=currentPath.length>=2?this.remainingMetrics():routeMetrics(oldPath,this.cfg),targetDistance=Math.min(before.length*.8,spec.radius+.6);let distance=0,p=oldPath[oldPath.length-1],heading={x:1,y:0},wasBlocked=this.status==='blocked';
      if(center){p={x:center.x,y:center.y};let nearest=Infinity;for(let i=1;i<oldPath.length;i++){const a=oldPath[i-1],b=oldPath[i],dx=b.x-a.x,dy=b.y-a.y,n2=dx*dx+dy*dy;if(n2<1e-10)continue;const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/n2)),qx=a.x+t*dx,qy=a.y+t*dy,d2=(p.x-qx)**2+(p.y-qy)**2;if(d2<nearest){nearest=d2;const n=Math.sqrt(n2);heading={x:dx/n,y:dy/n};}}}
      else for(let i=1;i<oldPath.length;i++){const a=oldPath[i-1],b=oldPath[i],d=M.STEP*Math.hypot(b.x-a.x,b.y-a.y);if(distance+d>=targetDistance){const k=(targetDistance-distance)/d;p={x:a.x+(b.x-a.x)*k,y:a.y+(b.y-a.y)*k};const n=Math.hypot(b.x-a.x,b.y-a.y);heading={x:(b.x-a.x)/n,y:(b.y-a.y)/n};break;}distance+=d;}
      const id='G'+this.nextGustId++;this.gusts.push({...spec,id,kind,placement:center?'map':'front',x:p.x,y:p.y,u:-heading.x*spec.strength,v:-heading.y*spec.strength,createdAt:this.elapsed,endAt:this.elapsed+240});this.updateField();
      const underWeather=W.annotate(oldPath,this.data.field,this.cfg);let unsafe=0,peakWind=0,peakPower=0;
      for(let i=1;i<underWeather.length;i++){const e=underWeather[i].segment;if(!W.safeSegment(this.data.field,underWeather[i-1],underWeather[i],this.cfg))unsafe++;peakWind=Math.max(peakWind,e.windSpeed);peakPower=Math.max(peakPower,e.powerW);}
      if(this.swapRemaining>0){this.pending=true;this.decision={action:'换电后避险',detail:`已叠加第 ${this.activeGusts().length} 处阵风；正在地面换电，完成后按合成风场重新规划。`,unsafe,peakWind,peakPower,before,at:this.elapsed};this.log(id+' 已注入，完成换电后重新评估航路');return true;}
      this.node={...this.position};this.replan(`新增 ${id} 阵风后立即评估`);if(wasBlocked&&this.feasible)this.status=this.elapsed?'paused':'ready';const after=this.remainingMetrics();this.decision={action:this.feasible?(unsafe?'已绕开危险区':center?'所选阵风已注入 · 当前航线仍可行':'已按风耗重选路线'):'无可行路线 · 保护停演',detail:this.feasible?`当前 ${this.activeGusts().length} 处阵风共同作用；旧航线有 ${unsafe} 段不满足风况限制，已重新检查途经点、换电与保留电量。`:this.reason,unsafe,peakWind,peakPower,before,after,at:this.elapsed};
      this.log(id+' · '+this.decision.action+` · 旧航线峰值风速 ${peakWind.toFixed(1)} m/s`);return true;
    }
    removeGust(id){const before=this.gusts.length;this.gusts=this.gusts.filter(g=>g.id!==id);if(this.gusts.length===before)return false;this.afterGustRemoval(`已移除 ${id}`);return true;}
    clearGust(){if(!this.gusts.length)return;this.gusts=[];this.afterGustRemoval('已清除全部模拟阵风');}
    afterGustRemoval(label){this.decision=null;if(this.swapRemaining>0){this.pending=true;this.updateField();this.log(label+'，换电结束后更新路线');return;}const blocked=this.status==='blocked',wasWaiting=this.status==='waiting'||this.resumeStatus==='waiting';this.waitUntil=null;this.resumeStatus=null;this.node={...this.position};this.replan(label+' · 重新评估剩余阵风');if((blocked||wasWaiting)&&this.feasible)this.status=this.elapsed?'paused':'ready';if(wasWaiting&&!this.feasible)this.status='blocked';}
    refreshWeather(seed){
      if(!Number.isInteger(seed)||seed<0||seed>4294967295)throw Error('天气种子必须是 32 位非负整数。');
      const before=this.remainingMetrics(),oldPath=this.remainingPath(),blocked=this.status==='blocked';this.cfg.seed=seed;this.decision=null;if(this.status==='waiting'){this.updateField();if(!W.safePoint(this.data.field,this.position,this.cfg)){this.status='blocked';this.reason='等待点已不满足风况安全阈值，模拟停止。';}this.log('已刷新随机天气，检查原地等待条件');return;}
      if(this.swapRemaining>0){this.pending=true;this.updateField();this.log('已刷新随机天气，换电结束后重新规划');}
      else{this.node={...this.position};this.replan('刷新随机天气 · 种子 '+seed);if(blocked&&this.feasible)this.status=this.elapsed?'paused':'ready';}
      if(this.data.field.events.length){const route=W.annotate(oldPath,this.data.field,this.cfg);let unsafe=0,peakWind=0,peakPower=0;for(let i=1;i<route.length;i++){const e=route[i].segment;unsafe+=!W.safeSegment(this.data.field,route[i-1],route[i],this.cfg);peakWind=Math.max(peakWind,e.windSpeed);peakPower=Math.max(peakPower,e.powerW);}
        this.decision={action:this.swapRemaining>0?'换电后避险':this.feasible?'天气已刷新 · 已复核阵风避险':'无可行路线 · 保护停演',detail:this.swapRemaining>0?'手动阵风已保留，地面换电结束后按新天气重新规划。':this.feasible?'手动阵风仍然有效；已从当前位置重新检查航路、换电站与电量。':this.reason,unsafe,peakWind,peakPower,before,after:this.remainingMetrics(),at:this.elapsed};
      }
    }
    previewWeather(minutes=1){this.assertEditable();this.cfg.time=Math.max(0,this.cfg.time+minutes);this.replan('天气预演：推进 '+minutes+' 分钟');}
    windAt(p){return W.windSample(this.data.field,p);}
    weatherAt(p){return W.diagnostics(this.data.field,p);}
    holdPower(){const field=this.data.field,p=this.position,w=this.windAt(p);return W.hoverPower(W.sample(field,p),this.cfg,Math.hypot(w.u,w.v),W.sample(field.gust,p));}
    waitAssessment(){const events=this.activeGusts(),seconds=events.length?Math.max(...events.map(g=>g.endAt))-this.elapsed:0;
      if(this.status!=='blocked'||!events.length)return {allowed:false,reason:'当前没有可等待消散的手动阵风。',seconds:0,energyWh:0};
      if(!W.safePoint(this.data.field,this.position,this.cfg))return {allowed:false,reason:'当前位置已超过风况安全阈值，不能按安全悬停方案等待。',seconds,energyWh:0};
      const powerW=this.holdPower(),energyWh=powerW*seconds/3600;
      if(!Number.isFinite(powerW)||this.remainingWh-energyWh<this.reserveWh-1e-7)return {allowed:false,reason:`等待约需 ${energyWh.toFixed(1)} Wh，无法保留 ${this.reserveWh.toFixed(1)} Wh 的电量。`,seconds,energyWh,powerW};
      return {allowed:true,reason:`当前 ${events.length} 处阵风；按最晚消散时间可等待约 ${Math.ceil(seconds)} 秒，估计悬停耗电 ${energyWh.toFixed(1)} Wh。若提前出现可行航路将恢复飞行；天气变化时继续校验。`,seconds,energyWh,powerW};
    }
    waitOutGust(){const a=this.waitAssessment();if(!a.allowed)return a;this.waitUntil=this.elapsed+a.seconds;this.status='waiting';this.reason='已进入安全位置等待：飞机不前进，模拟时钟与悬停能耗继续累计；阵风结束后自动重规划。';if(this.decision){this.decision.action='原地等待阵风消散 · 正在耗电';this.decision.detail=this.reason;}this.log(`开始原地等待 ${Math.ceil(a.seconds)} 秒 · 预计悬停耗电 ${a.energyWh.toFixed(1)} Wh`);return a;}
    instantaneous(){const a=this.path?.[this.index],b=this.path?.[this.index+1],e=b?.segment||(a&&b?W.edge(a,b,this.cfg):null),preview=this.status==='ready';const holding=this.status==='waiting',on=this.status==='running'||preview;
      return {powerW:holding?this.holdPower():on&&e?e.powerW:0,groundSpeed:on&&e?e.groundSpeed:0,whPerKm:holding?0:e?.whPerKm||0,holding,windSpeed:e?.windSpeed||Math.hypot(this.windAt(this.position).u,this.windAt(this.position).v),calmPower:power(0,this.cfg),preview,localGust:W.sample(this.data.field.gust,this.position),flightActive:this.status==='running'};
    }
    finishLeg(){const leg=this.itinerary.shift();this.markWaypoints();this.index=0;this.edgeProgress=0;
      if(same(this.node,this.end)&&this.nextWaypoint===this.waypoints.length){this.status='arrived';this.itinerary=[];this.path=null;this.fullPath=[];this.metrics=null;this.reason=null;this.log(`已到达终点 · 总用时 ${this.elapsed.toFixed(1)} 秒 = 飞行 ${this.flightSeconds.toFixed(1)} 秒 + 换电 ${this.swapElapsed.toFixed(1)} 秒 + 原地等待 ${this.holdSeconds.toFixed(1)} 秒`);return;}
      this.path=this.itinerary[0]?.path||null;
      if(leg?.swap){this.activeStation=leg.target;this.swapRemaining=this.cfg.swapSeconds;this.status='swapping';this.log(`到达 ${leg.target.id}，开始换电，固定 ${this.cfg.swapSeconds} 秒`);}
      else this.replan('已访问途经点');
    }
    expireWeather(){if(this.status==='waiting')return;if(!(this.data.field.events||[]).some(g=>Number.isFinite(g.endAt)&&g.endAt<=this.elapsed+1e-8))return;if(this.swapRemaining>0){this.updateField();this.pending=true;this.log('手动阵风已结束，换电完成后重规划');}else{this.node={...this.position};if(!same(this.trail[this.trail.length-1],this.node))this.trail.push({...this.node});this.replan('手动阵风已结束，立即重新评估');}}
    tick(seconds){if(!Number.isFinite(seconds)||seconds<0)throw Error('无效时间步长');let remaining=seconds;
      while(remaining>1e-8&&['running','swapping','waiting'].includes(this.status)){
        this.expireWeather();if(!['running','swapping','waiting'].includes(this.status))break;const deadline=Math.min(Infinity,...this.gusts.filter(g=>Number.isFinite(g.endAt)&&g.endAt>this.elapsed+1e-8).map(g=>g.endAt-this.elapsed));
        if(this.status==='waiting'){
          const until=this.waitUntil;
          if(!Number.isFinite(until)){this.status='blocked';this.reason='等待事件已失效，模拟停止。';break;}
          const gap=until-this.elapsed;if(gap<=1e-8){this.waitUntil=null;this.node={...this.position};this.replan('阵风结束后自动重规划');this.status=this.feasible?'running':'blocked';if(this.decision){this.decision.action=this.feasible?'阵风结束 · 已恢复飞行':'阵风结束 · 仍无可行航路';this.decision.detail=this.feasible?'已重新校验剩余电量、换电与任务点。':this.reason;}continue;}
          if(!W.safePoint(this.data.field,this.position,this.cfg)){this.status='blocked';this.reason='当前位置风况已超过安全阈值，不能继续原地等待。';this.log(this.reason);break;}
          const powerW=this.holdPower(),step=Math.min(remaining,20,gap,deadline),available=Math.max(0,this.remainingWh-this.reserveWh),dt=Math.min(step,available*3600/powerW),wh=powerW*dt/3600;
          if(!Number.isFinite(dt)||dt<=1e-8){this.status='blocked';this.reason='等待耗电已触及保留电量，模拟停止。';this.log(this.reason);break;}
          this.usedWh+=wh;this.batteryWh-=wh;this.elapsed+=dt;this.holdSeconds+=dt;this.holdEnergyWh+=wh;if(this.cfg.dynamic)this.weatherElapsed+=dt/60*4;remaining-=dt;
          const eventExpired=Number.isFinite(deadline)&&dt>=deadline-1e-8;
          if(eventExpired||((this.cfg.dynamic||this.activeGusts().length)&&this.elapsed-this.lastField>=20))this.updateField();
          if(dt<step-1e-8){this.status='blocked';this.reason='等待耗电已触及保留电量，模拟停止。';this.log(this.reason);break;}
          if(this.elapsed>=until-1e-8){this.waitUntil=null;this.node={...this.position};this.replan('阵风结束后自动重规划');this.status=this.feasible?'running':'blocked';if(this.decision){this.decision.action=this.feasible?'阵风结束 · 已恢复飞行':'阵风结束 · 仍无可行航路';this.decision.detail=this.feasible?'已重新校验剩余电量、换电与任务点。':this.reason;}this.log(this.feasible?'等待结束，继续执行新航路':'等待结束但仍无可行航路');}
          else if(eventExpired&&planMission(this.data.field,this.cfg,this.position,this.end,this.waypoints.slice(this.nextWaypoint),this.remainingWh)){this.waitUntil=null;this.node={...this.position};this.replan('部分阵风消散后提前恢复');this.status=this.feasible?'running':'blocked';if(this.decision){this.decision.action='部分阵风消散 · 已恢复飞行';this.decision.detail='其余阵风仍叠加显示；已重新检查剩余航路与保留电量。';}this.log('一处阵风消散，提前恢复可行航路');}
          continue;
        }
        if(this.status==='swapping'){const dt=Math.min(remaining,this.swapRemaining,deadline);this.elapsed+=dt;if(this.cfg.dynamic)this.weatherElapsed+=dt/60*4;this.swapElapsed+=dt;this.swapRemaining-=dt;remaining-=dt;
          if((this.cfg.dynamic||this.gusts.length)&&this.elapsed-this.lastField>=20)this.updateField();
          if(this.swapRemaining<=1e-8){this.swapRemaining=0;this.completedSwaps++;this.swaps.push({id:this.activeStation.id,at:this.elapsed,duration:this.cfg.swapSeconds,before_Wh:this.batteryWh});this.batteryWh=this.cfg.capacity;this.log(`${this.activeStation.id} 换电完成，电量恢复 100%`);this.activeStation=null;this.status='running';this.replan('换电完成后重规划');}continue;}
        if(!this.path){this.status='blocked';this.reason='当前无可执行航路。';break;}
        if(this.index>=this.path.length-1){this.finishLeg();continue;}
        const a=this.path[this.index],b=this.path[this.index+1],km=M.STEP*Math.hypot(b.x-a.x,b.y-a.y),motion=b.segment||W.edge(a,b,this.cfg);
        if(!motion.flyable||!W.safeSegment(this.data.field,a,b,this.cfg)){this.status='blocked';this.feasible=false;this.reason='当前航段不满足风况限制，保护停演。清除阵风或重置调整任务。';this.log(this.reason);break;}
        const duration=km*1000/motion.groundSpeed,dt=Math.min(remaining,(1-this.edgeProgress)*duration,deadline),fraction=dt/duration,wh=motion.powerW*dt/3600;
        if(this.remainingWh-wh<this.reserveWh-1e-7){this.status='blocked';this.reason='电量触及保留阈值，模拟停止。';this.log(this.reason);break;}
        this.usedWh+=wh;this.batteryWh-=wh;this.elapsed+=dt;if(this.cfg.dynamic)this.weatherElapsed+=dt/60*4;this.flightSeconds+=dt;this.travelKm+=km*fraction;this.edgeProgress+=fraction;remaining-=dt;this.position={x:a.x+(b.x-a.x)*this.edgeProgress,y:a.y+(b.y-a.y)*this.edgeProgress};
        if(this.edgeProgress>=1-1e-8){this.node={x:b.x,y:b.y};this.position={...this.node};this.trail.push({...this.node});this.index++;this.edgeProgress=0;
          if(this.index>=this.path.length-1)this.finishLeg();else if(this.markWaypoints()||this.pending||((this.cfg.dynamic||this.gusts.length)&&this.elapsed-this.lastReplan>=20))this.replan('当前位置滚动更新');}
      }
      if(this.status!=='waiting')this.expireWeather();
    }
    remainingPath(){if(!this.path||this.status==='arrived')return [];const a=this.path[this.index],b=this.path[this.index+1];if(!a)return [];const p={...this.position,value:b?a.value+(b.value-a.value)*this.edgeProgress:a.value};return [p,...this.path.slice(this.index+1),...this.itinerary.slice(1).flatMap(l=>l.path.slice(1))];}
    remainingMetrics(){const path=this.remainingPath();return path.length?routeMetrics(path,this.cfg):{length:0,timeMinutes:0,energyWh:0,mean:0,cost:0,profile:[]};}
    schedule(){const m=this.remainingMetrics();let charge=this.swapRemaining>0?this.cfg.capacity:this.remainingWh,flight=0,futureSwaps=0,firstEnergy=0;
      this.itinerary.forEach((l,i)=>{let mm=l.metrics;if(i===0&&this.path){const p=this.remainingPath().slice(0,this.path.length-this.index);mm=routeMetrics(p,this.cfg);}flight+=mm.timeMinutes*60;charge-=mm.energyWh;if(i===0)firstEnergy=mm.energyWh;if(l.swap){futureSwaps++;charge=this.cfg.capacity;}});
      const swapping=this.swapRemaining>0,swapSeconds=futureSwaps*this.cfg.swapSeconds+(swapping?this.swapRemaining:0);
      return {flightSeconds:flight,holdSeconds:this.holdSeconds,swapSeconds,totalSeconds:flight+swapSeconds,etaSeconds:this.elapsed+flight+swapSeconds,arrivalWh:charge,nextLegEnergyWh:firstEnergy,futureSwaps:futureSwaps+(swapping?1:0),energyWh:m.energyWh,feasible:this.feasible,stops:this.itinerary.filter(l=>l.swap).map(l=>l.target.id)};
    }
    snapshot(){return {version:6,data:'教学模拟，非真实遥测',parameters:{...this.cfg},status:this.status,start:toLatLng(this.start),end:toLatLng(this.end),waypoints:this.waypoints.map(toLatLng),waypoint_visits:this.visits,stations:STATIONS.map(s=>({...s,coordinate:toLatLng(s)})),position:toLatLng(this.position),elapsed_s:this.elapsed,flight_time_s:this.flightSeconds,hold_time_s:this.holdSeconds,hold_energy_Wh:this.holdEnergyWh,wait_until_s:this.waitUntil,swap_time_s:this.swapElapsed,completed_swaps:this.completedSwaps,swap_records:this.swaps,flown_km:this.travelKm,energy_used_Wh:this.usedWh,remaining_Wh:this.remainingWh,reserve_Wh:this.reserveWh,replans:this.replans,reason:this.reason,remaining_schedule:this.schedule(),remaining_route:this.remainingMetrics(),planned_route:this.remainingPath().map(toLatLng),actual_track:[...this.trail,this.position].map(toLatLng),weather:{source:'synthetic',snapshot_min:this.data.time,seed:this.cfg.seed,events:this.data.events,wind_affects_energy:true,local_coupling:this.weatherAt(this.position),gusts:this.gusts,active_gusts:this.data.field.events,decision:this.decision},instantaneous:this.instantaneous(),logs:this.logs};}
  }
  root.FlightModel={Flight,DEFAULTS,MAX_GUSTS,STATIONS,CELL,toLatLng,fromLatLng,fromLatLngExact,power,energy,cost,routeMetrics,planMission,origin};if(typeof module!=='undefined'&&module.exports)module.exports=root.FlightModel;
})(typeof globalThis!=='undefined'?globalThis:this);
