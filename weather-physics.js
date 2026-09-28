/* Pedagogical wind/energy model; coefficients and flight limits are not aircraft specifications. */
(function(root){
  'use strict';const M=root.DemoModel;
  const TYPES={moderate:{name:'中等阵风',strength:8,radius:1.3,core:0},strong:{name:'强阵风',strength:18,radius:1.8,core:.55},wide:{name:'大范围强风带',strength:22,radius:4.8,core:.7}};
  const LIMIT=14,BUFFER=.2;
  function influence(g,p){const r=Math.hypot(p.x-g.x,p.y-g.y)*M.STEP/g.radius;return r>=1?0:(1-r*r)**2;}
  function activeEvents(gusts,elapsed){return gusts.filter(g=>g.endAt===undefined||elapsed<g.endAt).map(g=>{const scale=g.endAt===undefined?1:Math.min(1,Math.max(0,(g.endAt-elapsed)/60));return {...g,u:g.u*scale,v:g.v*scale,strength:g.strength*scale,core:scale>.45?g.core:0,envelope:scale};});}
  function decorate(data,gusts=[],elapsed=0){const f=data.field;f.time=data.time;f.seed=data.seed;f.windW=new Float64Array(f.length);f.meanU=new Float64Array(f.length);f.meanV=new Float64Array(f.length);f.gustU=new Float64Array(f.length);f.gustV=new Float64Array(f.length);f.windU=new Float64Array(f.length);f.windV=new Float64Array(f.length);f.variance=new Float64Array(f.length);f.gust=new Float64Array(f.length);f.blocked=new Uint8Array(f.length);f.events=activeEvents(gusts,elapsed);
    for(let y=0;y<M.NY;y++)for(let x=0;x<M.NX;x++){const i=y*M.NX+x,p={x,y};let du=0,dv=0,t=0,gain=0,blocked=false;
      for(const g of f.events){const k=influence(g,p);du+=g.u*k;dv+=g.v*k;t+=2.7*k*g.envelope**2;gain+=g.strength/14*k;if(g.core&&Math.hypot(x-g.x,y-g.y)*M.STEP<=g.radius*g.core+BUFFER)blocked=true;}
      if(Number.isFinite(f[i]))f[i]=Math.min(3,f[i]+t);const w=M.wind(x*M.STEP,y*M.STEP,data.time,data.seed,Number.isFinite(f[i])?f[i]:0),u=w.u+du,v=w.v+dv;
      f.windU[i]=u;f.windV[i]=v;f.windW[i]=w.w;f.meanU[i]=w.meanU+du;f.meanV[i]=w.meanV+dv;f.gustU[i]=du;f.gustV[i]=dv;f.variance[i]=Number.isFinite(f[i])?2*f[i]/3:NaN;f.gust[i]=gain;f.blocked[i]=blocked||Math.hypot(u,v)>=LIMIT?1:0;
    }return data;
  }
  function sample(arr,p){if(!arr)return 0;const x=Math.max(0,Math.min(M.NX-1,p.x)),y=Math.max(0,Math.min(M.NY-1,p.y)),x0=Math.floor(x),x1=Math.ceil(x),y0=Math.floor(y),y1=Math.ceil(y),tx=x-x0,ty=y-y0;
    // Avoid NaN * 0 contaminating finite neighboring coordinates.
    let sum=0;for(const [xx,yy,w]of[[x0,y0,(1-tx)*(1-ty)],[x1,y0,tx*(1-ty)],[x0,y1,(1-tx)*ty],[x1,y1,tx*ty]])if(w)sum+=arr[yy*M.NX+xx]*w;return sum;
  }
  // Interpolate energy, then evaluate the same continuous random process at the
  // requested coordinate. Interpolating velocity first damps its variance.
  function windSample(f,p){
    const tke=sample(f,p),sigma=Math.sqrt(Math.max(0,tke)*2/3);
    if(Number.isInteger(p.x)&&Number.isInteger(p.y)&&f.meanU){const i=p.y*M.NX+p.x;return {u:f.windU[i],v:f.windV[i],w:f.windW[i],meanU:f.meanU[i],meanV:f.meanV[i],fluctU:f.windU[i]-f.meanU[i],fluctV:f.windV[i]-f.meanV[i],fluctW:f.windW[i],sigma,tke};}
    if(f.seed===undefined)return {u:sample(f.windU,p),v:sample(f.windV,p),w:0,meanU:0,meanV:0,sigma,tke};
    const w=M.wind(p.x*M.STEP,p.y*M.STEP,f.time,f.seed,Number.isFinite(tke)?tke:0),du=sample(f.gustU,p),dv=sample(f.gustV,p);
    return {...w,u:w.u+du,v:w.v+dv,meanU:w.meanU+du,meanV:w.meanV+dv,sigma,tke};
  }
  function diagnostics(f,p){const w=windSample(f,p),available=Number.isFinite(w.tke);return {available,snapshot_min:f.time,point:{...p},horizontal_speed:available?Math.hypot(w.u,w.v):null,mean_horizontal_speed:available?Math.hypot(w.meanU,w.meanV):null,tke:available?w.tke:null,sigma:available?w.sigma:null,variance_u:available?w.sigma**2:null,variance_v:available?w.sigma**2:null,variance_w:available?w.sigma**2:null,tke_from_variances:available?1.5*w.sigma**2:null,instantaneous:available?{u:w.u,v:w.v,w:w.w}:null,mean:available?{u:w.meanU,v:w.meanV,w:0}:null,fluctuation:available?{u:w.fluctU,v:w.fluctV,w:w.fluctW}:null,statistics:'prescribed_model_variance_not_measured_window'};}
  function point(f,p){const w=windSample(f,p);return {x:p.x,y:p.y,value:w.tke,u:w.u,v:w.v,gust:sample(f.gust,p)};}
  function basePower(cfg){return cfg.basePower*((5.5+cfg.payload)/5.5)**1.5;}
  function speedFactor(speed){const x=speed/12;return .2+.3/x+.5*x**3;}
  function power(tke,cfg,windSpeed=0,gust=0){return basePower(cfg)*speedFactor(cfg.speed)*(1+.6*(tke/3)**2)+4*windSpeed**2+220*gust**2+40;}
  function hoverPower(tke,cfg,windSpeed=0,gust=0){return basePower(cfg)*1.08*(1+.6*(tke/3)**2)+4*windSpeed**2+220*gust**2+40;}
  function edge(a,b,cfg){const dx=b.x-a.x,dy=b.y-a.y,n=Math.hypot(dx,dy),u=((a.u||0)+(b.u||0))/2,v=((a.v||0)+(b.v||0))/2,wind=Math.hypot(u,v),along=n?(u*dx+v*dy)/n:0,cross=n?Math.abs(u*dy-v*dx)/n:0,tke=(a.value+b.value)/2,gust=((a.gust||0)+(b.gust||0))/2;
    const groundSpeed=cross<cfg.speed?Math.sqrt(cfg.speed**2-cross**2)+along:0,powerW=power(tke,cfg,wind,gust),km=n*M.STEP,flyable=Number.isFinite(tke)&&wind<LIMIT&&groundSpeed>=3;
    const seconds=km?km*1000/Math.max(.01,groundSpeed):0;return {groundSpeed,powerW,windSpeed:wind,along,cross,tke,gust,flyable,seconds,energyWh:powerW*seconds/3600,whPerKm:powerW/Math.max(.01,groundSpeed)/3.6};
  }
  function safePoint(f,p,cfg){if(p.x<0||p.y<0||p.x>M.NX-1||p.y>M.NY-1)return false;const q=point(f,p);if(!Number.isFinite(q.value)||(cfg.hard&&q.value>=M.LIMIT)||Math.hypot(q.u,q.v)>=LIMIT)return false;
    for(const g of f.events||[])if(g.core&&Math.hypot(p.x-g.x,p.y-g.y)*M.STEP<=g.radius*g.core+BUFFER)return false;
    return true;
  }
  function safeSegment(f,a,b,cfg){const dx=b.x-a.x,dy=b.y-a.y,n=Math.hypot(dx,dy),count=Math.max(1,Math.ceil(n*M.STEP/.05));for(let i=0;i<=count;i++){const p={x:a.x+dx*i/count,y:a.y+dy*i/count};if(!safePoint(f,p,cfg))return false;if(n){const q=point(f,p),along=(q.u*dx+q.v*dy)/n,cross=Math.abs(q.u*dy-q.v*dx)/n;if(cross>=cfg.speed||Math.sqrt(cfg.speed**2-cross**2)+along<3)return false;}}return edge(point(f,a),point(f,b),cfg).flyable;}
  function annotate(path,f,cfg){return path.map((p,i)=>{const q=point(f,p);if(i)q.segment=edge(point(f,path[i-1]),q,cfg);return q;});}
  const api={TYPES,LIMIT,BUFFER,activeEvents,decorate,sample,windSample,diagnostics,point,basePower,speedFactor,power,hoverPower,edge,safePoint,safeSegment,annotate};root.WeatherPhysics=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
