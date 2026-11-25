'use strict';
self.window=self;
importScripts('vendor/javascript-lp-solver-1.0.3.js?v=session-first-search-v1','session-builder-distribution.js?v=session-first-search-v1','session-builder-planning.js?v=session-first-search-v1','session-builder-diagnostics.js?v=session-first-search-v1','session-builder-optimisation.js?v=session-first-search-v1');
self.onmessage=event=>{
 try{const result=self.SessionBuilderOptimisation.estimate(...event.data,plan=>self.postMessage({type:'incumbent',result:plan}),diagnostics=>self.postMessage({type:'diagnostics',diagnostics}));self.postMessage({type:'complete',result});}
 catch(error){self.postMessage({rows:[],error:'Cost optimisation could not complete. Review the settings and try again.'});}
};
