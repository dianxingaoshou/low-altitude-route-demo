/* Map-aligned synthetic meteorological raster and wind particle renderer. */
(function(root){
  const M=root.DemoModel,F=root.FlightModel;
  const WindLayer=L.Layer.extend({
    initialize(sim){this.sim=sim;this.particles=[];this.enabled=true;},
    onAdd(map){this.map=map;this.canvas=L.DomUtil.create('canvas','wind-canvas');this.canvas.setAttribute('aria-hidden','true');map.getPane('windPane').appendChild(this.canvas);map.on('moveend zoomend resize',this.reset,this);map.on('movestart zoomstart',this.clear,this);this.reset();},
    onRemove(map){map.off('moveend zoomend resize',this.reset,this);map.off('movestart zoomstart',this.clear,this);this.canvas.remove();},
    clear(){this.ctx?.clearRect(0,0,this.w,this.h);},
    reset(){const size=this.map.getSize(),dpr=devicePixelRatio||1;this.w=size.x;this.h=size.y;this.canvas.width=size.x*dpr;this.canvas.height=size.y*dpr;this.canvas.style.width=size.x+'px';this.canvas.style.height=size.y+'px';L.DomUtil.setPosition(this.canvas,this.map.containerPointToLayerPoint([0,0]));this.ctx=this.canvas.getContext('2d');this.ctx.scale(dpr,dpr);this.particles=Array.from({length:Math.min(750,Math.floor(size.x*size.y/650))},(_,i)=>({x:(i*.61803398875%1)*60,y:(i*.41421356237%1)*40,life:i%90}));},
    setEnabled(on){this.enabled=on;this.canvas.style.display=on?'block':'none';this.clear();},
    animate(dt){if(!this.enabled||!dt||!this.sim.cfg.sources.length||document.hidden)return;const c=this.ctx;c.save();c.globalCompositeOperation='destination-in';c.fillStyle='rgba(0,0,0,.90)';c.fillRect(0,0,this.w,this.h);c.restore();c.strokeStyle='rgba(248,253,255,.88)';c.lineWidth=1.25;c.beginPath();
      for(const p of this.particles){const w=this.sim.windAt(p),a=this.map.latLngToContainerPoint(F.toLatLng(p));p.x+=w.u*dt*65/F.CELL;p.y+=w.v*dt*65/F.CELL;p.life+=dt*35;const b=this.map.latLngToContainerPoint(F.toLatLng(p));if(p.x<0||p.y<0||p.x>60||p.y>40||p.life>100){p.x=Math.random()*60;p.y=Math.random()*40;p.life=0;continue;}c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);}c.stroke();}
  });
  class WeatherLayer{
    constructor(map,bounds,sim){this.map=map;this.sim=sim;this.mode='combined';this.opacity=.65;map.createPane('weatherPane');map.getPane('weatherPane').style.zIndex=250;map.getPane('weatherPane').style.pointerEvents='none';map.createPane('windPane');map.getPane('windPane').style.zIndex=350;map.getPane('windPane').style.pointerEvents='none';this.canvas=document.createElement('canvas');this.canvas.width=61;this.canvas.height=41;this.ctx=this.canvas.getContext('2d');this.image=L.imageOverlay('',bounds,{pane:'weatherPane',opacity:this.opacity,interactive:false}).addTo(map);this.wind=new WindLayer(sim).addTo(map);this.draw();}
    setMode(mode){if(!['wind','turbulence','fluctuation','combined','none'].includes(mode))return;this.mode=mode;this.wind.setEnabled(mode==='wind'||mode==='combined'||mode==='fluctuation');this.draw();}
    setOpacity(value){this.opacity=value;this.image.setOpacity(this.mode==='none'?0:value);}
    draw(){const mode=this.mode,img=this.ctx.createImageData(61,41),palettes={
      wind:[[0,[35,82,160]],[.12,[38,150,202]],[.34,[67,204,185]],[.65,[243,219,91]],[1,[241,111,67]]],
      fluctuation:[[0,[65,46,135]],[.25,[102,63,171]],[.5,[177,96,189]],[.75,[235,149,139]],[1,[255,219,110]]],
      turbulence:[[0,[34,86,101]],[.22,[50,147,131]],[.45,[222,184,83]],[.7,[238,121,63]],[1,[184,54,76]]]
    },stops=palettes[mode]||palettes.turbulence;
      function color(t){t=Math.max(0,Math.min(1,t));for(let i=1;i<stops.length;i++)if(t<=stops[i][0]){const[a,c]=stops[i-1],[b,d]=stops[i],k=(t-a)/(b-a);return c.map((v,j)=>Math.round(v+(d[j]-v)*k));}return stops.at(-1)[1];}
      for(let y=0;y<41;y++)for(let x=0;x<61;x++){const val=this.sim.data.field[y*61+x],w=this.sim.windAt({x,y}),c=color(mode==='wind'?Math.hypot(w.u,w.v)/24:mode==='fluctuation'?w.sigma/Math.sqrt(2):val/3),i=((40-y)*61+x)*4;img.data.set([...c,Number.isFinite(val)?225:0],i);}
      this.ctx.putImageData(img,0,0);this.image.setUrl(this.canvas.toDataURL());this.image.setOpacity(mode==='none'?0:this.opacity);this.wind.clear();
    }
    animate(dt){if(this.sim.status!=='paused')this.wind.animate(dt);}
  }
  root.WeatherLayer=WeatherLayer;
})(window);
