/* Offline canvas charts share one mission-time cursor and retain the full history. */
(function(root){
  'use strict';
  const TYPES={gust:{name:'阵风',color:'#ffab69'},replan:{name:'重规划',color:'#a694ff'},wait:{name:'等待',color:'#ffd16d'},swap:{name:'换电',color:'#64dce8'},control:{name:'启停 / 参数',color:'#b9cadf'},task:{name:'到达',color:'#91ec9b'}};
  const PLOTS=[
    {id:'historySpeed',title:'空速设定与执行地速',unit:'m/s',series:[['cruise_setpoint_mps','巡航空速设定','#76afff'],['ground_speed_mps','执行地速','#65edcc']]},
    {id:'historyPower',title:'执行功率',unit:'W',series:[['power_W','电池输出功率','#ffc775']]},
    {id:'historyBattery',title:'剩余电量',unit:'%',max:100,series:[['battery_pct','当前电池电量','#65edcc']]},
    {id:'historyWind',title:'当前位置水平风速',unit:'m/s',series:[['wind_speed_mps','水平风速','#76afff']]},
    {id:'historyTke',title:'当前位置湍流动能',unit:'m²/s²',series:[['tke_m2ps2','TKE','#de9fec']]}
  ];
  const STATES={ready:'待起飞',running:'飞行',waiting:'安全等待',swapping:'换电',paused:'模拟暂停',blocked:'保护停演',arrived:'已到达'};
  const clock=t=>{t=Math.max(0,Math.round(t));return String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0');};
  const fmt=(v,n=1)=>Number.isFinite(v)?v.toFixed(n):'—';
  const download=(blob,name)=>{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  class Charts{
    constructor(sim){
      this.sim=sim;this.host=document.getElementById('flightHistory');this.rows=[];this.cursor=null;this.pinned=false;this.range='all';this.lastRevision=-1;this.lastRecorder=null;
      this.enabled=new Set(Object.keys(TYPES));
      this.plots=PLOTS.map(p=>({...p,canvas:document.getElementById(p.id)}));
      this.plots.forEach(p=>{
        p.canvas.addEventListener('pointermove',e=>{if(!this.pinned)this.seek(this.timeAtPointer(e,p.canvas));});
        p.canvas.addEventListener('pointerleave',()=>{if(!this.pinned){this.cursor=null;this.paint();}});
        p.canvas.addEventListener('click',e=>{this.pinned=true;this.seek(this.timeAtPointer(e,p.canvas));});
        p.canvas.addEventListener('keydown',e=>{
          if(e.key==='Escape'){this.follow();return;}
          if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)||!this.rows.length)return;
          e.preventDefault();const times=[...new Set(this.rows.map(r=>r.time_s))],i=times.findIndex(t=>t>=(this.cursor??this.sim.elapsed)-1e-7);
          const next=e.key==='Home'?times[0]:e.key==='End'?times[times.length-1]:times[Math.max(0,Math.min(times.length-1,(i<0?times.length-1:i)+(e.key==='ArrowRight'?1:-1)))];
          this.pinned=true;this.seek(next);
        });
      });
      document.getElementById('historyRange').addEventListener('change',e=>{this.range=e.target.value;this.follow();});
      document.getElementById('historyFollow').addEventListener('click',()=>this.follow());
      this.host.querySelectorAll('[data-history-event]').forEach(input=>input.addEventListener('change',()=>{input.checked?this.enabled.add(input.dataset.historyEvent):this.enabled.delete(input.dataset.historyEvent);this.paint();this.renderEvents();}));
      document.getElementById('historyEvents').addEventListener('click',e=>{const button=e.target.closest('[data-history-time]');if(!button)return;if(this.range!=='all'){this.range='all';document.getElementById('historyRange').value='all';}this.pinned=true;this.seek(Number(button.dataset.historyTime));});
      document.getElementById('exportHistoryCsv').addEventListener('click',()=>download(new Blob(['\uFEFF',sim.telemetry.csv(sim)],{type:'text/csv;charset=utf-8'}),'飞行过程时间序列.csv'));
      document.getElementById('exportHistoryPng').addEventListener('click',()=>this.exportPng());
      this.observer=new ResizeObserver(()=>this.paint());this.observer.observe(this.host);
      this.update(true);
    }
    follow(){this.cursor=null;this.pinned=false;this.paint();}
    bounds(){const end=Math.max(60,this.sim.elapsed),window=this.range==='all'?end:Number(this.range);return {start:Math.max(0,end-window),end};}
    timeAtPointer(e,canvas){const r=canvas.getBoundingClientRect(),{start,end}=this.bounds();return start+Math.max(0,Math.min(1,(e.clientX-r.left-49)/Math.max(1,r.width-65)))*(end-start);}
    seek(time){this.cursor=Math.max(0,Math.min(this.sim.elapsed,time));this.paint();}
    update(force=false){
      if(this.lastRecorder!==this.sim.telemetry){this.lastRecorder=this.sim.telemetry;this.cursor=null;this.pinned=false;this.lastRevision=-1;this.eventKey=null;}
      if(!force&&this.lastRevision===this.sim.telemetry.revision)return;
      this.lastRevision=this.sim.telemetry.revision;this.rows=this.sim.telemetry.rows(this.sim);
      document.getElementById('historySummary').textContent=this.sim.elapsed?`任务 ${clock(this.sim.elapsed)} · ${this.rows.length} 条记录 · ${this.sim.telemetry.events.length} 个事件`:'尚未起飞，开始后自动记录完整过程';
      document.getElementById('exportHistoryCsv').disabled=!this.sim.elapsed;
      document.getElementById('exportHistoryPng').disabled=!this.sim.elapsed;
      this.renderEvents();this.paint();
    }
    renderEvents(){
      const key=this.sim.telemetry.events.length+'|'+[...this.enabled].sort().join(',');if(key===this.eventKey)return;this.eventKey=key;
      const list=document.getElementById('historyEvents');list.replaceChildren();
      const events=this.sim.telemetry.events.filter(e=>this.enabled.has(e.type));
      if(!events.length){const p=document.createElement('p');p.className='history-note';p.textContent='所选事件会按发生时间列在这里，点击可定位曲线。';list.append(p);return;}
      for(const e of events){const button=document.createElement('button'),type=TYPES[e.type]||TYPES.control;button.type='button';button.dataset.historyTime=e.time_s;button.style.setProperty('--event-color',type.color);
        const time=document.createElement('time'),badge=document.createElement('b'),label=document.createElement('span');time.textContent=clock(e.time_s);badge.textContent=type.name;label.textContent=e.label;button.append(time,badge,label);list.append(button);}
    }
    selected(){
      const t=this.cursor??this.sim.elapsed;let selected=this.rows[0];
      for(const row of this.rows){if(row.time_s<=t+1e-7)selected=row;else break;}return selected;
    }
    paint(){
      if(!this.rows.length)return;const bounds=this.bounds(),selected=this.selected(),t=selected.time_s;
      document.getElementById('historyFollow').setAttribute('aria-pressed',String(!this.pinned));
      document.getElementById('historyCursor').textContent=`${clock(t)} · ${STATES[selected.status]||selected.status}${this.pinned?' · 已锁定':' · '+(this.cursor===null?'跟随任务':'取样查看')}`;
      const values=[['空速设定',selected.cruise_setpoint_mps,'m/s',1],['地速',selected.ground_speed_mps,'m/s',1],['功率',selected.power_W,'W',0],['电量',selected.battery_pct,'%',1],['风速',selected.wind_speed_mps,'m/s',1],['TKE',selected.tke_m2ps2,'m²/s²',2]];
      document.getElementById('historyValues').textContent=values.map(([name,v,unit,n])=>`${name} ${fmt(v,n)} ${unit}`).join('　 ·　 ');
      const events=this.sim.telemetry.events.filter(e=>Math.abs(e.time_s-t)<1e-6&&this.enabled.has(e.type));
      document.getElementById('historyCursorEvent').textContent=events.length?events.map(e=>e.label).join('；'):`累计耗能 ${fmt(selected.energy_used_Wh)} Wh · 已飞 ${fmt(selected.distance_km,2)} km`;
      this.plots.forEach(p=>{
        const r=p.canvas.getBoundingClientRect();if(!r.width)return;const dpr=Math.min(2,root.devicePixelRatio||1),width=Math.round(r.width*dpr),height=Math.round(r.height*dpr);
        if(p.canvas.width!==width||p.canvas.height!==height){p.canvas.width=width;p.canvas.height=height;}
        const ctx=p.canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);this.draw(ctx,r.width,r.height,p,bounds,t);
        const current=selected[p.series[0][0]];
        document.getElementById(p.id+'Value').textContent=p.id==='historySpeed'?`${fmt(selected.cruise_setpoint_mps)} / ${fmt(selected.ground_speed_mps)} m/s`:`${fmt(current,p.id==='historyTke'?2:p.id==='historyPower'?0:1)} ${p.unit}`;
        p.canvas.setAttribute('aria-label',`${p.title}，任务 ${clock(t)}，${p.series.map(([key,name])=>`${name} ${fmt(selected[key],2)} ${p.unit}`).join('，')}。左右方向键查看记录，Escape 返回跟随。`);
      });
    }
    draw(ctx,w,h,plot,bounds,cursor){
      ctx.fillStyle='#0d1a2b';ctx.fillRect(0,0,w,h);const l=49,r=16,top=24,bottom=30,gw=Math.max(1,w-l-r),gh=h-top-bottom;
      const px=t=>l+(t-bounds.start)/(bounds.end-bounds.start)*gw;
      const visible=this.rows.filter(row=>row.time_s>=bounds.start-1e-7&&row.time_s<=bounds.end+1e-7);
      const prev=this.rows.filter(row=>row.time_s<bounds.start);if(prev.length)visible.unshift(prev[prev.length-1]);
      const max=plot.max||visible.reduce((peak,row)=>plot.series.reduce((v,[key])=>Number.isFinite(row[key])?Math.max(v,row[key]):v,peak),1)*1.15;
      const py=value=>top+gh*(1-value/max);ctx.font='11px "Microsoft YaHei", sans-serif';
      // State bands show real task time spent waiting or swapping.
      ctx.save();ctx.beginPath();ctx.rect(l,top,gw,gh);ctx.clip();
      for(let i=0;i<visible.length-1;i++){const a=visible[i],b=visible[i+1];if(!['waiting','swapping'].includes(a.status))continue;ctx.fillStyle=a.status==='waiting'?'#ffd16d10':'#64dce810';ctx.fillRect(px(a.time_s),top,Math.max(0,px(b.time_s)-px(a.time_s)),gh);}
      ctx.restore();ctx.textAlign='right';ctx.fillStyle='#b4c7db';ctx.strokeStyle='#ffffff14';ctx.lineWidth=1;
      for(let i=0;i<=4;i++){const value=max*i/4,y=py(value);ctx.beginPath();ctx.moveTo(l,y);ctx.lineTo(w-r,y);ctx.stroke();ctx.fillText(value>=100?value.toFixed(0):value>=10?value.toFixed(1):value.toFixed(2),l-7,y+4);}
      ctx.textAlign='left';ctx.fillStyle='#b4c7db';ctx.fillText(plot.unit,5,13);
      ctx.textAlign='center';for(let i=0;i<=4;i++){const time=bounds.start+(bounds.end-bounds.start)*i/4;ctx.fillText(clock(time),px(time),h-9);}
      ctx.save();ctx.beginPath();ctx.rect(l,top,gw,gh);ctx.clip();
      if(plot.id==='historyBattery'){
        ctx.strokeStyle='#ffc77580';ctx.setLineDash([4,4]);ctx.beginPath();
        visible.forEach((row,i)=>i?ctx.lineTo(px(row.time_s),py(row.reserve_pct)):ctx.moveTo(px(row.time_s),py(row.reserve_pct)));ctx.stroke();ctx.setLineDash([]);
      }
      // Nearby markers are grouped in pixels; the list retains every event.
      const markers=new Map();for(const event of this.sim.telemetry.events){if(!this.enabled.has(event.type)||event.time_s<bounds.start||event.time_s>bounds.end)continue;const bucket=Math.floor((px(event.time_s)-l)/8);if(!markers.has(bucket))markers.set(bucket,[]);markers.get(bucket).push(event);}
      for(const group of markers.values()){const event=group.find(e=>e.type==='gust'||e.type==='swap'||e.type==='wait')||group[0],x=px(event.time_s),color=(TYPES[event.type]||TYPES.control).color;ctx.strokeStyle=color+'45';ctx.setLineDash([3,5]);ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,top+gh);ctx.stroke();ctx.setLineDash([]);}
      for(const [key,,color]of plot.series){ctx.beginPath();let drawing=false;for(const row of visible){if(!Number.isFinite(row[key])){drawing=false;continue;}const x=px(row.time_s),y=py(row[key]);drawing?ctx.lineTo(x,y):ctx.moveTo(x,y);drawing=true;}ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke();}
      ctx.restore();
      for(const group of markers.values()){const event=group.find(e=>e.type==='gust'||e.type==='swap'||e.type==='wait')||group[0],x=px(event.time_s);ctx.fillStyle=(TYPES[event.type]||TYPES.control).color;ctx.beginPath();ctx.moveTo(x,top-2);ctx.lineTo(x-4,top-9);ctx.lineTo(x+4,top-9);ctx.closePath();ctx.fill();if(group.length>1){ctx.font='9px sans-serif';ctx.textAlign='center';ctx.fillText(group.length,x,top-12);}}
      if(cursor>=bounds.start&&cursor<=bounds.end){const x=px(cursor);ctx.strokeStyle='#e5f4ff90';ctx.lineWidth=1;ctx.setLineDash([2,3]);ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,top+gh);ctx.stroke();ctx.setLineDash([]);}
      if(!this.sim.elapsed){ctx.fillStyle='#c2d6e6';ctx.font='13px "Microsoft YaHei", sans-serif';ctx.textAlign='center';ctx.fillText('开始飞行后，曲线随任务时间生成',l+gw/2,top+gh/2);}
    }
    exportPng(){
      this.update(true);const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=1120;const ctx=canvas.getContext('2d');ctx.fillStyle='#08121f';ctx.fillRect(0,0,1600,1120);ctx.fillStyle='#edf4ff';ctx.font='bold 25px "Microsoft YaHei",sans-serif';ctx.fillText('萧山低空航路 · 完整飞行过程',30,43);
      ctx.fillStyle='#b4c7db';ctx.font='15px "Microsoft YaHei",sans-serif';ctx.fillText(`教学模拟 · 种子 ${this.sim.cfg.seed} · 任务 ${clock(this.sim.elapsed)} · 总耗能 ${fmt(this.sim.usedWh)} Wh`,30,75);
      const layout=[[30,100,760],[810,100,760],[30,420,1540],[30,740,760],[810,740,760]];
      this.plots.forEach((plot,i)=>{const[x,y,width]=layout[i];ctx.fillStyle='#101e30';ctx.fillRect(x,y,width,300);ctx.fillStyle='#edf4ff';ctx.font='bold 17px "Microsoft YaHei",sans-serif';ctx.fillText(plot.title,x+18,y+27);ctx.font='13px "Microsoft YaHei",sans-serif';ctx.fillStyle='#b4c7db';ctx.fillText(plot.series.map(([,name])=>name).join(' / ')+(plot.id==='historyBattery'?' · 虚线为保留电量':''),x+18,y+50);ctx.save();ctx.translate(x+12,y+58);this.draw(ctx,width-24,230,plot,{start:0,end:Math.max(60,this.sim.elapsed)},this.sim.elapsed);ctx.restore();});
      ctx.font='13px "Microsoft YaHei",sans-serif';ctx.fillStyle='#b4c7db';ctx.fillText('横轴：任务模拟时间；黄色底纹：等待；青色底纹：换电。换电电量跳变，累计耗能不清零。',30,1072);ctx.fillText('风速、TKE 为当前位置采样；功率和地速为执行航段模型值。事件名称见导出的 CSV / JSON。',30,1097);
      canvas.toBlob(blob=>{if(blob)download(blob,'完整飞行过程曲线.png');},'image/png');
    }
  }
  root.FlightCharts={Charts,TYPES,PLOTS};
})(typeof window!=='undefined'?window:globalThis);
