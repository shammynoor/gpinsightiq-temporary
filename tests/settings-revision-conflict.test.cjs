const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
const helpers=source.slice(source.indexOf('let categoryDirty=false, cloudChangeSerial=0'),source.indexOf('async function saveCloudCategories(options={}'));
const lastSave=source.slice(source.lastIndexOf('async function saveCloudCategories(){'),source.lastIndexOf('async function openCSVCache()'));
function setup({storageFails=false,conflict=true}={}){
 const store=new Map(),elements=new Map(),calls=[],notices=[],timers=[];let current={version:9,sessionBuilderTypes:[{name:'Local edit'}]};
 const element=id=>{if(!elements.has(id))elements.set(id,{hidden:true,textContent:'',addEventListener(){}});return elements.get(id)};
 const context={console,Map,JSON,Error,Date,Blob,URL,window:{addEventListener:(event,fn)=>{context.unloadHandler=fn}},document:{},isOwner:true,cloudReady:true,cloudBusy:false,activeAccount:{id:'a'},cloudSaveTimer:null,iqSettingsRevision:7,
  iqLocalStorage:{getItem:key=>store.get(key),setItem:(key,value)=>{if(storageFails)throw Error('Storage unavailable');store.set(key,value)}},
  analyticsSettingsSnapshot:()=>JSON.stringify(current),validateCloudCategories:()=>{},cloudNotice:text=>notices.push(text),$ :element,
  setTimeout:fn=>{timers.push(fn);return timers.length},clearTimeout:()=>{},
  iqBridge:{saveSettings:async(snapshot,revision)=>{calls.push({snapshot,revision});if(conflict)throw {code:'P0001',message:'Settings changed in another session. Reload before editing.'};return revision+1}}};
 vm.createContext(context);vm.runInContext(helpers+'\n'+lastSave,context);
 return {context,store,elements,calls,notices,timers,setSnapshot:snapshot=>current=snapshot};
}
test('conflict preserves unsaved settings, warns clearly and stops future automatic retries',async()=>{
 const h=setup();assert.equal(await h.context.saveCloudCategories(),false);assert.equal(h.calls.length,1);
 assert.equal(h.elements.get('settingsConflictNotice').hidden,false);assert.match(h.elements.get('settingsConflictMessage').textContent,/not saved/);
 assert.equal(JSON.parse(h.store.get('gp-insight-unsaved-shared-settings-v1')).sessionBuilderTypes[0].name,'Local edit');
 h.setSnapshot({version:9,sessionBuilderTypes:[{name:'Newer local edit'}]});h.context.markCategoryDirty();
 assert.equal(JSON.parse(h.store.get('gp-insight-unsaved-shared-settings-v1')).sessionBuilderTypes[0].name,'Newer local edit');
 assert.equal(await h.context.saveCloudCategories(),false);assert.equal(h.calls.length,1);
});
test('if backup storage fails the warning does not claim a copy was saved',async()=>{
 const h=setup({storageFails:true});assert.equal(await h.context.saveCloudCategories(),false);
 assert.match(h.elements.get('settingsConflictMessage').textContent,/could not be backed up/);assert.equal(h.elements.get('settingsConflictDownload').hidden,true);
});
test('a normal save succeeds without displaying a conflict',async()=>{
 const h=setup({conflict:false});assert.equal(await h.context.saveCloudCategories(),true);assert.equal(h.calls.length,1);assert.equal(h.store.size,0);
});

test('database migration keeps access and revision checks but uses a non-retryable conflict code',()=>{
 const sql=fs.readFileSync('supabase/migrations/20261123195627_stop_revision_conflict_retries.sql','utf8');
 for(const name of ['iq_save_analytics_settings','iq_save_analytics_source','iq_delete_analytics_source']){
  const start=sql.indexOf('CREATE OR REPLACE FUNCTION iq_private.'+name+'(');assert.ok(start>=0,name);
  const end=sql.indexOf('end $function$;',start),body=sql.slice(start,end);
  assert.match(body,/iq_private\.iq_can_access\(p_practice,true\)/);assert.match(body,/p_expected/);
  assert.match(body,/errcode='P0001'/);assert.doesNotMatch(body,/errcode='40001'/);
 }
});

test('refresh warns only while shared settings are unsaved',async()=>{const h=setup({conflict:false});let prevented=false;const event={preventDefault(){prevented=true}};h.context.unloadHandler(event);assert.equal(prevented,false);h.context.markCategoryDirty();h.context.unloadHandler(event);assert.equal(prevented,true);await h.context.saveCloudCategories();prevented=false;h.context.unloadHandler(event);assert.equal(prevented,false);});
