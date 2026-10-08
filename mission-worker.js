/* All dependencies are local. File:// browsers can use the UI's cooperative fallback. */
importScripts('seeded-weather.js','model.js','weather-physics.js','flight-telemetry.js?v=20261008-history','flight-engine.js?v=20261008-analysis','mission-analysis.js?v=20261008-analysis');
self.onmessage=async event=>{
  const {input,count,id}=event.data;
  try{const result=await MissionAnalysis.run(input,count,{progress:progress=>self.postMessage({id,type:'progress',progress})});self.postMessage({id,type:'result',result});}
  catch(error){self.postMessage({id,type:'error',message:error.message});}
};
