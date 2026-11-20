const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('app.js','utf8');
const status=source.slice(source.indexOf('function csvDropStatus('),source.indexOf('function csvDropOverlay('));
const start=source.indexOf('async function replaceExistingCSV(file){',source.indexOf('let iqSources='));
const upload=source.slice(start);
async function run(refreshOK){
 const statusEl={textContent:'',classList:{toggle(){}}},events=[],saved=[];
 const maps=Array.from({length:8},()=>new Map());maps[1].set('test',2);
 const context={iqUploading:false,csvDropBusy:false,isOwner:true,iqUploadStatus:{textContent:''},iqSources:[],iqContributions:new Map(),
  iqBridge:{ensure:async()=>{},list:async()=>[],save:async entry=>saved.push(entry),practice:{name:'Test'}},
  Papa:{parse:()=>({meta:{fields:[]}})},parseCSVContribution:()=>({kind:'slot',maps}),
  GPSessionsHistory:{holderTokens:async()=>new Map()},parseSlotReportCSV:()=>({columns:[],rows:[]}),
  confirm:()=>true,loadFolder:async()=>refreshOK,showRefreshFeedback:(message,loading)=>events.push({message,loading}),
  $:()=>statusEl,Date,Number,Map,JSON,Error};
 vm.createContext(context);vm.runInContext(status+'\n'+upload,context);
 await context.replaceExistingCSV({name:'report.csv',size:10,lastModified:Date.now()-60000,text:async()=>''});
 return {events,saved,status:context.iqUploadStatus.textContent};
}
(async()=>{let ok=await run(true);assert.equal(ok.saved.length,1);assert.equal(ok.events.at(-1).loading,false);assert.match(ok.status,/^Saved/);let fail=await run(false);assert.equal(fail.saved.length,1);assert.equal(fail.events.at(-1).loading,false);assert.match(fail.status,/Report saved.*do not upload/i);console.log('Upload feedback checks passed: successful and failed refresh stop the spinner and preserve saved status.');})().catch(e=>{console.error(e);process.exit(1)});
