const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){
 class Element{constructor(){this.children=[];this.events={};this.attrs={};this.dataset={};this.value='';}append(...nodes){this.children.push(...nodes)}replaceChildren(...nodes){this.children=nodes}setAttribute(k,v){this.attrs[k]=v}addEventListener(k,v){this.events[k]=v}checkValidity(){return true}setCustomValidity(){}reportValidity(){}focus(){}}
 const nodes=new Map(),byId=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id)},c={window:{},document:{getElementById:byId,createElement:()=>new Element()},Intl,canEditSessionBuilder:()=>true,sessionBuilderRules:[],sessionBuilderTypes:[{id:'greenwood',name:'Greenwood on-call',eligibleClinicians:['GP Partner','Salaried GP']},{id:'nurse',name:'Nursing',eligibleClinicians:['Nurse']}],clinicianGroupNames:['GP','Urgent Care Team'],clinicianCategoryNames:['GP Partner','Salaried GP','Nurse'],clinicianGroupAssignments:{'GP Partner':'GP','Salaried GP':'GP',Nurse:'Urgent Care Team'},groupUrgencyNames:['Same Day','Routine'],isDashboardToggleOption:()=>true,markCategoryDirty:()=>{},crypto:{randomUUID:()=> 'new-rule'}};vm.createContext(c);
 vm.runInContext(fs.readFileSync('session-builder-planning.js','utf8'),c);vm.runInContext(fs.readFileSync('session-builder-rules.js','utf8'),c);
 const all=()=>{const result=[];function visit(n){result.push(n);for(const child of n.children||[])visit(child)}visit(byId('sessionBuilderRulesBody'));return result;},control=label=>all().find(n=>n.attrs?.['aria-label']===label);
 return {c,byId,all,control};
}
test('session clinician mix is added only on request and defaults to exact weekly fifty percent',()=>{
 const h=setup();h.c.window.renderSessionBuilderRules();assert.equal(h.c.sessionBuilderRules.length,0);
 h.byId('sessionBuilderNewRuleKind').value='sessionClinicianMix';h.byId('sessionBuilderAddRule').events.click();
 const r=h.c.sessionBuilderRules[0];assert.equal(r.kind,'sessionClinicianMix');assert.equal(r.scope,'week');assert.deepEqual([...r.days],[1,2,3,4,5]);assert.equal(r.minimum,50);assert.equal(r.comparison,'exact');assert.equal(r.strength,'must');assert.equal(r.sessionTypeId,'greenwood');assert.equal(r.shareSubject.name,'GP Partner');
 assert.equal(h.c.window.validateSessionBuilderRules(JSON.parse(JSON.stringify(h.c.sessionBuilderRules))),true);
 assert.deepEqual(h.control('Period for rule 1').children.map(n=>n.value),['week']);assert.equal(h.control('Weekdays for rule 1'),undefined);
 const section=h.byId('sessionBuilderRulesBody').children[0];assert.equal(section.dataset.ruleKind,'sessionClinicianMix');assert.equal(section.children[0].textContent,'Session clinician mix');assert.match(section.children[1].children[0].children[0].textContent,/Exactly 50% of Greenwood on-call sessions provided by GP Partner.*Each week/);
 assert.deepEqual(h.control('Clinician type for rule 1').children.map(n=>n.value),['','GP Partner','Salaried GP']);
});
test('weekly session mix controls save clinician, comparison and percentage and preserve renamed types',()=>{
 const h=setup();h.byId('sessionBuilderNewRuleKind').value='sessionClinicianMix';h.byId('sessionBuilderAddRule').events.click();
 let input=h.control('Clinician type for rule 1');input.value='Salaried GP';input.events.change();assert.equal(h.c.sessionBuilderRules[0].shareSubject.name,'Salaried GP');
 input=h.control('Comparison for rule 1');input.value='atLeast';input.events.change();input=h.control('Session percentage for rule 1');input.value='40';input.events.change();assert.equal(h.c.sessionBuilderRules[0].minimum,40);assert.equal(h.c.sessionBuilderRules[0].comparison,'atLeast');
 assert.equal(h.c.window.inspectSessionBuilderRules().length,0);
 h.c.window.renameSessionBuilderRuleClinicianType('Salaried GP','Salaried doctor');assert.equal(h.c.sessionBuilderRules[0].shareSubject.name,'Salaried doctor');
});
test('weekly session mix validates scope and warns about removed or ineligible selections',()=>{
 const h=setup(),rule={id:'x',kind:'sessionClinicianMix',enabled:true,scope:'week',days:[1,2,3,4,5],sessionTypeId:'greenwood',minimum:50,comparison:'exact',strength:'must',shareSubject:{kind:'type',name:'GP Partner'}};
 assert.equal(h.c.window.validateSessionBuilderRules([rule]),true);
 assert.throws(()=>h.c.window.validateSessionBuilderRules([{...rule,scope:'day'}]));assert.throws(()=>h.c.window.validateSessionBuilderRules([{...rule,days:[1,2]}]));assert.throws(()=>h.c.window.validateSessionBuilderRules([{...rule,minimum:101}]));assert.throws(()=>h.c.window.validateSessionBuilderRules([{...rule,shareSubject:{kind:'group',name:'GP'}}]));
 const issues=r=>h.c.window.sessionBuilderRuleIssues(r,h.c.sessionBuilderTypes,h.c.clinicianGroupNames);
 assert.match(issues({...rule,sessionTypeId:'gone'})[0],/existing session/);assert.match(issues({...rule,shareSubject:{kind:'type',name:'Gone'}})[0],/existing clinician/);assert.match(issues({...rule,shareSubject:{kind:'type',name:'Nurse'}})[0],/not eligible/);
});
test('switching an existing rule to session clinician mix resets it to whole-week exact comparison',()=>{
 const h=setup();h.byId('sessionBuilderNewRuleKind').value='minimum';h.byId('sessionBuilderAddRule').events.click();let type=h.control('Rule type 1');type.value='sessionClinicianMix';type.events.change();const r=h.c.sessionBuilderRules[0];assert.equal(r.kind,'sessionClinicianMix');assert.equal(r.scope,'week');assert.equal(r.comparison,'exact');assert.equal(r.minimum,50);assert.equal(r.shareSubject.name,'GP Partner');assert.deepEqual([...r.days],[1,2,3,4,5]);
 let session=h.control('Session type for rule 1');session.value='nurse';session.events.change();assert.equal(h.c.sessionBuilderRules[0].sessionTypeId,'nurse');assert.equal(h.c.sessionBuilderRules[0].shareSubject.name,'Nurse');assert.deepEqual(h.control('Clinician type for rule 1').children.map(n=>n.value),['','Nurse']);
});
