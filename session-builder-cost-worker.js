'use strict';
self.window=self;
importScripts('vendor/javascript-lp-solver-1.0.3.js','session-builder-planning.js?v=manual-planner-reset-v1','session-builder-optimisation.js?v=manual-planner-reset-v1');
self.onmessage=event=>{
 try{self.postMessage(self.SessionBuilderOptimisation.estimate(...event.data));}
 catch(error){self.postMessage({rows:[],error:'Cost optimisation could not complete. Review the settings and try again.'});}
};
