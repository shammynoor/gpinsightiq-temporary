const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{Worker:NodeWorker}=require('node:worker_threads');
test('background worker executes the production solver, cancels stale plans and caches the current result',async()=>{
 let starts=0;
 class BrowserWorker{
  constructor(url){starts++;this.worker=new NodeWorker(`const {parentPort,workerData}=require('node:worker_threads'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');const c={console,Date};c.self=c;c.postMessage=r=>parentPort.postMessage(r);c.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(path.join(workerData,file.split('?')[0]),'utf8'),c));vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(workerData,'session-builder-cost-worker.js'),'utf8'),c);parentPort.on('message',data=>c.onmessage({data}));`,{eval:true,workerData:process.cwd()});this.worker.on('message',data=>this.onmessage?.({data}));this.worker.on('error',error=>this.onerror?.(error));}
  postMessage(args){this.worker.postMessage(args)}terminate(){this.worker.terminate()}
 }
 const c={window:{},Worker:BrowserWorker,setTimeout,clearTimeout};vm.createContext(c);vm.runInContext(fs.readFileSync('session-builder-optimisation.js','utf8'),c);
 const d={sameDay:[10,0,0,0,0],homeVisit:[0,0,0,0,0],weekly:0,routine:0,planned:0,eligibleDailyTypes:['Same Day'],types:{sameDay:['Same Day']},byType:{sameDay:{'Same Day':[10,0,0,0,0]}}},types=[{id:'gp',name:'GP',eligibleClinicians:['GP'],appointmentTypes:['Same Day'],appointmentsByMode:{Phone:10}}],args=[types,['Phone'],['GP'],d,[],{optimizeCost:true,respectTypes:true,clinicians:{GP:'GP'},clinicianLimits:{GP:{annualRate:10000,annualLeaveWeeks:0}},appointmentPools:{'Same Day':'sameDay'}}];
 const first=c.window.SessionBuilderOptimisation.estimateAsync(...args),next=structuredClone(args);next[3].sameDay[0]=30;next[3].byType.sameDay['Same Day'][0]=30;
 const second=c.window.SessionBuilderOptimisation.estimateAsync(...next);assert.equal((await first).cancelled,true);const result=await second;assert.equal(result.error,undefined);assert.equal(result.annualCost,30000);assert.equal(result.clinicianCounts.GP,3);assert.equal(starts,2);assert.equal(await c.window.SessionBuilderOptimisation.estimateAsync(...next),result);assert.equal(starts,2);
});
