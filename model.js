/* Deterministic teaching model. No real meteorological observations are used. */
(function(root){
  'use strict';const SW=root.SeededWeather||(typeof require!=='undefined'?require('./seeded-weather.js'):null);
  const NX=61, NY=41, STEP=.2, SCALE=3, LIMIT=1.8, SPEED=15;
  const START={x:4,y:20}, END={x:56,y:20};
  const types={radar:{name:'多普勒天气雷达',sigma:.22,age:6,radius:1.05},profiler:{name:'风廓线雷达',sigma:.12,age:3,radius:1.4},station:{name:'地面自动站',sigma:.16,age:1,radius:1.05}};
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  function noise(n){const x=Math.sin(n*127.1+73.9)*43758.5453;return (x-Math.floor(x))*2-1;}
  function truth(x,y,z,time,seed=SW.DEFAULT_SEED){return SW.reference(x,y,z,time,seed);}
  function observations(time,seed=SW.DEFAULT_SEED){
    const pts=[];
    const add=(type,x,y,z)=>{x*=2;y*=2;const spec=types[type],id=pts.length+1;pts.push({type,x,y,z,...spec,radius:spec.radius*2,value:clamp(truth(x,y,z,time-spec.age/60,seed)+spec.sigma*noise(id+seed)*.25+.025*Math.sin(time*.15+id+seed),.01,3)});};
    for(const z of [150,300,450])for(let j=0;j<7;j++)for(let i=0;i<11;i++)add('radar',i*.6,j*2/3,z);
    for(const [x,y] of [[.7,1.1],[1.9,2.8],[2.8,1.8],[3.5,3.1],[4.8,1.3],[5.5,2.9]])for(const z of [150,300,450])add('profiler',x,y,z);
    for(const [x,y] of [[.3,.4],[1.1,1.8],[1.8,.7],[2.5,2.3],[3.2,.8],[3.8,2.6],[4.5,.5],[5.6,1.7],[.7,3.5],[2.3,3.6],[4.3,3.6],[5.8,3.5]])add('station',x,y,30);
    return pts;
  }
  function buildField({altitude=300,time=0,seed=SW.DEFAULT_SEED,sources=['radar','profiler','station']}={}){
    const obs=observations(time,seed).filter(p=>sources.includes(p.type));
    const field=new Float64Array(NX*NY), ref=new Float64Array(NX*NY);let error=0;
    for(let y=0;y<NY;y++)for(let x=0;x<NX;x++){
      let sum=0,weights=0;const px=x*STEP,py=y*STEP;
      for(const o of obs){const d2=(px-o.x)**2+(py-o.y)**2+(2.5*(altitude-o.z)/1000)**2;
        const w=Math.exp(-d2/(o.radius**2))*Math.exp(-o.age/15)/((d2+.08**2)*o.sigma**2);
        sum+=w*o.value;weights+=w;
      }
      const idx=y*NX+x;field[idx]=weights>0?sum/weights:NaN;ref[idx]=truth(px,py,altitude,time,seed);error+=(field[idx]-ref[idx])**2;
    }
    return {field,ref,obs,rmse:Math.sqrt(error/field.length),altitude,time,seed,events:SW.events(seed,time)};
  }
  class Heap{
    constructor(){this.a=[];}push(item){let i=this.a.length;this.a.push(item);while(i){const p=(i-1)>>1;if(this.a[p].f<=item.f)break;this.a[i]=this.a[p];i=p;}this.a[i]=item;}
    pop(){const root=this.a[0],last=this.a.pop();if(this.a.length){let i=0;while(i*2+1<this.a.length){let k=i*2+1;if(k+1<this.a.length&&this.a[k+1].f<this.a[k].f)k++;if(this.a[k].f>=last.f)break;this.a[i]=this.a[k];i=k;}this.a[i]=last;}return root;}
    get length(){return this.a.length;}
  }
  const index=p=>p.y*NX+p.x;
  function edgeCost(a,b,d,lambda){return d*(1+lambda*((a+b)/(2*SCALE))**2);}
  function plan(field,lambda=8,hard=false,heuristic=true,options={}){
    const from=options.start||START,to=options.end||END;
    const start=index(from),end=index(to),n=NX*NY,g=new Float64Array(n).fill(Infinity),prev=new Int32Array(n).fill(-1),closed=new Uint8Array(n),heap=new Heap();let visited=0;
    const ok=i=>Number.isFinite(field[i])&&(!hard||field[i]<LIMIT)&&(!options.allowed||options.allowed(i));
    if(!ok(start)||!ok(end))return {path:null,visited,reason:'起点或终点缺少数据，或超过所设教学阈值。'};
    g[start]=0;heap.push({i:start,f:0});
    while(heap.length){const u=heap.pop().i;if(closed[u])continue;closed[u]=1;visited++;
      if(u===end){let cur=end,path=[];while(cur!==-1){path.push({x:cur%NX,y:Math.floor(cur/NX),value:field[cur]});cur=prev[cur];}return {path:path.reverse(),visited,reason:null};}
      const x=u%NX,y=Math.floor(u/NX);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        if(!dx&&!dy)continue;const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=NX||yy>=NY)continue;
        const v=yy*NX+xx;if(closed[v]||!ok(v))continue;
        if(dx&&dy&&(!ok(y*NX+xx)||!ok(yy*NX+x)))continue;
        if(options.edgeAllowed&&!options.edgeAllowed(u,v))continue;
        const d=STEP*Math.hypot(dx,dy),ng=g[u]+(options.cost?options.cost(field[u],field[v],d,u,v):edgeCost(field[u],field[v],d,lambda));
        if(ng<g[v]-1e-12){g[v]=ng;prev[v]=u;const h=heuristic?STEP*Math.hypot(to.x-xx,to.y-yy):0;heap.push({i:v,f:ng+h});}
      }
    }
    return {path:null,visited,reason:'当前高值网格将可用区域隔断，未找到满足阈值的航路。'};
  }
  function metrics(path,lambda){
    if(!path)return null;let length=0,dose=0,cost=0,highLength=0,peak=0;const profile=[];
    for(let i=0;i<path.length;i++){const p=path[i];peak=Math.max(peak,p.value);
      if(i){const q=path[i-1],d=STEP*Math.hypot(p.x-q.x,p.y-q.y),t=(p.value+q.value)/2;length+=d;dose+=d*t;cost+=edgeCost(p.value,q.value,d,lambda);if(t>=LIMIT)highLength+=d;}
      profile.push({distance:length,value:p.value});
    }
    return {length,timeMinutes:length*1000/SPEED/60,mean:length?dose/length:path[0].value,dose,cost,peak,highPercent:length?highLength/length*100:0,profile};
  }
  function experiment(opts){
    const data=buildField(opts),baseline=plan(data.field,0,false),optimized=plan(data.field,opts.lambda,opts.hard);
    return {...data,baseline,optimized,baselineMetrics:metrics(baseline.path,opts.lambda),optimizedMetrics:metrics(optimized.path,opts.lambda)};
  }
  function wind(x,y,time,seed=SW.DEFAULT_SEED,tke){return SW.wind(x,y,time,seed,tke);}
  const api={NX,NY,STEP,SCALE,LIMIT,SPEED,START,END,types,truth,wind,observations,buildField,plan,metrics,experiment,edgeCost};root.DemoModel=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
