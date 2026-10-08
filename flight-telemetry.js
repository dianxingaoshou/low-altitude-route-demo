/* Full mission history. Sampling observes the integrator without changing its steps. */
(function(root){
  'use strict';
  const EPS=1e-7;
  const COLUMNS=[
    ['time_s','s'],['status',''],['cruise_setpoint_mps','m/s'],['ground_speed_mps','m/s'],
    ['power_W','W'],['battery_pct','%'],['battery_Wh','Wh'],['energy_used_Wh','Wh'],
    ['wind_speed_mps','m/s'],['tke_m2ps2','m²/s²'],['sigma_mps','m/s'],
    ['latitude_deg','deg'],['longitude_deg','deg'],['distance_km','km'],
    ['flight_time_s','s'],['wait_time_s','s'],['swap_time_s','s'],['reserve_pct','%'],
    ['weather_snapshot_min','min'],['weather_seed',''],['active_gusts',''],['event_types',''],['event_labels','']
  ];
  const finite=v=>Number.isFinite(v)?v:null;
  const equivalent=(a,b)=>a&&b&&COLUMNS.slice(0,-2).every(([key])=>
    typeof a[key]==='number'&&typeof b[key]==='number'?Math.abs(a[key]-b[key])<EPS:a[key]===b[key]);
  class Recorder{
    constructor({weatherSample,coordinates}){
      this.weatherSample=weatherSample;this.coordinates=coordinates;
      this.samples=[];this.events=[];this.nextSecond=1;this.pending=null;this.rateKey=null;this.revision=0;
    }
    point(sim,rates={},overrides={}){
      const p=overrides.position||sim.position,field=overrides.field||sim.data?.field;
      const weather=field?this.weatherSample(field,p):{};
      const ll=this.coordinates(p),running=sim.status==='running',waiting=sim.status==='waiting';
      const live=sim.data?sim.instantaneous():{};
      const battery=overrides.battery_Wh??sim.remainingWh;
      return {
        time_s:overrides.time_s??sim.elapsed,status:rates.status||sim.status,
        cruise_setpoint_mps:sim.cfg.speed,
        ground_speed_mps:finite(rates.groundSpeed??(running?live.groundSpeed:0)),
        power_W:finite(rates.powerW??(running||waiting?live.powerW:0)),
        battery_pct:battery/sim.cfg.capacity*100,battery_Wh:battery,
        energy_used_Wh:overrides.energy_used_Wh??sim.usedWh,
        wind_speed_mps:finite(weather.horizontal_speed),tke_m2ps2:finite(weather.tke),sigma_mps:finite(weather.sigma),
        latitude_deg:ll[0],longitude_deg:ll[1],distance_km:overrides.distance_km??sim.travelKm,
        flight_time_s:overrides.flight_time_s??sim.flightSeconds,wait_time_s:overrides.wait_time_s??sim.holdSeconds,
        swap_time_s:overrides.swap_time_s??sim.swapElapsed,reserve_pct:sim.cfg.reserve,
        weather_snapshot_min:finite(field?.time),weather_seed:sim.cfg.seed,
        active_gusts:(field?.events||[]).filter(g=>g.endAt===undefined||g.endAt>(overrides.time_s??sim.elapsed)+EPS).length
      };
    }
    push(point){
      const last=this.samples[this.samples.length-1];
      if(last&&point.time_s<last.time_s-EPS)throw Error('飞行记录时间不能倒退');
      if(equivalent(last,point))return;
      this.samples.push(point);this.revision++;
    }
    capture(sim,rates){
      if(this.pending){this.push(this.pending);this.pending=null;}
      const point=this.point(sim,rates);
      // Pre-flight edits update the initial condition rather than inventing flown data.
      if(!sim.elapsed&&sim.status==='ready'&&this.samples.every(s=>s.status==='ready')){
        this.samples=[point];this.revision++;
      }else this.push(point);
    }
    event(sim,type,label){
      this.capture(sim);
      this.events.push({id:this.events.length+1,time_s:sim.elapsed,type,label});this.revision++;
    }
    begin(sim,rates){
      const key=[sim.status,rates.powerW,rates.groundSpeed,sim.cfg.speed,sim.cfg.capacity,sim.cfg.reserve].join('|');
      if(key!==this.rateKey){this.capture(sim,rates);this.rateKey=key;}
      return {time:sim.elapsed,position:{...sim.position},battery:sim.remainingWh,energy:sim.usedWh,
        distance:sim.travelKm,flight:sim.flightSeconds,wait:sim.holdSeconds,swap:sim.swapElapsed,
        field:sim.data.field,rates:{...rates,status:sim.status}};
    }
    end(sim,interval){
      const duration=sim.elapsed-interval.time;if(duration<=0)return;
      const at=time=>{
        const f=Math.max(0,Math.min(1,(time-interval.time)/duration));
        const mix=(a,b)=>a+(b-a)*f;
        return this.point(sim,interval.rates,{time_s:time,field:interval.field,
          position:{x:mix(interval.position.x,sim.position.x),y:mix(interval.position.y,sim.position.y)},
          battery_Wh:mix(interval.battery,sim.remainingWh),energy_used_Wh:mix(interval.energy,sim.usedWh),
          distance_km:mix(interval.distance,sim.travelKm),flight_time_s:mix(interval.flight,sim.flightSeconds),
          wait_time_s:mix(interval.wait,sim.holdSeconds),swap_time_s:mix(interval.swap,sim.swapElapsed)});
      };
      while(this.nextSecond<=sim.elapsed+EPS){
        if(this.nextSecond>=interval.time-EPS)this.push(at(Math.min(this.nextSecond,sim.elapsed)));
        this.nextSecond++;
      }
      this.pending=at(sim.elapsed);this.revision++;
    }
    rows(sim){
      const rows=this.samples.map(p=>({...p}));
      if(this.pending&&!equivalent(rows[rows.length-1],this.pending))rows.push({...this.pending});
      const current=this.point(sim);
      if(!equivalent(rows[rows.length-1],current))rows.push(current);
      // Multiple rows at one instant preserve the two sides of a battery swap or state change.
      // Attach event labels only to the last row at that instant.
      const groups=new Map();for(const e of this.events){const key=e.time_s.toFixed(7);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(e);}
      rows.forEach((r,i)=>{
        const sameNext=rows[i+1]&&Math.abs(rows[i+1].time_s-r.time_s)<EPS;
        const events=sameNext?[]:groups.get(r.time_s.toFixed(7))||[];
        r.event_types=[...new Set(events.map(e=>e.type))].join(' | ');r.event_labels=events.map(e=>e.label).join(' | ');
      });return rows;
    }
    snapshot(sim){return {sample_interval_s:1,source:'教学模拟，非真实遥测',
      sampling:'每个任务秒采样；状态、功率变化和换电跳变额外保留边界；暂停不推进时间',
      columns:COLUMNS.map(([name,unit])=>({name,unit})),samples:this.rows(sim),events:this.events.map(e=>({...e}))};}
    csv(sim){
      const cell=v=>{
        if(v===null||v===undefined)return '';
        const str=typeof v==='number'?(Number.isInteger(v)?String(v):v.toFixed(9).replace(/0+$/,'').replace(/\.$/,'')):String(v);
        return /[",\r\n]/.test(str)?'"'+str.replace(/"/g,'""')+'"':str;
      };
      return [COLUMNS.map(([name])=>name).join(','),...this.rows(sim).map(r=>COLUMNS.map(([name])=>cell(r[name])).join(','))].join('\r\n')+'\r\n';
    }
  }
  const api={Recorder,COLUMNS};root.FlightTelemetry=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
