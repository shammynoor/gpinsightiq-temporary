'use strict';
self.window=self;
importScripts('vendor/javascript-lp-solver-1.0.3.js?v=planner-recent-routine-v1','vendor/highs.js?v=1.16.0','session-builder-mip.js?v=planner-recent-routine-v1','session-builder-distribution.js?v=planner-recent-routine-v1','session-builder-planning.js?v=planner-recent-routine-v1','session-builder-diagnostics.js?v=planner-recent-routine-v1','session-builder-optimisation.js?v=planner-recent-routine-v1');
self.onmessage=async event=>{
 try{
  const highs=await Module({locateFile:file=>new URL('vendor/'+file,self.location.href).href});
  self.SessionBuilderMip.initialize(highs);
  self.postMessage({type:'ready'});
  const result=self.SessionBuilderOptimisation.estimate(...event.data,plan=>self.postMessage({type:'incumbent',result:plan}),diagnostics=>self.postMessage({type:'diagnostics',diagnostics}));
  self.postMessage({type:'complete',result});
 }catch(error){
  self.postMessage({type:'complete',result:{rows:[],error:'The integer optimiser could not load or complete. Your previous plan is unchanged. Refresh and try Reset planner again.'}});
 }
};
