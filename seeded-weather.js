/* Reproducible correlated synthetic weather. Not a forecast or a calibrated Dryden model. */
(function(root){
  'use strict';const DEFAULT_SEED=20260923,TAU=Math.PI*2,cache=new Map();
  function rng(seed){let a=seed>>>0;return()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
  function config(seed=DEFAULT_SEED){seed=seed>>>0;if(cache.has(seed))return cache.get(seed);const r=rng(seed),direction=r()*TAU,speed=1.3+r()*1.7,c={seed,direction,speed,meanU:Math.cos(direction)*speed,meanV:Math.sin(direction)*speed,phase:r()*TAU,modes:[]};
    for(let i=0;i<4;i++)c.modes.push({kx:(.7+r()*1.4)*(r()<.5?-1:1),ky:(.7+r()*1.4)*(r()<.5?-1:1),omega:.35+r()*.6,phase:[r()*TAU,r()*TAU,r()*TAU]});if(cache.size>40)cache.clear();cache.set(seed,c);return c;
  }
  function cell(seed,index){const r=rng((seed^Math.imul(index+1024,2654435761))>>>0),start=index*5+r()*2,duration=10+r()*10;return {id:'T'+(index+1000),index,start,end:start+duration,x:1+r()*10,y:.6+r()*6.8,rx:.75+r()*.9,ry:.65+r()*1.0,angle:r()*TAU,peak:.8+r()*1.7,kind:'湍流斑块'};}
  function envelope(c,time){if(time<=c.start||time>=c.end)return 0;const p=(time-c.start)/(c.end-c.start);return Math.sin(Math.PI*p)**2;}
  function events(seed,time){const out=[],n=Math.floor(time/5);for(let i=n-4;i<=n+2;i++){const c=cell(seed,i),age=(time-c.start)/(c.end-c.start),strength=envelope(c,time);out.push({...c,strength,phase:age<0?'尚未生成':age>=1?'已消散':age<.4?'增强中':age>.6?'衰减中':'活跃',progress:Math.max(0,Math.min(1,age))});}return out;}
  function state(seed,time){const c=config(seed);return {config:c,events:events(seed,time)};}
  function reference(x,y,z,time,seed=DEFAULT_SEED){const c=config(seed);let k=.07;for(const e of events(seed,time)){if(!e.strength)continue;const dt=time-(e.start+e.end)/2,dx=x-e.x-c.meanU*.06*dt,dy=y-e.y-c.meanV*.06*dt,co=Math.cos(e.angle),si=Math.sin(e.angle),a=(dx*co+dy*si)/e.rx,b=(-dx*si+dy*co)/e.ry;k+=e.peak*e.strength*Math.exp(-.5*(a*a+b*b))*(.85+.15*Math.cos((z-300)/350));}return Math.min(3,k);}
  function wind(x,y,time,seed=DEFAULT_SEED,tke=reference(x,y,300,time,seed)){
    const c=config(seed),sigma=Math.sqrt(Math.max(0,tke)*2/3),modeScale=Math.sqrt(2/c.modes.length),fluct=[0,0,0];
    for(const m of c.modes)for(let j=0;j<3;j++)fluct[j]+=modeScale*Math.sin(m.kx*x+m.ky*y+m.omega*time+m.phase[j]);
    const shear=.45*Math.sin(y*.55+time*.03+c.phase),meanU=c.meanU+shear,meanV=c.meanV+.35*Math.cos(x*.45+time*.025+c.phase);
    // With independent uniform random phases, each component has variance sigma².
    return {u:meanU+sigma*fluct[0],v:meanV+sigma*fluct[1],w:sigma*fluct[2],fluctU:sigma*fluct[0],fluctV:sigma*fluct[1],fluctW:sigma*fluct[2],meanU,meanV,sigma,tke,varianceU:sigma*sigma,varianceV:sigma*sigma,varianceW:sigma*sigma};
  }
  const api={DEFAULT_SEED,rng,config,cell,events,envelope,state,reference,wind};root.SeededWeather=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
