'use strict';
self.window=self;
importScripts('vendor/javascript-lp-solver-1.0.3.js','session-builder-distribution.js?v=full-capacity-allocation-v1','session-builder-planning.js?v=full-capacity-allocation-v1','session-builder-optimisation.js?v=full-capacity-allocation-v1');
self.onmessage=event=>{
 try{const result=self.SessionBuilderOptimisation.estimate(...event.data,plan=>self.postMessage({type:'incumbent',result:plan}));self.postMessage({type:'complete',result});}
 catch(error){self.postMessage({rows:[],error:'Cost optimisation could not complete. Review the settings and try again.'});}
};
