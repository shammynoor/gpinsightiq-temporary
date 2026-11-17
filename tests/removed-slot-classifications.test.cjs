const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const html=fs.readFileSync(require.resolve('../dashboard.html'),'utf8');
const script=fs.readFileSync(require.resolve('../app.js'),'utf8');
test('retired classifications are absent from mapping and chart controls',()=>{
 for(const id of ['slotPurposeFilter','slotCapacityFilter','slotPurposeUnassignedOnly','slotCapacityUnassignedOnly','slotWorkspacePurpose','slotWorkspaceCapacity','demandCapacityToggles','waitingCapacityToggles','waitingTrendCapacityToggles'])assert.ok(!html.includes('id="'+id+'"'),id);
 const mapping=script.slice(script.indexOf('function renderSlotTable(){'),script.indexOf('/* Smart allocation'));
 assert.ok(!mapping.includes('purposeCell'));assert.ok(!mapping.includes('capacityCell'));
});
test('historical and urgent charts do not filter by retired category assignments',()=>{
 const historic=script.slice(script.indexOf('function includedRecord(r){'),script.indexOf('function monthOfPeriod'));
 assert.ok(!historic.includes('capacityAssignments'));
 const urgent=script.slice(script.indexOf('function renderAvailabilityChart(){'),script.indexOf('function renderRoutineCategoryToggles(){'));
 assert.ok(!urgent.includes('capacityAssignments'));
 assert.ok(urgent.includes('capacityChartStatus(r,urgentGroupWithheld,clock)'));
});
