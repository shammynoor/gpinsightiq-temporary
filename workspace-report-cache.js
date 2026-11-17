(function(root){
'use strict';
const version=source=>JSON.stringify([source.source_key,source.revision,source.imported_at,source.clinical_at,source.kind,source.row_count]);
const valid=value=>value&&((value.kind==='slot'&&Array.isArray(value.maps)&&value.maps.length===8&&value.maps.every(m=>Object.prototype.toString.call(m)==='[object Map]'))||(value.kind==='signposting'&&Array.isArray(value.events)));
function createCache(identity,practice){
 let active=true,opening;
 const prefix=JSON.stringify([identity,practice])+':';
 const open=()=>opening||(opening=new Promise((resolve,reject)=>{
  const request=indexedDB.open('gpinsight-report-cache-v1',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('reports');
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
 }));
 async function read(key){
  if(!active)return null;
  const db=await open();
  return new Promise((resolve,reject)=>{const req=db.transaction('reports','readonly').objectStore('reports').get(prefix+key);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error)});
 }
 async function write(key,entry){
  if(!active)return;
  const db=await open();if(!active)return;
  return new Promise((resolve,reject)=>{const tx=db.transaction('reports','readwrite');tx.objectStore('reports').put(entry,prefix+key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)});
 }
 async function removeExcept(keys){
  const db=await open();
  return new Promise((resolve,reject)=>{
   const tx=db.transaction('reports','readwrite'),store=tx.objectStore('reports'),request=store.openCursor();
   request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;if(typeof cursor.key==='string'&&cursor.key.startsWith(prefix)&&(!keys||!keys.has(cursor.key.slice(prefix.length))))cursor.delete();cursor.continue()};
   tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
 }
 async function clear(){active=false;await removeExcept(null)}
 async function prune(keys){if(active)await removeExcept(new Set(keys))}
 return {read,write,clear,prune};
}
async function loadReports(sources,memory,cache,read,concurrency=4){
 let next=0,downloaded=0,reused=0;
 const result=new Array(sources.length);
 async function worker(){
  while(true){
   const index=next++;if(index>=sources.length)return;
   const source=sources[index],token=version(source);
   let entry=memory.get(source.source_key);
   if(!entry||entry.token!==token||!valid(entry.value)){
    try{entry=await cache?.read(source.source_key)}catch(_){entry=null}
    if(!entry||entry.token!==token||!valid(entry.value)){
     const value=await read(source.source_key);
     if(!valid(value))throw Error('A saved report has an invalid format.');
     entry={revision:source.revision,token,value};downloaded++;
     try{await cache?.write(source.source_key,entry)}catch(_){}
    }else reused++;
   }else reused++;
   result[index]=entry;
  }
 }
 await Promise.all(Array.from({length:Math.min(concurrency,sources.length)},worker));
 return {entries:result,downloaded,reused};
}
const api={createCache,loadReports,version};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.GPReportCache=api;
})(typeof window!=='undefined'?window:globalThis);
