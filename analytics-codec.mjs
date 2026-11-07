// Compressed aggregate contributions, never the uploaded CSV or patient identifiers.
export async function packContribution(value){
 const blob=new Blob([JSON.stringify(value,(_,item)=>Object.prototype.toString.call(item)==='[object Map]'?{$map:[...item]}:item)]);
 const bytes=new Uint8Array(await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
 let binary='';for(let start=0;start<bytes.length;start+=32768)binary+=String.fromCharCode(...bytes.subarray(start,start+32768));
 const result=btoa(binary);if(result.length>12000000)throw Error('This report is too large. Export a smaller reporting period.');return result;
}
export async function unpackContribution(encoded){
 if(typeof encoded!=='string'||encoded.length>12000000)throw Error('Invalid saved report.');
 const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
 const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
 // Bound decompression so a damaged aggregate cannot consume unlimited memory.
 const reader=stream.getReader(),parts=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>200000000){await reader.cancel();throw Error('Saved report exceeds the supported size.');}parts.push(value);}
 return JSON.parse(await new Blob(parts).text(),(_,item)=>item&&typeof item==='object'&&Object.keys(item).length===1&&Array.isArray(item.$map)?new Map(item.$map):item);
}
export async function sourceKey(kind,name){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(kind+':'+name.trim().toLowerCase()));
 return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
