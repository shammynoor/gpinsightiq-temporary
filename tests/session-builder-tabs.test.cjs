const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(saved,allowed=true){
 const text=fs.readFileSync('session-builder-rules.js','utf8'),code=text.slice(text.indexOf("const tabs=[['clinician'"),text.lastIndexOf('\n})();'));
 const elements=new Map(),prefs={sessionBuilderTab:saved};let rules=0,plans=0;
 const byId=id=>{if(!elements.has(id))elements.set(id,{hidden:false,tabIndex:0,attrs:{},events:{},setAttribute(k,v){this.attrs[k]=v},addEventListener(k,fn){this.events[k]=fn},focus(){this.focused=true}});return elements.get(id)};
 const window={gpChartPreferences:{read:()=>prefs,write:(key,value)=>prefs[key]=value},renderSessionBuilderRequirements:()=>plans++};
 const context={window,byId,canEditSessionBuilder:()=>allowed,renderSessionBuilderRules:()=>rules++};vm.createContext(context);vm.runInContext(code,context);return {window,prefs,byId,rules:()=>rules,plans:()=>plans};
}
test('five tabs restore saved choice and reveal the matching panel',()=>{
 const h=setup('planner');h.window.restoreSessionBuilderTab();assert.equal(h.byId('sessionBuilderPlannerPanel').hidden,false);assert.equal(h.byId('sessionBuilderTypesPanel').hidden,true);assert.equal(h.byId('sessionBuilderPlannerTab').attrs['aria-selected'],'true');assert.equal(h.plans(),1);
 h.byId('sessionBuilderClinicianTab').events.click();assert.equal(h.byId('sessionBuilderClinicianPanel').hidden,false);assert.equal(h.byId('sessionBuilderPlannerPanel').hidden,true);assert.equal(h.prefs.sessionBuilderTab,'clinician');
 h.byId('sessionBuilderRulesTab').events.click();assert.equal(h.rules(),1);
});
test('tab keyboard navigation wraps and preserves old types preference',()=>{
 const h=setup('types');h.window.restoreSessionBuilderTab();let prevented=false;h.byId('sessionBuilderTypesTab').events.keydown({key:'ArrowLeft',preventDefault(){prevented=true}});assert.ok(prevented);assert.equal(h.prefs.sessionBuilderTab,'clinician');assert.equal(h.byId('sessionBuilderClinicianTab').focused,true);
 h.byId('sessionBuilderClinicianTab').events.keydown({key:'End',preventDefault(){}});assert.equal(h.prefs.sessionBuilderTab,'planner');assert.equal(h.byId('sessionBuilderPlannerTab').tabIndex,0);
});

test('slot release tab loads the sandbox and remains within administrator-only controls',()=>{const h=setup('release');h.window.restoreSessionBuilderTab();assert.equal(h.byId('sessionBuilderReleasePanel').hidden,false);assert.equal(h.byId('sessionBuilderReleaseTab').attrs['aria-selected'],'true');assert.equal(h.byId('sessionBuilderReleaseFrame').src,'sandbox/slot-release-preview.html?v=slot-release-blocked-bars-v1');});

test('slot release tab is not opened without practice administrator access',()=>{const h=setup('release',false);h.window.restoreSessionBuilderTab();assert.equal(h.byId('sessionBuilderReleaseFrame').src,undefined);});
