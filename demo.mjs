// A separate, in-memory walkthrough. No passwords, sessions, CSVs, or records persist.
// This is a UI demonstration, not an authentication or security boundary.
export class DemoBackend{
 constructor(){
  this.demo=true;this.identity='platform';
  this.people={platform:{id:'platform',email:'owner@example.test'},admin:{id:'admin',email:'admin@darwin.example.test'},viewer:{id:'viewer',email:'viewer@darwin.example.test'},other:{id:'other',email:'viewer@riverside.example.test'},pending:{id:'pending',email:'new@darwin.example.test'}};
  this.practices=[{id:'darwin-demo',name:'Darwin · demo',tenant_name:'darwin',active:true},{id:'riverside-demo',name:'Riverside · demo',tenant_name:'riverside',active:true}];
  this.memberships=[{practice_id:'darwin-demo',user_id:'admin',role:'practice_admin',status:'approved'},{practice_id:'darwin-demo',user_id:'viewer',role:'viewer',status:'approved'},{practice_id:'darwin-demo',user_id:'pending',role:'viewer',status:'pending'},{practice_id:'riverside-demo',user_id:'other',role:'viewer',status:'approved'}];
  this.datasets=new Map(this.practices.map((p,i)=>[p.id,{state:{coverage_start:'2026-09-01',coverage_end:'2026-09-30',record_count:i?900:1400,latest_request:'2026-09-30T23:59:00',updated_at:'2026-10-01T08:30:00Z'},daily:Array.from({length:30},(_,d)=>({request_date:'2026-09-'+String(d+1).padStart(2,'0'),other_enquiries:(i?2:9)+(d%5)})),imports:[{source_name:'Synthetic example data',imported_at:'2026-10-01T08:30:00Z',added:i?900:1400,skipped:0}]}]));
 }
 async user(){return this.people[this.identity];}
 async logout(){}
 async context(){return {platform_admin:this.identity==='platform',practices:this.practices.flatMap(p=>{const m=this.memberships.find(m=>m.practice_id===p.id&&m.user_id===this.identity);return this.identity==='platform'?[{...p,role:'platform_admin',status:null}]:m?[{...p,role:m.role,status:m.status}]:[]})};}
 async require(practice,manage=false){const p=(await this.context()).practices.find(p=>p.id===practice);if(!p||p.status!=='approved'||(manage&&!['practice_admin','platform_admin'].includes(p.role)))throw Error('This demo account has no access to that practice.');return p;}
 async analyticsSources(practice){await this.require(practice);this.analytics ||=new Map();return [...this.analytics.values()].filter(row=>row.practice_id===practice).map(({payload,...row})=>({...row}));}
 async analyticsPayload(practice,key){await this.require(practice);return this.analytics?.get(practice+key)?.payload;}
 async analyticsSettings(practice){await this.require(practice);return structuredClone(this.sharedSettings?.get(practice)||{settings:null,revision:0});}
 async saveAnalyticsSource(practice,source){await this.require(practice,true);this.analytics ||=new Map();const key=practice+source.source_key,old=this.analytics.get(key);if((old?.revision||0)!==(source.revision||0))throw Error('Report changed. Refresh first.');this.analytics.set(key,{...source,practice_id:practice,revision:(old?.revision||0)+1,imported_at:new Date().toISOString()});return (old?.revision||0)+1;}
 async deleteAnalyticsSource(practice,key,revision){await this.require(practice,true);if(this.analytics?.get(practice+key)?.revision!==revision)throw Error('Report changed. Refresh first.');this.analytics.delete(practice+key);}
 async saveAnalyticsSettings(practice,settings,revision){await this.require(practice,true);this.sharedSettings ||=new Map();if((this.sharedSettings.get(practice)?.revision||0)!==revision)throw Error('Settings changed. Reload first.');this.sharedSettings.set(practice,{settings:structuredClone(settings),revision:revision+1});return revision+1;}
 async report(practice){await this.require(practice);return structuredClone(this.datasets.get(practice)||{state:null,daily:[],imports:[]});}
 async members(practice){
  const platform=this.identity==='platform';
  if(!platform)await this.require(practice,true);
  return this.memberships.filter(m=>m.practice_id===practice&&(!platform||m.role==='practice_admin')).map(m=>({...m,email:this.people[m.user_id]?.email||'New member'}));
 }
 async setStatus(practice,user,status){
  const platform=this.identity==='platform';
  if(!platform)await this.require(practice,true);
  if(user===this.identity)throw Error('You cannot change your own approval.');
  const member=this.memberships.find(m=>m.practice_id===practice&&m.user_id===user);
  if(!member||member.role!==(platform?'practice_admin':'viewer'))throw Error('You cannot manage this membership.');
  member.status=status;
 }
 async createPractice(name,tenant){if(this.identity!=='platform')throw Error('Platform administrator required.');if(this.practices.some(p=>p.tenant_name===tenant))throw Error('Tenant already exists.');const id=crypto.randomUUID();this.practices.push({id,name,tenant_name:tenant,active:true});return id;}
 async invite(practice,email,role){
  const platform=this.identity==='platform';
  if(!platform)await this.require(practice,true);
  if(role!==(platform?'practice_admin':'viewer')||!this.practices.some(p=>p.id===practice&&p.active))throw Error('You cannot invite this role to the practice.');
  return {token:crypto.randomUUID(),expires_at:new Date(Date.now()+7*86400000).toISOString()};
 }
 async importRH(practice,bundle,name){
  const p=await this.require(practice,true);if(p.tenant_name!==bundle.tenant)throw Error('CSV tenant does not match the selected practice.');
  const report=await this.report(practice),cutoff=report.state?.latest_request;let added=0,skipped=0,first,last,latest;
  const daily=new Map(report.daily.map(r=>[r.request_date,r.other_enquiries]));
  for(const group of bundle.rows){if(cutoff&&group.at<=cutoff){skipped+=group.total;continue;}const date=group.at.slice(0,10);daily.set(date,(daily.get(date)||0)+group.other);added+=group.total;first=!first||date<first?date:first;last=!last||date>last?date:last;latest=!latest||group.at>latest?group.at:latest;}
  if(added){report.state={coverage_start:report.state?.coverage_start&&report.state.coverage_start<first?report.state.coverage_start:first,coverage_end:report.state?.coverage_end&&report.state.coverage_end>last?report.state.coverage_end:last,record_count:(report.state?.record_count||0)+added,latest_request:latest,updated_at:new Date().toISOString()};report.daily=[...daily].map(([request_date,other_enquiries])=>({request_date,other_enquiries}));report.imports.unshift({source_name:name,imported_at:new Date().toISOString(),added,skipped});this.datasets.set(practice,report);}
  return {added,skipped};
 }
}
