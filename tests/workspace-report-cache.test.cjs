const test=require('node:test');
const assert=require('node:assert/strict');
const {loadReports}=require('../workspace-report-cache.js');
const source=(key,revision=1)=>({source_key:key,revision,imported_at:'2026-11-01',clinical_at:'2026-11-01',kind:'slot',row_count:1});
const report=key=>({kind:'slot',maps:Array.from({length:8},()=>new Map([[key,1]]))});
const fakeCache=()=>{const entries=new Map();return {entries,read:async k=>entries.get(k),write:async(k,v)=>entries.set(k,v)}};

test('unchanged reports are reused after reload; changed and new reports are fetched',async()=>{
 const cache=fakeCache(),memory=new Map(),first=[source('a'),source('b')],calls=[];
 const read=async key=>{calls.push(key);return report(key)};
 const a=await loadReports(first,memory,cache,read);
 assert.deepEqual([a.downloaded,a.reused],[2,0]);
 const b=await loadReports(first,new Map(),cache,read);
 assert.deepEqual([b.downloaded,b.reused],[0,2]);
 const c=await loadReports([source('a',2),source('c')],new Map(),cache,read);
 assert.deepEqual([c.downloaded,c.reused],[2,0]);
 assert.deepEqual(c.entries.map(e=>[...e.value.maps[0].keys()][0]),['a','c']);
 assert.deepEqual(calls,['a','b','a','c']);
});

test('downloads happen concurrently but return in source order',async()=>{
 let running=0,peak=0;
 const sources=Array.from({length:9},(_,i)=>source(String(i)));
 const out=await loadReports(sources,new Map(),null,async key=>{
  peak=Math.max(peak,++running);await new Promise(resolve=>setTimeout(resolve,(9-Number(key))*2));running--;return report(key);
 },4);
 assert.equal(peak,4);
 assert.deepEqual(out.entries.map(e=>[...e.value.maps[0].keys()][0]),sources.map(s=>s.source_key));
});

test('cache errors are ignored but failed downloads fail the refresh',async()=>{
 const cache={read:async()=>{throw Error('unavailable')},write:async()=>{throw Error('full')}};
 const ok=await loadReports([source('a')],new Map(),cache,async k=>report(k));
 assert.equal(ok.downloaded,1);
 await assert.rejects(loadReports([source('a')],new Map(),cache,async()=>{throw Error('offline')}),/offline/);
});

test('a revision reset with a new import timestamp does not reuse old data',async()=>{
 const cache=fakeCache(),s=source('a');
 await loadReports([s],new Map(),cache,async k=>report(k));
 const fresh={...s,imported_at:'2026-11-15'};
 const result=await loadReports([fresh],new Map(),cache,async k=>report(k));
 assert.equal(result.downloaded,1);
});
