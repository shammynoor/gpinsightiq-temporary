export const weekdays=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
export const canManage=practice=>practice?.active!==false&&practice?.status==='approved'&&['practice_admin','platform_admin'].includes(practice.role);
export function parseUpload(text,papa,rh=globalThis.DirectRHCSV){
 if(!rh)throw Error('The CSV importer did not load. Reload the page.');
 const {fields,rows}=rh.parse(text,papa),index=Object.fromEntries(fields.map((name,i)=>[name,i]));
 const tenants=new Set(),groups=new Map();
 for(const row of rows){
  const tenant=row[index.tenant_name].trim();if(!tenant)throw Error('A request has no tenant name.');tenants.add(tenant);
  const at=new Date(rh.timestamp(row[index.request_date],row[index.request_time])).toISOString().slice(0,19);
  const group=groups.get(at)||{at,total:0,other:0};group.total++;
  if(row[index.request_type].trim()==='Admin'&&row[index.admin_type].trim()==='OTHER_ENQUIRY')group.other++;
  groups.set(at,group);
 }
 if(tenants.size!==1)throw Error('Upload one practice at a time. This CSV contains several tenants.');
 if(groups.size>100000)throw Error('This export is too large for one MVP import. Export a smaller date range.');
 return {tenant:[...tenants][0],rows:[...groups.values()].sort((a,b)=>a.at.localeCompare(b.at)),count:rows.length};
}
export function monthlyAverages(state,daily){
 if(!state?.coverage_start||!state.coverage_end)return [];
 const counts=new Map(daily.map(row=>[row.request_date,Number(row.other_enquiries)])),months=new Map();
 const start=Date.parse(state.coverage_start+'T00:00:00Z'),end=Date.parse(state.coverage_end+'T00:00:00Z');
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)throw Error('Invalid report coverage.');
 for(let at=start;at<=end;at+=86400000){
  const date=new Date(at),key=date.toISOString().slice(0,10),month=key.slice(0,7),day=(date.getUTCDay()+6)%7;
  const record=months.get(month)||{month,counts:Array(7).fill(0),days:Array(7).fill(0)};
  record.counts[day]+=counts.get(key)||0;record.days[day]++;months.set(month,record);
 }
 return [...months.values()].map(row=>({...row,averages:row.counts.map((count,i)=>row.days[i]?count/row.days[i]:null)}));
}
export function validateConfig(config){
 if(!config?.supabaseUrl||!config?.publishableKey)return false;
 if(!/^https:\/\//.test(config.supabaseUrl))throw Error('The test backend must use HTTPS.');
 if(config.publishableKey.startsWith('sb_secret_'))throw Error('A server secret must never be placed in browser configuration.');
 if(config.publishableKey.startsWith('eyJ')){
  try{const data=JSON.parse(atob(config.publishableKey.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));if(data.role!=='anon')throw Error('Use a publishable or anon key, never an administrator key.');}
  catch(error){throw Error('Invalid public backend key: '+error.message);}
 }else if(!config.publishableKey.startsWith('sb_publishable_'))throw Error('Use the project publishable key.');
 return true;
}
export const formatDate=value=>value?new Date(value).toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/London'}):'No upload yet';
