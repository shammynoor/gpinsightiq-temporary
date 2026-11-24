const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){const context={window:{},document:{getElementById:()=>null},canEditSessionBuilder:()=>true,sessionBuilderClinicianLimits:{},sessionBuilderTypes:[{id:'one',eligibleClinicians:['Old GP']}],Object,Number,Error};vm.createContext(context);vm.runInContext(fs.readFileSync('session-builder-clinicians.js','utf8'),context);return context;}
test('validates minimum and optional maximum session limits',()=>{const c=setup(),validate=c.window.validateSessionBuilderClinicianLimits;assert.equal(validate({'GP Partner':{min:0,max:null}}),true);assert.equal(validate({'GP Partner':{min:3,max:5}}),true);assert.throws(()=>validate({'GP Partner':{min:6,max:5}}));assert.throws(()=>validate({'GP Partner':{min:-1,max:null}}));assert.throws(()=>validate({'GP Partner':{min:0,max:2.5}}));});
test('renaming a clinician type retains its saved limits',()=>{const c=setup();c.sessionBuilderClinicianLimits={'Old GP':{min:2,max:5}};c.window.renameSessionBuilderClinicianType('Old GP','New GP');assert.equal(c.sessionBuilderClinicianLimits['New GP'].min,2);assert.equal(c.sessionBuilderClinicianLimits['New GP'].max,5);assert.equal(Object.hasOwn(c.sessionBuilderClinicianLimits,'Old GP'),false);assert.equal(c.sessionBuilderTypes[0].eligibleClinicians[0],'New GP');});
test('validates working patterns and rates while preserving earlier saved limits',()=>{
 const validate=setup().window.validateSessionBuilderClinicianLimits;
 assert.equal(validate({GP:{min:0,max:null}}),true);
 assert.equal(validate({GP:{min:1,max:4,workingPattern:[],annualRate:0}}),true);
 assert.equal(validate({GP:{min:1,max:4,workingPattern:['Mon AM','Fri PM'],annualRate:1234.56}}),true);
 assert.throws(()=>validate({GP:{min:0,max:null,workingPattern:['Sat AM']}}));
 assert.throws(()=>validate({GP:{min:0,max:null,workingPattern:['Mon AM','Mon AM']}}));
 assert.throws(()=>validate({GP:{min:0,max:null,annualRate:-1}}));
 assert.throws(()=>validate({GP:{min:0,max:null,annualRate:1.234}}));
});
test('validates annual leave and sickness without breaking older settings',()=>{
 const validate=setup().window.validateSessionBuilderClinicianLimits;
 assert.equal(validate({GP:{min:0,max:null,annualLeaveWeeks:5,sicknessPercent:0}}),true);
 assert.equal(validate({GP:{min:0,max:null,annualLeaveWeeks:5.5,sicknessPercent:15}}),true);
 assert.throws(()=>validate({GP:{min:0,max:null,annualLeaveWeeks:52.5}}));
 assert.throws(()=>validate({GP:{min:0,max:null,annualLeaveWeeks:-1}}));
 assert.throws(()=>validate({GP:{min:0,max:null,sicknessPercent:3}}));
 assert.throws(()=>validate({GP:{min:0,max:null,sicknessPercent:105}}));
});
test('renaming a clinician retains absence settings',()=>{
 const c=setup();c.sessionBuilderClinicianLimits={'Old GP':{min:0,max:null,annualLeaveWeeks:6,sicknessPercent:10}};
 c.window.renameSessionBuilderClinicianType('Old GP','New GP');assert.equal(c.sessionBuilderClinicianLimits['New GP'].annualLeaveWeeks,6);assert.equal(c.sessionBuilderClinicianLimits['New GP'].sicknessPercent,10);
});
