/* Read-only decision explanations and controlled experiment UI. */
(() => {
  'use strict';const A=window.MissionAnalysis,$=id=>document.getElementById(id);
  const num=(v,n=2)=>Number.isFinite(v)?v.toFixed(n):'—';
  const time=s=>Number.isFinite(s)?`${Math.floor(s/60)} 分 ${(s%60).toFixed(1)} 秒`:'—';
  const signed=(v,unit,n=1)=>`${v>=0?'+':''}${num(v,n)} ${unit}`;
  const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
  function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type})),a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function signature(sim){const {playback,...cfg}=sim.cfg;return JSON.stringify([cfg,sim.position,sim.end,sim.waypoints.slice(sim.nextWaypoint),sim.remainingWh,sim.elapsed,sim.swapRemaining,sim.data.time,sim.gusts]);}
  const metrics=m=>`剩余 ${num(m.distance_km)} km · ${time(m.total_s)} · ${num(m.energy_Wh,1)} Wh；换电 ${m.swap_count} 次，到达 ${num(m.arrival_Wh,1)} Wh`;
  class Lab{
    constructor(sim,callbacks={}){
      this.sim=sim;this.callbacks=callbacks;this.lastDecision=null;this.result=null;this.job=null;this.selectedSeed=null;this.previewKey=null;
      $('compareOnce').addEventListener('click',()=>this.start(1));
      $('compareBatch').addEventListener('click',()=>this.start(Number($('compareCount').value)));
      $('compareCancel').addEventListener('click',()=>this.cancel());
      $('compareSeed').addEventListener('change',()=>{this.selectedSeed=Number($('compareSeed').value);this.clearPreview();this.renderRows();});
      $('compareCsv').addEventListener('click',()=>this.result&&download('航路策略对照实验.csv','\ufeff'+A.csv(this.result),'text/csv;charset=utf-8'));
      $('compareJson').addEventListener('click',()=>this.result&&download('航路策略对照实验.json',JSON.stringify(this.result,null,2),'application/json'));
      $('compareRouteClear').addEventListener('click',()=>this.clearPreview());
      $('compareRows').addEventListener('click',event=>{const button=event.target.closest('[data-compare-route]');if(!button)return;
        const row=this.result?.rows.find(r=>r.seed===this.selectedSeed&&r.strategy===button.dataset.compareRoute);if(!row?.completed)return;
        this.previewKey=row.strategy;this.callbacks.route?.(row.path);$('compareRouteNote').textContent=`紫色虚线：种子 ${row.seed} · ${row.method} 的回放轨迹。仅供对照，不改变当前飞行路线。`;
        $('compareRouteClear').disabled=false;this.renderRows();$('geoMap').scrollIntoView({behavior:'smooth',block:'center'});
      });
      $('candidateRefresh').addEventListener('click',()=>{if(!this.sim.activeGusts().length)return;
        const legs=this.sim.remainingLegs(),reference=legs.length?legs:this.sim.gustReferenceLegs;
        this.sim.captureDecision(reference,null);if(!this.sim.decision)this.sim.decision={action:'手动复核候选方案',at:this.sim.elapsed};this.update();
      });
      this.busy(false);this.update();
    }
    update(){
      const current=this.sim.decision?this.sim.decisionInput:null;
      if(current!==this.lastDecision){
        this.lastDecision=current;this.renderCandidates(this.sim.decisionAssessment());
      }
      $('candidateRefresh').disabled=!this.sim.activeGusts().length;
      if(this.result){const stale=signature(this.sim)!==this.result.signature;$('compareStale').hidden=!stale;
        if(stale&&this.previewKey)this.clearPreview();}
    }
    renderCandidates(report){
      const container=$('candidateDetail');container.hidden=!report;$('candidateEmpty').hidden=!!report;
      if(!report){this.callbacks.unsafe?.([]);return;}
      $('candidateStamp').textContent=`触发时任务 ${time(report.trigger_s)} · 天气 T+${num(report.weather_min)} min · 种子 ${report.seed}。以下是该时刻快照；继续飞行后可点“复核当前位置”。`;
      $('candidateRecommendation').textContent=report.recommended;
      $('candidateNotes').textContent=report.notes;
      const body=$('candidateRows');body.replaceChildren();
      for(const [label,r,detail]of [
        ['沿原航线前进',report.original,report.original.feasible?metrics(report.original.metrics):report.original.reason],
        ['重新规划绕行',report.reroute,report.reroute.feasible?metrics(report.reroute.metrics)+(report.reroute.delta?`；较注入前：距离 ${signed(report.reroute.delta.distance_km,'km',2)}，用时 ${signed(report.reroute.delta.total_s,'秒')}，能耗 ${signed(report.reroute.delta.energy_Wh,'Wh')}`:'；没有可用的注入前计划，不计算增量'):report.reroute.reason],
        ['安全位置等待',report.wait,report.wait.not_applicable?report.wait.reason:(report.wait.can_hold?'可保持当前位置；':'不能安全支撑完整等待；')+report.wait.reason+(report.wait.can_hold?`。预计等待 ${time(report.wait.wait_s)}，等待耗电 ${num(report.wait.wait_energy_Wh,1)} Wh`:`。预测检查至 ${time(report.wait.wait_s)} 时，悬停电量预算 ${num(report.wait.wait_energy_Wh,1)} Wh`)+(report.wait.feasible?`；含等待的剩余任务：${metrics(report.wait.metrics)}`:'')]
      ]){const tr=el('tr');tr.append(el('th',label),el('td',r.not_applicable?'不适用':r.feasible?'预计可完成':'不可完成',r.feasible?'lab-ok':'lab-fail'),el('td',detail));body.append(tr);}
      if(!report.original.feasible&&!report.reroute.feasible&&!report.wait.feasible){const tr=el('tr','', 'lab-no-solution');const td=el('td','无可行方案：任务暂不能继续。请根据上述受阻原因清除或调整阵风、电量、任务点；保护停演会冻结仿真，不能当作零耗电悬停。');td.colSpan=3;tr.append(td);body.append(tr);}
      const unsafe=report.original.first_unsafe;
      if(unsafe){const ll=window.FlightModel.toLatLng(unsafe.point);$('candidateUnsafe').hidden=false;
        $('candidateUnsafe').textContent=`红色航段：原路线第 ${unsafe.segment} 段（任务段 ${unsafe.leg}）；首个超限取样点 ${ll[0].toFixed(5)}°N, ${ll[1].toFixed(5)}°E。${unsafe.reason}`;
        this.callbacks.unsafe?.([unsafe.from,unsafe.to]);
      }else{$('candidateUnsafe').hidden=true;this.callbacks.unsafe?.([]);}
      $('candidateWaitBoundary').textContent='等待是预测候选：只有当前处于“保护停演”且通过实时等待校验，才能用地图上方的等待按钮进入执行。执行中每 20 个任务秒复核安全与电量；预计可完成不等于实际必然完成。';
    }
    busy(value){for(const id of ['compareOnce','compareBatch','compareCount'])$(id).disabled=value;$('compareCancel').disabled=!value;$('comparisonLab').setAttribute('aria-busy',String(value));}
    clearPreview(){this.previewKey=null;this.callbacks.route?.([]);$('compareRouteNote').textContent='点击已完成策略的“看航迹”，在地图上叠加其回放结果。';$('compareRouteClear').disabled=true;}
    context(input,count){const c=input.cfg;$('compareContext').textContent=`截取任务 ${time(input.task_elapsed_s)} 的剩余任务 · 电量 ${num(input.battery_Wh,1)} / ${c.capacity} Wh · 载荷 ${c.payload} kg · 空速 ${c.speed} m/s · 保留 ${c.reserve}% · 途经点 ${input.waypoints.length} 个 · ${c.stationsEnabled?'启用':'关闭'}换电 · ${c.swapSeconds} 秒/次 · 天气 T+${num(input.weather_min)} min · 起始种子 ${c.seed} · ${count} 组天气。`+(input.pending_swap_s>0?` 正在换电：各策略均先等待剩余 ${num(input.pending_swap_s,1)} 秒并恢复满电。`:'');}
    partial(job){return {version:1,mode:'frozen_weather_replay',input:job.input,requested_samples:job.count,processed_samples:job.rows.length/4,cancelled:true,rows:job.rows,summary:A.summary(job.rows),boundary:'相同天气、剩余任务、电池、载荷、速度与安全约束；只改变路径代价。天气全程冻结，不注入新阵风，不执行等待。失败不参与成功样本的指标分布。'};}
    cancel(){const job=this.job;if(!job)return;job.cancelled=true;$('compareProgress').textContent='正在停止；保留已完成的整组四策略结果。';
      if(job.worker){job.worker.terminate();this.finish(job,this.partial(job));}
    }
    async start(count){
      if(this.job)return;const input=A.capture(this.sim),job={input,count,signature:signature(this.sim),rows:[],cancelled:false,worker:null};this.job=job;this.result=null;this.selectedSeed=null;
      this.clearPreview();this.busy(true);this.context(input,count);$('compareStale').hidden=true;$('compareResult').hidden=true;$('compareCsv').disabled=true;$('compareJson').disabled=true;
      $('compareProgress').textContent='正在冻结天气并回放四种规划策略…';$('compareBar').max=count;$('compareBar').value=0;
      const fallback=async()=>{if(this.job!==job||job.cancelled)return;job.worker=null;$('compareExecution').textContent='本地协作回放 · 所有算法依赖均在本机';
        try{const result=await A.run(input,count,{progress:p=>this.progress(job,p),cancelled:()=>job.cancelled});this.finish(job,result);}catch(error){this.fail(job,error.message);}};
      if(location.protocol==='file:'||typeof Worker==='undefined'){await fallback();return;}
      try{const worker=new Worker('mission-worker.js?v=20261008-analysis');job.worker=worker;$('compareExecution').textContent='后台线程回放 · 可以继续操作地图';
        worker.onmessage=event=>{if(this.job!==job)return;const message=event.data;
          if(message.type==='progress')this.progress(job,message.progress);
          else if(message.type==='result'){worker.terminate();this.finish(job,message.result);}
          else if(message.type==='error'){worker.terminate();this.fail(job,message.message);}};
        worker.onerror=event=>{event.preventDefault();worker.terminate();fallback();};worker.postMessage({id:1,input,count});
      }catch{await fallback();}
    }
    progress(job,p){if(this.job!==job)return;job.rows=p.rows;$('compareProgress').textContent=`已回放 ${p.processed} / ${p.total} 组天气（每组 4 种策略）。`;$('compareBar').value=p.processed;}
    fail(job,message){if(this.job!==job)return;this.job=null;this.busy(false);$('compareProgress').textContent='实验未完成：'+message;}
    finish(job,result){if(this.job!==job)return;this.job=null;this.busy(false);this.result={...result,signature:job.signature};
      $('compareProgress').textContent=`${result.cancelled?'已停止':'实验完成'} · ${result.processed_samples} / ${result.requested_samples} 组天气 · ${result.rows.length} 条策略结果。`;
      $('compareResult').hidden=!result.rows.length;$('compareCsv').disabled=!result.rows.length;$('compareJson').disabled=!result.rows.length;
      if(result.rows.length){this.selectedSeed=result.rows[0].seed;$('compareSeed').replaceChildren();
        for(const seed of [...new Set(result.rows.map(r=>r.seed))]){const option=el('option','种子 '+seed);option.value=seed;$('compareSeed').append(option);}
        this.renderRows();this.renderSummary();}
      this.update();
    }
    renderRows(){const body=$('compareRows');body.replaceChildren();if(!this.result)return;
      for(const r of this.result.rows.filter(r=>r.seed===this.selectedSeed)){const tr=el('tr'),head=el('th',r.method);tr.append(head,el('td',r.completed?'完成':'不可完成',r.completed?'lab-ok':'lab-fail'),el('td',num(r.distance_km)),el('td',time(r.total_s)),el('td',num(r.energy_Wh,1)),el('td',num(r.tke_exposure,3)),el('td',r.swap_count??'—'));
        const detail=el('td');detail.append(el('span',r.reason));if(r.completed){const b=el('button',this.previewKey===r.strategy?'航迹已叠加':'看航迹');b.dataset.compareRoute=r.strategy;detail.append(b);}tr.append(detail);body.append(tr);}
    }
    renderSummary(){const body=$('compareSummary');body.replaceChildren();
      const dist=(d,n=2)=>d.n?`${num(d.median,n)} [${num(d.q1,n)}, ${num(d.q3,n)}]`:'—';
      for(const r of this.result.summary){const tr=el('tr');for(const text of [r.method,`${r.completed}/${r.cases} · ${num(r.completion_rate*100,0)}%`,r.completed,dist(r.distance_km),dist(r.total_s,1),dist(r.energy_Wh,1),dist(r.tke_exposure,3),dist(r.swap_count,1)])tr.append(el('td',text));body.append(tr);}
      $('compareDistribution').hidden=this.result.requested_samples===1;
      $('compareBoundary').textContent=this.result.boundary+' 湍流暴露为 ∫K ds，单位 (m²/s²)·km；不是超阈值时间或实际风险概率。';
    }
  }
  window.MissionLab={Lab};
})();
