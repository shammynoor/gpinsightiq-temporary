// Initialise the availability filter before the first category-editor render.
let selectedAvailabilityUrgency='';
"use strict";
// Single rule for every dashboard toggle: exclude this non-actionable mapping value.
function isDashboardToggleOption(name){
 const value=String(name||'').toLowerCase().replace(/[^a-z]/g,'');
 return value!=='unassigned' && !value.startsWith('notre') && !value.startsWith('notrv') && !value.startsWith('notapplic');
}

const CLIENT_ID='ba2bc895-4213-447c-ba62-d7edec6e8173';
const SCOPES=['Files.Read','Files.ReadWrite','Files.ReadWrite.AppFolder'];
const REDIRECT_URI='https://shammynoor.github.io/weekly-demand-dashboard/index.html';
const GRAPH='disabled:';
const FOLDER_KEY='weekly-demand-onedrive-folder-v1';
// A specific-person, view-only practice workspace share; not an authentication credential.
// Only accounts explicitly granted access in practice workspace can read this folder.
const SHARED_FOLDER_LINK='https://1drv.ms/f/c/07c73540cffc666d/IgDtAqPOppU4RI0NK-J0JwZwARwoZ83uuDlzEzq8G_hJW9Q?e=QiECEF';
const OWNER_DRIVE_ID='07c73540cffc666d';
const SHARED_SETTINGS_FILE='weekly-demand-categories.json';
const SHARED_TOKEN='u!'+btoa(unescape(encodeURIComponent(SHARED_FOLDER_LINK))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
let isOwner=false,sharedDriveId='',sharedFolderId='';
let workforceWeeklySessions=new Map();
let folderAccessVerified=false,folderAccessDenied=false,authNeedsAccountSelection=false,authChecking=false;
let dashboardIdleState=null,dashboardIdleInterval=null,dashboardLogoutRunning=false;
try{authNeedsAccountSelection=!!iqSessionStorage.getItem('gp-insight-account-selection-required');}catch(_){}
function sharedPath(){return '/shares/'+SHARED_TOKEN+'/driveItem'}
function sourceItemUrl(id){return isOwner?'/me/drive/items/'+encodeURIComponent(id):'/drives/'+encodeURIComponent(sharedDriveId)+'/items/'+encodeURIComponent(id)}
// One menu lifecycle for Activity, Capacity, Forecast and Settings.
const dashboardMenus=[...document.querySelectorAll('.dashboard-nav > .nav-demand-menu,.dashboard-nav > .nav-availability-menu,.dashboard-nav > .nav-settings-menu')];
function positionDashboardSubmenu(menu){
 if(!window.matchMedia('(max-width:1100px)').matches||menu.classList.contains('nav-settings-menu'))return;
 const panel=menu.querySelector(':scope > div'),nav=menu.closest('.dashboard-nav');if(!panel||!nav)return;
 panel.style.setProperty('--nav-dropdown-shift','0px');
 const bounds=nav.getBoundingClientRect(),popup=panel.getBoundingClientRect();
 const shift=Math.max(bounds.left+4-popup.left,Math.min(0,bounds.right-4-popup.right));
 panel.style.setProperty('--nav-dropdown-shift',shift+'px');
}
function setDashboardMenuOpen(menu,open){
 menu.classList.toggle('open',open);
 menu.querySelector(':scope > button')?.setAttribute('aria-expanded',String(open));
 if(!open)delete menu.dataset.clickOpen;
 else positionDashboardSubmenu(menu);
}
function closeDashboardMenus(except=null){
 for(const menu of dashboardMenus)if(menu!==except)setDashboardMenuOpen(menu,false);
}
window.closeDashboardMenus=closeDashboardMenus;
window.addEventListener('resize',()=>{for(const menu of dashboardMenus)if(menu.classList.contains('open'))positionDashboardSubmenu(menu)});
for(const menu of dashboardMenus){
 const trigger=menu.querySelector(':scope > button');
 if(!trigger)continue;
 menu.classList.add('nav-menu-managed');menu.classList.remove('menu-dismissed');
 trigger.setAttribute('aria-haspopup','true');trigger.setAttribute('aria-expanded','false');
 // Hover navigation is for real mouse pointers only. Touchscreens use click-to-open.
 menu.addEventListener('pointerenter',event=>{
  if(!window.matchMedia('(hover: hover) and (pointer: fine)').matches || event.pointerType==='touch' || menu.dataset.clickOpen==='true')return;
  closeDashboardMenus(menu);setDashboardMenuOpen(menu,true);
 });
 menu.addEventListener('pointerleave',event=>{
  if(event.pointerType==='touch' || !window.matchMedia('(hover: hover) and (pointer: fine)').matches)return;
  setDashboardMenuOpen(menu,false);
 });
 trigger.addEventListener('click',event=>{
  event.stopPropagation();const open=menu.dataset.clickOpen!=='true';
  closeDashboardMenus(menu);setDashboardMenuOpen(menu,open);
  if(open)menu.dataset.clickOpen='true';
 });
 trigger.addEventListener('keydown',event=>{
  if(event.key!=='ArrowDown'&&event.key!=='ArrowUp')return;
  event.preventDefault();closeDashboardMenus(menu);setDashboardMenuOpen(menu,true);
  const items=[...menu.querySelectorAll(':scope > div button:not(:disabled)')];
  ((event.key?.startsWith(iqStorageScope)?event.key.slice(iqStorageScope.length):null)==='ArrowUp'?items[items.length-1]:items[0])?.focus();
 });
 menu.addEventListener('click',event=>{if(event.target.closest('button')!==trigger){closeDashboardMenus();hideDayView2Tooltip();}});
 // On mobile, tapping an option can blur the trigger before its click.
 // Outside taps and selection already close the menu explicitly.
 menu.addEventListener('focusout',event=>{
  if(window.matchMedia('(hover: hover) and (pointer: fine)').matches && !menu.contains(event.relatedTarget))setDashboardMenuOpen(menu,false);
 });
}
document.addEventListener('pointerdown',event=>{if(!event.target.closest('.nav-menu-managed'))closeDashboardMenus();});
document.addEventListener('keydown',event=>{
 if(event.key!=='Escape')return;
 const active=dashboardMenus.find(menu=>menu.classList.contains('open'));
 closeDashboardMenus();if(active?.contains(document.activeElement))active.querySelector(':scope > button')?.focus();
});
function updateHeaderIdentity(){
 const label=$('accountLabel');if(!label)return;
 const saved=readPersonalSettings();
 label.textContent=(typeof saved.name==='string'&&saved.name.trim())||activeAccount?.name||activeAccount?.username||'Microsoft account';
 label.title=activeAccount?.username||'';
}
let headerReportTimestamp=null,headerRefreshLoading=false;
function headerReportAge(timestamp,now=Date.now()){
 if(!Number.isFinite(timestamp)||Number.isNaN(new Date(timestamp).getTime()))return {text:'',stale:false};
 const elapsed=Math.max(0,now-timestamp),minutes=Math.floor(elapsed/60000),hours=Math.floor(minutes/60);
 const unit=(n,name)=>n+' '+name+(n===1?'':'s');
 return {text:'EMIS refresh '+(elapsed<7200000?unit(hours,'hour')+' '+unit(minutes%60,'minute'):unit(hours,'hour'))+' ago',stale:elapsed>7200000};
}
function updateHeaderReportAge(timestamp,now=Date.now()){
 const age=$('headerReportAge'),row=$('headerReportAgeRow'),reminder=$('headerEmisReminder');
 const info=headerReportAge(timestamp,now);
 if(age)age.textContent=headerRefreshLoading?'EMIS refresh in progress…':info.text||'EMIS refresh unavailable';
 if(row)row.hidden=false;
 if(reminder)reminder.hidden=true;
}
function updateHeaderSlotReportTime(timestamp){
 headerReportTimestamp=timestamp;
 if(headerRefreshLoading)return;
 const label=$('headerSlotRefreshed');if(!label)return;
 const valid=Number.isFinite(timestamp)&&!Number.isNaN(new Date(timestamp).getTime());
 label.textContent='Last clinical system download: '+(valid?new Date(timestamp).toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Europe/London'}):'unavailable');
 label.title=valid?'Latest successfully imported Slot Report file · London time':'No imported Slot Report timestamp is available.';
 updateHeaderReportAge(timestamp);
}
function closeHeaderNavigation(){
 const nav=document.querySelector('.dashboard-nav'),toggle=$('headerMenuToggle');
 nav?.classList.remove('header-menu-open');toggle?.setAttribute('aria-expanded','false');toggle?.setAttribute('aria-label','Open navigation menu');
}
function setupResponsiveHeader(){
 const nav=document.querySelector('.dashboard-nav'),toggle=$('headerMenuToggle');if(!nav||!toggle)return;
 const narrow=window.matchMedia('(max-width:1100px)');
 const setOpen=open=>{
  const expanded=!!open&&narrow.matches;nav.classList.toggle('header-menu-open',expanded);
  toggle.setAttribute('aria-expanded',String(expanded));toggle.setAttribute('aria-label',expanded?'Close navigation menu':'Open navigation menu');
  if(!expanded)closeDashboardMenus();
 };
 toggle.addEventListener('click',()=>setOpen(toggle.getAttribute('aria-expanded')!=='true'));
 nav.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.id==='navHome'||button.closest('.nav-demand-dropdown,.nav-availability-dropdown,.nav-settings-dropdown'))setOpen(false);
 });
 document.addEventListener('pointerdown',event=>{if(!nav.contains(event.target))setOpen(false);const accountMenu=$('headerAccountMenu');if(accountMenu&&!accountMenu.contains(event.target))accountMenu.removeAttribute('open');});
 document.addEventListener('keydown',event=>{if((event.key?.startsWith(iqStorageScope)?event.key.slice(iqStorageScope.length):null)==='Escape'&&nav.classList.contains('header-menu-open')){setOpen(false);toggle.focus();}});
 const widthChanged=()=>setOpen(false);if(narrow.addEventListener)narrow.addEventListener('change',widthChanged);else narrow.addListener(widthChanged);
 $('headerPersonalSettings')?.addEventListener('click',()=>{$('headerAccountMenu')?.removeAttribute('open');showPage('personalSettings')});
}

function applyAccessMode(){
 document.body.classList.toggle('viewer-mode',!isOwner);
 for(const id of ['navCategories','navPeople','navPracticeSettings','chooseFolder','sourceSetup']){const el=document.getElementById(id);if(el)el.hidden=!isOwner}
 const label=document.getElementById('accessRoleLabel');if(label)label.textContent=iqBridge?.platformAdmin?'Platform administrator':isOwner?'Practice administrator':'Practice viewer';
}
async function identifyOwner(){
 const drive=await graph('/me/drive?$select=id');
 isOwner=String(drive.id||'').toLowerCase()===OWNER_DRIVE_ID.toLowerCase();
 applyAccessMode();
}
async function locateSharedFolder(){
 // Access must be confirmed by Microsoft Graph for this signed-in account.
 const root=await graph(sharedPath());
 if(!root.folder)throw Error('The sharing link does not point to a folder.');
 sharedDriveId=root.parentReference?.driveId||'';
 sharedFolderId=root.id||'';
 if(!sharedDriveId||!sharedFolderId)throw Error('Microsoft did not return the shared folder drive and item identifiers.');
 return {id:sharedFolderId,name:root.name||'Shared dashboard folder',shared:true};
}
async function readSharedSettings(){
 // Resolve the file from the folder's children, which works with shared personal practice workspace.
 // A sharing-link path followed by :/filename:/content is not consistently supported.
 const folder=await locateSharedFolder();
 const files=await children(folder.id);
 const settings=files.find(item=>item.file&&item.name.toLowerCase()===SHARED_SETTINGS_FILE.toLowerCase());
 if(!settings)return null;
 // The children response is already scoped to the verified sharing link.
 // Personal practice workspace recipients may not be able to resolve owner drive IDs directly.
 let downloadUrl=settings['@microsoft.graph.downloadUrl'];
 if(!downloadUrl){
  try{const detail=await graph(sourceItemUrl(settings.id));downloadUrl=detail['@microsoft.graph.downloadUrl'];}
  catch(error){throw Error('Shared settings file was found but could not be downloaded ('+(error.code||error.status||error.message)+').');}
 }
 if(!downloadUrl)throw Error('Microsoft did not provide a download link for shared settings.');
 const response=await fetch(downloadUrl,{cache:'no-store'});
 if(!response.ok)throw Error('Shared settings download failed (HTTP '+response.status+')');
 const data=parseSettingsJSON(await response.text());
 if(!data||!Array.isArray(data.categories)||!data.assignments||typeof data.assignments!=='object')
  throw Error('Shared settings JSON does not contain valid categories and slot assignments.');
 if(!Object.keys(data.assignments).length)
  throw Error('Shared settings file contains no slot type assignments. Ask the administrator to check Slot settings.');
 return data;
}

let records=[],weeks=[],types=[],statuses=[],clinicianTypes=[],bookingTimeRecords=[],appointmentTimeRecords=[];
let availabilityRecords=[];
let capacityCSVLatestModified=null;
let slotReportCoverage=[],settingsRefreshing=false;
let analyticsRoles={};
try{analyticsRoles=JSON.parse(iqLocalStorage.getItem("appointment-dashboard-categories-v1")||"{}").analyticsRoles||{}}catch(_){}
function ensureAnalyticsRoles(){return analyticsRoles=GPCorrectness.roles(analyticsRoles,groupUrgencyNames,clinicianGroupNames,appointmentCategoryFor)}
function appointmentCalculationRole(name){if(!groupUrgencyNames.includes(name))return "other";if(!Object.hasOwn(analyticsRoles.appointmentTypes||{},name))ensureAnalyticsRoles();return analyticsRoles.appointmentTypes[name]?.kind||"other"}
function isDoctorPlanningGroup(name){if(!Object.hasOwn(analyticsRoles.clinicianGroups||{},name))ensureAnalyticsRoles();return !!analyticsRoles.clinicianGroups[name]?.doctor}
function renameAnalyticsRole(dimension,oldName,newName){ensureAnalyticsRoles();GPCorrectness.renameRole(analyticsRoles,dimension,oldName,newName)}
function refreshPrimaryApptTypeBoxes(){for(const id of PRIMARY_APPT_ROOT_IDS)enhancePrimaryApptTypeBox($(id))}

let capacityPaceCache=null;
let waitingTimeRecords=[],waitingTrendRecords=[];
let waitingTrendDimensionCache=new WeakMap();
let waitingTrendAvailableMonths=[];
let waitingAppointmentMonthStart='',waitingAppointmentMonthEnd='',waitingAppointmentMonthBounds='';
let waitingTrendMonthStart='',waitingTrendMonthEnd='',waitingTrendMonthBounds='';
const waitingTrendDisabledUrgency=new Set();
const waitingTrendDisabled={consult:new Set(),capacity:new Set(),clinician:new Set()};
const waitingDisabledUrgency=new Set();
let userTypeLocum={};
const locumFilterPages=['chartPage','availabilityPage','routineAvailabilityPage','routineCapacityPage','waitingTimesPage','waitingOverTimePage','dayView2Page','bookingTimesPage','dailyForecastPage','weeklyForecastPage','workforceNeedPage'];
const locumFilterSelections=new Map();
function locumCategory(row){
 return Object.hasOwn(userTypeLocum,row.clinician)&&userTypeLocum[row.clinician]==='yes'?'Locum':'Not Locum';
}
function locumMatches(row,page){
 return locumFilterSelections.get(page)?.[locumCategory(row)]!==false;
}
function installLocumFilters(){
 const preferences=readChartPreferences();
 for(const page of locumFilterPages){
  const root=$(page+'Locum');
  if(!root)continue;
  const key='locum:'+page;
  const selection={Locum:preferences[key]?.Locum!==false,'Not Locum':preferences[key]?.['Not Locum']!==false};
  locumFilterSelections.set(page,selection);
  for(const input of root.querySelectorAll('input')){
   const name=input.dataset.filterName;
   input.checked=selection[name];
   input.addEventListener('change',event=>{
    event.stopPropagation();
    selection[name]=input.checked;
    writeChartPreference(key,{...selection});
    demandFilterCache=new WeakMap();
    capacityPaceCache=null;
    updateCollapsedFilterSummaries();
    void renderActiveAnalyticsPage().catch(error=>showRefreshFeedback('Chart refresh failed: '+error.message));
   });
  }
 }
 updateCollapsedFilterSummaries();
}
// One customisable colour per Clinician Group (never per detailed type).
let clinicianGroupColours={};
let clinicianTypeColours={};
let urgencyTypeColours={};

// Curated 18-colour spectrum: cohesive, deep pastel shades rather than unrestricted RGB.
const DASHBOARD_COLOUR_PALETTE=["#D9485F", "#F06438", "#E88C28", "#D9B528", "#9DAF30", "#42A54C", "#19A886", "#0C9D9B", "#1C91C5", "#3778D6", "#6557D2", "#9348BE", "#C34C9B", "#B95D72", "#9E5737", "#718E38", "#3C9A78", "#377C8C", "#4C70A3", "#7E68AC", "#A861A1", "#C87C42", "#E6C4B3", "#B8D5A5", "#9BD8D6", "#9AB8EB", "#D4A9E6", "#FFFFFF", "#929AA4", "#30343B"];
function showDashboardColourPalette(anchor,input){
 document.querySelectorAll('.dashboard-colour-popover').forEach(el=>el.remove());
 const popup=document.createElement('div');popup.className='dashboard-colour-popover';popup.setAttribute('role','group');popup.setAttribute('aria-label','Choose from 30 coordinated colours');
 DASHBOARD_COLOUR_PALETTE.forEach((hex,i)=>{
  const b=document.createElement('button');b.type='button';b.className='dashboard-colour-swatch';b.style.backgroundColor=hex;b.title='Colour '+(i+1);b.setAttribute('aria-label','Select colour '+(i+1));
  if(input.value.toLowerCase()===hex)b.classList.add('selected');
  b.addEventListener('click',event=>{event.stopPropagation();input.value=hex;input.dispatchEvent(new Event('change',{bubbles:true}));popup.remove()});popup.append(b);
 });
 document.body.append(popup);
 const rect=anchor.getBoundingClientRect();const width=popup.offsetWidth;
 popup.style.left=Math.max(8,Math.min(window.innerWidth-width-8,rect.left))+'px';
 popup.style.top=(rect.bottom+popup.offsetHeight+10<window.innerHeight?rect.bottom+7:Math.max(8,rect.top-popup.offsetHeight-7))+'px';
 const dismiss=event=>{if(!popup.contains(event.target)&&!anchor.contains(event.target)){popup.remove();document.removeEventListener('pointerdown',dismiss,true)}};
 setTimeout(()=>document.addEventListener('pointerdown',dismiss,true),0);
}
function installDashboardColourPicker(wrap,input){
 // Keep the existing input/change handlers and saved-settings flow; replace native picker UI only.
 input.tabIndex=-1;input.setAttribute('aria-hidden','true');
 wrap.setAttribute('role','button');wrap.tabIndex=0;
 wrap.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();showDashboardColourPalette(wrap,input)});
 wrap.addEventListener('keydown',event=>{if((event.key?.startsWith(iqStorageScope)?event.key.slice(iqStorageScope.length):null)==='Enter'||(event.key?.startsWith(iqStorageScope)?event.key.slice(iqStorageScope.length):null)===' '){event.preventDefault();showDashboardColourPalette(wrap,input)}});
}

const TYPE_PALETTE=['#d4777e','#9978c8','#e4b94f','#72a9d5','#6eaea6','#cf8eb7','#82b789','#c79c70'];
function typeColour(name,overrides){if(/^#[0-9a-f]{6}$/i.test(overrides[name]||''))return overrides[name];let hash=0;for(const c of String(name).toLowerCase())hash=(hash*31+c.charCodeAt(0))>>>0;return TYPE_PALETTE[hash%TYPE_PALETTE.length]}
function urgencyGroupColour(name){return typeColour(name,urgencyTypeColours)}
function clinicianTypeColour(name){return typeColour(name,clinicianTypeColours)}
function typeColourPicker(type,kind,onChanged){const colour=kind==='urgency'?urgencyTypeColours:clinicianTypeColours;const current=kind==='urgency'?urgencyTypeColour(type):clinicianTypeColour(type);const wrap=document.createElement('label');wrap.className='people-colour-control people-type-colour-control';wrap.title='Change colour for '+type;wrap.draggable=false;const dot=document.createElement('span');dot.className='clinician-colour-dot';dot.style.backgroundColor=current;const input=document.createElement('input');input.className='people-colour-picker';input.type='color';input.value=current;input.setAttribute('aria-label','Choose colour for '+type);input.addEventListener('change',()=>{colour[type]=input.value;onChanged()});wrap.append(dot,input);installDashboardColourPicker(wrap,input);return wrap}

const CLINICIAN_GROUP_PALETTE=['#78a9d1','#85bb99','#b49bd3','#dea37e','#80bdbf','#d493b0','#b8ae75','#8badd1','#b1a0ca','#c89e80'];
function clinicianGroupColour(group){
 if(!group||!clinicianGroupNames.includes(group))return '#aab5c1';
 if(/^#[0-9a-f]{6}$/i.test(clinicianGroupColours[group]||''))return clinicianGroupColours[group];
 const index=clinicianGroupNames.indexOf(group);
 return CLINICIAN_GROUP_PALETTE[index%CLINICIAN_GROUP_PALETTE.length];
}
function clinicianColourDot(group){
 const dot=document.createElement('span');dot.className='clinician-colour-dot';
 dot.style.backgroundColor=clinicianGroupColour(group);dot.title=group+' group colour';return dot;
}
function effectiveClinicianType(clinician){
 return Object.hasOwn(clinicianAssignments,clinician)?clinicianAssignments[clinician]||'':'';
}
function refreshClinicianCharts(){
 if(!$('chartPage')?.classList.contains('hidden'))scheduleDemandRefresh();
 if(!$('availabilityPage')?.classList.contains('hidden'))renderAvailabilityChart();
 if(!$('routineAvailabilityPage')?.classList.contains('hidden'))renderRoutineAvailabilityChart();
 if(!$('bookingTimesPage')?.classList.contains('hidden'))renderBookingTimesChart();
}
// Slot settings uses the same compact group/type organiser as People settings.
let urgencyGroupColours={};
const URGENCY_GROUP_PALETTE=['#cf7e89','#83afca','#85b69b','#bd9cc9','#d3ad71','#79b9b8','#d49a83','#9daccf'];
function urgencyGroupColour(group){
 if(/^#[0-9a-f]{6}$/i.test(urgencyGroupColours[group]||''))return urgencyGroupColours[group];
 const i=groupUrgencyNames.indexOf(group);
 return i>=0?URGENCY_GROUP_PALETTE[i%URGENCY_GROUP_PALETTE.length]:'#aab5c1';
}
function renderConsultModeCards(){
 const root=$('slotConsultModeCards'),add=$('slotAddConsultMode');if(!root||!add)return;
 root.replaceChildren();
 const edit=(oldName='')=>{
  const wrapper=document.createElement('div');wrapper.className='slot-mode-editor';
  const input=document.createElement('input');input.type='text';input.placeholder='e.g. Video';input.value=oldName;
  const save=document.createElement('button');save.type='button';save.textContent='Save';
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';
  const commit=()=>{
   const name=input.value.trim();
   if(!name||name.toLowerCase()==='uncategorised'||consultCategoryNames.some(value=>value.toLowerCase()===name.toLowerCase()&&value!==oldName)){alert('Enter a unique consultation mode.');return}
   if(oldName){
    consultCategoryNames=consultCategoryNames.map(value=>value===oldName?name:value);
    for(const slot of Object.keys(consultAssignments))if(consultAssignments[slot]===oldName)consultAssignments[slot]=name;
    if(consultModeColours[oldName]){consultModeColours[name]=consultModeColours[oldName];delete consultModeColours[oldName]}
   }else consultCategoryNames.push(name);
   saveCategories();renderConsultModeCards();renderSlotTable();renderConsultEditor();
  };
  save.addEventListener('click',commit);cancel.addEventListener('click',renderConsultModeCards);
  input.addEventListener('keydown',event=>{if((event.key?.startsWith(iqStorageScope)?event.key.slice(iqStorageScope.length):null)==='Enter')commit();if((event.key?.startsWith(iqStorageScope)?event.key.slice(iqStorageScope.length):null)==='Escape')renderConsultModeCards()});
  wrapper.append(input,save,cancel);return {wrapper,input};
 };
 for(const name of consultCategoryNames){
  const row=document.createElement('div');row.className='slot-mode-item';
  const colour=slotCategoryColourPicker(name,consultModeColours,()=>{saveCategories();renderConsultModeCards()});
  const label=document.createElement('span');label.textContent=name;
  const rename=document.createElement('button');rename.type='button';rename.textContent='✎';rename.title='Rename '+name;
  rename.addEventListener('click',()=>{const {wrapper,input}=edit(name);row.replaceChildren(wrapper);input.focus();input.select()});
  const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.title='Delete '+name;
  remove.addEventListener('click',()=>{
   const count=Object.values(consultAssignments).filter(value=>value===name).length;
   if(!confirm('Delete consultation mode "'+name+'"? '+count+' assigned slot types will become unassigned.'))return;
   consultCategoryNames=consultCategoryNames.filter(value=>value!==name);delete consultModeColours[name];
   for(const slot of Object.keys(consultAssignments))if(consultAssignments[slot]===name)consultAssignments[slot]='Uncategorised';
   saveCategories();renderConsultModeCards();renderSlotTable();renderConsultEditor();
  });
  row.append(colour,label,rename,remove);root.append(row);
 }
 add.onclick=()=>{const {wrapper,input}=edit();root.append(wrapper);input.focus()};
}
function suggestConsultMode(slot){
 // Underscores are word characters in JavaScript, so use alphanumeric boundaries
 // to recognise names such as GP_F2F, F2F_15, and F2F-urgent.
 const value=String(slot||'').toLowerCase();
 const token=pattern=>new RegExp('(^|[^a-z0-9])(?:'+pattern+')(?=$|[^a-z0-9])','i').test(value);
 const matches=[
  {found:token('telephone|telephony|phone|phoned|tel|tele|t\\/c|callback|call[ -]?back|telephone[ -]?triage|remote[ -]?phone'),modes:['Phone','Telephone','Telephone consultation']},
  {found:token('video|video[ -]?call|video[ -]?consultation|virtual[ -]?video|teams|zoom|webcam'),modes:['Video','Video call','Video consultation']},
  {found:token('home[ -]?visit|homevisit|domiciliary|house[ -]?call|visit[ -]?at[ -]?home|hv'),modes:['Visit','Home visit']},
  {found:token('f[ .-]?2[ .-]?f|face[ -]?to[ -]?face|in[ -]?person|clinic[ -]?appointment|surgery[ -]?appointment|in[ -]?clinic'),modes:['Face-to-face','Face to face','F2F','In person']}
 ].filter(rule=>rule.found);
 // Do not guess when the slot name explicitly signals conflicting modes.
 if(matches.length!==1)return '';
 const configured=matches[0].modes.map(mode=>consultCategoryNames.find(name=>name.toLowerCase()===mode.toLowerCase())).find(Boolean);
 return configured||'';
}
function consolidateUrgencyGroups(){
 // Preserve chart compatibility: each urgency group is its own sole internal category.
 const groups=[...groupUrgencyNames];
 if(!groups.length){categoryNames=[];groupUrgencyAssignments={};assignments=Object.fromEntries(Object.keys(assignments).map(slot=>[slot,'Uncategorised']));return;}
 const previous={...groupUrgencyAssignments};
 const converted={};
 for(const [slot,type] of Object.entries(assignments)){
  converted[slot]=groups.includes(type)?type:(groups.includes(previous[type])?previous[type]:'Uncategorised');
 }
 assignments=converted;
 categoryNames=groups.slice();
 groupUrgencyAssignments=Object.fromEntries(groups.map(group=>[group,group]));
}
// Appointment categories are a second, independent grouping above appointment types.
const DEFAULT_APPOINTMENT_CATEGORIES=['Urgent Care','Routine Care','Planned Care','Other'];
let appointmentCategoryNames=DEFAULT_APPOINTMENT_CATEGORIES.slice(),appointmentCategoryAssignments={},appointmentCategoryColours={};
try{const saved=JSON.parse(iqLocalStorage.getItem('appointment-dashboard-categories-v1')||'{}');
 if(Array.isArray(saved.appointmentCategoryNames))appointmentCategoryNames=validCategoryNames(saved.appointmentCategoryNames);
 if(saved.appointmentCategoryAssignments&&typeof saved.appointmentCategoryAssignments==='object')appointmentCategoryAssignments={...saved.appointmentCategoryAssignments};
 if(saved.appointmentCategoryColours&&typeof saved.appointmentCategoryColours==='object')appointmentCategoryColours={...saved.appointmentCategoryColours};
}catch(e){}
function defaultAppointmentCategory(type){
 const name=String(type).toLowerCase().replace(/[^a-z0-9]/g,'');
 if(name==='sameday'||name==='within3days'||name==='urgentextra'||name==='111referral')return 'Urgent Care';
 if(name==='routine'||name==='followup')return 'Routine Care';
 if(name==='plannedcare')return 'Planned Care';
 return '';
}
function appointmentCategoryFor(type){
 const assigned=appointmentCategoryAssignments[type];
 if(assigned==='')return '';
 if(appointmentCategoryNames.includes(assigned))return assigned;
 const fallback=defaultAppointmentCategory(type);
 return appointmentCategoryNames.includes(fallback)?fallback:'';
}
function renderAppointmentCategorySettings(){
 const root=$('appointmentCategorySettings');if(!root)return;
 root.replaceChildren();
 for(const name of appointmentCategoryNames){
  const row=document.createElement('div');row.className='appointment-category-setting';
  const colour=document.createElement('input');colour.type='color';colour.value=/^#[0-9a-f]{6}$/i.test(appointmentCategoryColours[name]||'')?appointmentCategoryColours[name]:'#7897ad';colour.title='Category colour for '+name;
  colour.addEventListener('change',()=>{appointmentCategoryColours[name]=colour.value;saveCategories()});
  const label=document.createElement('span');label.textContent=name;
  const rename=document.createElement('button');rename.type='button';rename.textContent='✎';rename.title='Rename '+name;
  rename.onclick=()=>{const next=prompt('Rename appointment category',name)?.trim();if(!next||next===name)return;if(appointmentCategoryNames.some(n=>n.toLowerCase()===next.toLowerCase())){alert('Category already exists.');return;}appointmentCategoryNames=appointmentCategoryNames.map(n=>n===name?next:n);for(const type of Object.keys(appointmentCategoryAssignments))if(appointmentCategoryAssignments[type]===name)appointmentCategoryAssignments[type]=next;if(appointmentCategoryColours[name]){appointmentCategoryColours[next]=appointmentCategoryColours[name];delete appointmentCategoryColours[name]}saveCategories();renderSlotGroupBoxes()};
  const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.title='Delete '+name;
  remove.onclick=()=>{if(!confirm('Delete category '+name+'? Its appointment types will become unassigned.'))return;for(const type of groupUrgencyNames)if(appointmentCategoryFor(type)===name)appointmentCategoryAssignments[type]='';appointmentCategoryNames=appointmentCategoryNames.filter(n=>n!==name);delete appointmentCategoryColours[name];saveCategories();renderSlotGroupBoxes()};
  row.append(colour,label,rename,remove);root.append(row);
 }
 const add=$('slotAddAppointmentCategory');if(add)add.onclick=()=>{const name=prompt('New appointment category name')?.trim();if(!name)return;if(appointmentCategoryNames.some(n=>n.toLowerCase()===name.toLowerCase())){alert('Category already exists.');return;}appointmentCategoryNames.push(name);saveCategories();renderSlotGroupBoxes()};
}
function renderSlotGroupBoxes(){
 const root=$('slotGroupBoxes');if(!root)return;
 root.replaceChildren();
 renderAppointmentCategorySettings();
 const changed=()=>{
  consolidateUrgencyGroups();saveCategories();rebuildCategoryFilter();renderSlotGroupBoxes();renderUrgentCategoryToggles();renderEditor();renderGroupUrgencyEditor();renderSlotTable();updateAvailabilityUrgencyFilter();
  if(!$('availabilityPage').classList.contains('hidden'))renderAvailabilityChart();
  if(!$('routineAvailabilityPage').classList.contains('hidden'))renderRoutineAvailabilityChart();
  if(!$('chartPage').classList.contains('hidden'))scheduleDemandRefresh();
  if(!$('bookingTimesPage').classList.contains('hidden'))renderBookingTimesChart();
 };
 const editor=(oldName='')=>{
  const row=document.createElement('div');row.className='slot-mode-editor';
  const input=document.createElement('input');input.type='text';input.value=oldName;input.placeholder='Appointment Types';
  const save=document.createElement('button');save.type='button';save.textContent='Save';
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';
  const commit=()=>{
   const name=input.value.trim();
   if(!name||name.toLowerCase()==='uncategorised'||groupUrgencyNames.some(x=>x.toLowerCase()===name.toLowerCase()&&x!==oldName)){alert('Enter a unique Appointment Types name.');return}
   if(oldName){
    renameAnalyticsRole('appointmentTypes',oldName,name);
    groupUrgencyNames=groupUrgencyNames.map(x=>x===oldName?name:x);
    if(Object.prototype.hasOwnProperty.call(appointmentCategoryAssignments,oldName)){appointmentCategoryAssignments[name]=appointmentCategoryAssignments[oldName];delete appointmentCategoryAssignments[oldName];}
    for(const slot of Object.keys(assignments))if(assignments[slot]===oldName)assignments[slot]=name;
    if(urgencyGroupColours[oldName]){urgencyGroupColours[name]=urgencyGroupColours[oldName];delete urgencyGroupColours[oldName]}
    if(bookingTimesDisabledUrgency.has(oldName)){bookingTimesDisabledUrgency.delete(oldName);bookingTimesDisabledUrgency.add(name)}
   }else groupUrgencyNames.push(name);
   changed();
  };
  save.addEventListener('click',commit);cancel.addEventListener('click',renderSlotGroupBoxes);
  input.addEventListener('keydown',event=>{if((event.key?.startsWith(iqStorageScope)?event.key.slice(iqStorageScope.length):null)==='Enter')commit();if((event.key?.startsWith(iqStorageScope)?event.key.slice(iqStorageScope.length):null)==='Escape')renderSlotGroupBoxes()});
  row.append(input,save,cancel);return {row,input};
 };
 for(const name of groupUrgencyNames){
  const row=document.createElement('div');row.className='slot-mode-item';
  row.append(slotCategoryColourPicker(name,urgencyGroupColours,()=>{saveCategories();renderSlotGroupBoxes();renderSlotTable()}));
  const label=document.createElement('span');label.textContent=name;row.append(label);
  const category=document.createElement('select');category.className='appointment-category-select';category.setAttribute('aria-label','Category for '+name);
  for(const optionName of ['',...appointmentCategoryNames]){const option=document.createElement('option');option.value=optionName;option.textContent=optionName||'Unassigned category';category.append(option)}
  category.value=appointmentCategoryFor(name);category.addEventListener('change',()=>{appointmentCategoryAssignments[name]=category.value;saveCategories()});row.append(category);
  const rename=document.createElement('button');rename.type='button';rename.textContent='✎';rename.title='Rename '+name;
  rename.addEventListener('click',()=>{const edit=editor(name);row.replaceWith(edit.row);edit.input.focus();edit.input.select()});
  const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.title='Delete '+name;
  remove.addEventListener('click',()=>{
   if(!confirm('Delete Appointment Types "'+name+'"? Its slot assignments will become unassigned.'))return;
   groupUrgencyNames=groupUrgencyNames.filter(x=>x!==name);delete urgencyGroupColours[name];delete appointmentCategoryAssignments[name];
   for(const slot of Object.keys(assignments))if(assignments[slot]===name)assignments[slot]='Uncategorised';
   bookingTimesDisabledUrgency.delete(name);changed();
  });
  row.append(rename,remove);root.append(row);
 }
 const add=document.getElementById('slotAddUrgencyGroup');
 if(add)add.onclick=()=>{const edit=editor();root.append(edit.row);edit.input.focus()};
}
function renderPeopleGroups(){
 const root=$('peopleGroupBoxes');if(!root)return;
 root.replaceChildren();
 const groups=[...clinicianGroupNames];
 const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};
 const nameValid=(name,existing)=>name&&name.toLowerCase()!=='uncategorised'&&!existing.some(x=>x.toLowerCase()===name.toLowerCase());
 const changed=()=>{
  saveCategories();
  renderPeopleGroups();
  renderPeopleGroupFilter();
  renderPeople();
  renderClinicianEditor();
  renderClinicianGroupEditor();
  updateClinicianChartFilter();
  refreshClinicianCharts();
  const status=$('peopleSaveStatus');if(status)status.textContent='Changes are saving automatically to practice workspace.';
 };
 const editor=(initial,placeholder,onSave)=>{
  const wrap=el('div','people-inline-editor');
  const input=el('input','people-group-add-input');input.value=initial;input.placeholder=placeholder;
  const save=el('button','people-mini-action','Save');save.type='button';
  const cancel=el('button','people-mini-action','Cancel');cancel.type='button';
  save.addEventListener('click',()=>onSave(input.value.trim()));
  cancel.addEventListener('click',()=>renderPeopleGroups());
  input.addEventListener('keydown',e=>{if(e.key==='Enter')save.click();if(e.key==='Escape')cancel.click()});
  wrap.append(input,save,cancel);
  return {wrap,input};
 };
 const renameType=(oldName,newName)=>{
  if(newName===oldName){renderPeopleGroups();return}
  if(!nameValid(newName,clinicianCategoryNames)){alert('Please enter a unique detailed clinician type.');return}
  clinicianCategoryNames=clinicianCategoryNames.map(n=>n===oldName?newName:n);
  for(const [key,value] of workforceWeeklySessions){
   const [type,year]=JSON.parse(key);
   if(type===oldName){
    workforceWeeklySessions.set(JSON.stringify([newName,year]),value);
    workforceWeeklySessions.delete(key);
   }
  }
  if(clinicianTypeColours[oldName]){clinicianTypeColours[newName]=clinicianTypeColours[oldName];delete clinicianTypeColours[oldName]}
  clinicianGroupAssignments[newName]=clinicianGroupAssignments[oldName];
  delete clinicianGroupAssignments[oldName];
  for(const key of Object.keys(clinicianAssignments))if(clinicianAssignments[key]===oldName)clinicianAssignments[key]=newName;
  changed();
 };
 for(const group of groups){
  const card=el('section','people-group-card');
  const assigned=clinicianCategoryNames.filter(t=>clinicianGroupAssignments[t]===group).sort((a,b)=>a.localeCompare(b));
  const header=el('div','people-group-heading');
  const title=el('h3','people-group-title',group);
  const count=el('span','people-group-count',assigned.length+' types');
  const actions=el('div','people-group-actions');
  const rename=el('button','people-icon-action','✎');rename.type='button';rename.title='Rename group '+group;rename.setAttribute('aria-label','Rename clinician group '+group);
  rename.addEventListener('click',()=>{
   const {wrap,input}=editor(group,'Clinician group',value=>{
    if(value===group){renderPeopleGroups();return}
    if(!nameValid(value,clinicianGroupNames)){alert('Please enter a unique clinician group name.');return}
    renameAnalyticsRole('clinicianGroups',group,value);
    clinicianGroupNames=clinicianGroupNames.map(n=>n===group?value:n);
    if(clinicianGroupColours[group]){clinicianGroupColours[value]=clinicianGroupColours[group];delete clinicianGroupColours[group]}
    for(const type of Object.keys(clinicianGroupAssignments))if(clinicianGroupAssignments[type]===group)clinicianGroupAssignments[type]=value;
    for(const disabled of [disabledClinicianTypes,urgentClinicianDisabled,routineDisabledClinicianGroups,bookingTimesDisabledClinician]){
     if(disabled.has(group)){disabled.delete(group);disabled.add(value)}
    }
    changed();
   });
   header.replaceChildren(wrap);input.focus();input.select();
  });
  const remove=el('button','people-icon-action people-delete-action','×');remove.type='button';remove.title='Delete group '+group;remove.setAttribute('aria-label','Delete clinician group '+group);
  remove.addEventListener('click',()=>{
   const count=clinicianCategoryNames.filter(t=>clinicianGroupAssignments[t]===group).length;
   if(!confirm('Delete clinician group "'+group+'"? '+count+' detailed clinician type(s) will become unassigned, but the types and people will not be deleted.'))return;
   clinicianGroupNames=clinicianGroupNames.filter(n=>n!==group);
   delete clinicianGroupColours[group];
   for(const type of Object.keys(clinicianGroupAssignments))if(clinicianGroupAssignments[type]===group)clinicianGroupAssignments[type]='Uncategorised';
   for(const disabled of [disabledClinicianTypes,urgentClinicianDisabled,routineDisabledClinicianGroups,bookingTimesDisabledClinician])disabled.delete(group);
   changed();
  });
  actions.append(rename,remove);
  const colourWrap=el('label','people-colour-control people-group-colour-control');
  colourWrap.title='Change colour for '+group+' group';
  const dot=clinicianColourDot(group);
  const picker=el('input','people-colour-picker');
  picker.type='color';picker.value=clinicianGroupColour(group);
  picker.setAttribute('aria-label','Choose colour for '+group+' clinician group');
  picker.addEventListener('change',()=>{
   clinicianGroupColours[group]=picker.value;
   saveCategories();renderPeopleGroups();renderPeople();
   renderUrgentSideFilters();renderRoutineAvailabilityFilters();refreshClinicianCharts();
  });
  colourWrap.append(dot,picker);installDashboardColourPicker(colourWrap,picker);
  header.append(colourWrap,title,count,actions);
  card.append(header);
  const list=el('div','people-group-types');
  list.dataset.group=group;
  list.addEventListener('dragover',event=>{if(event.dataTransfer.types.includes('text/plain')){event.preventDefault();event.dataTransfer.dropEffect='move';card.classList.add('people-drop-target')}});
  list.addEventListener('dragleave',event=>{if(!list.contains(event.relatedTarget))card.classList.remove('people-drop-target')});
  list.addEventListener('drop',event=>{
   event.preventDefault();card.classList.remove('people-drop-target');
   const type=event.dataTransfer.getData('text/plain');
   if(!clinicianCategoryNames.includes(type)||clinicianGroupAssignments[type]===group)return;
   clinicianGroupAssignments[type]=group;changed();
  });
  for(const type of assigned){
   const row=el('div','people-group-type');
   row.draggable=true;row.title='Drag to another clinician group';
   row.addEventListener('dragstart',event=>{event.dataTransfer.setData('text/plain',type);event.dataTransfer.effectAllowed='move';row.classList.add('people-dragging')});
   row.addEventListener('dragend',()=>row.classList.remove('people-dragging'));
   const grip=el('span','people-drag-grip','⠿');grip.setAttribute('aria-hidden','true');
   const label=el('span','people-type-label',type);
   const edit=el('button','people-icon-action','✎');edit.type='button';edit.title='Rename '+type;edit.setAttribute('aria-label','Rename '+type);
   edit.addEventListener('click',()=>{
    const {wrap,input}=editor(type,'Clinician type',value=>renameType(type,value));
    row.replaceChildren(wrap);input.focus();input.select();
   });
   const remove=el('button','people-icon-action people-delete-action','×');remove.type='button';remove.title='Delete '+type;remove.setAttribute('aria-label','Delete '+type);
   remove.addEventListener('click',()=>{
    if(!confirm('Delete clinician type "'+type+'"? Any CSV user types assigned to it will become unassigned.'))return;
    clinicianCategoryNames=clinicianCategoryNames.filter(n=>n!==type);delete clinicianTypeColours[type];
    delete clinicianGroupAssignments[type];
    for(const key of Object.keys(clinicianAssignments))if(clinicianAssignments[key]===type)clinicianAssignments[key]='Uncategorised';
    changed();
   });
   row.append(grip,typeColourPicker(type,'clinician',changed),label,edit,remove);list.append(row);
  }
  if(!assigned.length)list.append(el('p','people-empty-group','Drop a type here'));
  card.append(list);
  const add=el('button','people-add-type-button','+ Add type');add.type='button';
  add.addEventListener('click',()=>{
   const {wrap,input}=editor('','New detailed type',value=>{
    if(!nameValid(value,clinicianCategoryNames)){alert('Please enter a unique detailed clinician type.');return}
    clinicianCategoryNames.push(value);clinicianGroupAssignments[value]=group;changed();
   });
   add.replaceWith(wrap);input.focus();
  });
  card.append(add);root.append(card);
 }
 const add=el('button','people-add-group-button','+ Add Group');add.type='button';
 add.addEventListener('click',()=>{
  const {wrap,input}=editor('','New clinician group',value=>{
   if(!nameValid(value,clinicianGroupNames)){alert('Please enter a unique clinician group.');return}
   clinicianGroupNames.push(value);changed();
  });
  add.replaceWith(wrap);input.focus();
 });
 root.append(add);
}
function renderSlotTableGroupFilter(){
 const dimensions=[
  ['slotGroupFilter',groupUrgencyNames],
  ['slotModeFilter',consultCategoryNames],
  ['slotPurposeFilter',purposeCategoryNames],
  ['slotCapacityFilter',capacityCategoryNames]
 ];
 for(const [id,names] of dimensions){
  const select=$(id);if(!select)continue;
  const old=select.value||'';
  select.replaceChildren();
  for(const value of ['',...names]){
   const option=document.createElement('option');option.value=value;
   option.textContent=value||'All';
   select.append(option);
  }
  select.value=names.includes(old)?old:'';
 }
}
let slotTypeFileStats=new Map();
let excludedSlotTypes=new Set();
try{const saved=JSON.parse(iqLocalStorage.getItem('appointment-dashboard-categories-v1')||'{}');if(Array.isArray(saved.excludedSlotTypes))excludedSlotTypes=new Set(saved.excludedSlotTypes.filter(x=>typeof x==='string'))}catch(e){}
function renderSlotInclusion(){
 const root=$('slotInclusionList');if(!root)return;
 root.replaceChildren();
 const names=[...types].sort((a,b)=>(slotTypeFileStats.get(b)?.count||0)-(slotTypeFileStats.get(a)?.count||0)||a.localeCompare(b));
 for(const slot of names){
  const label=document.createElement('label');label.className='slot-inclusion-item';
  const wrap=document.createElement('span');wrap.className='switch';
  const input=document.createElement('input');input.type='checkbox';input.setAttribute('role','switch');
  input.checked=!excludedSlotTypes.has(slot);input.setAttribute('aria-label','Include '+slot);
  const track=document.createElement('span');track.className='switch-track';wrap.append(input,track);
  const name=document.createElement('span');name.className='slot-inclusion-name';name.textContent=slot;
  const count=document.createElement('span');count.className='slot-inclusion-count';count.textContent=(slotTypeFileStats.get(slot)?.count||0).toLocaleString('en-GB');
  label.append(wrap,name,count);root.append(label);
  input.addEventListener('change',()=>{
   if(input.checked)excludedSlotTypes.delete(slot);else excludedSlotTypes.add(slot);
   saveCategories();renderSlotTable();refresh();
   if(!$('availabilityPage').classList.contains('hidden'))renderAvailabilityChart();
   if(!$('routineAvailabilityPage').classList.contains('hidden'))renderRoutineAvailabilityChart();
   if(!$('bookingTimesPage').classList.contains('hidden'))renderBookingTimesChart();
   const summary=$('slotInclusionSummary');if(summary)summary.textContent=(types.length-excludedSlotTypes.size)+' of '+types.length+' slot types included';
  });
 }
 const summary=$('slotInclusionSummary');if(summary)summary.textContent=names.filter(n=>!excludedSlotTypes.has(n)).length+' of '+names.length+' slot types included';
}

function formatSlotMonth(date){const [year,month]=date.split('-');return new Date(Date.UTC(Number(year),Number(month)-1,1)).toLocaleDateString('en-GB',{month:'short',year:'numeric',timeZone:'UTC'});}
function ensureCoreConsultModes(){if(!consultCategoryNames.length)consultCategoryNames=['Phone','Face-to-face']}
let slotMappingSort='name';
function setSlotMappingSort(value){
 slotMappingSort=value;writeChartPreference('settings:slotSort',value);
 renderSlotTable();
}
function renderSlotTable(){
 const body=$('slotTableBody');if(!body)return;
 renderSlotTableGroupFilter();
 const query=String($('slotTableSearch')?.value||'').trim().toLowerCase();
 const filters=[['slotGroupFilter',assignments],['slotModeFilter',consultAssignments],['slotPurposeFilter',purposeAssignments],['slotCapacityFilter',capacityAssignments]];
 const unassignedTypeOnly=!!$('slotUnassignedOnly')?.checked;
 const unassignedModeOnly=!!$('slotModeUnassignedOnly')?.checked;
 const unassignedPurposeOnly=!!$('slotPurposeUnassignedOnly')?.checked;
 const unassignedCapacityOnly=!!$('slotCapacityUnassignedOnly')?.checked;
 const rows=types.filter(slot=>{
  if(excludedSlotTypes.has(slot))return false;
  const assigned=groupUrgencyNames.includes(assignments[slot])?assignments[slot]:'';
  const group=assigned;
  if(unassignedTypeOnly&&assigned)return false;
  if(unassignedModeOnly&&consultCategoryNames.includes(consultAssignments[slot]))return false;
  if(unassignedPurposeOnly&&purposeCategoryNames.includes(purposeAssignments[slot]))return false;
  if(unassignedCapacityOnly&&capacityCategoryNames.includes(capacityAssignments[slot]))return false;
  if(filters.some(([id,mapping])=>$(id)?.value&&mapping[slot]!==$(id).value))return false;
  return !query||(slot+' '+assigned+' '+group).toLowerCase().includes(query);
 }).sort((a,b)=>{
  if(slotMappingSort==='count-desc'||slotMappingSort==='count-asc'){
   const difference=(slotTypeFileStats.get(a)?.count||0)-(slotTypeFileStats.get(b)?.count||0);
   if(difference)return slotMappingSort==='count-desc'?-difference:difference;
  }
  return a.localeCompare(b,undefined,{sensitivity:'base'});
 });
 const countSortButton=$('slotCountSort');
 if(countSortButton){
  countSortButton.textContent=slotMappingSort==='count-desc'?'Slots found ▼':slotMappingSort==='count-asc'?'Slots found ▲':'Slots found ⇅';
  countSortButton.setAttribute('aria-label',slotMappingSort==='count-desc'?'Sort slots found ascending':slotMappingSort==='count-asc'?'Sort by slot type name':'Sort slots found highest first');
 }
 body.replaceChildren();
 const attachInlineSuggestion=(slot,key,cell,select)=>{
  const dim=smartDimensions().find(d=>d.key===key);
  if(!dim||dim.names.includes(dim.map[slot]))return;
  const suggestion=smartSuggestion(slot,dim);
  if(!suggestion)return;
  select.value=suggestion.value;
  select.classList.add('slot-inline-suggested');
  select.title='Suggested — click the tick to approve, or choose a different value';
  const approve=document.createElement('button');
  approve.type='button';approve.className='slot-inline-approve';
  approve.textContent='✓';approve.title='Approve suggested '+dim.label+': '+suggestion.value;
  approve.setAttribute('aria-label','Approve '+suggestion.value+' for '+slot);
  const note=document.createElement('span');note.className='slot-inline-suggestion-label';note.textContent='Suggested';
  const removeHint=()=>{select.classList.remove('slot-inline-suggested');select.removeAttribute('title');approve.remove();note.remove()};
  select.addEventListener('change',removeHint,{once:true});
  approve.addEventListener('click',()=>{
   if(dim.names.includes(dim.map[slot])||!dim.names.includes(select.value))return;
   dim.map[slot]=select.value;saveCategories();renderSlotTable();
   if(key==='urgency'){renderEditor();renderUrgentCategoryToggles();updateAvailabilityUrgencyFilter();rebuildCategoryFilter();if(!$('chartPage').classList.contains('hidden'))scheduleDemandRefresh();if(!$('availabilityPage').classList.contains('hidden'))renderAvailabilityChart();if(!$('routineAvailabilityPage').classList.contains('hidden'))renderRoutineAvailabilityChart();if(!$('bookingTimesPage').classList.contains('hidden'))renderBookingTimesChart()}
   if(key==='mode')renderConsultEditor();
  });
  cell.append(note,approve);
 };
 for(const slot of rows){
  const tr=document.createElement('tr');
  const slotCell=document.createElement('td');
  const slotName=document.createElement('span');slotName.textContent=slot;slotCell.append(slotName);
  const stats=slotTypeFileStats.get(slot);
  if(stats){const details=document.createElement('span');details.className='slot-type-found-details';details.style.display='block';details.textContent=` — ${stats.count.toLocaleString('en-GB')} found (${formatSlotMonth(stats.min)} – ${formatSlotMonth(stats.max)})`;slotCell.append(details);}
  const countCell=document.createElement('td');countCell.className='slot-found-count';countCell.textContent=(stats?.count||0).toLocaleString('en-GB');
  const urgencyCell=document.createElement('td');urgencyCell.className='people-assigned-cell';
  const urgencySelect=document.createElement('select');urgencySelect.className='people-clinician-select';urgencySelect.setAttribute('aria-label','Appointment Types for '+slot);
  for(const name of ['',...groupUrgencyNames]){const option=document.createElement('option');option.value=name;option.textContent=name||'Unassigned';urgencySelect.append(option)}
  urgencySelect.value=groupUrgencyNames.includes(assignments[slot])?assignments[slot]:'';
  urgencySelect.addEventListener('change',()=>{
   assignments[slot]=urgencySelect.value||'Uncategorised';saveCategories();renderSlotTable();renderEditor();renderUrgentCategoryToggles();updateAvailabilityUrgencyFilter();
   if(!$('availabilityPage').classList.contains('hidden'))renderAvailabilityChart();
   if(!$('routineAvailabilityPage').classList.contains('hidden'))renderRoutineAvailabilityChart();
   if(!$('chartPage').classList.contains('hidden'))scheduleDemandRefresh();
   if(!$('bookingTimesPage').classList.contains('hidden'))renderBookingTimesChart();
  });
  urgencyCell.append(urgencySelect);attachInlineSuggestion(slot,'urgency',urgencyCell,urgencySelect);
  const modeCell=document.createElement('td');modeCell.className='people-assigned-cell';
  const modeSelect=document.createElement('select');modeSelect.className='people-clinician-select';modeSelect.setAttribute('aria-label','Consultation mode for '+slot);
  const modeOptions=[['','Unassigned'],...consultCategoryNames.map(name=>[name,name])];
  for(const [value,label] of modeOptions){const option=document.createElement('option');option.value=value;option.textContent=label;modeSelect.append(option)}
  modeSelect.value=consultCategoryNames.includes(consultAssignments[slot])?consultAssignments[slot]:'';
  modeSelect.addEventListener('change',()=>{
   consultAssignments[slot]=modeSelect.value||'Uncategorised';
   saveCategories();renderConsultEditor();renderSlotTable();
   const status=$('slotGroupSaveStatus');if(status)status.textContent='Changes are saving automatically to practice workspace.';
  });
  modeCell.prepend(modeSelect);attachInlineSuggestion(slot,'mode',modeCell,modeSelect);
  const purposeCell=document.createElement('td');purposeCell.className='people-assigned-cell';
  const purposeSelect=document.createElement('select');purposeSelect.className='people-clinician-select';purposeSelect.setAttribute('aria-label','Slot purpose for '+slot);
  for(const name of ['',...purposeCategoryNames]){const option=document.createElement('option');option.value=name;option.textContent=name||'Unassigned';purposeSelect.append(option)}
  purposeSelect.value=purposeCategoryNames.includes(purposeAssignments[slot])?purposeAssignments[slot]:'';
  purposeSelect.addEventListener('change',()=>{purposeAssignments[slot]=purposeSelect.value||'Uncategorised';saveCategories();renderSlotTable();const status=$('slotGroupSaveStatus');if(status)status.textContent='Changes are saving automatically to practice workspace.'});
  purposeCell.append(purposeSelect);attachInlineSuggestion(slot,'purpose',purposeCell,purposeSelect);
  const capacityCell=document.createElement('td');capacityCell.className='people-assigned-cell';
  const capacitySelect=document.createElement('select');capacitySelect.className='people-clinician-select';capacitySelect.setAttribute('aria-label','Capacity status for '+slot);
  for(const name of ['',...capacityCategoryNames]){const option=document.createElement('option');option.value=name;option.textContent=name||'Unassigned';capacitySelect.append(option)}
  capacitySelect.value=capacityCategoryNames.includes(capacityAssignments[slot])?capacityAssignments[slot]:'';
  capacitySelect.addEventListener('change',()=>{capacityAssignments[slot]=capacitySelect.value||'Uncategorised';saveCategories();const status=$('slotGroupSaveStatus');if(status)status.textContent='Changes are saving automatically to practice workspace.'});
  capacityCell.append(capacitySelect);attachInlineSuggestion(slot,'capacity',capacityCell,capacitySelect);
  tr.append(slotCell,countCell,urgencyCell,modeCell,purposeCell,capacityCell);body.append(tr);
 }
 const count=$('slotTableCount');if(count)count.textContent=rows.length+' of '+types.length+' slot types shown';
}


/* Smart allocation: suggestions are transient until explicitly approved. */
let smartSlotSuggestions=[];
const smartDimensions=()=>[
 {key:'urgency',label:'Appointment Types',names:groupUrgencyNames,map:assignments},
 {key:'mode',label:'Consult Mode',names:consultCategoryNames,map:consultAssignments},
 {key:'purpose',label:'Slot Purpose',names:purposeCategoryNames,map:purposeAssignments},
 {key:'capacity',label:'Capacity Status',names:capacityCategoryNames,map:capacityAssignments}
];
function smartWords(value){return String(value||'').toLocaleLowerCase('en-GB').replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(Boolean)}
function smartSuggestion(slot,dim){
 if(dim.names.includes(dim.map[slot]))return null;
 const words=smartWords(slot),wordSet=new Set(words);
 if(!words.length)return null;
 const votes=new Map();
 const add=(name,points,why)=>{if(!dim.names.includes(name))return;const old=votes.get(name);if(!old||points>old.points)votes.set(name,{name,points,why})};
 // Reuse exact classifications for near-identical, previously confirmed slot names.
 const normal=words.join(' ');
 for(const [other,name] of Object.entries(dim.map)){
  if(other===slot||!dim.names.includes(name))continue;
  const otherWords=smartWords(other),otherNormal=otherWords.join(' ');
  if(otherNormal===normal)add(name,100,'Previously mapped identical slot name');
  else if(words.length>=2&&otherWords.length>=2){
   const shared=words.filter(w=>otherWords.includes(w)).length;
   if(shared>=2&&shared===words.length&&shared===otherWords.length)add(name,96,'Previously mapped equivalent slot name');
  }
 }
 // Learn from confirmed manual selections on similar slot names.
 // Require substantial overlap and a clear majority, rather than inferring from a single generic word.
 const learned=new Map();
 const ignored=new Set(['gp','dr','doctor','nurse','appointment','appt','slot','clinic','session','the','for','and','of']);
 const meaningful=words.filter(w=>w.length>2&&!ignored.has(w));
 for(const [other,name] of Object.entries(dim.map)){
  if(other===slot||!dim.names.includes(name))continue;
  const otherMeaningful=smartWords(other).filter(w=>w.length>2&&!ignored.has(w));
  if(meaningful.length<2||otherMeaningful.length<2)continue;
  const overlap=meaningful.filter(w=>otherMeaningful.includes(w)).length;
  const similarity=overlap/Math.max(meaningful.length,otherMeaningful.length);
  if(overlap>=2&&similarity>=0.75)learned.set(name,(learned.get(name)||0)+1);
 }
 const rankedLearned=[...learned.entries()].sort((a,b)=>b[1]-a[1]);
 if(rankedLearned.length&&rankedLearned[0][1]>=2&&(!rankedLearned[1]||rankedLearned[0][1]>=rankedLearned[1][1]*2+1))
  add(rankedLearned[0][0],97,'Consistent confirmed mappings for similar slot names');
 for(const name of dim.names){
  const terms=smartWords(name);
  if(!terms.length)continue;
  const phrase=terms.join(' ');
  if(normal===phrase||(' '+normal+' ').includes(' '+phrase+' '))add(name,terms.length===1?88:94,'Category name appears in slot name');
  else if(terms.length>1&&terms.every(w=>wordSet.has(w)))add(name,85,'All category words found');
 }
 // Only use a small set of unambiguous, domain-specific aliases.
 const aliases={
  urgency:[['urgent',['urgent','emergency','same day','on the day']],['routine',['routine','planned']]],
  mode:[['phone',['telephone','phone','tel','telephony']],['face to face',['face to face','f2f','in person']],['video',['video','virtual video']]],
  purpose:[['follow up',['follow up','followup','review appointment']],['medication',['medication','medicines','prescription']],['immunisation',['immunisation','vaccination','vaccine']]],
  capacity:[['additional',['additional','extra capacity','overflow','overbook']],['core',['core capacity','standard capacity']]]
 };
 for(const [concept,patterns] of aliases[dim.key]||[]){
  const candidates=dim.names.filter(name=>{const n=smartWords(name).join(' ');return n===concept||n.includes(concept)});
  if(candidates.length!==1)continue;
  if(patterns.some(pattern=>(' '+normal+' ').includes(' '+pattern+' ')))add(candidates[0],82,'Recognised '+concept+' wording');
 }
 const sorted=[...votes.values()].sort((a,b)=>b.points-a.points);
 if(!sorted.length||sorted[0].points<80||sorted[1]&&sorted[0].points-sorted[1].points<10)return null;
 return {slot,key:dim.key,label:dim.label,value:sorted[0].name,confidence:sorted[0].points>=95?'High':'Medium',reason:sorted[0].why};
}
/* Use exactly the same circular control and 30-swatch palette as the urgency editor. */
function slotCategoryColourPicker(name,colourMap,onChanged){
 const current=typeColour(name,colourMap);
 const wrap=document.createElement('label');wrap.className='people-colour-control people-type-colour-control';wrap.title='Change colour for '+name;wrap.draggable=false;
 const dot=document.createElement('span');dot.className='clinician-colour-dot';dot.style.backgroundColor=current;
 const input=document.createElement('input');input.className='people-colour-picker';input.type='color';input.value=current;input.setAttribute('aria-label','Choose colour for '+name);
 input.addEventListener('change',()=>{colourMap[name]=input.value;onChanged()});
 wrap.append(dot,input);installDashboardColourPicker(wrap,input);return wrap;
}
/* Slot Purpose category management — no changes to appointment mappings or auth. */
function renderCapacityStatusCategories(){
 const root=document.getElementById('slotCapacityCategoryList');
 const add=document.getElementById('slotAddCapacityCategory');
 if(!root||!add)return;
 root.replaceChildren();
 const editor=(oldName='')=>{
  const row=document.createElement('div');row.className='slot-mode-editor';
  const input=document.createElement('input');input.type='text';input.value=oldName;input.placeholder='e.g. Additional Capacity';
  const save=document.createElement('button');save.type='button';save.textContent='Save';
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';
  const commit=()=>{
   const name=input.value.trim();
   if(!name||name.toLowerCase()==='uncategorised'||capacityCategoryNames.some(x=>x.toLowerCase()===name.toLowerCase()&&x!==oldName)){alert('Enter a unique capacity status name.');return}
   if(oldName){capacityCategoryNames=capacityCategoryNames.map(x=>x===oldName?name:x);for(const slot of Object.keys(capacityAssignments))if(capacityAssignments[slot]===oldName)capacityAssignments[slot]=name;if(capacityColours[oldName]){capacityColours[name]=capacityColours[oldName];delete capacityColours[oldName]}}
   else{capacityCategoryNames.push(name);capacityColours[name]='#8aa6bd'}
   saveCategories();renderCapacityStatusCategories();renderSlotTable();
  };
  save.addEventListener('click',commit);cancel.addEventListener('click',renderCapacityStatusCategories);
  input.addEventListener('keydown',e=>{if(e.key==='Enter')commit();if(e.key==='Escape')renderCapacityStatusCategories()});
  row.append(input,save,cancel);return {row,input};
 };
 for(const name of capacityCategoryNames){
  const row=document.createElement('div');row.className='slot-mode-item';
  const colour=slotCategoryColourPicker(name,capacityColours,()=>{saveCategories();renderCapacityStatusCategories()});
  const label=document.createElement('span');label.textContent=name;
  const rename=document.createElement('button');rename.type='button';rename.textContent='✎';rename.title='Rename '+name;
  rename.addEventListener('click',()=>{const edit=editor(name);row.replaceWith(edit.row);edit.input.focus();edit.input.select()});
  const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.title='Delete '+name;
  remove.addEventListener('click',()=>{if(!confirm('Delete capacity status "'+name+'"?'))return;capacityCategoryNames=capacityCategoryNames.filter(x=>x!==name);delete capacityColours[name];for(const slot of Object.keys(capacityAssignments))if(capacityAssignments[slot]===name)capacityAssignments[slot]='Uncategorised';saveCategories();renderCapacityStatusCategories();renderSlotTable()});
  row.append(colour,label,rename,remove);root.append(row);
 }
 add.onclick=()=>{const edit=editor();root.append(edit.row);edit.input.focus()};
}

function renderSlotPurposeCategories(){
 const root=document.getElementById('slotPurposeCategoryList');
 const add=document.getElementById('slotAddPurposeCategory');
 if(!root||!add)return;
 root.replaceChildren();
 const editor=(oldName='')=>{
  const row=document.createElement('div');row.className='slot-mode-editor';
  const input=document.createElement('input');input.type='text';input.value=oldName;input.placeholder='e.g. Chronic Disease Review';
  const save=document.createElement('button');save.type='button';save.textContent='Save';
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';
  const commit=()=>{
   const name=input.value.trim();
   if(!name||name.toLowerCase()==='uncategorised'||purposeCategoryNames.some(x=>x.toLowerCase()===name.toLowerCase()&&x!==oldName)){alert('Enter a unique slot purpose name.');return}
   if(oldName){purposeCategoryNames=purposeCategoryNames.map(x=>x===oldName?name:x);for(const slot of Object.keys(purposeAssignments))if(purposeAssignments[slot]===oldName)purposeAssignments[slot]=name;if(purposeColours[oldName]){purposeColours[name]=purposeColours[oldName];delete purposeColours[oldName]}}
   else{purposeCategoryNames.push(name);purposeColours[name]='#8aa6bd'}
   saveCategories();renderSlotPurposeCategories();renderSlotTable();
  };
  save.addEventListener('click',commit);cancel.addEventListener('click',renderSlotPurposeCategories);
  input.addEventListener('keydown',e=>{if(e.key==='Enter')commit();if(e.key==='Escape')renderSlotPurposeCategories()});
  row.append(input,save,cancel);return {row,input};
 };
 for(const name of purposeCategoryNames){
  const row=document.createElement('div');row.className='slot-mode-item';
  const colour=slotCategoryColourPicker(name,purposeColours,()=>{saveCategories();renderSlotPurposeCategories()});
  const label=document.createElement('span');label.textContent=name;
  const rename=document.createElement('button');rename.type='button';rename.textContent='✎';rename.title='Rename '+name;
  rename.addEventListener('click',()=>{const edit=editor(name);row.replaceWith(edit.row);edit.input.focus();edit.input.select()});
  const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.title='Delete '+name;
  remove.addEventListener('click',()=>{if(!confirm('Delete slot purpose "'+name+'"?'))return;purposeCategoryNames=purposeCategoryNames.filter(x=>x!==name);delete purposeColours[name];for(const slot of Object.keys(purposeAssignments))if(purposeAssignments[slot]===name)purposeAssignments[slot]='Uncategorised';saveCategories();renderSlotPurposeCategories();renderSlotTable()});
  row.append(colour,label,rename,remove);root.append(row);
 }
 add.onclick=()=>{const edit=editor();root.append(edit.row);edit.input.focus()};
}

function renderPeopleGroupFilter(){
 const select=$('peopleGroupFilter');if(!select)return;
 const previous=select.value||'';
 select.replaceChildren();
 for(const [value,label] of [['','All Clinician Groups'],...clinicianGroupNames.map(name=>[name,name])]){
  const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);
 }
 select.value=clinicianGroupNames.includes(previous)?previous:'';
}
function renderPeople(){
 const body=$('peopleTableBody'),count=$('peopleCount');if(!body)return;
 const query=String($('peopleSearch')?.value||'').trim().toLowerCase();
 const group=$('peopleGroupFilter')?.value||'';
 const unassignedOnly=!!$('peopleUnassignedOnly')?.checked;
 const userTypes=[...new Set(availabilityRecords.filter(row=>row.source==='slot').map(row=>row.clinician))]
  .sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}));
 const rows=userTypes.filter(userType=>{
  const type=effectiveClinicianType(userType);
  const assignedGroup=type?clinicianGroupAssignments[type]||'':'';
  if(unassignedOnly){if(clinicianCategoryNames.includes(type))return false;}
  else if(group&&assignedGroup!==group)return false;
  return !query||(userType+' '+type+' '+assignedGroup).toLowerCase().includes(query);
 });
 body.replaceChildren();
 for(const userType of rows){
  const tr=document.createElement('tr');
  const type=document.createElement('td');type.textContent=userType;
  const assignedCell=document.createElement('td');assignedCell.className='people-assigned-cell';
  const assigned=document.createElement('select');assigned.className='people-clinician-select';
  assigned.setAttribute('aria-label','Assigned Clinician Type for '+userType);
  const unassigned=document.createElement('option');unassigned.value='';unassigned.textContent='Unassigned';assigned.append(unassigned);
  const clinicianGrouped=new Set();
  for(const groupName of [...clinicianGroupNames].sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}))){
   const names=clinicianCategoryNames.filter(name=>clinicianGroupAssignments[name]===groupName).sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}));
   if(!names.length)continue;
   const section=document.createElement('optgroup');section.label=groupName;
   for(const value of names){const option=document.createElement('option');option.value=value;option.textContent=value;section.append(option);clinicianGrouped.add(value)}
   assigned.append(section);
  }
  const ungrouped=clinicianCategoryNames.filter(name=>!clinicianGrouped.has(name)).sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}));
  if(ungrouped.length){const section=document.createElement('optgroup');section.label='Other / Ungrouped';for(const value of ungrouped){const option=document.createElement('option');option.value=value;option.textContent=value;section.append(option)}assigned.append(section)}
  const selectedType=effectiveClinicianType(userType);
  assigned.value=clinicianCategoryNames.includes(selectedType)?selectedType:'';
  assigned.addEventListener('change',()=>{
   clinicianAssignments={...clinicianAssignments,[userType]:assigned.value||'Uncategorised'};
   saveCategories();
   refreshClinicianCharts();
   renderPeople();
   const status=$('peopleSaveStatus');if(status)status.textContent='Changes are saving automatically to practice workspace.';
  });
  assignedCell.append(assigned);
  const groupCell=document.createElement('td');groupCell.className='people-clinician-group-cell';
  const groupName=selectedType?clinicianGroupAssignments[selectedType]||'':'';
  const validGroup=clinicianGroupNames.includes(groupName);
  const groupBadge=document.createElement('span');groupBadge.className='people-clinician-group-badge';
  const groupDot=document.createElement('span');groupDot.className='clinician-colour-dot';
  groupDot.style.backgroundColor=validGroup?clinicianGroupColour(groupName):'#b6c0ca';
  groupBadge.append(groupDot,document.createTextNode(validGroup?groupName:'Unassigned'));
  groupCell.append(groupBadge);
  const locumCell=document.createElement('td');locumCell.className='people-locum-cell';
  const locum=document.createElement('select');locum.className='people-locum-select';
  locum.setAttribute('aria-label','Locum status for '+userType);
  for(const [value,label] of [['unknown','Unknown'],['no','No'],['yes','Yes']]){const option=document.createElement('option');option.value=value;option.textContent=label;locum.append(option)}
  locum.value=Object.hasOwn(userTypeLocum,userType)?userTypeLocum[userType]:'unknown';
  locum.addEventListener('change',()=>{
   userTypeLocum={...userTypeLocum,[userType]:locum.value};
   saveCategories();
   const status=$('peopleSaveStatus');if(status)status.textContent='Changes are saving automatically to practice workspace.';
  });
  locumCell.append(locum);tr.append(type,assignedCell,groupCell,locumCell);body.append(tr);
 }
 if(count)count.textContent=rows.length.toLocaleString('en-GB')+' of '+userTypes.length.toLocaleString('en-GB')+' user types';
}

const slots={selectedOptions:[],replaceChildren(){},append(){},options:[]};
const $=id=>document.getElementById(id);
let auth,authInitPromise=null,activeAccount=null,authenticatedOnce=false,selectedFolder=null,folderView={id:'root',name:'practice workspace',trail:[]},busy=false,lastFingerprint='';
let cloudReady=false, cloudSaveTimer=null, cloudVersion=null, cloudBusy=false;
let cloudFolder=null;
setupResponsiveHeader();
setInterval(()=>updateHeaderReportAge(headerReportTimestamp),60000);
// Per-account chart preferences stay local to this browser and are never included
// in the shared practice workspace settings JSON.
function chartPreferenceAccount(){return activeAccount?.homeAccountId||activeAccount?.localAccountId||activeAccount?.username||null}
function chartPreferenceKey(){const id=chartPreferenceAccount();return id?'gp-insight-chart-toggles-v1:'+encodeURIComponent(id):null}
function readChartPreferences(){const key=chartPreferenceKey();if(!key)return {};try{return JSON.parse(iqLocalStorage.getItem(key)||'{}')||{}}catch{return {}}}
let chartPreferenceSyncReady=false,chartPreferenceSyncRunning=false;
function pendingChartPreferences(){
 try{return JSON.parse(iqLocalStorage.getItem(chartPreferenceKey()+':pending')||'{}')||{};}catch{return {};}
}
async function flushChartPreferences(){
 if(!chartPreferenceSyncReady||chartPreferenceSyncRunning||!iqBridge?.writeChartPreferences)return;
 const storageKey=chartPreferenceKey();
 chartPreferenceSyncRunning=true;
 try{
  while(storageKey===chartPreferenceKey()){
   const pending=pendingChartPreferences();
   if(!Object.keys(pending).length)break;
   await iqBridge.writeChartPreferences(pending);
   const latest=pendingChartPreferences();
   for(const [key,value] of Object.entries(pending)){
    if(JSON.stringify(latest[key])===JSON.stringify(value))delete latest[key];
   }
   iqLocalStorage.setItem(storageKey+':pending',JSON.stringify(latest));
  }
 }catch(error){console.warn('Could not sync chart preferences',error);}
 finally{chartPreferenceSyncRunning=false;}
}
async function loadSyncedChartPreferences(){
 if(!iqBridge?.readChartPreferences)return;
 const storageKey=chartPreferenceKey();
 try{
  let remote=await iqBridge.readChartPreferences();
  const local=readChartPreferences();
  if(!Object.keys(remote).length&&Object.keys(local).length){
   await iqBridge.writeChartPreferences(local,true);
   remote=await iqBridge.readChartPreferences();
  }
  iqLocalStorage.setItem(storageKey,JSON.stringify({...remote,...pendingChartPreferences()}));
 }catch(error){console.warn('Could not load synced chart preferences',error);}
 chartPreferenceSyncReady=true;
 void flushChartPreferences();
}
function writeChartPreference(key,value){
 const storageKey=chartPreferenceKey();if(!storageKey)return;
 try{
  const saved=readChartPreferences();
  if(JSON.stringify(saved[key])===JSON.stringify(value))return;
  saved[key]=value;
  iqLocalStorage.setItem(storageKey,JSON.stringify(saved));
  if(iqBridge?.writeChartPreferences){
   iqLocalStorage.setItem(storageKey+':pending',JSON.stringify({...pendingChartPreferences(),[key]:value}));
   queueMicrotask(flushChartPreferences);
  }
 }catch(error){console.warn('Could not save chart preference',error);}
}
window.addEventListener('online',flushChartPreferences);
const chartShadowControls=[
 {id:'urgentChartShadows',key:'chartShadows:urgent'},
 {id:'routineChartShadows',key:'chartShadows:routine'},
 {id:'historicChartShadows',key:'chartShadows:historic'}
];
let chartShadowPreferenceOwner=null;
const chartShadowBoundInputs=new WeakSet();
function applyCapacityChartShadows(target,isDaily=false){
 if(!target)return;
 const input=$(target.id==='availabilityChart'?'urgentChartShadows':'routineChartShadows');
 const enabled=input?.checked!==false;
 const barLayer=target.querySelector('.barlayer');
 if(barLayer)barLayer.style.filter=enabled?(isDaily?'drop-shadow(4px 5px 3px rgba(25,45,65,0.32))':'drop-shadow(4px 5px 3px rgba(25,45,65,0.22))'):'none';
 target.querySelectorAll('.annotation-text-g').forEach(group=>{
  if(!group.textContent.trim().startsWith('Today'))return;
  const background=group.querySelector('rect');
  if(background){
   background.setAttribute('rx','6');background.setAttribute('ry','6');
   if(background.dataset.capsulePadding!=='1'){
    const x=Number(background.getAttribute('x')),width=Number(background.getAttribute('width'));
    if(Number.isFinite(x)&&Number.isFinite(width)){background.setAttribute('x',String(x-5));background.setAttribute('width',String(width+10));}
    background.dataset.capsulePadding='1';
   }
  }
  group.style.filter=enabled?'drop-shadow(0 1px 3px rgba(16,43,73,0.06))':'none';
 });
}
function applyHistoricChartShadows(target){
 if(!target)return;
 const enabled=$('historicChartShadows')?.checked!==false;
 const groups=[...target.querySelectorAll('.scatterlayer .trace.scatter')];let scatterIndex=0;
 for(const trace of target.data||[]){
  if(trace.type!=='scatter')continue;
  const group=groups[scatterIndex++];
  if(!group)continue;
  const historical=String(trace.mode||'').includes('lines')&&!trace.meta?.estimateConnector&&!trace.meta?.nowcast&&!trace.meta?.currentObserved&&!trace.meta?.rangeCaps;
  group.querySelectorAll('path.js-line').forEach(path=>{path.style.filter=enabled&&historical?'drop-shadow(0 1px 2px rgba(25,45,65,0.22))':'none';});
 }
}
function restoreChartShadowControls(){
 const account=chartPreferenceAccount();if(!account)return;
 if(account!==chartShadowPreferenceOwner){
  chartShadowPreferenceOwner=account;
  const saved=readChartPreferences();
  for(const {id,key} of chartShadowControls){const input=$(id);if(input)input.checked=saved[key]!==false;}
 }
 for(const {id,key} of chartShadowControls){
  const input=$(id);if(!input||chartShadowBoundInputs.has(input))continue;
  chartShadowBoundInputs.add(input);
  input.addEventListener('change',()=>{
   writeChartPreference(key,input.checked);
   if(id==='historicChartShadows')applyHistoricChartShadows($('combinedDemandChart'));
   else {const target=$(id==='urgentChartShadows'?'availabilityChart':'routineAvailabilityChart');applyCapacityChartShadows(target,target?._capacityIsDaily);}
  });
 }
}
window.gpChartPreferences={read:readChartPreferences,write:writeChartPreference,account:chartPreferenceAccount};
function plotSeriesKey(trace){return JSON.stringify([trace.type,trace.name,trace.legendgroup]);}
const plotLegendListeners=new WeakMap();
const calendarYearBandListeners=new WeakMap();
function drawCalendarYearBand(chart){
 const layout=chart._fullLayout,axis=layout?.xaxis,container=chart.querySelector('.plot-container');
 if(axis?.type!=='date'||!container)return;
 const [start,end]=axis.range.map(value=>axis.r2l(value)).sort((a,b)=>a-b);
 if(!Number.isFinite(start)||!Number.isFinite(end)||start===end)return;
 let band=container.querySelector('.calendar-year-band');
 if(!band){
  band=document.createElement('div');
  band.className='calendar-year-band';
  container.append(band);
 }
 band.style.left=axis._offset+'px';
 band.style.width=axis._length+'px';
 band.style.top=(layout.yaxis._offset+layout.yaxis._length+29)+'px';
 const segments=[];
 for(let year=new Date(start).getUTCFullYear();Date.UTC(year,0,1)<end;year++){
  const a=axis.l2p(Math.max(start,Date.UTC(year,0,1)));
  const b=axis.l2p(Math.min(end,Date.UTC(year+1,0,1)));
  const segment=document.createElement('span');
  segment.style.left=Math.min(a,b)+'px';
  segment.style.width=Math.abs(b-a)+'px';
  segment.dataset.parity=year%2;
  segment.toggleAttribute('data-narrow',Math.abs(b-a)<30);
  segment.textContent=year;
  segments.push(segment);
 }
 band.replaceChildren(...segments);
}

function renderPreferencePlot(target,traces,layout,config,useCalendarBand=true){
 const chart=typeof target==='string'?$(target):target;
 const previousBand=calendarYearBandListeners.get(chart);
 if(previousBand){
  chart.removeListener?.('plotly_afterplot',previousBand);
  calendarYearBandListeners.delete(chart);
 }
 chart.querySelector('.calendar-year-band')?.remove();
 const calendarAxis=useCalendarBand&&layout.xaxis?.type==='date'&&traces.some(trace=>trace.x?.length);
 if(calendarAxis){
  const xaxis=layout.xaxis;
  layout={...layout,margin:{...layout.margin,b:90},xaxis:{...xaxis,
   title:{text:xaxis.title,standoff:39},tickangle:0,hoverformat:'%d %b %Y',tickformat:'%b',
   tickformatstops:[{dtickrange:[null,'M1'],value:'%d %b'}]
  }};
 }
 const account=chartPreferenceAccount(),key='plotLegend:'+chart.id;
 const saved=readChartPreferences()[key]||{};
 const data=traces.map(trace=>{
  const visibility=saved[plotSeriesKey(trace)];
  return trace.visible!==false&&(visibility===true||visibility==='legendonly')?{...trace,visible:visibility}:trace;
 });
 return Plotly.react(chart,data,layout,config).then(result=>{
  if(calendarAxis){
   const redrawBand=()=>drawCalendarYearBand(chart);
   const previous=calendarYearBandListeners.get(chart);
   if(previous)chart.removeListener?.('plotly_afterplot',previous);
   chart.on?.('plotly_afterplot',redrawBand);
   calendarYearBandListeners.set(chart,redrawBand);
   redrawBand();
  }
  const previous=plotLegendListeners.get(chart);
  if(previous)chart.removeListener?.('plotly_restyle',previous);
  const remember=([update,indices])=>{
   if(!account||account!==chartPreferenceAccount()||!Object.hasOwn(update,'visible'))return;
   const visibility=readChartPreferences()[key]||{};
   for(const index of indices){
    const trace=chart.data[index];
    if(trace&&trace.visible!==false)visibility[plotSeriesKey(trace)]=trace.visible==='legendonly'?'legendonly':true;
   }
   writeChartPreference(key,visibility);
  };
  chart.on?.('plotly_restyle',remember);
  plotLegendListeners.set(chart,remember);
  return result;
 });
}
function chartControlKey(el){
 if(!el||!el.matches?.('input,select'))return null;
 if(el.dataset?.chartProxy||el.hasAttribute('data-forecast-preference')||el.closest('#bookingTimesUrgencyFilters'))return null;
 // Month sliders restore both handles together after their data bounds are ready.
 if(/^(demandRange|waitingRange|waitingTrendRange)(Start|End)$/.test(el.id))return null;
 const page=el.closest('[id$="Page"]');
 if(!page||page.id==='personalSettingsPage')return null;
 if(['categoryPage','practiceSettingsPage','peoplePage'].includes(page.id)&&!/(Search|Filter|UnassignedOnly)$/.test(el.id))return null;
 const type=el.tagName==='SELECT'?'select':el.type;
 if(!['checkbox','radio','select','range','date','month','number','search','text'].includes(type))return null;
 if(el.id)return (type==='checkbox'?'checkbox':type)+':'+page.id+':'+el.id;
 // Dynamic filter rows can be rebuilt or reordered; use their stable data key.
 const filterName=el.dataset?.filterName||el.dataset?.name||el.dataset?.option;
 if(filterName)return type+':'+page.id+':'+(el.closest('[id]')?.id||page.id)+':'+filterName;
 const row=el.closest('label')||el.parentElement;
 const label=(row?.textContent||el.getAttribute('aria-label')||'').trim().replace(/\s+/g,' ').slice(0,120);
 const panel=el.closest('[id]')?.id||page.id;
 return label?(type==='checkbox'?'checkbox':type)+':'+page.id+':'+panel+':'+label:null;
}
function chartControlValue(el){
 if(el.type==='checkbox'||el.type==='radio')return el.checked;
 return el.multiple?[...el.selectedOptions].map(option=>option.value):el.value;
}
let chartPreferenceRestoring=false,chartRestoredAccount=null;
let chartRestoredValues=new WeakMap();
const chartControlDefaults=new Map();
function restoreChartCheckboxes(){
 const account=chartPreferenceAccount();if(!account||chartPreferenceRestoring)return;
 const accountChanged=account!==chartRestoredAccount;
 if(accountChanged){chartRestoredAccount=account;chartRestoredValues=new WeakMap();}
 const saved=readChartPreferences(),changes=[];
 chartPreferenceRestoring=true;
 try{
  document.querySelectorAll('#dashboardShell input,#dashboardShell select').forEach(el=>{
   const key=chartControlKey(el);if(!key||el.disabled)return;
   if(!chartControlDefaults.has(key))chartControlDefaults.set(key,chartControlValue(el));
   if(!Object.hasOwn(saved,key)&&!accountChanged)return;
   // Waiting sliders attach their state handlers only when first opened.
   if(el.type==='range'&&/^waiting/.test(el.id)&&!el.dataset.bound)return;
   const value=key in saved?saved[key]:chartControlDefaults.get(key),signature=JSON.stringify(value);
   // Rebuilt controls need their own restoration attempt. Range inputs can
   // also become usable after report data supplies their actual bounds.
   const attempt=el.type==='range'?JSON.stringify([value,el.min,el.max,el.step]):signature;
   if(chartRestoredValues.get(el)===attempt)return;
   if(el.tagName==='SELECT'){
    const wanted=Array.isArray(value)?value:[String(value)];
    if(!wanted.every(v=>[...el.options].some(option=>option.value===v)))return;
   }
   chartRestoredValues.set(el,attempt);
   if(JSON.stringify(chartControlValue(el))===signature)return;
   if(el.type==='checkbox'||el.type==='radio'){if(typeof value!=='boolean')return;el.checked=value;}
   else if(el.multiple){for(const option of el.options)option.selected=value.includes(option.value);}
   else el.value=String(value);
   changes.push(el);
  });
  // Set both range handles before their handlers enforce ordering.
  // A range handler can redraw its paired handle. Reapply the whole pending group
  // before each dispatch so both handlers see the intended saved values.
  const pending=changes.map(el=>[el,chartControlValue(el)]);
  for(const [el,value] of pending){
   if(!el.isConnected||el.disabled){chartRestoredValues.delete(el);continue;}
   for(const [input,rangeValue] of pending)if(input.type==='range')input.value=rangeValue;
   if(el.type==='checkbox'||el.type==='radio')el.checked=value;
   el.dispatchEvent(new Event(['range','search','text'].includes(el.type)?'input':'change',{bubbles:true}));
  }
 }finally{chartPreferenceRestoring=false}
}
window.gpChartPreferences.restore=restoreChartCheckboxes;
function rememberChartControl(event){
 if(chartPreferenceRestoring)return;
 const el=event.target,key=chartControlKey(el);
 if(!key||el.disabled)return;
 if(event.type==='input'&&(el.type==='checkbox'||el.type==='radio'||el.tagName==='SELECT'))return;
 // The event bubbles here after the control's own handler validates the change.
 writeChartPreference(key,chartControlValue(el));
}
document.addEventListener('change',rememberChartControl);
document.addEventListener('input',rememberChartControl);
function chartExpansionKey(button){
 const page=button?.closest('[id$="Page"]');
 if(!page||['categoryPage','practiceSettingsPage','peoplePage','personalSettingsPage'].includes(page.id))return null;
 const target=button.getAttribute('aria-controls');return target?'expanded:'+page.id+':'+target:null;
}
const chartRestoredExpansions=new Map(),chartExpansionDefaults=new Map();
let chartExpansionAccount=null;
function setSecondaryFilterExpanded(button,expanded){
 button.setAttribute('aria-expanded',String(expanded));
 const sign=button.querySelector('.collapse-sign');if(sign)sign.textContent=expanded?'−':'+';
 const root=$(button.getAttribute('aria-controls'));if(root)root.hidden=!expanded;
 const summary=button.closest('.panel')?.querySelector('.collapsed-selection-summary');if(summary)summary.hidden=expanded;
}
function restoreChartExpansions(){
 const account=chartPreferenceAccount();if(!account)return;
 if(account!==chartExpansionAccount){chartExpansionAccount=account;chartRestoredExpansions.clear();}
 const saved=readChartPreferences(),wasRestoring=chartPreferenceRestoring;chartPreferenceRestoring=true;
 try{document.querySelectorAll('#dashboardShell .collapse-filter-button').forEach(button=>{
  const key=chartExpansionKey(button);if(!key)return;
  if(!chartExpansionDefaults.has(key))chartExpansionDefaults.set(key,button.getAttribute('aria-expanded')==='true');
  const expanded=typeof saved[key]==='boolean'?saved[key]:chartExpansionDefaults.get(key);
  if(chartRestoredExpansions.get(key)===expanded)return;
  chartRestoredExpansions.set(key,expanded);setSecondaryFilterExpanded(button,expanded);
 });updateCollapsedFilterSummaries();}finally{chartPreferenceRestoring=wasRestoring}
}

document.addEventListener('DOMContentLoaded',()=>{
 const shell=$('dashboardShell');if(!shell)return;
 let queued=false;
 new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;restoreChartCheckboxes();restoreChartExpansions()})}).observe(shell,{childList:true,subtree:true});
 restoreChartCheckboxes();restoreChartExpansions();
});
const CLOUD_SETTINGS_NAME='weekly-demand-categories.json';
function cloudNotice(msg){
 for(const id of ['cloudCategoryStatus','workforcePlanningSaveStatus']){
  const element=$(id);if(element)element.textContent=msg;
 }
}
async function cloudFile(){
 const shared=await readSharedSettings();
 if(shared||!isOwner)return shared;
 // Only a verified missing shared file permits first-time private-file recovery.
 // A permission, network or validation error must never publish a stale copy.
 const t=await token();
 const r=await fetch(GRAPH+'/me/drive/special/approot:/'+CLOUD_SETTINGS_NAME+':/content',{headers:{Authorization:'Bearer '+t},cache:'no-store'});
 if(r.status===404)return null;
 if(!r.ok)throw Error('Private settings read failed (HTTP '+r.status+')');
 return parseSettingsJSON(await r.text());
}
function validCategoryNames(names){
 if(!Array.isArray(names))throw Error('Saved categories are invalid');
 const result=[];
 for(const item of names){
  if(typeof item!=='string')continue;
  const name=item.trim();
  if(name&&name.toLowerCase()!=='uncategorised'&&!result.some(x=>x.toLowerCase()===name.toLowerCase()))result.push(name);
 }
 return result;
}
function validAssignments(values,names){
 if(!values||typeof values!=='object'||Array.isArray(values))throw Error('Saved assignments are invalid');
 const result={};
 for(const [slot,category] of Object.entries(values)){
  if(typeof category==='string'&&(category==='Uncategorised'||names.includes(category)))result[slot]=category;
 }
 return result;
}
async function loadCloudCategories(options={}){
 const readSerial=cloudChangeSerial,previousReady=cloudReady;
 if(!activeAccount)return;
 cloudReady=false;
 cloudNotice('Loading all categories from practice workspace…');
 try{
  const data=await cloudFile();
  if(options.protectEdits&&(categoryDirty||cloudBusy||readSerial!==cloudChangeSerial))throw Error('Settings changed during refresh; local edits were preserved.');
  if(data){
   validateCloudCategories(data);
   workforceWeeklySessions=new Map((data.workforceWeeklySessions||[]).map(([type,year,value])=>[JSON.stringify([type,year]),value]));
   analyticsRoles=data.analyticsRoles||{};
   if(data.practiceSettings&&typeof data.practiceSettings==='object'){
    const p=data.practiceSettings;
    practiceSettings={name:typeof p.name==='string'?p.name:'',anchors:p.anchors&&typeof p.anchors==='object'&&!Array.isArray(p.anchors)?Object.fromEntries(Object.entries(p.anchors).filter(([month,value])=>/^\d{4}-\d{2}$/.test(month)&&Number.isFinite(Number(value))&&Number(value)>=0).map(([month,value])=>[month,Number(value)])): {}};
    try{iqLocalStorage.setItem(PRACTICE_SETTINGS_KEY,JSON.stringify(practiceSettings))}catch(e){}
   }
   updateHomePracticeName();
   userTypeLocum=Object.fromEntries(Object.entries(data.userTypeLocum||{}).filter(([,value])=>['yes','no','unknown'].includes(value)));
   if(data.clinicianTypeColours&&typeof data.clinicianTypeColours==='object')clinicianTypeColours=Object.fromEntries(Object.entries(data.clinicianTypeColours).filter(([k,v])=>/^#[0-9a-f]{6}$/i.test(v)));
   if(data.urgencyTypeColours&&typeof data.urgencyTypeColours==='object')urgencyTypeColours=Object.fromEntries(Object.entries(data.urgencyTypeColours).filter(([k,v])=>/^#[0-9a-f]{6}$/i.test(v)));
   if(data.clinicianGroupColours&&typeof data.clinicianGroupColours==='object'&&!Array.isArray(data.clinicianGroupColours))clinicianGroupColours=Object.fromEntries(Object.entries(data.clinicianGroupColours).filter(([k,v])=>typeof k==='string'&&/^#[0-9a-f]{6}$/i.test(v)));
   cloudFolder=data.folder&&typeof data.folder.id==='string'?data.folder:null;
   if(data.togglePriority&&typeof data.togglePriority==='object')for(const k of Object.keys(togglePriority))togglePriority[k]=Array.isArray(data.togglePriority[k])?data.togglePriority[k].filter(x=>typeof x==='string'):[];
    excludedSlotTypes=new Set(Array.isArray(data.excludedSlotTypes)?data.excludedSlotTypes.filter(x=>typeof x==='string'):[]);
   const names=validCategoryNames(data.categories);
   const remoteAssignments=validAssignments(data.assignments,names);
   clinicianCategoryNames=Array.isArray(data.clinicianCategories)?validCategoryNames(data.clinicianCategories):clinicianCategoryNames;
   clinicianAssignments=data.clinicianAssignments?validAssignments(data.clinicianAssignments,clinicianCategoryNames):clinicianAssignments;
   consultCategoryNames=Array.isArray(data.consultCategories)?validCategoryNames(data.consultCategories):[];
   consultAssignments=data.consultAssignments?validAssignments(data.consultAssignments,consultCategoryNames):{};lastConsultFilterNames=[];
   if(data.consultModeColours&&typeof data.consultModeColours==='object')consultModeColours=Object.fromEntries(Object.entries(data.consultModeColours).filter(([k,v])=>/^#[0-9a-f]{6}$/i.test(v)));
   if(Array.isArray(data.purposeCategories)){purposeCategoryNames=validCategoryNames(data.purposeCategories);purposeColours=data.purposeColours&&typeof data.purposeColours==='object'?Object.fromEntries(Object.entries(data.purposeColours).filter(([k,v])=>/^#[0-9a-f]{6}$/i.test(v))):{};purposeAssignments=validAssignments(data.purposeAssignments||{},purposeCategoryNames)}
   if(Array.isArray(data.capacityCategories)){capacityCategoryNames=validCategoryNames(data.capacityCategories);capacityColours=data.capacityColours&&typeof data.capacityColours==='object'?Object.fromEntries(Object.entries(data.capacityColours).filter(([k,v])=>/^#[0-9a-f]{6}$/i.test(v))):{};capacityAssignments=validAssignments(data.capacityAssignments||{},capacityCategoryNames)}
   if(Array.isArray(data.clinicianGroupCategories)){clinicianGroupNames=validCategoryNames(data.clinicianGroupCategories);clinicianGroupAssignments=data.clinicianGroupAssignments?validAssignments(data.clinicianGroupAssignments,clinicianGroupNames):{};}
   if(data.urgencyGroupColours&&typeof data.urgencyGroupColours==='object'&&!Array.isArray(data.urgencyGroupColours))urgencyGroupColours=Object.fromEntries(Object.entries(data.urgencyGroupColours).filter(([key,value])=>typeof key==='string'&&/^#[0-9a-f]{6}$/i.test(value)));
   if(Array.isArray(data.appointmentCategoryNames)){appointmentCategoryNames=validCategoryNames(data.appointmentCategoryNames);appointmentCategoryAssignments=data.appointmentCategoryAssignments&&typeof data.appointmentCategoryAssignments==='object'?{...data.appointmentCategoryAssignments}:{};appointmentCategoryColours=data.appointmentCategoryColours&&typeof data.appointmentCategoryColours==='object'?{...data.appointmentCategoryColours}:{}}
   if(Array.isArray(data.groupUrgencyCategories)){
    groupUrgencyNames=validCategoryNames(data.groupUrgencyCategories);
    groupUrgencyAssignments=data.groupUrgencyAssignments?validAssignments(data.groupUrgencyAssignments,groupUrgencyNames):{};
   }
   // Older dashboard versions only saved Urgent and Routine to practice workspace.
   // On the original computer, preserve additional local categories during migration.
   const legacy=Number(data.version||1)<2;
   const localNames=categoryNames.slice();
   const localAssignments={...assignments};
   categoryNames=names.length?names:['Urgent','Routine'];
   ensureFollowUpCategory();
   assignments=remoteAssignments;
   if(legacy&&localNames.some(c=>!categoryNames.includes(c))){
    for(const c of localNames)if(!categoryNames.includes(c))categoryNames.push(c);
    for(const [slot,cat] of Object.entries(localAssignments)){
     if(!Object.prototype.hasOwnProperty.call(assignments,slot)||!['Urgent','Routine','Uncategorised'].includes(cat)){
      if(categoryNames.includes(cat)||cat==='Uncategorised')assignments[slot]=cat;
     }
    }
    cloudNotice('Recovered browser categories; saving all categories to practice workspace…');
    cloudReady=true;
    saveCategories(false);
    await saveCloudCategories();
   }else cloudNotice('All categories loaded from practice workspace.');
  }else if(!isOwner)throw Error('No shared settings file. The owner must sign in and publish settings first.');
  else cloudNotice('No cloud settings yet. Changes will save automatically.');
  cloudReady=true;
  saveCategories(false);
  if(categoryDirty)markCategoryDirty();
  renderEditor();
  renderGroupUrgencyEditor();
  renderClinicianEditor();
  renderClinicianGroupEditor();
  renderConsultEditor();
  refresh();
  renderPeopleGroups();
  consolidateUrgencyGroups();
  renderSlotPurposeCategories();
  renderCapacityStatusCategories();
  renderConsultModeCards();
  renderSlotGroupBoxes();renderSlotInclusion();renderSlotTable();renderUrgentCategoryToggles();
  renderPeople();
 }catch(e){
  cloudNotice('Could not load cloud categories: '+e.message+' (local settings retained)');
  cloudReady=options.protectEdits?previousReady:false;
  if(options.protectEdits&&cloudReady&&categoryDirty)markCategoryDirty();
  if(options.strict)throw e;
 }
}
let categoryDirty=false, cloudChangeSerial=0, cloudRetryTimer=null;
function markCategoryDirty(){
 if(!isOwner)return;
 categoryDirty=true;cloudChangeSerial++;
 cloudNotice('Saving settings automatically…');
 clearTimeout(cloudSaveTimer);
 if(activeAccount&&cloudReady)cloudSaveTimer=setTimeout(()=>{void saveCloudCategories()},850);
 else cloudNotice('Changes saved in this browser; practice workspace will sync when connected.');
}
function scheduleCloudSave(){markCategoryDirty()}

async function saveCloudCategories(options={}){
 if(!isOwner)return false;
 const manual=!!options.manual;
 if(!activeAccount||!cloudReady){
  if(manual)cloudNotice('Cannot save: sign in and wait for practice workspace settings to load.');
  return false;
 }
 if(cloudBusy){return false;}
 cloudBusy=true;
 const saveSerial=cloudChangeSerial;
 if(manual)cloudNotice('Saving all categories and slot assignments to practice workspace…');
 const snapshot=JSON.stringify({
  version:9,
  analyticsRoles:ensureAnalyticsRoles(),
   togglePriority:{...togglePriority},
  practiceSettings:{name:practiceSettings.name,anchors:{...practiceSettings.anchors}},
  userTypeLocum:{...userTypeLocum},
  clinicianGroupColours:{...clinicianGroupColours},clinicianTypeColours:{...clinicianTypeColours},urgencyTypeColours:{...urgencyTypeColours},
  categories:categoryNames.slice(),
  assignments:{...assignments},
  clinicianCategories:clinicianCategoryNames.slice(),
  clinicianAssignments:{...clinicianAssignments},
  clinicianGroupCategories:clinicianGroupNames.slice(),
  clinicianGroupAssignments:{...clinicianGroupAssignments},
  consultCategories:consultCategoryNames.slice(),
  consultAssignments:{...consultAssignments},
  purposeCategories:purposeCategoryNames.slice(),purposeColours:{...purposeColours},purposeAssignments:{...purposeAssignments},capacityCategories:capacityCategoryNames.slice(),capacityColours:{...capacityColours},capacityAssignments:{...capacityAssignments},consultModeColours:{...consultModeColours},excludedSlotTypes:[...excludedSlotTypes],
  groupUrgencyCategories:groupUrgencyNames.slice(),appointmentCategoryNames:appointmentCategoryNames.slice(),appointmentCategoryAssignments:{...appointmentCategoryAssignments},appointmentCategoryColours:{...appointmentCategoryColours},
  groupUrgencyAssignments:{...groupUrgencyAssignments},
  urgencyGroupColours:{...urgencyGroupColours},
  folder:selectedFolder||cloudFolder||null,
  updatedAt:new Date().toISOString()
 });
 try{
  const t=await token();
  const response=await fetch(GRAPH+'/me/drive/special/approot:/'+CLOUD_SETTINGS_NAME+':/content',{
   method:'PUT',
   headers:{Authorization:'Bearer '+t,'Content-Type':'application/json'},
   body:snapshot
  });
  if(!response.ok)throw Error('HTTP '+response.status);
  // Publish the same settings inside the shared CSV folder for read-only viewers.
  // Never save through a viewer's delegated Microsoft Graph session.
  if(selectedFolder?.id){
   const sharedSave=await fetch(GRAPH+'/me/drive/items/'+encodeURIComponent(selectedFolder.id)+':/'+encodeURIComponent(SHARED_SETTINGS_FILE)+':/content',{
    method:'PUT',headers:{Authorization:'Bearer '+t,'Content-Type':'application/json'},body:snapshot
   });
   if(!sharedSave.ok)throw Error('Shared settings publishing failed (HTTP '+sharedSave.status+')');
  }
  categoryDirty=cloudChangeSerial!==saveSerial;
  cloudNotice(categoryDirty?'Saved; newer edits are waiting to sync.':'Saved to practice workspace successfully.');
  return true;
 }catch(e){
  categoryDirty=true;
  cloudNotice('practice workspace autosave failed: '+e.message+'. Changes remain in this browser; retrying automatically.');
  clearTimeout(cloudRetryTimer);
  cloudRetryTimer=setTimeout(()=>{if(categoryDirty&&cloudReady&&activeAccount)void saveCloudCategories()},10000);
  return false;
 }finally{
  cloudBusy=false;
  if(categoryDirty&&cloudReady&&activeAccount&&!cloudRetryTimer){
   clearTimeout(cloudSaveTimer);
   cloudSaveTimer=setTimeout(()=>{void saveCloudCategories()},350);
  }
  if(!categoryDirty){clearTimeout(cloudRetryTimer);cloudRetryTimer=null;}
 }
}
function setStatus(s){$('connectionStatus').textContent=s;$('loginStatus').textContent=s}
function setSync(s){$('syncStatus').textContent=s}
function showRefreshFeedback(message,loading=false){
 const el=$('refreshFeedback');if(!el)return;
 headerRefreshLoading=loading;
 const header=$('headerSlotRefreshed');
 if(header){header.setAttribute('aria-busy',String(loading));if(loading){header.textContent=message;header.title=message;updateHeaderReportAge(headerReportTimestamp);}else updateHeaderSlotReportTime(headerReportTimestamp);}
 el.textContent=loading?'':message;el.classList.toggle('loading',loading);
 el.classList.toggle('header-feedback-quiet',!loading&&/^(Already up to date|Data refreshed successfully|Data refreshed ·)/.test(message));
 el.setAttribute('aria-busy',String(loading));
}
function resizeVisibleCharts(){
 if(!window.Plotly||$('chartPage').classList.contains('hidden')||$('dashboardShell').classList.contains('hidden'))return;
 for(const id of ['combinedDemandChart']){
  const el=$(id);
  if(el&&el.offsetWidth>0&&el.classList.contains('js-plotly-plot')){
   try{Plotly.Plots.resize(el)}catch(e){console.warn('Chart resize:',e)}
  }
 }
}
function scheduleChartResize(){
 requestAnimationFrame(()=>requestAnimationFrame(resizeVisibleCharts));
}
window.addEventListener('resize',scheduleChartResize);


function setButtons(){
 // Never interpret a background chart/data refresh as a sign-out.
 // Recover the active MSAL account from its persistent cache if needed.
 if(!activeAccount&&auth&&!authNeedsAccountSelection){
  try{activeAccount=auth.getActiveAccount()||auth.getAllAccounts()[0]||null}catch(e){}
 }
 if(activeAccount)authenticatedOnce=true;
 // A completed sign-in is only cleared by the explicit Sign out action.
 // A graph redraw or temporary MSAL cache lookup must never reveal login.
 const logged=!!activeAccount||authenticatedOnce||$('dashboardShell').dataset.signedIn==='true';
 if(logged)authenticatedOnce=true;
 // Never reveal the dashboard until Microsoft has verified folder access.
 if(logged&&folderAccessVerified&&!folderAccessDenied){
  $('dashboardShell').dataset.signedIn='true';
  $('loginScreen').classList.add('hidden');
  $('dashboardShell').classList.remove('hidden');
 }else if($('dashboardShell').dataset.signedIn!=='true'){
  $('loginScreen').classList.remove('hidden');
  $('dashboardShell').classList.add('hidden');
 }
 $('signIn').disabled=authChecking||(logged&&folderAccessVerified&&!folderAccessDenied);
 $('signIn').textContent='Sign in with Microsoft';
 if(logged)updateHeaderIdentity();
 window.gpChartOptions?.restore?.();
 $('signOut').disabled=!logged;
 $('chooseFolder').disabled=!logged||!isOwner;
 $('refreshData').disabled=!logged||!selectedFolder||busy;
}
function authStepWithTimeout(promise,message,milliseconds=20000){
 let timer;
 return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),milliseconds);})]).finally(()=>clearTimeout(timer));
}
function returnToMicrosoftSignIn(denied){
 stopDashboardIdleSession();
 folderAccessDenied=denied;folderAccessVerified=false;authenticatedOnce=false;
 authNeedsAccountSelection=true;activeAccount=null;selectedFolder=null;
 isOwner=false;cloudReady=false;
 $('dashboardShell').dataset.signedIn='false';
 $('dashboardShell').classList.add('hidden');$('loginScreen').classList.remove('hidden');
 $('accountLabel').textContent='';
 updateHeaderSlotReportTime(null);
 closeHeaderNavigation();
 try{auth?.setActiveAccount(null);}catch(_){}
 try{iqSessionStorage.setItem('gp-insight-account-selection-required',denied?'denied':'retry');}catch(_){}
 applyAccessMode();
}
async function initAuth(){
 if(authInitPromise)return authInitPromise;
 authChecking=true;
 // A reload can occur while large CSVs are parsed. If MSAL has a cached
 // account, do not flash the login page while redirect handling resolves.
 try{
  const cache=iqLocalStorage.getItem('msal.account.keys');
  if(cache&&cache!=='[]'){
   setStatus('Checking your Microsoft account and practice workspace access…');
  }
 }catch(e){}
 authInitPromise=(async()=>{
 try{
  if(!window.msal)throw Error('practice sign-in library did not load. Please refresh with Ctrl+F5 or check browser content blocking.');
  if(!window.Plotly||!window.Papa)setSync('A chart or CSV library did not load. Refresh the page to retry.');
  auth=new msal.PublicClientApplication({auth:{clientId:CLIENT_ID,authority:'https://login.microsoftonline.com/consumers',redirectUri:REDIRECT_URI,navigateToLoginRequestUrl:false},cache:{cacheLocation:'iqLocalStorage',storeAuthStateInCookie:false}});
  if(typeof auth.initialize==='function')await authStepWithTimeout(auth.initialize(),'practice sign-in took too long. Please try again.');const result=await authStepWithTimeout(auth.handleRedirectPromise(),'practice sign-in took too long. Please try again.');
  if(result?.account){authNeedsAccountSelection=false;try{iqSessionStorage.removeItem('gp-insight-account-selection-required');}catch(_){}}
  
  activeAccount=authNeedsAccountSelection?null:(result?.account||auth.getActiveAccount()||auth.getAllAccounts()[0]||activeAccount||null);
  if(activeAccount){
   authenticatedOnce=true;
   auth.setActiveAccount(activeAccount);
   folderAccessVerified=false;folderAccessDenied=false;
   setStatus('Checking your practice workspace folder permissions…');
   setButtons();
   await identifyOwner();
   if(isOwner){
    try{selectedFolder=JSON.parse(iqLocalStorage.getItem(FOLDER_KEY)||'null')}catch{}
   }else{
    selectedFolder=await locateSharedFolder();
   }
   await loadCloudCategories();
   if(!isOwner&&!cloudReady)throw Error('Shared settings could not be loaded. '+($('cloudCategoryStatus')?.textContent||'Ask the owner to publish them.'));
   folderAccessVerified=true;folderAccessDenied=false;setButtons();startDashboardIdleSession();
   // Existing browser migrates its chosen folder to practice workspace settings once.
   if(isOwner){if(cloudFolder){selectedFolder=cloudFolder;iqLocalStorage.setItem(FOLDER_KEY,JSON.stringify(selectedFolder))}
   else if(selectedFolder&&cloudReady){cloudFolder=selectedFolder;await saveCloudCategories()}
   // Publish shared settings even if this account has not made edits recently.
   if(selectedFolder&&cloudReady)await saveCloudCategories();}
   setStatus('Signed in: '+(activeAccount.username||'Microsoft account'));
   updateHeaderIdentity();
   if(selectedFolder){$('folderStatus').textContent='Source: '+selectedFolder.name;await loadFolder(false)}
   else if(isOwner){setSync('No source folder saved yet. Use Slot settings → Source folder setup.');$('sourceSetup').classList.remove('hidden')}
  }else setStatus(authNeedsAccountSelection?'Choose a Microsoft account with access to this dashboard.':'Sign in with a Microsoft account that has access to this dashboard.');
 }catch(e){
  const message=String(e?.message||e);
  // Only a confirmed 401/403 or a sharing-link denial is an access rejection.
  // Network outages and missing settings should not be mislabelled as unauthorised.
  // A 404 can mean an unsupported shared-item path or missing settings, not denied access.
  // Only classify explicit access-denied responses as an authorisation failure.
  const permissionError=[401,403].includes(e?.status)||/access.?denied|permission.?denied|not authorised|not authorized|does not have access/i.test(String(e?.code||'')+' '+message);
  const failedAccessCheck=!folderAccessVerified;
  if(failedAccessCheck){
   returnToMicrosoftSignIn(permissionError);
   setStatus(permissionError?'practice workspace access was denied (HTTP '+(e?.status||'unknown')+'). Check that this Microsoft account was explicitly invited to the shared folder.':'Unable to check dashboard access: '+message+' You can try signing in again.');
  }else setStatus('Unable to open dashboard: '+message);
 }finally{authChecking=false;setButtons()}
 })();
 return authInitPromise;
}
async function token(){
 if(!activeAccount)throw Error('Please sign in first.');
 try{return (await auth.acquireTokenSilent({scopes:SCOPES,account:activeAccount})).accessToken}
 catch(e){
  // Never automatically redirect from the dashboard on a background refresh.
  // A transient consent/token problem should not look like an unexpected logout.
  if(e instanceof msal.InteractionRequiredAuthError || /interaction_required|consent_required|login_required/i.test(String(e.errorCode||''))){
   throw Error('Microsoft needs to renew access. Your dashboard is still signed in; please refresh the page or sign out and sign in again if the problem continues.');
  }
  throw e;
 }
}
async function graph(url){
 const bearer=await authStepWithTimeout(token(),'Microsoft account verification timed out. Please sign in again.');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
 try{
  const response=await fetch(url.startsWith('https://')?url:GRAPH+url,{headers:{Authorization:'Bearer '+bearer},signal:controller.signal});
  if(!response.ok){
   let body=null;try{body=await response.json()}catch(_){}
   const error=Error(body?.error?.message||'HTTP '+response.status);error.status=response.status;error.code=body?.error?.code||'';throw error;
  }
  return await response.json();
 }catch(error){if(error?.name==='AbortError')throw Error('practice workspace access verification timed out. Please sign in again.');throw error;}
 finally{clearTimeout(timer)}
}
async function children(id){if(!isOwner&&id===sharedFolderId){const items=[];let url=sharedPath()+'/children?$top=200';while(url){const r=await graph(url);items.push(...(r.value||[]));url=r['@odata.nextLink']||null}return items;}let url=id==='root'?'/me/drive/root/children?$top=200&$select=id,name,folder,file,size,lastModifiedDateTime':`/me/drive/items/${encodeURIComponent(id)}/children?$top=200&$select=id,name,folder,file,size,lastModifiedDateTime`;const items=[];while(url){const r=await graph(url);items.push(...(r.value||[]));url=r['@odata.nextLink']||null}return items}
async function showFolderPicker(){$('onedrivePanel').classList.remove('hidden');folderView={id:'root',name:'practice workspace',trail:[]};$('folderPicker').classList.remove('hidden');await showFolderContents()}
async function showFolderContents(){try{$('pickerPath').textContent=[...folderView.trail.map(x=>x.name),folderView.name].join(' / ');$('pickerEntries').textContent='Loading folders…';const folders=(await children(folderView.id)).filter(x=>x.folder).sort((a,b)=>a.name.localeCompare(b.name));$('pickerEntries').replaceChildren();if(!folders.length)$('pickerEntries').textContent='No subfolders. You can select this folder.';for(const f of folders){const btn=document.createElement('button');btn.className='folder-entry';btn.textContent='📁 '+f.name;btn.onclick=async()=>{folderView={id:f.id,name:f.name,trail:[...folderView.trail,{id:folderView.id,name:folderView.name}]};await showFolderContents()};$('pickerEntries').append(btn)}}catch(e){$('pickerEntries').textContent='Could not list folders: '+e.message}}
function weekMonday(d){const x=new Date(d);x.setUTCHours(12,0,0,0);x.setUTCDate(x.getUTCDate()-((x.getUTCDay()+6)%7));return x.toISOString().slice(0,10)}
function parseDate(s){const m=/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec((s||'').trim());if(!m)return null;const mi=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[2].toLowerCase());if(mi<0)return null;const d=new Date(Date.UTC(Number(m[3]),mi,Number(m[1])));return d.getUTCMonth()===mi&&d.getUTCDate()===Number(m[1])?d:null}
const slotUserTypeColumn='User Type of the Session Holder of the Session';
const slotLeadTimeColumn='Booked Time to Slot Time';
const slotQuantityColumn='Count';
const slotQuantityHeadings=new Set(['count','slot count','appointment count','quantity','number of slots','number of appointments']);
const slotRequiredColumns=['Appointment Date','Appointment Time',slotLeadTimeColumn,slotUserTypeColumn,'Slot Type','Availability'];
const slotHeaderlessColumns=[...slotRequiredColumns,'Patient Age','Gender','Town of the Location of the Session','DNA'];
const slotAvailabilityValues=new Set(['booked','available','blocked','embargoed']);

function parseSlotReportCSV(csv){
 const parsed=Papa.parse(csv,{delimiter:',',skipEmptyLines:'greedy'});
 if(parsed.errors.length)throw Error('Slot Report CSV parsing failed: '+parsed.errors[0].message);
 const clean=value=>String(value??'').trim();
 const headerIndex=parsed.data.slice(0,30).findIndex(row=>slotRequiredColumns.every(column=>row.some(value=>clean(value)===column)));
 if(headerIndex>=0){
  const columns=parsed.data[headerIndex].map(clean);
  if([...slotRequiredColumns,'DNA'].some(column=>columns.indexOf(column)!==columns.lastIndexOf(column))){
   throw Error('The Slot Report contains duplicate column headings.');
  }
  const rows=parsed.data.slice(headerIndex+1);
  const quantityPositions=columns.flatMap((column,index)=>slotQuantityHeadings.has(column.toLowerCase())?[index]:[]);
  if(quantityPositions.length>1)throw Error('The Slot Report contains more than one count column.');
  let quantityPosition=quantityPositions[0];
  if(quantityPosition===undefined){
   // EMIS can export a quantity after the last named column, with either
   // an empty header cell or no header cell at all.
   let trailingPosition=columns.length;
   while(trailingPosition>0&&!columns[trailingPosition-1])trailingPosition--;
   if(rows.some(row=>row.slice(trailingPosition+1).some(value=>clean(value)))){
    throw Error('The Slot Report contains multiple unlabelled columns after its last heading.');
   }
   if(rows.some(row=>clean(row[trailingPosition]))){
    columns[trailingPosition]=slotQuantityColumn;
    quantityPosition=trailingPosition;
   }
  }
  return {columns,rows,quantityPosition};
 }
 // Only infer the tested EMIS column order when the first row looks like
 // appointment data and every row fits the supported positional layout.
 const first=parsed.data[0];
 if(!first||!parseDate(clean(first[0]))||!/^\d{1,2}:\d{2}/.test(clean(first[1]))
     ||!clean(first[3])||!clean(first[4])||!slotAvailabilityValues.has(clean(first[5]).toLowerCase())
     ||parsed.data.some(row=>row.length<9
       ||(clean(row[10])&&!/^\d+$/.test(clean(row[10])))
       ||row.slice(11).some(value=>clean(value)))){
  throw Error('Slot Report headings were not found and the file does not match the supported headerless layout.');
 }
 const hasDNA=parsed.data.some(row=>clean(row[9]));
 const hasQuantity=parsed.data.some(row=>clean(row[10]));
 const columns=slotHeaderlessColumns.slice(0,hasDNA?10:9);
 if(hasQuantity){
  if(!hasDNA)columns.push('');
  columns.push(slotQuantityColumn);
 }
 return {columns,rows:parsed.data,quantityPosition:hasQuantity?10:undefined};
}

function aggregateCSV(csv,aggregated,availabilityAggregate,bookingTimeAggregate,_peopleAggregate,slotStats,waitingAggregate,waitingTrendAggregate,appointmentTimeAggregate){
 const parsed=parseSlotReportCSV(csv);
 const columnPositions=new Map(parsed.columns.map((name,index)=>[name,index]));
 const dna=columnPositions.has('DNA')?{attended:0,didNotAttend:0,unknown:0}:null;
 let valid=0,skipped=0;
 const slotFieldPositions=slotHeaderlessColumns.map(column=>columnPositions.get(column));
 const leadTimePosition=columnPositions.get(slotLeadTimeColumn);
 const previous=parsed.columns.map(()=>'');
 for(const [rowIndex,original] of parsed.rows.entries()){
  // A row needs at least one value in a recognised Slot Report field before fill-down.
  const values=parsed.columns.map((_,index)=>String(original[index]??'').trim());
  if(!slotFieldPositions.some(index=>values[index])&&!values[parsed.quantityPosition])continue;
  const quantityRaw=values[parsed.quantityPosition];
  const quantity=parsed.quantityPosition===undefined?1:Number(quantityRaw);
  if(parsed.quantityPosition!==undefined&&(!/^\d+$/.test(quantityRaw)||!Number.isSafeInteger(quantity))){
   throw Error('Slot Report data row '+(rowIndex+1)+' must have a non-negative whole number in the count column.');
  }
  const leadRaw=values[leadTimePosition];
  const filled=values.map((value,index)=>{
   if(index===leadTimePosition||index===parsed.quantityPosition)return value;
   if(value)previous[index]=value;
   return previous[index];
  });
  const r=Object.fromEntries(parsed.columns.map((column,index)=>[column,filled[index]]));
  if(quantity===0)continue;
  const day=String(r['Appointment Date']??'').trim();
  const time=String(r['Appointment Time']??'').trim();
  const slotType=String(r['Slot Type']??'').trim();
  const availability=String(r['Availability']??'').trim();
  const status=availability.toLowerCase();
  if(!slotAvailabilityValues.has(status)||!slotType)continue;
  const appointmentDay=parseDate(day);
  if(!appointmentDay)continue;
  const date=appointmentDay.toISOString().slice(0,10);
  const clinician=r[slotUserTypeColumn]||'Unknown clinician';
  // Preserve the aggregate key shape so existing reports can still load.
  const person='';
  if(dna){
   const outcome=r.DNA.toLowerCase();
   if(outcome==='did not attend')dna.didNotAttend+=quantity;
   else if(outcome==='attended')dna.attended+=quantity;
   else dna.unknown+=quantity;
  }
  if(slotStats){const stat=slotStats.get(slotType)||{count:0,min:date,max:date};stat.count+=quantity;if(date<stat.min)stat.min=date;if(date>stat.max)stat.max=date;slotStats.set(slotType,stat)}
  const slotClock=/^(\d{1,2}):(\d{2})/.exec(time);
  const appointmentMinute=slotClock&&Number(slotClock[1])<24&&Number(slotClock[2])<60?Number(slotClock[1])*60+Number(slotClock[2]):null;
  const akey=JSON.stringify([date,slotType,availability,clinician,person,appointmentMinute,'slot']);
  availabilityAggregate.set(akey,(availabilityAggregate.get(akey)||0)+quantity);
  if(status!=='booked')continue;
  const lead=Number(leadRaw.replace(/,/g,''));
  if(waitingAggregate&&leadRaw&&Number.isFinite(lead)&&lead>=0){
   const dayBin=Math.floor(lead/1440);
   const appointmentMonth=appointmentDay.toISOString().slice(0,7);
   const appointmentDate=appointmentDay.toISOString().slice(0,10);
   const waitKey=JSON.stringify([slotType,dayBin,clinician,person,appointmentMonth]);
   waitingAggregate.set(waitKey,(waitingAggregate.get(waitKey)||0)+quantity);
   const trendKey=JSON.stringify([slotType,clinician,person,appointmentMonth,appointmentDate,lead]);
   waitingTrendAggregate.set(trendKey,(waitingTrendAggregate.get(trendKey)||0)+quantity);
  }
  const tm=/^(\d{1,2}):(\d{2})/.exec(time);
  if(!tm||!leadRaw||!Number.isFinite(lead)){skipped+=quantity;continue;}
  const dt=new Date(appointmentDay.getTime());
  dt.setUTCHours(Number(tm[1]),Number(tm[2]),0,0);
  const booked=new Date(dt.getTime()-lead*60000);
  if(!Number.isFinite(booked.getTime())){skipped+=quantity;continue;}
  const w=weekMonday(booked);
  const bookedDay=booked.toISOString().slice(0,10);
  // Booking clock time, calculated using the same lead-time arithmetic as the demand charts.
  const bookedMinute=booked.getUTCHours()*60+booked.getUTCMinutes();
  // Day View scheduled workload: appointment DATE is fixed, booking timestamp controls the slider.
  const scheduledKey=JSON.stringify([date,bookedDay,bookedMinute,slotType,clinician,person,'slot']);
  appointmentTimeAggregate.set(scheduledKey,(appointmentTimeAggregate.get(scheduledKey)||0)+quantity);
  const timeKey=JSON.stringify([bookedDay,bookedMinute,slotType,clinician,person]);
  bookingTimeAggregate.set(timeKey,(bookingTimeAggregate.get(timeKey)||0)+quantity);
  const key=JSON.stringify([bookedDay,slotType,clinician,person]);
  aggregated.set(key,(aggregated.get(key)||0)+quantity);valid+=quantity;
 }
 return {valid,skipped,dna};
}
// Drag-and-drop category editor. Existing practice workspace JSON schema remains unchanged.
let pickedSlot=null;
function renderDropEditor(dimension){
 const cfg={
  urgency:{items:types,names:categoryNames,assign:assignments,boxes:'categoryNames',pool:'slotAssignments',search:'slotSearch',summary:'assignmentSummary',render:renderEditor},
  groupUrgency:{items:categoryNames,names:groupUrgencyNames,assign:groupUrgencyAssignments,boxes:'groupUrgencyNames',pool:'groupUrgencyAssignmentsPool',search:'groupUrgencySearch',summary:'groupUrgencySummary',render:renderGroupUrgencyEditor},
  clinician:{items:clinicianTypes,names:clinicianCategoryNames,assign:clinicianAssignments,boxes:'clinicianCategoryNames',pool:'clinicianSlotAssignments',search:'clinicianSlotSearch',summary:'clinicianAssignmentSummary',render:renderClinicianEditor},
  clinicianGroup:{items:clinicianCategoryNames,names:clinicianGroupNames,assign:clinicianGroupAssignments,boxes:'clinicianGroupNames',pool:'clinicianGroupAssignmentsPool',search:'clinicianGroupSearch',summary:'clinicianGroupSummary',render:renderClinicianGroupEditor},
  consult:{items:types,names:consultCategoryNames,assign:consultAssignments,boxes:'consultCategoryNames',pool:'consultSlotAssignments',search:'consultSlotSearch',summary:'consultAssignmentSummary',render:renderConsultEditor}
 }[dimension];
 if(!cfg)return;
 const boxes=$(cfg.boxes),pool=$(cfg.pool);if(!boxes||!pool)return;
 boxes.replaceChildren();pool.replaceChildren();
 const query=$(cfg.search).value.trim().toLowerCase();
 const filtered=cfg.items.filter(t=>t.toLowerCase().includes(query));
 const current=t=>cfg.names.includes(cfg.assign[t])?cfg.assign[t]:'Uncategorised';
 const place=(slot,category)=>{
  if(!cfg.items.includes(slot)||!(category==='Uncategorised'||cfg.names.includes(category)))return;
  cfg.assign[slot]=category;
  pickedSlot=null;
  saveCategories();
  if(dimension==='urgency')rebuildCategoryFilter();
  cfg.render();
 };
 function makeCard(t){
  const card=document.createElement('div');card.className='slot-chip';card.draggable=true;card.tabIndex=0;
  card.setAttribute('role','button');card.setAttribute('aria-label',t+'. Drag to a category, or press Enter to select.');
  const ico=document.createElement('span');ico.className='slot-chip-icon';ico.textContent='⠿';ico.setAttribute('aria-hidden','true');
  const label=document.createElement('span');label.textContent=t;card.append(ico,label);
  card.addEventListener('dragstart',e=>{pickedSlot={dimension,slot:t};e.dataTransfer.setData('text/plain',t);e.dataTransfer.effectAllowed='move';card.classList.add('dragging')});
  card.addEventListener('dragend',()=>{card.classList.remove('dragging');document.querySelectorAll('.drop-over').forEach(el=>el.classList.remove('drop-over'))});
  card.addEventListener('click',()=>{pickedSlot={dimension,slot:t};document.querySelectorAll('.slot-chip.selected').forEach(el=>el.classList.remove('selected'));card.classList.add('selected')});
  card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();card.click()}});
  return card;
 }
 function makeZone(name,isPool=false){
  const zone=document.createElement('div');zone.className='drop-zone'+(isPool?' unassigned-zone':'');zone.tabIndex=0;
  zone.setAttribute('role','group');zone.setAttribute('aria-label','Drop items into '+name);
  const head=document.createElement('div');head.className='drop-zone-header';
  const title=document.createElement('strong');title.textContent=name;
  head.append(title);
  if(!isPool){
   const rename=document.createElement('button');rename.type='button';rename.className='drop-rename';rename.textContent='Rename';
   rename.setAttribute('aria-label','Rename '+name);
   rename.onclick=e=>{
    e.stopPropagation();
    const proposed=prompt('Rename category “'+name+'”:',name);
    if(proposed===null)return;
    const next=proposed.trim();
    if(!next||next.toLowerCase()==='uncategorised'||cfg.names.some(c=>c!==name&&c.toLowerCase()===next.toLowerCase())){
     alert('Enter a unique category name (Uncategorised is reserved).');return;
    }
    if(next===name)return;
    // Update both the category and all existing assignments atomically.
    const index=cfg.names.indexOf(name);if(index<0)return;
    if(dimension==='urgency'||dimension==='groupUrgency')renameAnalyticsRole('appointmentTypes',name,next);
    if(dimension==='clinicianGroup')renameAnalyticsRole('clinicianGroups',name,next);
    cfg.names[index]=next;
    if(dimension==='clinician'&&Object.prototype.hasOwnProperty.call(clinicianGroupAssignments,name)){clinicianGroupAssignments[next]=clinicianGroupAssignments[name];delete clinicianGroupAssignments[name];}
    if(dimension==='urgency'&&Object.prototype.hasOwnProperty.call(groupUrgencyAssignments,name)){groupUrgencyAssignments[next]=groupUrgencyAssignments[name];delete groupUrgencyAssignments[name];}
    if(dimension==='clinicianGroup'){if(disabledClinicianTypes.delete(name))disabledClinicianTypes.add(next);lastClinicianFilterNames=[];}
    for(const slot of Object.keys(cfg.assign))if(cfg.assign[slot]===name)cfg.assign[slot]=next;
    // Preserve the selected urgency filter when its category name changes.
    if(dimension==='urgency'){for(const option of slots.options)if(option.value===name)option.value=next;}
    if(dimension==='groupUrgency'&&selectedAvailabilityUrgency===name)selectedAvailabilityUrgency=next;
    saveCategories();if(dimension==='urgency'){rebuildCategoryFilter();renderGroupUrgencyEditor()}if(dimension==='clinician'){renderClinicianGroupEditor();renderPeople()}cfg.render();if(dimension==='groupUrgency')renderAvailabilityChart();if(dimension==='clinicianGroup')updateClinicianChartFilter();
   };
   head.append(rename);
   const del=document.createElement('button');del.type='button';del.className='drop-delete';del.textContent='Delete';
   del.setAttribute('aria-label','Delete '+name);
   del.onclick=e=>{e.stopPropagation();if(!confirm('Delete category “'+name+'”? Its slot types will become Uncategorised.'))return;
    if(dimension==='urgency'){categoryNames=categoryNames.filter(c=>c!==name);for(const t of cfg.items)if(assignments[t]===name)assignments[t]='Uncategorised';delete groupUrgencyAssignments[name]}
    else if(dimension==='groupUrgency'){groupUrgencyNames=groupUrgencyNames.filter(c=>c!==name);for(const t of cfg.items)if(groupUrgencyAssignments[t]===name)groupUrgencyAssignments[t]='Uncategorised'}
    else if(dimension==='clinician'){clinicianCategoryNames=clinicianCategoryNames.filter(c=>c!==name);for(const t of cfg.items)if(clinicianAssignments[t]===name)clinicianAssignments[t]='Uncategorised';delete clinicianGroupAssignments[name]}
    else if(dimension==='clinicianGroup'){clinicianGroupNames=clinicianGroupNames.filter(c=>c!==name);for(const t of cfg.items)if(clinicianGroupAssignments[t]===name)clinicianGroupAssignments[t]='Uncategorised'}
    else{consultCategoryNames=consultCategoryNames.filter(c=>c!==name);for(const t of cfg.items)if(consultAssignments[t]===name)consultAssignments[t]='Uncategorised'}
    if(dimension==='clinicianGroup'){disabledClinicianTypes.delete(name);lastClinicianFilterNames=[];}
    saveCategories();if(dimension==='urgency'){rebuildCategoryFilter();renderGroupUrgencyEditor()}if(dimension==='clinician'){renderClinicianGroupEditor();renderPeople()}cfg.render();if(dimension==='groupUrgency')renderAvailabilityChart();if(dimension==='clinicianGroup')updateClinicianChartFilter();
   };head.append(del);
  }
  zone.append(head);
  const body=document.createElement('div');body.className='drop-zone-body';
  const matching=filtered.filter(t=>current(t)===name);
  if(!matching.length){const hint=document.createElement('p');hint.className='drop-hint';hint.textContent=query?'No matching items':'Drop items here';body.append(hint)}
  for(const t of matching)body.append(makeCard(t));
  zone.append(body);
  zone.addEventListener('dragover',e=>{if(pickedSlot?.dimension!==dimension)return;e.preventDefault();e.dataTransfer.dropEffect='move';zone.classList.add('drop-over')});
  zone.addEventListener('dragleave',e=>{if(!zone.contains(e.relatedTarget))zone.classList.remove('drop-over')});
  zone.addEventListener('drop',e=>{e.preventDefault();zone.classList.remove('drop-over');if(pickedSlot?.dimension===dimension)place(pickedSlot.slot,name)});
  // Accessible alternative to drag-and-drop: select a slot, then click its destination.
  zone.addEventListener('click',e=>{if(e.target.closest('button')||e.target.closest('.slot-chip'))return;if(pickedSlot?.dimension===dimension)place(pickedSlot.slot,name)});
  zone.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&pickedSlot?.dimension===dimension){e.preventDefault();place(pickedSlot.slot,name)}});
  return zone;
 }
 pool.append(makeZone('Uncategorised',true));
 for(const c of cfg.names)boxes.append(makeZone(c));
 $(cfg.summary).textContent=cfg.items.filter(t=>cfg.names.includes(cfg.assign[t])).length+' of '+cfg.items.length+(dimension==='groupUrgency'?' detailed Appointment Types':dimension==='clinicianGroup'?' detailed clinician categories':dimension==='clinician'?' clinician user types':' slot types')+' assigned. Drag a slot icon into a category box (or select it, then click a box).';
}

// Only replace an existing CSV in the selected source folder. Never create files,
// and never write to the separate app-folder settings JSON.
let csvDropBusy=false,csvDragDepth=0;
function csvDropStatus(message,isError=false){
 const status=$('csvDropStatus');if(status){status.textContent='';status.classList.toggle('csv-drop-error',isError)}
 showRefreshFeedback(message,!!message&&!isError);
}
function csvDropOverlay(show){
 const overlay=$('csvDropOverlay');if(overlay)overlay.classList.toggle('hidden',!show);
}
function csvUploadModal(show){
 const modal=$('csvUploadModal');if(modal)modal.classList.toggle('hidden',!show);
}
function csvFileDrag(event){
 return [...(event.dataTransfer?.types||[])].includes('Files');
}
function validateReplacementCSV(text){
 const {columns,rows}=parseSlotReportCSV(text);
 if(!rows.length)throw Error('CSV has no appointment rows.');
 return {columns,previewRows:Math.min(rows.length,15)};
}
function validateSignpostingReplacementCSV(text){
 const parsed=Papa.parse(text,{header:true,preview:15,skipEmptyLines:'greedy',bom:true});
 if(parsed.errors?.length)throw Error('Signposting CSV parsing failed: '+parsed.errors[0].message);
 const columns=(parsed.meta.fields||[]).map(x=>String(x||'').replace(/^\uFEFF/,'').trim());
 const required=['Anonymised Identifier','Age','Gender','Date',"Consultation Details' Time",'Code Term'];
 const missing=required.filter(x=>!columns.includes(x));
 if(missing.length)throw Error('Signposting CSV is incompatible. Missing column(s): '+missing.join(', '));
 if(!parsed.data.length)throw Error('Signposting CSV has no data rows.');
 return {columns,previewRows:parsed.data.length};
}
function validateCSVForReplacement(text,filename){
 return isSignpostingFile(filename)?validateSignpostingReplacementCSV(text):validateReplacementCSV(text);
}
function awaitCSVConfirmation(fileName,match,appendSummary){
 return new Promise(resolve=>{
  const modal=$('csvUploadModal'),confirm=$('csvUploadConfirm'),cancel=$('csvUploadCancel');
  if(!modal||!confirm||!cancel){resolve(false);return}
  $('csvUploadMessage').textContent=appendSummary||'Replace the existing practice workspace CSV "'+match.name+'" with the dropped file "'+fileName+'"? This will overwrite the existing file. Your people and slot settings will not be changed.';
  confirm.textContent=appendSummary?'Append new records':'Replace existing CSV';
  csvUploadModal(true);
  const finish=accepted=>{
   csvUploadModal(false);confirm.removeEventListener('click',yes);cancel.removeEventListener('click',no);
   resolve(accepted);
  };
  const yes=()=>finish(true),no=()=>finish(false);
  confirm.addEventListener('click',yes);cancel.addEventListener('click',no);
 });
}
async function replaceExistingCSV(file){
 if(csvDropBusy)return;
 if(!isOwner){csvDropStatus('View-only accounts cannot replace CSV files.',true);return;}if(!activeAccount||!selectedFolder){csvDropStatus('Sign in and select your practice workspace CSV folder first.',true);return}
 if(!file||!/\.csv$/i.test(file.name)){csvDropStatus('Rejected: only CSV files can be uploaded.',true);return}
 if(file.size===0||file.size>200*1024*1024){csvDropStatus('Rejected: CSV must be non-empty and no larger than 200 MB.',true);return}
 let uploadFailed=false,keepStatus=false;
 csvDropBusy=true;csvDropStatus('Checking '+file.name+' against practice workspace…');
 try{
  const existing=(await children(selectedFolder.id)).filter(item=>item.file&&/\.csv$/i.test(item.name));
  const text=await file.text();
  const directRH=typeof DirectRHCSV!=='undefined'&&DirectRHCSV.recognises(text,Papa);
  // Direct RH exports can have timestamp filenames; only their canonical source is updated.
  const targetName=directRH?'Direct RH Data.csv':file.name;
  const matches=existing.filter(item=>item.name.toLocaleLowerCase('en-GB')===targetName.toLocaleLowerCase('en-GB'));
  if(matches.length!==1)throw Error(directRH?'Place the initial full dataset named Direct RH Data.csv in the selected practice workspace folder first.':'Rejected: no existing CSV with exactly this filename in the selected practice workspace folder.');
  const match=matches[0];
  if(!directRH)validateCSVForReplacement(text,match.name);
  // Check the original export's columns as well, so incompatible replacements
  // cannot silently change the source schema.
  const detail=await graph('/me/drive/items/'+encodeURIComponent(match.id));
  if(detail.parentReference?.id&&detail.parentReference.id!==selectedFolder.id)
   throw Error('The existing file is not in the selected practice workspace folder.');
  const originalUrl=detail['@microsoft.graph.downloadUrl'];
  if(!originalUrl)throw Error('Could not verify the original practice workspace CSV.');
  const originalResponse=await fetch(originalUrl,{cache:'no-store'});
  if(!originalResponse.ok)throw Error('Could not check the original CSV.');
  const originalText=await originalResponse.text();
  let body=file,appendSummary='';
  if(directRH){
   const merged=DirectRHCSV.merge(originalText,text,Papa);
   if(!merged.rows.length){keepStatus=true;showRefreshFeedback('No new Direct RH records. Existing file unchanged; '+merged.skipped.toLocaleString('en-GB')+' overlapping or older records ignored.',false);return}
   if(!detail.eTag)throw Error('Could not verify the current Direct RH file version. Refresh and try again.');
   body=new Blob([merged.text],{type:'text/csv;charset=utf-8'});
   if(body.size>200*1024*1024)throw Error('The combined Direct RH CSV exceeds the 200 MB upload limit.');
   appendSummary='Append '+merged.rows.length.toLocaleString('en-GB')+' new records to '+match.name+'? Ignore '+merged.skipped.toLocaleString('en-GB')+' records at or before the latest saved request minute. Existing records stay unchanged. The dropped file will not be saved separately.';
  }else{
   const originalSchema=validateCSVForReplacement(originalText,match.name).columns;
   const newSchema=validateCSVForReplacement(text,match.name).columns;
   if(originalSchema.length!==newSchema.length||originalSchema.some((column,i)=>column!==newSchema[i]))
    throw Error('Rejected: the CSV column headings or their order do not match the existing practice workspace file.');
  }
  csvDropStatus('Validated '+file.name+'. Waiting for confirmation…');
  if(!await awaitCSVConfirmation(file.name,match,appendSummary)){csvDropStatus('Upload cancelled. No files were changed.');return}
  csvDropStatus('Uploading '+file.name+' to practice workspace…');
  const bearer=await token();
  // PUT by existing item ID, never by path: this can only replace the matched file.
  const upload=await fetch(GRAPH+'/me/drive/items/'+encodeURIComponent(match.id)+'/content',{
   method:'PUT',headers:{Authorization:'Bearer '+bearer,'Content-Type':'text/csv',...(directRH?{'If-Match':detail.eTag}:{})},
   body
  });
  if(!upload.ok){
   if(directRH&&upload.status===412)throw Error('Direct RH Data.csv changed during this upload. Drop the file again to merge with the latest version.');
   let message='HTTP '+upload.status;
   try{const response=await upload.json();message=response.error?.message||message}catch{}
   throw Error('practice workspace rejected the replacement: '+message);
  }
  csvDropStatus('Replaced '+match.name+' successfully. Refreshing charts…');
  // This refresh reads the current saved categories and people assignments
  // without changing them; the settings JSON is never overwritten here.
  csvContributionCache.delete(match.id);
  lastFingerprint='';
  if(directRH){
   await loadFolder(true);
   if($('refreshFeedback')?.textContent.startsWith('Refresh failed:')){uploadFailed=true;return;}
   keepStatus=true;showRefreshFeedback('New Direct RH records appended to '+match.name+'. No separate upload file saved.',false);return;
  }
  await loadFolder(true);
  if($('refreshFeedback')?.textContent.startsWith('Refresh failed:')){uploadFailed=true;return;}
  csvDropStatus('');
 }catch(error){
  uploadFailed=true;
  console.error('CSV replacement error',error);
  csvDropStatus(error?.message||String(error),true);
 }finally{csvDropBusy=false;if(!uploadFailed&&!keepStatus)csvDropStatus('')}
}
function initCSVDragDrop(){
 window.addEventListener('dragenter',event=>{
  if(!csvFileDrag(event))return;
  event.preventDefault();csvDragDepth++;
  if(!csvDropBusy)csvDropOverlay(true);
 });
 window.addEventListener('dragover',event=>{
  if(!csvFileDrag(event))return;
  event.preventDefault();event.dataTransfer.dropEffect='copy';
 });
 window.addEventListener('dragleave',event=>{
  if(!csvFileDrag(event))return;
  csvDragDepth=Math.max(0,csvDragDepth-1);
  if(!csvDragDepth)csvDropOverlay(false);
 });
 window.addEventListener('drop',event=>{
  // Internal group/type drags carry text data, not files. Never intercept them.
  if(!csvFileDrag(event))return;
  event.preventDefault();csvDragDepth=0;csvDropOverlay(false);
  const files=[...(event.dataTransfer?.files||[])];
  if(files.length!==1){csvDropStatus('Rejected: drop exactly one CSV file at a time.',true);return}
  void replaceExistingCSV(files[0]);
 });
}
initCSVDragDrop();

let rapidHealthSummary=null;
let signpostingRecords=[],signpostingFileCount=0;let signpostingSlotNames=new Set();
function isSignpostingFile(name){return /signposting[\s_-]*auto[\s_-]*report/i.test(String(name||''))&&/\.csv$/i.test(name)}
function parseSignpostingDate(raw){
 const value=String(raw||'').trim();
 const m=/^(\d{1,2})[-\/ ]([A-Za-z]{3,9})[-\/ ,]*(\d{4})$/.exec(value);
 if(m){const month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[2].slice(0,3).toLowerCase());const day=Number(m[1]),year=Number(m[3]);const dt=new Date(Date.UTC(year,month,day));if(month>=0&&dt.getUTCFullYear()===year&&dt.getUTCMonth()===month&&dt.getUTCDate()===day)return dt.toISOString().slice(0,10)}
 const iso=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
 if(iso){const dt=new Date(value+'T00:00:00Z');if(!isNaN(dt)&&dt.toISOString().slice(0,10)===value)return value}
 return '';
}
function parseSignpostingCSV(csv){
 const parsed=Papa.parse(csv,{header:true,skipEmptyLines:false,bom:true});
 const required=['Anonymised Identifier','Age','Gender','Date',"Consultation Details' Time",'Code Term'];
 const headers=(parsed.meta.fields||[]).map(h=>h.trim());
 if(!required.every(col=>headers.includes(col)))throw Error('Signposting CSV is missing expected columns: '+required.filter(col=>!headers.includes(col)).join(', '));
 const previous=Object.fromEntries(required.map(k=>[k,'']));
 const results=[];
 for(const raw of parsed.data){
  // Fill down EVERY column independently, including identifiers and demographics.
  // Completely empty rows are ignored so they cannot become duplicate events.
  const allFields=Object.keys(raw).filter(k=>k!=='__parsed_extra');
  if(!allFields.some(k=>String(raw[k]??'').trim()))continue;
  const row={};
  for(const key of allFields){
   const value=String(raw[key]??'').trim();
   if(value)previous[key]=value;
   row[key]=value||previous[key]||'';
  }
  const date=parseSignpostingDate(row.Date),destination=String(row['Code Term']||'').trim();
  if(date&&destination)results.push({date,destination,time:String(row["Consultation Details' Time"]||'').trim()});
 }
 return results;
}
function renderSignpostingChart(){
 const target=$('signpostingChart');if(!target||$('signpostingPage').classList.contains('hidden'))return;
 const status=$('signpostingStatus');
 if(!signpostingFileCount){Plotly.purge(target);status.textContent='No Signposting Auto Report CSV found in the selected practice workspace folder.';return}
 if(!signpostingRecords.length){Plotly.purge(target);status.textContent='Signposting file loaded, but no valid dated signposting records were found.';return}
 const counts=new Map(),dates=new Set(),destinations=new Set();
 for(const record of signpostingRecords){dates.add(record.date);destinations.add(record.destination);const key=JSON.stringify([record.date,record.destination]);counts.set(key,(counts.get(key)||0)+1)}
 const sortedDates=[...dates].sort(),sortedDestinations=[...destinations].sort((a,b)=>a.localeCompare(b));
 const traces=sortedDestinations.map((destination,i)=>({
  type:'scatter',mode:'lines',name:destination,
  x:sortedDates,y:sortedDates.map(date=>counts.get(JSON.stringify([date,destination]))||0),
  line:{width:2.4,shape:'linear'},
  hovertemplate:'<b>%{x|%d %b %Y}</b><br>'+destination.replace(/&/g,'&amp;').replace(/</g,'&lt;')+': %{y:,}<extra></extra>',
  connectgaps:false
 }));
 renderPreferencePlot(target,traces,{dragmode:false,
  autosize:true,height:535,margin:{l:62,r:24,t:28,b:65},
  paper_bgcolor:'#ffffff',plot_bgcolor:'#ffffff',
  xaxis:{type:'date',title:'Date',gridcolor:'#edf1f5'},
  yaxis:{title:'Signposting events',rangemode:'tozero',gridcolor:'#edf1f5'},
  legend:{orientation:'h',y:1.18,x:0},hovermode:'x unified',
  hoverlabel:{bgcolor:'#ffffff',bordercolor:'#dce5ed',font:{family:'Arial',size:12,color:'#182b3b'},align:'left'}
 },{responsive:true,displaylogo:false,displayModeBar:false,scrollZoom:false,doubleClick:false});
 status.textContent=signpostingRecords.length.toLocaleString('en-GB')+' signposting records · '+sortedDestinations.length+' destinations · '+signpostingFileCount+' CSV file'+(signpostingFileCount===1?'':'s')+'. Empty cells filled from preceding rows.';
}
function isDirectRHFile(name){return String(name||'').toLowerCase()==='direct rh data.csv'}
function renderRapidHealthTable(){
 const body=$('rapidHealthBody'),status=$('rapidHealthStatus'),table=$('rapidHealthTable');
 if(!body||!status||!table)return;
 body.replaceChildren();table.hidden=!rapidHealthSummary;
 status.textContent=rapidHealthSummary?'':'No Direct RH Data.csv has been loaded from the selected practice workspace folder.';
 if(!rapidHealthSummary)return;
 const fragment=document.createDocumentFragment();
 for(const record of rapidHealthSummary.months){
  const row=document.createElement('tr'),month=document.createElement('td');
  month.textContent=new Date(record.month+'-01T00:00:00Z').toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'UTC'});
  row.append(month);
  record.averages.forEach((average,i)=>{
   const cell=document.createElement('td');
   cell.textContent=average===null?'—':average.toLocaleString('en-GB',{minimumFractionDigits:1,maximumFractionDigits:1});
   cell.title=record.days[i]?record.counts[i]+' enquiries across '+record.days[i]+' days':'No dates covered';row.append(cell);
  });
  fragment.append(row);
 }
 body.append(fragment);
}
function updateHomeReportDates(items){const slots=items.filter(f=>/slot[\s_-]*report/i.test(f.name));const display=files=>{if(!files.length)return 'No report found';const dates=files.map(f=>Date.parse(f.lastModifiedDateTime||'')).filter(Number.isFinite);return dates.length?new Date(Math.max(...dates)).toLocaleString('en-GB',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true,timeZone:'Europe/London'}):'Modified date unavailable'};$('homeSlotModified').textContent=display(slots)}
// Parsed per-file contributions survive reloads in a private browser IndexedDB cache.
// A replacement invalidates only its own contribution, not the other CSV files.
const csvContributionCache=new Map();
// Bump this only when CSV parsing or contribution structure changes, not for UI deployments.
const CSV_CACHE_SCHEMA=6;
let csvMemoryScope=null;
function csvCacheScope(){
 const account=activeAccount?.homeAccountId||activeAccount?.localAccountId||activeAccount?.username;
 return account&&selectedFolder?JSON.stringify([CSV_CACHE_SCHEMA,account,selectedFolder.id,isOwner?'owner':sharedFolderId]):null;
}
function openCSVCache(){
 return new Promise(resolve=>{
  if(!window.indexedDB){resolve(null);return;}
  let request;try{request=indexedDB.open('capacity-iq-csv-cache',1);}catch(_){resolve(null);return;}
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('folders'))request.result.createObjectStore('folders');};
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>resolve(null);request.onblocked=()=>resolve(null);
 });
}
async function readCSVCache(scope){
 const db=await openCSVCache();if(!db)return null;
 return new Promise(resolve=>{
  try{const tx=db.transaction('folders','readonly');const request=tx.objectStore('folders').get(scope);
   let value=null;request.onsuccess=()=>{value=request.result;};
   tx.oncomplete=()=>{db.close();resolve(value);};tx.onerror=tx.onabort=()=>{db.close();resolve(null);};
  }catch(_){db.close();resolve(null);}
 });
}
async function writeCSVCache(scope,entries){
 if(!scope)return;
 const db=await openCSVCache();if(!db)return;
 await new Promise(resolve=>{
  try{const tx=db.transaction('folders','readwrite');tx.objectStore('folders').put({schema:CSV_CACHE_SCHEMA,entries},scope);
   tx.oncomplete=tx.onerror=tx.onabort=()=>{db.close();resolve();};
  }catch(_){db.close();resolve();}
 });
}
async function restoreCSVCache(){
 const scope=csvCacheScope();
 if(scope===csvMemoryScope)return scope;
 csvMemoryScope=scope;csvContributionCache.clear();lastFingerprint='';
 if(!scope)return null;
 const saved=await readCSVCache(scope);
 if(saved?.schema===CSV_CACHE_SCHEMA&&Array.isArray(saved.entries)){
  for(const entry of saved.entries){
   if(!Array.isArray(entry)||entry.length!==2)continue;
   const [id,value]=entry;
   if(typeof id!=='string'||typeof value?.version!=='string')continue;
   if(value.kind==='slot'&&(!Array.isArray(value.maps)||value.maps.length!==8||!value.maps.every(map=>map instanceof Map)))continue;
   if(value.kind==='signposting'&&!Array.isArray(value.events))continue;
   if(value.kind==='rapidHealth'&&(!value.summary||!Array.isArray(value.summary.months)))continue;
   if(!['slot','signposting','rapidHealth','other'].includes(value.kind))continue;
   csvContributionCache.set(id,value);
  }
 }
 return scope;
}
function mergeCSVCounts(target,source){
 for(const [key,value] of source){
  if(value&&typeof value==='object'&&!Array.isArray(value)){
   // Slot-type statistics are objects, not numeric aggregate counts.
   const previous=target.get(key);
   target.set(key,{count:(previous?.count||0)+(value.count||0),min:previous?.min&&previous.min<value.min?previous.min:value.min,max:previous?.max&&previous.max>value.max?previous.max:value.max});
  }else target.set(key,(target.get(key)||0)+value);
 }
}
function parseCSVContribution(csvText,name){
 if(isDirectRHFile(name))return {kind:'rapidHealth',summary:DirectRHCSV.monthlyWeekdayOtherEnquiries(csvText,Papa)};
 if(isSignpostingFile(name))return {kind:'signposting',events:parseSignpostingCSV(csvText)};
 if(!/slot[\s_-]*report/i.test(name))return {kind:'other'};
 const maps=Array.from({length:8},()=>new Map());
 const stats=aggregateCSV(csvText,...maps);
 return {kind:'slot',maps,valid:stats.valid,skipped:stats.skipped,dna:stats.dna};
}
async function loadFolder(force=true){if(!selectedFolder||busy)return;busy=true;setButtons();showRefreshFeedback('Refreshing data…',true);setSync('Checking practice workspace CSV files…');try{
 const items=(await children(selectedFolder.id)).filter(f=>f.file&&/\.csv$/i.test(f.name)).sort((a,b)=>a.name.localeCompare(b.name));if(!items.length)throw Error('No CSV files found directly inside this folder.');updateHomeReportDates(items);
 const cacheScope=await restoreCSVCache();
 const fingerprint=JSON.stringify(items.map(f=>[f.id,f.name,f.lastModifiedDateTime,f.size]));if(!force&&fingerprint===lastFingerprint){await renderActiveAnalyticsPage();showRefreshFeedback('Already up to date');setSync(`No changes detected · ${items.length} CSV files · Checked ${new Date().toLocaleTimeString('en-GB')}`);return}
 const aggregate=new Map(),availabilityAggregate=new Map(),bookingTimeAggregate=new Map(),appointmentTimeAggregate=new Map(),waitingAggregate=new Map(),waitingTrendAggregate=new Map(),peopleAggregate=new Map(),newSlotTypeStats=new Map();let valid=0,skipped=0;let newRapidHealth=null;const newSignposting=[];let newSignpostingFiles=0,newSlotFiles=0;
 const activeIds=new Set(items.map(f=>f.id));
 const removedCachedFiles=[...csvContributionCache.keys()].some(id=>!activeIds.has(id));
 const pendingCache=new Map();
 let downloaded=0,reused=0;
 for(let i=0;i<items.length;i++){
  const f=items[i],version=JSON.stringify([f.id,f.name,f.lastModifiedDateTime,f.size]);
  let contribution=csvContributionCache.get(f.id);
  if(!contribution||contribution.version!==version){
   downloaded++;
   showRefreshFeedback('Loading changed file '+downloaded+': '+f.name+'…',true);
   setSync('Refreshing '+f.name+' ('+downloaded+' changed file'+(downloaded===1?'':'s')+')');
   const detail=await graph(sourceItemUrl(f.id));
   const url=detail['@microsoft.graph.downloadUrl'];
   if(!url)throw Error('practice workspace did not provide a download URL for '+f.name);
   const response=await fetch(url,{cache:'no-store'});
   if(!response.ok)throw Error('Could not download '+f.name+': HTTP '+response.status);
   const csvText=await response.text();
   contribution={version,...parseCSVContribution(csvText,f.name)};
  }else reused++;
  pendingCache.set(f.id,contribution);
  if(contribution.kind==='rapidHealth'){
   newRapidHealth=contribution.summary;
  }else if(contribution.kind==='signposting'){
   newSignposting.push(...contribution.events);newSignpostingFiles++;
  }else if(contribution.kind==='slot'){
   newSlotFiles++;valid+=contribution.valid;skipped+=contribution.skipped;
   const destinations=[aggregate,availabilityAggregate,bookingTimeAggregate,peopleAggregate,newSlotTypeStats,waitingAggregate,waitingTrendAggregate,appointmentTimeAggregate];
   for(let m=0;m<destinations.length;m++)mergeCSVCounts(destinations[m],contribution.maps[m]);
  }
 }
 // Commit the new cache only after all changed files have parsed successfully.
 for(const id of csvContributionCache.keys())if(!activeIds.has(id))csvContributionCache.delete(id);
 for(const [id,contribution] of pendingCache)csvContributionCache.set(id,contribution);
 // IndexedDB preserves Maps through structured cloning; a cache failure never blocks loading.
 if(downloaded||removedCachedFiles)await writeCSVCache(cacheScope,[...pendingCache]);
 // Date the newest Slot Report CSV was last modified, committed only
 // after every changed file has downloaded and parsed successfully.
 const capacityFileDates=items.filter(file=>pendingCache.get(file.id)?.kind==='slot').map(file=>Date.parse(file.lastModifiedDateTime||'')).filter(Number.isFinite);
 capacityCSVLatestModified=capacityFileDates.length?Math.max(...capacityFileDates):null;
 updateHeaderSlotReportTime(capacityCSVLatestModified);
 slotReportCoverage=GPCorrectness.coverageFromEntries(pendingCache);
 slotTypeFileStats=newSlotTypeStats;renderSlotInclusion();
 rapidHealthSummary=newRapidHealth;
 signpostingRecords=newSignposting;signpostingFileCount=newSignpostingFiles;signpostingSlotNames=new Set(newSignposting.map(event=>event.destination));
 // Each dated signposting event is also a booked appointment for the main
 // demand/availability calculations. Its destination is its Slot Type.
 // Keep the dedicated Signposting page sourced from the original event list.
 // No clinician/person is invented: the report has no session holder field.
 // The event date is used as its booking AND appointment date.
 const signpostingClinician='Signposting (no clinician recorded)';
 for(const event of newSignposting){
  const slot=event.destination,date=event.date;
  const availabilityKey=JSON.stringify([date,slot,'Booked',signpostingClinician,'',null,'signposting']);
  availabilityAggregate.set(availabilityKey,(availabilityAggregate.get(availabilityKey)||0)+1);
  const bookedWeek=mondayOf(date);
  {
   const key=JSON.stringify([date,slot,signpostingClinician,'']);
   aggregate.set(key,(aggregate.get(key)||0)+1);
   const tm=/^(\d{1,2}):(\d{2})/.exec(event.time||'');
   if(tm&&Number(tm[1])<24&&Number(tm[2])<60){
    const minute=Number(tm[1])*60+Number(tm[2]);
    const timeKey=JSON.stringify([date,minute,slot,signpostingClinician,'']);
    bookingTimeAggregate.set(timeKey,(bookingTimeAggregate.get(timeKey)||0)+1);
    const scheduledKey=JSON.stringify([date,date,minute,slot,signpostingClinician,'','signposting']);
    appointmentTimeAggregate.set(scheduledKey,(appointmentTimeAggregate.get(scheduledKey)||0)+1);
   }
  }
 }
 waitingTimeRecords=[...waitingAggregate].map(([key,count])=>{const [slot,day,clinician,person,appointmentMonth]=JSON.parse(key);return {slot,day,clinician,person,appointmentMonth,status:'Booked',count}});
 waitingTrendRecords=[...waitingTrendAggregate].map(([key,count])=>{const [slot,clinician,person,appointmentMonth,appointmentDate,leadMinutes]=JSON.parse(key);return {slot,clinician,person,appointmentMonth,appointmentDate,leadMinutes,status:'Booked',count}}).sort((a,b)=>a.leadMinutes-b.leadMinutes);
 waitingTrendDimensionCache=new WeakMap();
 waitingTrendAvailableMonths=[...new Set(waitingTrendRecords.map(r=>r.appointmentMonth).filter(Boolean))].sort();
 appointmentTimeRecords=[...appointmentTimeAggregate].map(([key,count])=>{const [date,bookedDay,bookedMinute,slot,clinician,person,source]=JSON.parse(key);return {date,bookedDay,bookedMinute,slot,clinician,person,source:source||'slot',count}});
 bookingTimeRecords=[...bookingTimeAggregate].map(([key,count])=>{const [bookedDay,minute,slot,clinician,person]=JSON.parse(key);return {bookedDay,minute,slot,clinician,person,count}});
 availabilityRecords=[...availabilityAggregate].map(([key,count])=>{const [date,slot,availability,clinician,person,minute,source]=JSON.parse(key);return {date,slot,availability,clinician,person,minute:Number.isFinite(minute)?minute:null,source:source||'slot',count}});
 records=[...aggregate].map(([key,count])=>{const [bookedDay,slot,clinician,person]=JSON.parse(key);const bookedWeek=mondayOf(bookedDay);return {week:bookedWeek,bookedWeek,bookedDay,slot,clinician,person,status:'Booked',count}});weeks=[...new Set(records.map(r=>r.bookedWeek))].sort();types=[...new Set([...records.map(r=>r.slot),...availabilityRecords.map(r=>r.slot)])].sort();statuses=['Booked'];clinicianTypes=[...new Set([...records.map(r=>r.clinician),...availabilityRecords.map(r=>r.clinician)])].filter(Boolean).sort();
 // Assign obvious names on first encounter; retain any existing manual choices.
 // Do not guess assignments: unknown slot types stay Uncategorised until manually assigned.

 saveCategories(false);renderPeople();renderSlotInclusion();renderSlotTable();lastFingerprint=fingerprint;
const drawingErrors=[];
 for(const [label,draw] of [
  ['category filters',()=>rebuildCategoryFilter()],
  ['Appointment Types',()=>renderEditor()],
  ['clinician categories',()=>renderClinicianEditor()],
  ['clinician groups',()=>renderClinicianGroupEditor()],
  ['consult categories',()=>renderConsultEditor()],
  ['active chart',()=>renderActiveAnalyticsPage()]
 ]){
  try{await draw()}catch(error){drawingErrors.push(label+': '+(error?.message||String(error)));console.error('Dashboard rendering error in '+label,error)}
 }
 showRefreshFeedback(drawingErrors.length?'Data loaded; chart issue: '+drawingErrors.join('; '):(!isOwner?'Data refreshed · shared slot assignments: '+Object.keys(assignments).length:'Data refreshed successfully'));
 scheduleChartResize();setSync(`Downloaded ${downloaded} changed CSV file(s), reused ${reused} cached · ${newSlotFiles} Slot Report CSV files · ${newSignpostingFiles} Signposting CSV files · ${valid.toLocaleString('en-GB')} booked Slot Report rows + ${newSignposting.length.toLocaleString('en-GB')} signposting events · ${skipped.toLocaleString('en-GB')} skipped · ${Object.keys(assignments).length} assigned slot types · Updated ${new Date().toLocaleString('en-GB')}`)
 }catch(e){
 const message=e?.message||String(e);
 console.error('practice workspace refresh error',e);
 showRefreshFeedback('Refresh failed: '+message);
 setSync('Refresh failed: '+message+' · You remain signed in; the existing charts have been preserved where possible.');
 }finally{busy=false;setButtons()}}
$('signIn').onclick=async()=>{
 if(authChecking||folderAccessVerified)return;
 try{
  if(!auth){authInitPromise=null;await initAuth();if(!auth)throw Error('practice sign-in is unavailable. Please refresh and try again.');}
  if(folderAccessVerified)return;
  await auth.loginRedirect({scopes:SCOPES,prompt:'select_account'});
 }catch(error){setStatus('Sign-in failed: '+(error?.message||error));setButtons();}
};
$('signOut').onclick=()=>void logoutDashboard(false);
$('chooseFolder').onclick=()=>{if(isOwner)showFolderPicker()};
$('sourceSetup').onclick=()=>{if(isOwner)showFolderPicker()};
$('cancelFolder').onclick=()=>$('folderPicker').classList.add('hidden');
$('pickerUp').onclick=async()=>{if(!folderView.trail.length)return;const parent=folderView.trail.at(-1);folderView={...parent,trail:folderView.trail.slice(0,-1)};await showFolderContents()};
$('selectFolder').onclick=async()=>{if(!isOwner)return;selectedFolder={id:folderView.id,name:[...folderView.trail.map(x=>x.name),folderView.name].join(' / ')};iqLocalStorage.setItem(FOLDER_KEY,JSON.stringify(selectedFolder));$('folderStatus').textContent='Selected folder: '+selectedFolder.name;$('folderPicker').classList.add('hidden');$('onedrivePanel').classList.add('hidden');$('sourceSetup').classList.add('hidden');cloudFolder=selectedFolder;await saveCloudCategories();lastFingerprint='';await loadFolder(true)};
$('refreshData').onclick=()=>refreshDashboardData(true);
setInterval(()=>{if(activeAccount&&selectedFolder&&!busy)refreshDashboardData(false)},5*60*1000);
// England and Wales bank holidays, calculated for every year present in the booking data.
// Includes regular holidays, weekend substitute days and recent exceptional changes.
function englandWalesBankHolidays(year){
 const dates=new Set();
 const iso=d=>d.toISOString().slice(0,10);
 const date=(month,day)=>new Date(Date.UTC(year,month-1,day,12));
 const add=d=>dates.add(iso(d));
 const shift=(d,days)=>{const x=new Date(d);x.setUTCDate(x.getUTCDate()+days);return x};
 const weekday=(month,day)=>{const d=date(month,day);return d.getUTCDay()};
 const firstMonday=month=>{const d=date(month,1);return shift(d,(8-d.getUTCDay())%7)};
 const lastMonday=month=>{const d=date(month+1,0);return shift(d,-((d.getUTCDay()+6)%7))};
 // Gregorian computus (Easter Sunday).
 const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4;
 const f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30;
 const i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k+7)%7;
 const m=Math.floor((a+11*h+22*l)/451),n=h+l-7*m+114;
 const easter=date(Math.floor(n/31),n%31+1);
 add(shift(easter,-2));add(shift(easter,1));
 // New Year: Monday substitute if it falls at a weekend.
 const newYear=date(1,1);add(shift(newYear,newYear.getUTCDay()===6?2:newYear.getUTCDay()===0?1:0));
 add(firstMonday(5));add(lastMonday(5));add(lastMonday(8));
 // Christmas and Boxing Day, including both substitutes.
 const christmas=date(12,25),boxing=date(12,26);
 add(shift(christmas,christmas.getUTCDay()===6?2:christmas.getUTCDay()===0?2:0));
 add(shift(boxing,boxing.getUTCDay()===6?2:boxing.getUTCDay()===0?2:0));
 // Exceptional England/Wales holidays and moved spring bank holidays.
 if(year===2020){dates.delete(iso(firstMonday(5)));add(date(5,8));}
 if(year===2022){dates.delete(iso(lastMonday(5)));add(date(6,2));add(date(6,3));add(date(9,19));}
 if(year===2023)add(date(5,8));
 if(year===2012){dates.delete(iso(lastMonday(5)));add(date(6,4));add(date(6,5));}
 if(year===2011)add(date(4,29));
 if(year===2002){dates.delete(iso(lastMonday(5)));add(date(6,3));add(date(6,4));}
 return dates;
}
const bankHolidayWeeks=new Set();
function refreshBankHolidayWeeks(){
 bankHolidayWeeks.clear();
 const years=new Set(records.map(r=>Number((r.bookedWeek||'').slice(0,4))).filter(Number.isInteger));
 for(const year of years)for(const y of [year-1,year,year+1])for(const day of englandWalesBankHolidays(y))bankHolidayWeeks.add(mondayOf(day));
}
function mondayOf(dateString){const d=new Date(dateString+'T12:00:00Z');const day=d.getUTCDay();d.setUTCDate(d.getUTCDate()-((day+6)%7));return d.toISOString().slice(0,10)}
// Individual clinician category switches; every named category starts enabled.
const disabledClinicianTypes=new Set();
let lastClinicianFilterNames=[];
function updateClinicianChartFilter(){
 const root=$('clinicianChartFilters');if(!root)return;
 const names=clinicianGroupNames.filter(isDashboardToggleOption);
 // Do not recreate switches during each chart refresh; retain focus and scroll position.
 if(names.length===lastClinicianFilterNames.length&&names.every((n,i)=>n===lastClinicianFilterNames[i])){root.querySelectorAll('input[data-filter-name]').forEach(input=>input.nextElementSibling?.style.setProperty('--switch-on',clinicianGroupColour(input.dataset.filterName)));return;}
 lastClinicianFilterNames=names;
 root.replaceChildren();
 if(!names.length){const note=document.createElement('span');note.className='hint';note.textContent='Create clinician groups in Manage categories.';root.append(note);return;}
 for(const name of names){
  const row=document.createElement('label');row.className='filter-row';
  const switchEl=document.createElement('span');switchEl.className='switch';
  const input=document.createElement('input');input.type='checkbox';input.setAttribute('role','switch');input.checked=!disabledClinicianTypes.has(name);input.dataset.filterName=name;input.setAttribute('aria-label','Include '+name);
  const track=document.createElement('span');track.className='switch-track';track.style.setProperty('--switch-on',clinicianGroupColour(name));
  switchEl.append(input,track);
  const title=document.createElement('span');title.textContent=name;
  row.append(switchEl,title);root.append(row);
  input.addEventListener('change',()=>{changeHistoricBookingToggle(disabledClinicianTypes,name,input.checked,input)});
 }
}
let clinicianMatchCache=new Map();
function clinicianMatches(clinician,person){
 const key=clinician+'\\u0000'+person;
 if(clinicianMatchCache.has(key))return clinicianMatchCache.get(key);
 const detailed=effectiveClinicianType(clinician,person);
 const group=clinicianGroupAssignments[detailed];
 // Only session-holder user types mapped through a detailed category to an enabled group count.
 const matches=clinicianGroupNames.includes(group)&&!disabledClinicianTypes.has(group);
 clinicianMatchCache.set(key,matches);return matches;
}
// Consultation-mode switches on the Weekly Demand Chart.
const disabledConsultModes=new Set();
let lastConsultFilterNames=[];
function updateConsultChartFilter(){
 const root=$('consultChartFilters');if(!root)return;
 const names=consultCategoryNames.filter(isDashboardToggleOption);
 if(names.length===lastConsultFilterNames.length&&names.every((n,i)=>n===lastConsultFilterNames[i])){root.querySelectorAll('input').forEach((input,i)=>input.nextElementSibling?.style.setProperty('--switch-on',consultModeColours[names[i]]||'#638fac'));return;}
 lastConsultFilterNames=names;
 root.replaceChildren();
 if(!names.length){const note=document.createElement('span');note.className='hint';note.textContent='Create consult modes in Manage categories.';root.append(note);return;}
 for(const name of names){
  const row=document.createElement('label');row.className='filter-row';
  const switchEl=document.createElement('span');switchEl.className='switch';
  const input=document.createElement('input');input.type='checkbox';input.setAttribute('role','switch');input.checked=!disabledConsultModes.has(name);input.setAttribute('aria-label','Include '+name);
  const track=document.createElement('span');track.className='switch-track';track.style.setProperty('--switch-on',consultModeColours[name]||'#638fac');
  switchEl.append(input,track);
  const title=document.createElement('span');title.textContent=name;
  row.append(switchEl,title);root.append(row);
  input.addEventListener('change',()=>{changeHistoricBookingToggle(disabledConsultModes,name,input.checked,input)});
 }
}
function consultMatches(slot){
 // An unsaved suggestion must not silently remove an appointment from demand.
 // Only explicitly disabled, configured modes are excluded.
 const saved=consultCategoryNames.includes(consultAssignments[slot])?consultAssignments[slot]:'';
 const mode=saved||suggestConsultMode(slot);
 return !mode||!disabledConsultModes.has(mode);
}
let excludeBankHolidays=true;
document.getElementById('excludeBH').onchange=e=>{excludeBankHolidays=!e.target.checked;scheduleDemandRefresh()};
function isoWeek(weekStart){const d=new Date(weekStart+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+3);const year=d.getUTCFullYear();const jan4=new Date(Date.UTC(year,0,4,12));jan4.setUTCDate(jan4.getUTCDate()-((jan4.getUTCDay()+6)%7));const week=1+Math.round((d-jan4)/604800000);return {year,week}}
const colours=['#1475b8','#e57a28','#159a78','#9053b4','#c64c69','#65748b'];
let current=[];let continuousMode=true;let showCurrentWeek=true;let monthlyMode=false;
let todayLondon,thisWeek,thisMonth;
function updateDashboardDateContext(now=new Date()){
 const next=GPCorrectness.dateContext(now),changed=todayLondon!==next.today;
 todayLondon=next.today;thisWeek=next.week;thisMonth=next.month;return changed;
}
updateDashboardDateContext();
let savedWeeklyIncludeBankHolidays=document.getElementById('excludeBH').checked;
document.getElementById('periodMode').onchange=e=>{
 monthlyMode=e.target.checked;
 const bankToggle=document.getElementById('excludeBH');
 if(monthlyMode){savedWeeklyIncludeBankHolidays=readChartPreferences()['checkbox:chartPage:excludeBH']??bankToggle.checked;bankToggle.checked=true;bankToggle.disabled=true;excludeBankHolidays=false;}
 else{bankToggle.disabled=false;bankToggle.checked=savedWeeklyIncludeBankHolidays;excludeBankHolidays=!bankToggle.checked;}
 document.getElementById('periodModeValue').textContent=monthlyMode?'Month':'Week';
 document.getElementById('currentPeriodLabel').textContent=monthlyMode?'Show current month':'Show current week';
 refresh();
};
document.getElementById('currentWeekToggle').onchange=e=>{showCurrentWeek=e.target.checked;scheduleDemandRefresh()};
document.getElementById('displayMode').onchange=e=>{continuousMode=e.target.checked;document.getElementById('timelineValue').textContent=continuousMode?'Continuous':'Superimposed';scheduleDemandRefresh()};
function periodKey(r){return monthlyMode?r.bookedDay?.slice(0,7):r.bookedWeek}
let demandFilterCache=null;
const disabledDemandCapacities=new Set();
function historicBookingFilterCounts(){
 // Count only bookings eligible for the currently displayed chart, while
 // ignoring each option's own on/off state so it can be switched back on.
 const result={capacity:new Map(),consult:new Map(),clinician:new Map()};
 const firstAppointment=availabilityRecords.filter(r=>String(r.availability||'').trim().toLowerCase()==='booked').map(r=>r.date).filter(Boolean).sort()[0]||'';
 const lastAppointment=availabilityRecords.filter(r=>String(r.availability||'').trim().toLowerCase()==='booked').map(r=>r.date).filter(Boolean).sort().at(-1)||'';
 const firstPeriod=firstAppointment?(monthlyMode?firstAppointment.slice(0,7):mondayOf(firstAppointment)):'';
 const lastPeriod=lastAppointment?(monthlyMode?lastAppointment.slice(0,7):mondayOf(lastAppointment)):'';
 for(const r of records){
  if(r.status!=='Booked'||excludedSlotTypes.has(r.slot)||!(r.count>0)||!locumMatches(r,'chartPage'))continue;
  const period=periodKey(r);if(!period)continue;
  if((firstPeriod&&period<firstPeriod)||(lastPeriod&&period>lastPeriod))continue;
  if(period>(monthlyMode?thisMonth:thisWeek))continue;
  if(!showCurrentWeek&&periodIsCurrent(period))continue;
  if(!monthlyMode&&excludeBankHolidays&&bankHolidayWeeks.has(r.bookedWeek))continue;
  const month=period.slice(0,7);
  if((demandMonthStart&&month<demandMonthStart)||(demandMonthEnd&&month>demandMonthEnd))continue;
  const urgency=capacityUrgencyCategory(r.slot);
  if(!urgency||disabledDemandUrgencyGroups.has(urgency))continue;
  const group=clinicianGroupAssignments[effectiveClinicianType(r.clinician,r.person)];
  const values={capacity:capacityAssignments[r.slot],consult:consultCategoryNames.includes(consultAssignments[r.slot])?consultAssignments[r.slot]:(suggestConsultMode(r.slot)||''),clinician:group};
  for(const kind of Object.keys(result)){
   const value=values[kind];if(!isDashboardToggleOption(value))continue;
   // Match the chart's other active filters, but not this dimension's filter.
   if(kind!=='capacity'&&!demandCategoryAllowed(r.slot,capacityCategoryNames,capacityAssignments,disabledDemandCapacities))continue;
   if(kind!=='consult'&&!consultMatches(r.slot))continue;
   if(kind==='consult'&&(!consultCategoryNames.includes(value)||!group||!clinicianGroupNames.includes(group)||disabledClinicianTypes.has(group)))continue;
   if(kind!=='clinician'&&(!clinicianGroupNames.includes(group)||disabledClinicianTypes.has(group)))continue;
   result[kind].set(value,(result[kind].get(value)||0)+r.count);
  }
 }
 return result;
}
function historicBookingHasData(){
 const first=availabilityRecords.filter(r=>String(r.availability||'').trim().toLowerCase()==='booked').map(r=>r.date).filter(Boolean).sort()[0]||'';
 const last=availabilityRecords.filter(r=>String(r.availability||'').trim().toLowerCase()==='booked').map(r=>r.date).filter(Boolean).sort().at(-1)||'';
 return records.some(r=>{
  if(!includedRecord(r)||!(r.count>0))return false;
  const p=periodKey(r),m=p?.slice(0,7);
  if(!p||p>(monthlyMode?thisMonth:thisWeek)||(!showCurrentWeek&&periodIsCurrent(p)))return false;
  if(first&&p<(monthlyMode?first.slice(0,7):mondayOf(first)))return false;
  if(last&&p>(monthlyMode?last.slice(0,7):mondayOf(last)))return false;
  if((demandMonthStart&&m<demandMonthStart)||(demandMonthEnd&&m>demandMonthEnd))return false;
  const group=capacityUrgencyCategory(r.slot);
  return !!group&&!disabledDemandUrgencyGroups.has(group);
 });
}
let appointmentBulkFilterChange=false;
function changeHistoricBookingToggle(disabled,name,checked,input){
 const wasOff=disabled.has(name);
 if(checked)disabled.delete(name);else disabled.add(name);
 demandFilterCache=new WeakMap();clinicianMatchCache=new Map();
 if(!appointmentBulkFilterChange&&!chartPreferenceRestoring&&!historicBookingHasData()){
  if(wasOff)disabled.add(name);else disabled.delete(name);
  input.checked=!wasOff;
  demandFilterCache=new WeakMap();clinicianMatchCache=new Map();
  return;
 }
 scheduleDemandRefresh();
}
function hideEmptyHistoricBookingFilters(){
 const counts=historicBookingFilterCounts();
 for(const [id,kind] of [['demandCapacityToggles','capacity'],['consultChartFilters','consult'],['clinicianChartFilters','clinician']]){
  const root=$(id);if(!root)continue;
  let visible=0;
  for(const input of root.querySelectorAll('input')){
   const name=input.dataset.classification||input.dataset.filterName||input.getAttribute('aria-label')?.replace(/^Include /,'');
   const row=input.closest('.filter-row');
   if(row){row.hidden=!isDashboardToggleOption(name)||!counts[kind].has(name);if(!row.hidden)visible++;}
  }
  const card=root.closest('section');if(card)card.hidden=visible===0;
  // Keep the collapsed label in sync: hidden rows must not be advertised as selected.
  root.querySelectorAll('input').forEach(input=>{
   const row=input.closest('.filter-row');
   if(row&&row.hidden)input.dataset.hiddenNoData='1';
   else delete input.dataset.hiddenNoData;
  });
 }
 const additive=$('demandCombineLines');
 if(additive){
  const selected=groupUrgencyNames.filter(name=>isDashboardToggleOption(name)&&!disabledDemandUrgencyGroups.has(name)).length;
  additive.disabled=selected<=1;
  const row=additive.closest('label');
  if(row){row.hidden=historicChart2;row.style.opacity=selected<=1?'0.4':'';row.style.cursor=selected<=1?'not-allowed':'';row.title=selected<=1?'Select at least two Appointment Types to combine selected lines':'';}
 }
 refreshActivitySecondarySummaries();
}

function demandCategoryAllowed(slot,names,mapping,disabled){
 const value=names.includes(mapping[slot])?mapping[slot]:'Unassigned';
 return !disabled.has(value);
}
function renderDemandClassificationToggles(rootId,names,mapping,disabled,colourMap){
 names=names.filter(isDashboardToggleOption);
 const root=$(rootId);if(!root)return;
 const choices=[...names];
 const signature=choices.join('\u0001');
 if(root.dataset.choices===signature){
  for(const input of root.querySelectorAll('input[data-classification]')){
   input.checked=!disabled.has(input.dataset.classification);
   if(input.dataset.classification!=='Unassigned')input.nextElementSibling?.style.setProperty('--switch-on',typeColour(input.dataset.classification,colourMap));
  }
  return;
 }
 root.dataset.choices=signature;
 for(const value of [...disabled])if(!choices.includes(value))disabled.delete(value);
 root.replaceChildren();
 for(const name of choices){
  const row=document.createElement('label');row.className='filter-row';
  const wrap=document.createElement('span');wrap.className='switch';
  const input=document.createElement('input');input.type='checkbox';input.setAttribute('role','switch');
  input.dataset.classification=name;input.checked=!disabled.has(name);input.setAttribute('aria-label','Include '+name);
  const track=document.createElement('span');track.className='switch-track';
  if(name!=='Unassigned')track.style.setProperty('--switch-on',typeColour(name,colourMap));
  wrap.append(input,track);
  const label=document.createElement('span');label.textContent=name;
  row.append(wrap,label);root.append(row);
  input.addEventListener('change',()=>{
   changeHistoricBookingToggle(disabled,name,input.checked,input);
  });
 }
}
function includedRecord(r){
 if(demandFilterCache&&demandFilterCache.has(r))return demandFilterCache.get(r);
 const result=!excludedSlotTypes.has(r.slot)&&r.status==='Booked'&&clinicianMatches(r.clinician,r.person)&&consultMatches(r.slot)&&locumMatches(r,'chartPage')&&demandCategoryAllowed(r.slot,capacityCategoryNames,capacityAssignments,disabledDemandCapacities)&&(monthlyMode||!excludeBankHolidays||!bankHolidayWeeks.has(r.bookedWeek));
 if(demandFilterCache)demandFilterCache.set(r,result);
 return result;
}
function monthOfPeriod(p){return monthlyMode?p+'-01':p}
function periodIsCurrent(p){return p===(monthlyMode?thisMonth:thisWeek)}
function weeklyUrgencyMatches(slot,category){
 const detailed=assignments[slot]||'Uncategorised';
 if(category==='urgent'){
  const group=groupUrgencyAssignments[detailed];
  return typeof group==='string'&&group.trim().toLowerCase()==='urgent';
 }
 return detailed.trim().toLowerCase().replace(/[\s-]+/g,'')===category;
}
let demandMonthStart=null,demandMonthEnd=null,demandMonthBounds='';
const disabledDemandUrgencyGroups=new Set();
let demandUrgencyDefaultsApplied=false;
let lastDemandUrgencyGroupNames=[];
let demandRefreshQueued=false;
let demandMarkerResizeTimer=null;
window.addEventListener('resize',()=>{clearTimeout(demandMarkerResizeTimer);demandMarkerResizeTimer=setTimeout(()=>{if(!$('chartPage')?.classList.contains('hidden'))scheduleDemandRefresh()},150)});
const DEMAND_SMOOTHING_LABELS=['Off','Low','Medium','High'];
function demandSmoothingLevel(){const value=Number($('demandSmoothing')?.value||0);return Number.isInteger(value)&&value>=0&&value<=3?value:0}
function updateDemandSmoothingControl(){const input=$('demandSmoothing'),label=DEMAND_SMOOTHING_LABELS[demandSmoothingLevel()];if(input)input.setAttribute('aria-valuetext',label);}
$('demandSmoothing')?.addEventListener('input',()=>{updateDemandSmoothingControl();scheduleDemandRefresh()});
function scheduleDemandRefresh(){
 if(demandRefreshQueued)return;
 demandRefreshQueued=true;
 requestAnimationFrame(()=>{demandRefreshQueued=false;refresh()});
}
function monthRangeSelection(prefix,low,high){
 const saved=readChartPreferences(),page=prefix==='demandRange'?'chartPage':prefix==='waitingRange'?'waitingTimesPage':'waitingOverTimePage';
 const pair=saved['monthRange:'+prefix];
 const index=value=>typeof value==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(value)?Number(value.slice(0,4))*12+Number(value.slice(5,7))-1:NaN;
 const legacy=handle=>{const value=saved['range:'+page+':'+prefix+handle];return value!==undefined&&Number.isInteger(Number(value))?Number(value):NaN};
 const from=index(pair?.start),to=index(pair?.end);
 const first=Number.isFinite(from)?from:legacy('Start'),last=Number.isFinite(to)?to:legacy('End');
 const a=Math.max(low,Math.min(high,Number.isFinite(first)?first:low));
 return [a,Math.max(a,Math.min(high,Number.isFinite(last)?last:high))];
}
function saveMonthRange(prefix,start,end){writeChartPreference('monthRange:'+prefix,{start,end});}
function reportRangeDate(){
 return Number.isFinite(capacityCSVLatestModified)?GPCorrectness.londonDate(new Date(capacityCSVLatestModified)):null;
}
function reportRangeEndLabel(monthIndex){
 const date=reportRangeDate(),month=new Date(Date.UTC(Math.floor(monthIndex/12),monthIndex%12,1));
 const label=month.toLocaleDateString('en-GB',{month:'short',year:'numeric',timeZone:'UTC'});
 if(!date)return label; // Completeness cannot be inferred without the report timestamp.
 if(monthIndex===Number(date.slice(0,4))*12+Number(date.slice(5,7))-1)
  return new Date(date+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
 return 'End of '+label;
}

const historicBreakdowns=['appointment','clinician','locum','total'];
let historicChart2=false;
function historicChartBreakdown(){
 const saved=readChartPreferences()['historicChart2:breakdown'];
 return historicChart2&&historicBreakdowns.includes(saved)?saved:'appointment';
}
function paintHistoricSeriesLegend(series,colours){
 const legend=$('historicSeriesLegend');
 legend.hidden=!historicChart2||!series.length;
 legend.replaceChildren();
 if(legend.hidden)return;
 for(const name of series){
  const item=document.createElement('li'),swatch=document.createElement('span');
  swatch.style.setProperty('--series-colour',colours(name));
  swatch.setAttribute('aria-hidden','true');
  item.append(swatch,document.createTextNode(name));
  legend.append(item);
 }
}
function refresh(){
 updateDashboardDateContext();
 renderDemandUrgencyToggles();updateDemandSmoothingControl();
 refreshBankHolidayWeeks();
 updateClinicianChartFilter();updateConsultChartFilter();
 demandFilterCache=new WeakMap();
 clinicianMatchCache=new Map();
const selectedTypes=groupUrgencyNames.filter(name=>isDashboardToggleOption(name)&&!disabledDemandUrgencyGroups.has(name));
const additiveControl=$('demandCombineLines');
const breakdown=historicChartBreakdown();
$('historicBreakdown').querySelectorAll('[data-historic-breakdown]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.historicBreakdown===breakdown)));
const additiveLines=!historicChart2&&selectedTypes.length>1&&additiveControl?.checked===true;
const regroup=breakdown==='clinician'||breakdown==='locum';
const activeWeekSet=new Set();
for(const r of records){if(includedRecord(r)){const key=periodKey(r);if(key)activeWeekSet.add(key)}}
const reportClock=Number.isFinite(capacityCSVLatestModified)?dayView2LondonClock(new Date(Math.min(Date.now(),capacityCSVLatestModified))):null;
if(showCurrentWeek&&reportClock&&periodKey({bookedDay:reportClock.date,bookedWeek:mondayOf(reportClock.date)})===(monthlyMode?thisMonth:thisWeek)&&(monthlyMode||!excludeBankHolidays||!bankHolidayWeeks.has(thisWeek)))activeWeekSet.add(monthlyMode?thisMonth:thisWeek);
const activeWeeks=[...activeWeekSet].sort();
const appointmentDates=availabilityRecords.filter(r=>String(r.availability||'').trim().toLowerCase()==='booked').map(r=>r.date).filter(Boolean).sort();
const firstAppointmentDate=appointmentDates[0]||'';
const lastAppointmentDate=appointmentDates[appointmentDates.length-1]||'';
const firstPeriod=firstAppointmentDate?(monthlyMode?firstAppointmentDate.slice(0,7):mondayOf(firstAppointmentDate)):'';
const lastPeriod=lastAppointmentDate?(monthlyMode?lastAppointmentDate.slice(0,7):mondayOf(lastAppointmentDate)):'';
const selectedWeeks=activeWeeks.filter(w=>(!firstPeriod||w>=firstPeriod)&&(!lastPeriod||w<=lastPeriod)&&w<=(monthlyMode?thisMonth:thisWeek)&&(showCurrentWeek||!periodIsCurrent(w)));
const sums=new Map(selectedWeeks.map(w=>[w,0]));
const demandCategoryTotals=Object.fromEntries(groupUrgencyNames.map(name=>[name,new Map(selectedWeeks.map(w=>[w,0]))]));
const selectedTypeSet=new Set(selectedTypes);
const configuredGroups=breakdown==='clinician'?clinicianGroupNames.filter(name=>!disabledClinicianTypes.has(name)):['Locum','Not Locum'];
const groupedTotals=new Map(regroup?configuredGroups.map(name=>[name,new Map(selectedWeeks.map(period=>[period,0]))]):[]);
function seriesForBooking(row){
 const appointmentType=capacityUrgencyCategory(row.slot);
 if(!selectedTypeSet.has(appointmentType))return null;
 if(breakdown==='clinician')return clinicianGroupAssignments[effectiveClinicianType(row.clinician,row.person)];
 if(breakdown==='locum')return locumCategory(row);
 if(breakdown==='total')return 'Selected bookings';
 return additiveLines?'Combined':appointmentType;
}
for(const r of records){
 const key=periodKey(r);
 if(!sums.has(key)||!includedRecord(r))continue;
 sums.set(key,sums.get(key)+r.count);
 const group=capacityUrgencyCategory(r.slot);
 const totals=demandCategoryTotals[group];
 if(totals)totals.set(key,totals.get(key)+r.count);
 if(regroup){
  const grouped=groupedTotals.get(seriesForBooking(r));
  if(grouped)grouped.set(key,grouped.get(key)+r.count);
 }
}
current=[...sums].map(([week,count])=>({week,count,...isoWeek(monthOfPeriod(week))}));
const total=current.reduce((a,r)=>a+r.count,0);
const yearColours={urgent:['#8b111e','#d43846','#f08088','#6f0712'],routine:['#075d34','#199c5a','#79c99c','#a1d9b4'],followup:['#124b9b','#2675d2','#79acee','#a9cdf6']};
function monthPosition(date){const d=new Date(date+'T12:00:00Z');const month=d.getUTCMonth();const days=new Date(Date.UTC(d.getUTCFullYear(),month+1,0)).getUTCDate();return month+(d.getUTCDate()-1)/days}
const axis={type:'linear',range:[0,12],title:'Month of year',tickmode:'array',tickvals:Array.from({length:12},(_,i)=>i+0.5),ticktext:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],gridcolor:'#edf1f5'};
function yearBackgroundShapes(periods){
 if(!continuousMode||!periods.length)return [];
 const years=periods.map(v=>Number(v.slice(0,4)));
 const shapes=[];
 for(let year=Math.min(...years);year<=Math.max(...years);year++){
  if(year%2===0)shapes.push({type:'rect',xref:'x',yref:'paper',x0:year+'-01-01',x1:(year+1)+'-01-01',y0:0,y1:1,fillcolor:'#f1f1f1',opacity:1,line:{width:0},layer:'below'});
 }
 return shapes;
}
function setupDemandMonthSlider(){
 const start=$('demandRangeStart'),end=$('demandRangeEnd');if(!start||!end)return;
 const months=[...new Set(availabilityRecords.map(r=>typeof r.date==='string'?r.date.slice(0,7):r.date instanceof Date&&!Number.isNaN(r.date.getTime())?r.date.toISOString().slice(0,7):null).filter(Boolean))].sort();
 if(!months.length)return;
 const reportDate=reportRangeDate();
 const reportMonth=reportDate?Number(reportDate.slice(0,4))*12+Number(reportDate.slice(5,7))-1:null;
 const first=months[0],last=months[months.length-1];
 const toIndex=m=>Number(m.slice(0,4))*12+Number(m.slice(5,7))-1;
 const toMonth=i=>String(Math.floor(i/12)).padStart(4,'0')+'-'+String(i%12+1).padStart(2,'0');
 const limit=reportMonth??toIndex(last);
 const low=Math.min(toIndex(first),limit),high=Math.max(low,Math.min(toIndex(last),limit));
 const bounds=first+'|'+toMonth(high);
 const [a,b]=monthRangeSelection('demandRange',low,high);
 demandMonthBounds=bounds;demandMonthStart=toMonth(a);demandMonthEnd=toMonth(b);
 for(const input of [start,end]){input.min=String(low);input.max=String(high);input.step='1';input.disabled=low===high;}
 start.value=String(a);end.value=String(b);
 const label=i=>new Date(Date.UTC(Math.floor(i/12),i%12,1)).toLocaleDateString('en-GB',{month:'short',year:'numeric',timeZone:'UTC'});
 $('demandRangeFromLabel').textContent='Start of '+label(a);$('demandRangeToLabel').textContent=reportRangeEndLabel(b);
 const span=Math.max(1,high-low),fill=$('demandRangeFill');
 // The native range thumb travels over the input width MINUS its own diameter.
 // Position the blue fill between the actual thumb centres, not the input edges.
 const trackWidth=fill.parentElement.clientWidth;
 const thumbDiameter=24;
 const sliderLeft=start.getBoundingClientRect().left-fill.parentElement.getBoundingClientRect().left;
 const travel=Math.max(0,start.clientWidth-thumbDiameter);
 const startCentre=sliderLeft+thumbDiameter/2+((a-low)/span)*travel;
 const endCentre=sliderLeft+thumbDiameter/2+((b-low)/span)*travel;
 fill.style.left=startCentre+'px';
 fill.style.right=Math.max(0,trackWidth-endCentre)+'px';
 if(!start.dataset.bound){
  const changed=which=>{
   let x=Number(start.value),y=Number(end.value);
   if(which==='start'&&x>y){y=x;end.value=String(y)}
   if(which==='end'&&y<x){x=y;start.value=String(x)}
   demandMonthStart=toMonth(x);demandMonthEnd=toMonth(y);
   saveMonthRange('demandRange',demandMonthStart,demandMonthEnd);
   setupDemandMonthSlider();
   scheduleDemandRefresh();
  };
  start.addEventListener('input',()=>changed('start'));
  end.addEventListener('input',()=>changed('end'));
  start.dataset.bound=end.dataset.bound='1';
 }
}
function renderDemandUrgencyToggles(){
 const root=$('demandUrgencyToggles');if(!root)return;
 const names=groupUrgencyNames.filter(isDashboardToggleOption);
 if(names.length===lastDemandUrgencyGroupNames.length&&names.every((n,i)=>n===lastDemandUrgencyGroupNames[i])){
  root.querySelectorAll('input[data-urgency-group]').forEach(input=>{input.checked=!disabledDemandUrgencyGroups.has(input.dataset.urgencyGroup);input.nextElementSibling?.style.setProperty('--switch-on',urgencyGroupColour(input.dataset.urgencyGroup));});
  return;
 }
 if(!demandUrgencyDefaultsApplied&&names.length){
  disabledDemandUrgencyGroups.clear();
  for(const name of names)if(!['urgent','urgent care','routine','follow up','follow-up','followup'].includes(name.trim().toLowerCase()))disabledDemandUrgencyGroups.add(name);
  demandUrgencyDefaultsApplied=true;
 }
 lastDemandUrgencyGroupNames=names;
 root.replaceChildren();
 if(!names.length){const note=document.createElement('span');note.className='hint';note.textContent='Create Appointment Types in Slot settings.';root.append(note);return;}
 for(const name of names){
  const row=document.createElement('label');row.className='filter-row';
  const switchEl=document.createElement('span');switchEl.className='switch';
  const input=document.createElement('input');input.type='checkbox';input.setAttribute('role','switch');input.checked=!disabledDemandUrgencyGroups.has(name);input.dataset.urgencyGroup=name;input.setAttribute('aria-label','Include '+name);
  const track=document.createElement('span');track.className='switch-track';track.style.setProperty('--switch-on',urgencyGroupColour(name));
  switchEl.append(input,track);
  const title=document.createElement('span');title.textContent=name;
  row.append(switchEl,title);root.append(row);
  input.addEventListener('change',()=>{
   changeHistoricBookingToggle(disabledDemandUrgencyGroups,name,input.checked,input);
  });
 }
}
function installDemandAverageCapsules(target,averages){
 if(!target)return;
 if(target._demandAverageLayoutHandler&&typeof target.removeListener==='function')target.removeListener('plotly_afterplot',target._demandAverageLayoutHandler);
 target.querySelector('.demand-average-overlay')?.remove();
 const overlay=document.createElement('div');overlay.className='demand-average-overlay';target.appendChild(overlay);
 const pills=averages.map(({category,average,colour})=>{
  const pill=document.createElement('span');pill.className='demand-average-pill';pill.textContent='Average '+Math.round(average).toLocaleString('en-GB');
  pill.style.color=colour;pill.setAttribute('aria-label',category+' average '+Math.round(average).toLocaleString('en-GB'));overlay.appendChild(pill);return pill;
 });
 const layout=()=>{
  const full=target._fullLayout,size=full?._size,axis=full?.yaxis;if(!size||!axis)return;
  const labels=pills.map((pill,i)=>({width:pill.offsetWidth,height:pill.offsetHeight,y:axis.l2p(averages[i].average)}));
  const positions=GPCorrectness.averageCapsuleLayout(labels,size.w,size.h);
  positions.forEach((box,i)=>{
   const pill=pills[i];pill.style.left=(size.l+box.left)+'px';pill.style.top=(size.t+box.top)+'px';
   pill.style.maxWidth=size.w+'px';pill.style.setProperty('--average-line-y',(labels[i].y-box.top)+'px');
  });
 };
 target._demandAverageLayoutHandler=layout;if(typeof target.on==='function')target.on('plotly_afterplot',layout);layout();
}
function installDemandCardTooltip(target){
 if(!target||typeof target.on!=='function')return;
 target.querySelector('.availability-tooltip-card')?.remove();
 const card=document.createElement('div');card.className='availability-tooltip-card';card.hidden=true;
 target.appendChild(card);
 if(typeof target.removeAllListeners==='function'){
  target.removeAllListeners('plotly_hover');target.removeAllListeners('plotly_unhover');
 }
 target.on('plotly_hover',data=>{
  const point=data.points?.find(p=>p.data?.meta?.nowcast||(Number.isFinite(p.y)&&p.data?.line?.color&&typeof p.data?.name==='string'));
  if(!point){card.hidden=true;return;}
  const name=point.data.name,projection=point.data.meta?.nowcast,currentActual=point.data.meta?.currentObserved;
  const index=Array.isArray(point.pointNumber)?point.pointNumber[0]:(point.pointIndex??point.pointNumber);
  const values=point.customdata??point.data?.customdata?.[index];
  const date=Array.isArray(values)?values[0]:(typeof values==='string'?values:'');
  const rawDate=date||((typeof point.x==='string'&&/^\d{4}-\d{2}/.test(point.x))?point.x:'');
  let formatted=rawDate;
  if(/^\d{4}-\d{2}(?:-\d{2})?$/.test(rawDate)){
   const iso=rawDate.length===7?rawDate+'-01':rawDate;
   const d=new Date(iso+'T12:00:00Z');
   if(monthlyMode)formatted=d.toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'UTC'});
   else {const weekStart=mondayOf(iso);formatted='Week beginning '+new Date(weekStart+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});}
  }
  card.replaceChildren();
  const heading=document.createElement('div');heading.className='availability-tooltip-heading';
  heading.textContent=currentActual?'Actual bookings so far — current '+currentActual.mode:projection?'Indicative 70% prediction interval':formatted||(name.match(/\d{4}$/)?.[0]||'Appointment demand');card.append(heading);
  const row=document.createElement('div');row.className='availability-tooltip-line';
  const dot=document.createElement('span');dot.className='availability-tooltip-dot';dot.style.backgroundColor=point.data.line.color;
  const value=document.createElement('span');value.textContent=name+': '+Number(Array.isArray(values)?values[1]:point.y).toLocaleString('en-GB')+' actual bookings';
  if(Array.isArray(values)&&adjustDemandForListSize)value.textContent+=' · Adjusted: '+Number(values[2]).toLocaleString('en-GB',{maximumFractionDigits:1});
  if(demandSmoothingLevel()&&!projection&&!currentActual&&!/\(incomplete\)$/.test(name))value.textContent+=' · Smoothed: '+Number(point.y).toLocaleString('en-GB',{maximumFractionDigits:1});
  if(projection){value.textContent=projection.category+': '+Math.round(projection.low).toLocaleString('en-GB')+'–'+Math.round(projection.high).toLocaleString('en-GB')+' estimated bookings · '+Math.round(projection.rawObserved).toLocaleString('en-GB')+' actual bookings so far'+(adjustDemandForListSize?' · Range adjusted for list size':'')+' · Report: '+projection.asOfLabel+' · '+projection.samples+' complete historical '+(projection.mode==='month'?'months':'weeks')+(projection.intradayProfile?' · Historical booking-time profile':' · Uniform-time fallback; wider range');}
  if(currentActual){value.textContent=currentActual.category+': '+Math.round(currentActual.rawObserved).toLocaleString('en-GB')+' actual bookings so far'+(adjustDemandForListSize?' · Adjusted: '+Number(currentActual.observed).toLocaleString('en-GB',{maximumFractionDigits:1}):'')+' · Report: '+currentActual.asOfLabel;}
  row.append(dot,value);card.append(row);card.hidden=false;
  const rect=target.getBoundingClientRect(),event=data.event;
  const x=event?.clientX!=null?event.clientX-rect.left:rect.width/2;
  const y=event?.clientY!=null?event.clientY-rect.top:rect.height/2;
  // Plotly chart is positioned relative to its own internal layers; use viewport coordinates.
  const parent=card.offsetParent||target;
  const parentRect=parent.getBoundingClientRect();
  const clientX=rect.left+x,clientY=rect.top+y;
  const left=Math.max(parentRect.left+8,Math.min(parentRect.right-card.offsetWidth-8,clientX+18));
  const top=clientY+card.offsetHeight+18>parentRect.bottom?clientY-card.offsetHeight-16:clientY+14;
  card.style.left=(left-parentRect.left)+'px';
  card.style.top=(Math.max(parentRect.top+8,top)-parentRect.top)+'px';
 });
 target.on('plotly_unhover',()=>{card.hidden=true});
}

function historicInsightPresets(firstAppointment,lastAppointment,selected){
 const all=groupUrgencyNames.filter(isDashboardToggleOption);
 if(!all.length)return [];
 const families=Map.groupBy(all,appointmentCategoryFor);
 const urgent=[...families].find(([name])=>/urgent|acute/i.test(name))?.[1]||[];
 const groups=[...(selected.length?[selected]:[]),all,...[...families.values()].filter(group=>group.length!==all.length),...all.map(name=>[name])];
 if(urgent.length===3)for(let i=0;i<urgent.length;i++)groups.push(urgent.filter((_,index)=>i!==index));
 const profiles=[
  {match:()=>true,groups},
  ...['Locum','Not Locum'].map(name=>({match:row=>row.locum===name,groups:[all,...(urgent.length?[urgent]:[])]})),
  ...clinicianGroupNames.filter(isDashboardToggleOption).slice(0,8).map(name=>({match:row=>row.group===name,groups:[all]}))
 ];
 const bucket=()=>({weeks:new Set(),totals:Object.fromEntries(all.map(name=>[name,new Map()]))});
 for(const profile of profiles){profile.weekly=bucket();profile.holidays=bucket();profile.monthly=bucket();}
 const lowerWeek=firstAppointment?mondayOf(firstAppointment):'',upperWeek=lastAppointment?mondayOf(lastAppointment):thisWeek;
 const lowerMonth=firstAppointment.slice(0,7),upperMonth=lastAppointment.slice(0,7)||thisMonth;
 const add=(bucket,period,category,count)=>{
  bucket.weeks.add(period);
  const values=bucket.totals[category];
  if(values)values.set(period,(values.get(period)||0)+count);
 };
 for(const row of records){
  if(row.status!=='Booked'||excludedSlotTypes.has(row.slot))continue;
  const group=clinicianGroupAssignments[effectiveClinicianType(row.clinician,row.person)];
  if(!clinicianGroupNames.includes(group))continue;
  const week=row.bookedWeek,month=row.bookedDay?.slice(0,7),category=capacityUrgencyCategory(row.slot);
  const inWeek=week&&week>=lowerWeek&&week<=upperWeek&&week<thisWeek;
  const inMonth=month&&month>=lowerMonth&&month<=upperMonth&&month<thisMonth;
  if(!inWeek&&!inMonth)continue;
  const profileRow={group,locum:locumCategory(row)};
  for(const profile of profiles){
   if(!profile.match(profileRow))continue;
   if(inWeek){
    add(profile.holidays,week,category,row.count);
    if(!bankHolidayWeeks.has(week))add(profile.weekly,week,category,row.count);
   }
   if(inMonth)add(profile.monthly,month,category,row.count);
  }
 }
 const views=[],adjusters=[createListSizeAdjuster(false),createListSizeAdjuster(true)];
 for(const profile of profiles){
  const modes=monthlyMode?['monthly','weekly']:excludeBankHolidays?['weekly','holidays','monthly']:['holidays','weekly','monthly'];
  for(const [i,mode] of modes.entries()){
   if(profile!==profiles[0]&&i>0)break;
   const {weeks,totals}=profile[mode],periods=[...weeks].sort();
   const selections=i===0?profile.groups:profile.groups.slice(0,Math.max(1,families.size+1));
   for(const names of selections)for(const [index,adjust] of adjusters.entries()){
    const options={monthly:mode==='monthly',adjusted:index===1,combined:false,adjust};
    views.push(GPHistoricInsights.makeView(periods,names,totals,options));
    if(names.length>1)views.push(GPHistoricInsights.makeView(periods,names,totals,{...options,combined:true}));
   }
  }
 }
 return views;
}

function drawCombinedDemandChart(){
 if(typeof restoreChartShadowControls==='function')restoreChartShadowControls();
 const adjustmentStatus=$('demandAdjustmentStatus');if(adjustmentStatus)adjustmentStatus.textContent=adjustDemandForListSize?'Adjusted for list size':'Not adjusted for list size';
 renderDemandClassificationToggles('demandCapacityToggles',capacityCategoryNames,capacityAssignments,disabledDemandCapacities,capacityColours);
 setupDemandMonthSlider();
 hideEmptyHistoricBookingFilters();
 const adjustedCount=createListSizeAdjuster(adjustDemandForListSize);
 const selected=selectedTypes;
 const additiveTitle=$('demandAdditiveTitle');if(additiveTitle){additiveTitle.textContent=additiveLines?'Combined: '+selected.join(' + '):'';additiveTitle.hidden=!additiveLines||!selected.length;}
 const visibleWeeks=selectedWeeks.filter(w=>(!demandMonthStart||w.slice(0,7)>=demandMonthStart)&&(!demandMonthEnd||w.slice(0,7)<=demandMonthEnd));
 if(window.GPHistoricInsights){
  const completePeriods=visibleWeeks.filter(period=>!periodIsCurrent(period));
  const view=GPHistoricInsights.makeView(completePeriods,selected,demandCategoryTotals,{
   monthly:monthlyMode,adjusted:adjustDemandForListSize,combined:additiveLines,adjust:adjustedCount
  });
  GPHistoricInsights.update(view,()=>historicInsightPresets(firstAppointmentDate,lastAppointmentDate,selected));
 }
 const years=[...new Set(visibleWeeks.map(w=>Number(w.slice(0,4))))].sort((a,b)=>a-b);
 const latestYear=years.length?years[years.length-1]:null;
 const traces=[];
 const yearWidth=(year)=>[2.6,2.0,1.5][latestYear-year]??1.2;
 const x=p=>continuousMode?monthOfPeriod(p.date):(monthlyMode?Number(p.date.slice(5,7))-.5:monthPosition(p.date));
 // One legend entry per year; colour indicates urgency, thickness highlights the latest year.
 if(!continuousMode)for(const [i,year] of years.entries()){
  traces.push({name:String(year),x:[null],y:[null],type:'scatter',mode:'lines',showlegend:true,
   line:{color:'#58677a',width:yearWidth(year)},hoverinfo:'skip'});
 }
 let maxCount=0;
 const combinedTotals=new Map();
 if(additiveLines||breakdown==='total')for(const category of selected)for(const [date,count] of demandCategoryTotals[category]||[]){
  combinedTotals.set(date,(combinedTotals.get(date)||0)+count);
 }
 const currentKey=monthlyMode?thisMonth:thisWeek;
 const currentInView=showCurrentWeek&&visibleWeeks.includes(currentKey);
 const combined=additiveLines||breakdown==='total';
 const categories=regroup?[...groupedTotals.keys()]:combined&&selected.length?[breakdown==='total'?'Selected bookings':'Combined']:selected;
 const totalsFor=name=>regroup?groupedTotals.get(name):combined?combinedTotals:demandCategoryTotals[name];
 const series=historicChart2?categories.filter(name=>visibleWeeks.some(period=>totalsFor(name).get(period)>0)):categories;
 const seriesColour=name=>{
  if(combined)return '#2678ad';
  if(breakdown==='clinician')return clinicianGroupColour(name);
  if(breakdown==='locum')return name==='Locum'?'#9350bd':'#2479aa';
  return urgencyGroupColour(name);
 };
 paintHistoricSeriesLegend(series,seriesColour);
 const nowcastCategories=series;
 const range=demandMonthStart&&demandMonthEnd?[demandMonthStart+'-01',new Date(Date.UTC(Number(demandMonthEnd.slice(0,4)),Number(demandMonthEnd.slice(5,7)),0)).toISOString().slice(0,10)]:null;
 const currentPosition=x({date:currentKey});
 const nowcastDaily=new Map(nowcastCategories.map(name=>[name,new Map()])),nowcastTimed=new Map(nowcastCategories.map(name=>[name,[]]));
 const snapshot=Number.isFinite(capacityCSVLatestModified)?new Date(Math.min(Date.now(),capacityCSVLatestModified)):null;
 const snapshotClock=snapshot?dayView2LondonClock(snapshot):null;
 const asOfLabel=snapshot?snapshot.toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Europe/London'})+' London time':'timestamp unavailable';
 if(currentInView){
  const oldest=GPCorrectness.shift(monthlyMode?thisMonth+'-01':thisWeek,-750);
  for(const row of records){
   if(!row.bookedDay||row.bookedDay<oldest||!includedRecord(row))continue;
   const category=seriesForBooking(row),bucket=nowcastDaily.get(category);
   if(!bucket)continue;const previous=bucket.get(row.bookedDay)||{date:row.bookedDay,count:0,rawCount:0};previous.count+=adjustedCount(row.bookedDay,row.count);previous.rawCount+=row.count;bucket.set(row.bookedDay,previous);
  }
  for(const row of bookingTimeRecords){
   if(!row.bookedDay||row.bookedDay<oldest||!includedRecord({...row,status:'Booked',bookedWeek:mondayOf(row.bookedDay)}))continue;
   const category=seriesForBooking(row),bucket=nowcastTimed.get(category);
   if(bucket)bucket.push({date:row.bookedDay,minute:row.minute,count:adjustedCount(row.bookedDay,row.count)});
  }
 }

 for(const category of series){
  const totals=totalsFor(category);
  const points=GPCorrectness.smoothDemandSeries([...totals].filter(([date])=>(!demandMonthStart||date.slice(0,7)>=demandMonthStart)&&(!demandMonthEnd||date.slice(0,7)<=demandMonthEnd)).map(([date,count])=>({date,rawCount:count,count:adjustedCount(date,count),year:Number(date.slice(0,4))})),{level:demandSmoothingLevel(),continuous:continuousMode,currentPeriod:showCurrentWeek?(monthlyMode?thisMonth:thisWeek):''});
  for(const [i,year] of years.entries()){
   const data=points.filter(p=>p.year===year&&(!demandMonthStart||p.date.slice(0,7)>=demandMonthStart)&&(!demandMonthEnd||p.date.slice(0,7)<=demandMonthEnd)).sort((a,b)=>a.date.localeCompare(b.date));
   if(!data.length)continue;
   const last=data[data.length-1];
   const partial=showCurrentWeek&&periodIsCurrent(last.date);
   const complete=partial?data.slice(0,-1):data;
   // Continuous mode must join December to January, even though the year traces
   // use different widths. Include the previous year's final point as a bridge.
   const previousPoint=continuousMode?points.filter(p=>p.year===year-1&&(!demandMonthStart||p.date.slice(0,7)>=demandMonthStart)&&(!demandMonthEnd||p.date.slice(0,7)<=demandMonthEnd)).sort((a,b)=>a.date.localeCompare(b.date)).at(-1):null;
   const plotPoints=previousPoint&&complete.length?[previousPoint,...complete]:complete;
   const width=yearWidth(year);
   const opacity=year===latestYear?1:Math.max(0.25,0.62-(latestYear-year)*0.08);
   for(const p of data)maxCount=Math.max(maxCount,p.count);
   traces.push({name:category+' '+year,legendgroup:String(year),showlegend:false,
    x:plotPoints.map(x),y:plotPoints.map(p=>p.smoothed),customdata:plotPoints.map(p=>[p.date,p.rawCount,p.count]),
    type:'scatter',mode:'lines',connectgaps:false,opacity,
    line:{color:seriesColour(category),width,shape:demandSmoothingLevel()?'spline':'linear',smoothing:0.5},
    hoverinfo:'text',text:plotPoints.map(p=>p.date)});
   if(partial){
    const projection=GPCorrectness.currentPeriodNowcast({mode:monthlyMode?'month':'week',currentDate:todayLondon,clock:snapshotClock,daily:[...(nowcastDaily.get(category)?.values()||[])],timed:nowcastTimed.get(category)||[],coverage:slotReportCoverage,excludedPeriods:monthlyMode||!excludeBankHolidays?[]:[...bankHolidayWeeks]});
    const colour=seriesColour(category);
    const markerX=currentPosition;
    const observed=Number.isFinite(projection.observed)?projection.observed:last.count,rawObserved=Number.isFinite(projection.rawObserved)?projection.rawObserved:last.rawCount;
    const currentActual={category,mode:monthlyMode?'month':'week',observed,rawObserved,asOfLabel,logicalPeriod:last.date};
    traces.push({name:category+' current '+currentActual.mode+' so far',showlegend:false,type:'scatter',mode:'markers',
     x:[markerX],y:[observed],customdata:[[last.date,rawObserved,observed]],cliponaxis:false,
     marker:{symbol:'circle-open',size:7,color:colour,line:{color:colour,width:1.3}},line:{color:colour,width:0},
     hoverinfo:'text',text:category+': '+Math.round(rawObserved).toLocaleString('en-GB')+' actual bookings so far',meta:{currentObserved:currentActual}});
    if(projection.error)continue;
    const whiskerColour=/^#[0-9a-f]{6}$/i.test(colour)?'rgba('+[1,3,5].map(i=>parseInt(colour.slice(i,i+2),16)).join(',')+',0.65)':'rgba(38,120,173,0.65)';
    const meta={...projection,category,asOfLabel},centre=(projection.low+projection.high)/2;
    traces.push({name:category+' '+year+' estimated range',legendgroup:String(year),showlegend:false,type:'scatter',mode:'lines',
     x:[markerX,markerX,markerX],y:[projection.low,centre,projection.high],line:{color:whiskerColour,width:1.1},
     hoverinfo:'text',text:category+' indicative 70% prediction interval: '+Math.round(projection.low).toLocaleString('en-GB')+'–'+Math.round(projection.high).toLocaleString('en-GB')+' · Actual so far: '+Math.round(projection.rawObserved).toLocaleString('en-GB')+' · Report: '+asOfLabel,meta:{nowcast:meta}});
    traces.push({name:category+' range caps',showlegend:false,type:'scatter',mode:'markers',x:[markerX],y:[centre],marker:{size:0,opacity:0},
     error_y:{type:'data',symmetric:false,array:[projection.high-centre],arrayminus:[centre-projection.low],color:whiskerColour,thickness:1.1,width:3},hoverinfo:'skip',meta:{rangeCaps:true}});
    // Keep the finishing estimate and its range at the current-period date, joined to history.
    const bridge=complete.at(-1)||previousPoint;
    traces.push({name:category+' '+year+' estimated finish',legendgroup:String(year),showlegend:false,type:'scatter',mode:'lines',
     x:bridge?[x(bridge),markerX]:[markerX],y:bridge?[bridge.smoothed,projection.estimate]:[projection.estimate],
     line:{color:colour,width:1.35,dash:'1px,3px'},hoverinfo:'skip',meta:{estimateConnector:true}});
    maxCount=Math.max(maxCount,projection.high);
   }
  }
 }
 // One horizontal mean for each visible series, calculated over the
 // currently selected booking weeks/months (including zero-count periods).
 const averageShapes=[];
 const averageCapsules=[];
 for(const category of series){
  const totals=totalsFor(category);
  const values=visibleWeeks.filter(w=>!periodIsCurrent(w)).map(w=>adjustedCount(w,totals.get(w)||0)).filter(Number.isFinite);
  if(!values.length)continue;
  const average=values.reduce((sum,value)=>sum+value,0)/values.length;
  maxCount=Math.max(maxCount,average);
  const colour=seriesColour(category);
  averageShapes.push({type:'line',xref:'paper',yref:'y',x0:0,x1:1,y0:average,y1:average,
   line:{color:colour,width:1,dash:'dot'},layer:'above'});
  averageCapsules.push({category,average,colour});
 }
 // Fit the axis closely to the visible series and average lines, retaining a zero baseline.
 const yAxisTop=Math.max(5,Math.ceil(maxCount*1.08));
 const rawGridStep=yAxisTop/5,gridMagnitude=10**Math.floor(Math.log10(rawGridStep));
 const majorGridStep=[1,2,5,10].map(n=>n*gridMagnitude).find(n=>n>=rawGridStep);
 const historicalAxisStyle={showline:true,linecolor:'#597080',linewidth:2,automargin:false};
 renderPreferencePlot('combinedDemandChart',traces,{dragmode:false,autosize:true,height:535,
  margin:{l:62,r:24,t:continuousMode?28:50,b:65},paper_bgcolor:'white',plot_bgcolor:'#fafafa',
  shapes:[...yearBackgroundShapes(visibleWeeks),...averageShapes],
  showlegend:!continuousMode,legend:{orientation:'h',y:1.14,x:0,xanchor:'left',yanchor:'bottom',entrywidth:85,entrywidthmode:'pixels',traceorder:'normal'},
  xaxis:continuousMode?{...historicalAxisStyle,type:'date',domain:[0,1],title:monthlyMode?'Booking month':'Booking date',dtick:visibleWeeks.length<(monthlyMode?9:39)?'M1':'M3',showgrid:true,gridcolor:'#e4e4e4',gridwidth:1,...(range?{range}: {})}:{...axis,...historicalAxisStyle,domain:[0,1],showgrid:true,gridcolor:'#e4e4e4',gridwidth:1,dtick:3},
  yaxis:{...historicalAxisStyle,title:{text:monthlyMode?'Appointments per month':'Appointments per week',standoff:8,font:{size:11}},range:[0,yAxisTop],tick0:0,dtick:majorGridStep,showgrid:true,gridcolor:'#b0b0b0',gridwidth:1,zeroline:false,minor:{tick0:0,dtick:majorGridStep/2,showgrid:true,gridcolor:'#e3e3e3',gridwidth:0.6,ticks:''}},hovermode:'closest',
  annotations:!selected.length||(historicChart2&&!series.length)?[{text:selected.length?'No bookings match these filters':'Select an appointment type to display appointments',xref:'paper',yref:'paper',x:.5,y:.5,showarrow:false}]:[]
 },{responsive:true,displaylogo:false,displayModeBar:false,scrollZoom:false,doubleClick:false}).then(()=>{applyHistoricChartShadows($('combinedDemandChart'));installDemandCardTooltip($('combinedDemandChart'));installDemandAverageCapsules($('combinedDemandChart'),averageCapsules);});
}
drawCombinedDemandChart();
}
let groupUrgencyNames=[],groupUrgencyAssignments={};
let clinicianGroupNames=[],clinicianGroupAssignments={};
const STORAGE_KEY='appointment-dashboard-categories-v1';let categoryNames=['Urgent','Routine','Follow up'],assignments={};try{const saved=JSON.parse(iqLocalStorage.getItem(STORAGE_KEY)||'{}');categoryNames=Array.isArray(saved.categories)&&saved.categories.length?saved.categories.filter(x=>typeof x==='string'&&x.trim()&&x!=='Uncategorised'):['Urgent','Routine','Follow up'];assignments=saved.assignments&&typeof saved.assignments==='object'?saved.assignments:{};}catch(e){}let clinicianCategoryNames=[],clinicianAssignments={};try{const local=JSON.parse(iqLocalStorage.getItem(STORAGE_KEY)||'{}');if(Array.isArray(local.clinicianCategories))clinicianCategoryNames=validCategoryNames(local.clinicianCategories);if(local.clinicianAssignments)clinicianAssignments=validAssignments(local.clinicianAssignments,clinicianCategoryNames)}catch(e){}let capacityCategoryNames=['Core Capacity','Additional Capacity'],capacityColours={},capacityAssignments={};try{const local=JSON.parse(iqLocalStorage.getItem(STORAGE_KEY)||'{}');if(Array.isArray(local.capacityCategories))capacityCategoryNames=validCategoryNames(local.capacityCategories);capacityAssignments=validAssignments(local.capacityAssignments||{},capacityCategoryNames);if(local.capacityColours&&typeof local.capacityColours==='object')capacityColours=Object.fromEntries(Object.entries(local.capacityColours).filter(([k,v])=>/^#[0-9a-f]{6}$/i.test(v)));}catch(e){}let purposeCategoryNames=[],purposeColours={},purposeAssignments={};try{const local=JSON.parse(iqLocalStorage.getItem(STORAGE_KEY)||'{}');purposeCategoryNames=validCategoryNames(local.purposeCategories||[]);purposeAssignments=validAssignments(local.purposeAssignments||{},purposeCategoryNames);if(local.purposeColours&&typeof local.purposeColours==='object')purposeColours=Object.fromEntries(Object.entries(local.purposeColours).filter(([k,v])=>/^#[0-9a-f]{6}$/i.test(v)));}catch(e){}let consultModeColours={};let consultCategoryNames=[],consultAssignments={};try{const local=JSON.parse(iqLocalStorage.getItem(STORAGE_KEY)||'{}');if(Array.isArray(local.consultCategories))consultCategoryNames=validCategoryNames(local.consultCategories);if(local.consultAssignments)consultAssignments=validAssignments(local.consultAssignments,consultCategoryNames);if(local.consultModeColours&&typeof local.consultModeColours==='object')consultModeColours=Object.fromEntries(Object.entries(local.consultModeColours).filter(([k,v])=>/^#[0-9a-f]{6}$/i.test(v)))}catch(e){}try{const local=JSON.parse(iqLocalStorage.getItem(STORAGE_KEY)||'{}');if(Array.isArray(local.groupUrgencyCategories))groupUrgencyNames=validCategoryNames(local.groupUrgencyCategories);if(local.groupUrgencyAssignments)groupUrgencyAssignments=validAssignments(local.groupUrgencyAssignments,groupUrgencyNames);if(local.urgencyGroupColours&&typeof local.urgencyGroupColours==='object')urgencyGroupColours=local.urgencyGroupColours;if(local.urgencyTypeColours&&typeof local.urgencyTypeColours==='object')urgencyTypeColours=local.urgencyTypeColours}catch(e){}
try{const local=JSON.parse(iqLocalStorage.getItem(STORAGE_KEY)||'{}');if(Array.isArray(local.clinicianGroupCategories))clinicianGroupNames=validCategoryNames(local.clinicianGroupCategories);if(local.clinicianGroupAssignments)clinicianGroupAssignments=validAssignments(local.clinicianGroupAssignments,clinicianGroupNames)}catch(e){}
try{const local=JSON.parse(iqLocalStorage.getItem(STORAGE_KEY)||'{}');if(local.userTypeLocum&&typeof local.userTypeLocum==='object')userTypeLocum=local.userTypeLocum;if(local.clinicianTypeColours&&typeof local.clinicianTypeColours==='object')clinicianTypeColours=local.clinicianTypeColours;if(local.urgencyTypeColours&&typeof local.urgencyTypeColours==='object')urgencyTypeColours=local.urgencyTypeColours;if(local.clinicianGroupColours&&typeof local.clinicianGroupColours==='object')clinicianGroupColours=local.clinicianGroupColours}catch(e){}

const togglePriority={urgency:[],mode:[],purpose:[],capacity:[]};
const prioritySources={urgency:()=>groupUrgencyNames,mode:()=>consultCategoryNames,purpose:()=>purposeCategoryNames,capacity:()=>capacityCategoryNames};
function prioritySort(kind,names){const order=togglePriority[kind]||[];return [...names].sort((a,b)=>(order.indexOf(a)<0?9999:order.indexOf(a))-(order.indexOf(b)<0?9999:order.indexOf(b)))}
const priorityEditors={urgency:'slotGroupBoxes',mode:'slotConsultModeCards',purpose:'slotPurposeCategoryList',capacity:'slotCapacityCategoryList'};
function refreshPriorityEditors(){
 for(const [kind,id] of Object.entries(priorityEditors)){
  const root=document.getElementById(id);if(!root)continue;
  const rows=[...root.children].filter(r=>r.classList.contains('slot-mode-item'));
  const names=prioritySort(kind,prioritySources[kind]());
  const rowName=r=>r.dataset.priorityName||[...r.children].find(c=>c.tagName==='SPAN'&&!c.classList.contains('priority-grip')&&!c.classList.contains('clinician-colour-dot'))?.textContent?.trim();
  for(const name of names){
   const row=rows.find(r=>rowName(r)===name);if(!row)continue;
   row.dataset.priorityName=name;
   row.draggable=false;
   row.querySelector('.priority-grip')?.remove();
   let controls=row.querySelector('.priority-arrow-controls');
   if(!controls){
    controls=document.createElement('span');controls.className='priority-arrow-controls';
    const makeButton=(direction,symbol,label)=>{
     const button=document.createElement('button');button.type='button';button.className='priority-arrow-button';
     button.textContent=symbol;button.title=label;button.setAttribute('aria-label',label);
     button.addEventListener('click',event=>{
      event.preventDefault();event.stopPropagation();if(!isOwner)return;
      const ordered=prioritySort(kind,prioritySources[kind]());
      const from=ordered.indexOf(row.dataset.priorityName),to=from+direction;
      if(from<0||to<0||to>=ordered.length)return;
      [ordered[from],ordered[to]]=[ordered[to],ordered[from]];
      togglePriority[kind]=ordered;
      saveCategories();refreshPriorityEditors();refreshPriorityToggles();
      renderUrgentCategoryToggles();renderRoutineCategoryToggles();renderPlannedCategoryToggles();renderDayView2();
     });
     return button;
    };
    controls.append(makeButton(-1,'↑','Move '+name+' up in toggle priority'),makeButton(1,'↓','Move '+name+' down in toggle priority'));
    const actions=[...row.children].filter(c=>c.tagName==='BUTTON');
    if(actions.length)row.insertBefore(controls,actions[0]);else row.append(controls);
   }
   const [up,down]=controls.querySelectorAll('button');
   up.disabled=!isOwner||names.indexOf(name)===0;
   down.disabled=!isOwner||names.indexOf(name)===names.length-1;
  }
  const actual=[...root.children].filter(r=>r.classList.contains('slot-mode-item'));
  if(actual.some((row,i)=>row.dataset.priorityName!==names[i]))for(const name of names){const row=rows.find(r=>r.dataset.priorityName===name);if(row)root.append(row)}
 }
}
const priorityToggleIds={
 urgency:['demandUrgencyToggles','dayView2UrgencyToggles','routineCategoryToggles','plannedCategoryToggles','urgentCategoryToggles'],
 mode:['consultChartFilters','routineConsultFilters','plannedConsultFilters','bookingTimesConsultFilters'],
 capacity:['demandCapacityToggles','urgentCapacityToggles','routineCapacityFilters','plannedCapacityFilters','bookingTimesCapacityFilters']
};
function refreshPriorityToggles(){
 for(const [kind,ids] of Object.entries(priorityToggleIds))for(const id of ids){
  const root=document.getElementById(id);if(!root)continue;
  const rows=[...root.children];
  const name=r=>r.querySelector('input')?.dataset.urgencyGroup||r.querySelector('input')?.dataset.filterName||r.querySelector('span:last-child')?.textContent?.trim()||'';
  const sorted=prioritySort(kind,rows.map(name));if(rows.some((row,i)=>name(row)!==sorted[i]))for(const n of sorted){const row=rows.find(r=>name(r)===n);if(row)root.append(row)}
 }
}
function setupTogglePriority(){
 // No MutationObservers: DOM mutations from the priority renderer previously locked the login page.
 for(const fn of ['renderSlotGroupBoxes','renderConsultModeCards','renderSlotPurposeCategories','renderCapacityStatusCategories']){
  const original=globalThis[fn];
  if(typeof original!=='function')continue;
  globalThis[fn]=function(...args){const result=original.apply(this,args);refreshPriorityEditors();return result};
 }
 refreshPriorityEditors();
 refreshPriorityToggles();
}

function ensureFollowUpCategory(){if(!categoryNames.some(c=>c.toLowerCase().replace(/[\s-]+/g,'')==='followup'))categoryNames.push('Follow up')}ensureFollowUpCategory();function guessCategory(t){return /RED|YELLOW|AMBER|URGENT|SAME DAY|ACUTE/i.test(t)?'Urgent':/GREEN|FOLLOW UP|ROUTINE/i.test(t)?'Routine':null}function saveCategories(sync=true){ensureAnalyticsRoles();queueMicrotask(refreshPrimaryApptTypeBoxes);capacityPaceCache=null;lastConsultFilterNames=[];try{iqLocalStorage.setItem(STORAGE_KEY,JSON.stringify({categories:categoryNames,assignments,clinicianCategories:clinicianCategoryNames,clinicianAssignments,consultCategories:consultCategoryNames,consultAssignments,groupUrgencyCategories:groupUrgencyNames,groupUrgencyAssignments,urgencyGroupColours,appointmentCategoryNames,appointmentCategoryAssignments,appointmentCategoryColours,clinicianGroupCategories:clinicianGroupNames,clinicianGroupAssignments,userTypeLocum,clinicianGroupColours,clinicianTypeColours,urgencyTypeColours,purposeCategories:purposeCategoryNames,purposeColours,purposeAssignments,capacityCategories:capacityCategoryNames,capacityColours,capacityAssignments,consultModeColours,togglePriority:{...togglePriority},excludedSlotTypes:[...excludedSlotTypes]}));}catch(e){alert('Could not save settings in this browser. Please try again.')}if(sync)markCategoryDirty()}function allCategories(){return [...categoryNames,'Uncategorised']}function rebuildCategoryFilter(){const old=new Set([...slots.selectedOptions].map(o=>o.value));slots.replaceChildren();for(const c of allCategories()){const o=document.createElement('option');o.value=c;o.textContent=c;o.selected=old.has(c);slots.append(o)}}function renderEditor(){renderDropEditor('urgency');updateAvailabilityUrgencyFilter()}
function renderGroupUrgencyEditor(){renderDropEditor('groupUrgency');updateAvailabilityUrgencyFilter()}document.getElementById('addCategory').onclick=()=>{const el=document.getElementById('newCategory');const c=el.value.trim();if(!c)return;if(c.toLowerCase()==='uncategorised'||categoryNames.some(x=>x.toLowerCase()===c.toLowerCase())){alert('This category name already exists or is reserved.');return}categoryNames.push(c);el.value='';saveCategories();rebuildCategoryFilter();renderEditor();renderGroupUrgencyEditor()};document.getElementById('newCategory').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('addCategory').click()});document.getElementById('slotSearch').addEventListener('input',renderEditor);

/* Personal profile is private to this signed-in account and browser. */
function personalSettingsKey(){
 const account=activeAccount?.homeAccountId||activeAccount?.localAccountId||activeAccount?.username;
 return account?'gp-insight-personal-settings-v1:'+encodeURIComponent(account):null;
}
function readPersonalSettings(){
 try{const key=personalSettingsKey();return key?JSON.parse(iqLocalStorage.getItem(key)||'{}')||{}:{}}catch{return {}}
}
function renderPersonalSettings(){
 const saved=readPersonalSettings();
 $('personalName').value=typeof saved.name==='string'?saved.name:(activeAccount?.name||'');
 $('personalEmail').value=activeAccount?.username||activeAccount?.idTokenClaims?.email||activeAccount?.idTokenClaims?.preferred_username||'';
 const select=$('personalUserType');select.replaceChildren();
 const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Select a clinical type';select.append(placeholder);
 const names=[...new Set(clinicianCategoryNames)].sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}));
 for(const name of names){const option=document.createElement('option');option.value=name;option.textContent=name;select.append(option);}
 if(saved.userType&&!names.includes(saved.userType)){
  const previous=document.createElement('option');previous.value=saved.userType;previous.textContent=saved.userType+' (no longer configured)';previous.disabled=true;select.append(previous);
 }
 select.value=typeof saved.userType==='string'?saved.userType:'';
 $('personalLogoutMinutes').value=String(dashboardIdleMinutes());
 $('personalSettingsStatus').textContent='';
}
function savePersonalSettings(event){
 event.preventDefault();
 const key=personalSettingsKey();
 if(!key){$('personalSettingsStatus').textContent='Sign in to save your personal settings.';return;}
 try{
  iqLocalStorage.setItem(key,JSON.stringify({...readPersonalSettings(),name:$('personalName').value.trim(),userType:$('personalUserType').value,logoutMinutes:[10,30,60,120,240].includes(Number($('personalLogoutMinutes').value))?Number($('personalLogoutMinutes').value):30}));
  recordDashboardActivity(true);checkDashboardInactivity();
  updateHeaderIdentity();
  $('personalSettingsStatus').textContent='Personal settings saved.';
 }catch{$('personalSettingsStatus').textContent='Unable to save personal settings in this browser.';}
}

const PRACTICE_SETTINGS_KEY='demand-iq-practice-settings-v1';
let practiceSettings={name:'',anchors:{}},practiceSelectedMonth='';
try{const stored=JSON.parse(iqLocalStorage.getItem(PRACTICE_SETTINGS_KEY)||'{}');if(stored&&typeof stored==='object'){practiceSettings.name=typeof stored.name==='string'?stored.name:'';practiceSettings.anchors=stored.anchors&&typeof stored.anchors==='object'?stored.anchors:{};}}catch(e){}
function savePracticeSettings(){updateHomePracticeName();try{iqLocalStorage.setItem(PRACTICE_SETTINGS_KEY,JSON.stringify(practiceSettings));}catch(e){$('practiceListStatus').textContent='Unable to save changes in this browser.';}scheduleCloudSave();scheduleDemandRefresh();}
function practiceMonths(){
 let first='',last='';
 for(const r of availabilityRecords){
  const d=typeof r.date==='string'?r.date.slice(0,7):'';
  if(!/^\d{4}-\d{2}$/.test(d))continue;
  if(!first||d<first)first=d;
  if(!last||d>last)last=d;
 }
 if(!first)return [];
 const from=Number(first.slice(0,4))*12+Number(first.slice(5,7))-1;
 const to=Number(last.slice(0,4))*12+Number(last.slice(5,7))-1;
 return Array.from({length:Math.min(1200,to-from+1)},(_,i)=>{const n=from+i;return String(Math.floor(n/12)).padStart(4,'0')+'-'+String(n%12+1).padStart(2,'0')});
}
function practiceListValues(months){
 const anchors=months.map((month,i)=>({i,value:Number(practiceSettings.anchors[month])})).filter(p=>Object.prototype.hasOwnProperty.call(practiceSettings.anchors,months[p.i])&&Number.isFinite(p.value)&&p.value>=0);
 if(!anchors.length)return months.map(()=>10000);
 return months.map((month,i)=>{
  if(i<=anchors[0].i)return anchors[0].value;
  if(i>=anchors[anchors.length-1].i)return anchors[anchors.length-1].value;
  const right=anchors.findIndex(a=>a.i>=i),a=anchors[right-1],b=anchors[right];
  const t=(i-a.i)/(b.i-a.i),smooth=t*t*(3-2*t);
  return Math.round(a.value+(b.value-a.value)*smooth);
 });
}

function createListSizeAdjuster(enabled){
 const months=enabled?practiceMonths():[];
 if(!months.length)return (_date,count)=>count;
 const values=practiceListValues(months);
 const byMonth=new Map(months.map((month,i)=>[month,values[i]]));
 const reference=values.at(-1);
 return (date,count)=>{
  const month=date.slice(0,7);
  const historical=byMonth.get(month)??(month<months[0]?values[0]:reference);
  return historical>0?count*reference/historical:count;
 };
}

let adjustDemandForListSize=false;
function listSizeAtMonth(month){
 const months=practiceMonths();if(!months.length)return 10000;
 const first=months[0],last=months[months.length-1];
 const values=practiceListValues(months);
 if(month<=first)return values[0];if(month>=last)return values[values.length-1];
 const idx=months.indexOf(month);return idx<0?10000:values[idx];
}
function listSizeAdjustedCount(date,count){
 if(!adjustDemandForListSize)return count;
 const months=practiceMonths();if(!months.length)return count;
 const reference=listSizeAtMonth(months[months.length-1]);
 const historical=listSizeAtMonth(date.slice(0,7));
 return historical>0?count*reference/historical:count;
}
$('adjustListSize')?.addEventListener('change',e=>{adjustDemandForListSize=e.target.checked;scheduleDemandRefresh();});
function updateHomePracticeName(){const el=$('homePracticeName');if(el)el.textContent=practiceSettings.name.trim()||'Practice overview';}

/* Practice settings workspace; population chart remains the existing editor. */
let practiceSettingsTab='users',practiceUsersLoading=false,practiceUserRemovalBusy=false;
let practiceUsersSnapshot={base:'',permissions:[]};
function selectPracticeSettingsTab(tab){
 practiceSettingsTab=['list','reports'].includes(tab)?tab:'users';
 writeChartPreference('practiceSettings:tab',practiceSettingsTab);
 for(const name of ['users','list','reports']){
  const selected=practiceSettingsTab===name;
  $('practiceTab-'+name).setAttribute('aria-selected',String(selected));
  $('practiceTab-'+name).classList.toggle('active',selected);
  const panel=$('practicePanel-'+name);
  if(panel)panel.hidden=!selected;
 }
 if(practiceSettingsTab==='users')void renderPracticeUsers();
 else if(practiceSettingsTab==='list')renderPracticeSettings();
}
function practicePermissionUsers(permissions){
 const ownerEmail=(activeAccount?.username||'').toLowerCase();
 const rows=new Map();
 const add=(identity,email='',owner=false,permission=null)=>{
  const user=identity?.user||identity?.siteUser||{};
  const address=String(user.email||email||'').trim();
  const id=String(user.id||identity?.siteUser?.id||'');
  const key=address.toLowerCase()||id||user.displayName;
  if(!key)return;
  const admin=owner||address.toLowerCase()===ownerEmail||id.toLowerCase()===OWNER_DRIVE_ID.toLowerCase();
  const existing=rows.get(key);
  rows.set(key,{name:user.displayName||existing?.name||address||'Name unavailable',email:address||existing?.email||'',role:admin?'Admin':existing?.role||'View only',id:id||existing?.id||'',permissions:[...(existing?.permissions||[]),...(permission?[permission]:[])]});
 };
 add({user:{displayName:activeAccount?.name||activeAccount?.username}},activeAccount?.username||'',true);
 for(const permission of permissions){
  if(permission.expirationDateTime&&Date.parse(permission.expirationDateTime)<Date.now())continue;
  const identities=[permission.grantedToV2||permission.grantedTo,...(permission.grantedToIdentitiesV2||permission.grantedToIdentities||[])].filter(Boolean);
  const owner=(permission.roles||[]).includes('owner');
  if(owner)continue; // The signed-in administrator is already listed above.
  for(const identity of identities)add(identity,identities.length===1?permission.invitation?.email||'':'',false,permission);
  if(!identities.length&&permission.invitation?.email)add({},permission.invitation.email,false,permission);
 }
 return [...rows.values()].sort((a,b)=>(a.role==='Admin'?-1:1)-(b.role==='Admin'?-1:1)||a.name.localeCompare(b.name));
}

function practiceUserRemovalBlock(user,permissions=practiceUsersSnapshot.permissions){
 if(user.role==='Admin')return 'The administrator cannot be removed.';
 if(!user.email&&!user.id)return 'Microsoft did not return an identifiable account. Manage this user in practice workspace.';
 if(permissions.some(p=>p.link&&['anonymous','organization'].includes(p.link.scope)))return 'General sharing links may still grant access. Manage this user in practice workspace.';
 if(!user.permissions?.length)return 'Refresh the user list before removing this user.';
 for(const permission of user.permissions){
  if(!permission.id||permission.inheritedFrom)return 'This access is inherited. Manage it in practice workspace.';
  if(permission.link)return 'This user has access through a sharing link. Manage their individual access in practice workspace.';
  const people=[permission.grantedToV2||permission.grantedTo,...(permission.grantedToIdentitiesV2||permission.grantedToIdentities||[])].filter(Boolean);
  if(people.some(p=>p.group||p.siteGroup)||people.length>1)return 'This permission is shared with other people. Manage this user in practice workspace.';
 }
 return '';
}
function samePracticeUser(a,b){
 return !!(a.email&&b.email&&a.email.toLowerCase()===b.email.toLowerCase()||a.id&&b.id&&a.id===b.id);
}
let pendingPracticeRemoval=null;
function confirmPracticeUserRemoval(user){
 if(!isOwner||practiceUserRemovalBusy)return;
 pendingPracticeRemoval=user;
 $('practiceRemoveMessage').textContent='Are you sure you want to remove '+(user.email||user.name)+'? Their sharing access to the practice practice workspace folder will also be removed.';
 $('practiceRemoveDialog').showModal();
}
async function removePracticeUser(){
 const target=pendingPracticeRemoval;
 if(!isOwner||!target||target.role==='Admin'||practiceUserRemovalBusy)return;
 practiceUserRemovalBusy=true;$('practiceRemoveYes').disabled=true;$('practiceRemoveNo').disabled=true;
 const status=$('practiceUsersStatus');
 try{
  // Re-read permissions before any write; never delete a stale or multi-user grant.
  const refreshed=await renderPracticeUsers();
  if(!refreshed)throw Error('The current access list could not be verified. No access was removed.');
  const matches=refreshed.filter(user=>samePracticeUser(user,target));
  if(!matches.length)throw Error('This user is no longer listed. Refresh the user list.');
  for(const user of matches){const reason=practiceUserRemovalBlock(user);if(reason)throw Error(reason);}
  const ids=[...new Set(matches.flatMap(user=>user.permissions.map(p=>p.id)))];
  const base=practiceUsersSnapshot.base;
  for(const id of ids){
   if(!isOwner)throw Error('Administrator access is required.');
   const bearer=await token();
   const response=await fetch(GRAPH+base+'/'+encodeURIComponent(id),{method:'DELETE',headers:{Authorization:'Bearer '+bearer}});
   if(!response.ok&&response.status!==404)throw Error('Microsoft could not remove all access (HTTP '+response.status+'). Refresh the list before retrying.');
  }
  const after=await renderPracticeUsers();
  if(!after)throw Error('Removal was requested, but access could not be verified. Refresh the user list.');
  if(after.some(user=>samePracticeUser(user,target)))throw Error('This user still has folder access. Manage their remaining sharing permissions in practice workspace.');
  status.textContent=(target.email||target.name)+' was removed and their practice workspace folder sharing was revoked.';
 }catch(error){status.textContent='User removal could not be completed: '+(error?.message||error);}
 finally{practiceUserRemovalBusy=false;pendingPracticeRemoval=null;$('practiceRemoveYes').disabled=false;$('practiceRemoveNo').disabled=false;$('practiceRemoveDialog').close();}
}
$('practiceRemoveYes').addEventListener('click',()=>void removePracticeUser());
$('practiceRemoveNo').addEventListener('click',()=>{$('practiceRemoveDialog').close();pendingPracticeRemoval=null;});
$('practiceRemoveDialog').addEventListener('cancel',event=>{if(practiceUserRemovalBusy)event.preventDefault();else pendingPracticeRemoval=null;});

function drawPracticeUsers(rows){
 const body=$('practiceUsersBody');body.replaceChildren();
 for(const user of rows){
  const row=document.createElement('tr');
  for(const value of [user.name,user.email||'Not supplied',user.role]){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}
  const action=document.createElement('td');
  if(user.role!=='Admin'){
   const reason=practiceUserRemovalBlock(user);
   const button=document.createElement('button');button.type='button';button.className='secondary practice-remove-user';
   button.textContent=reason?'Manage in practice workspace':'Remove User';
   button.setAttribute('aria-label',(reason?'Manage access for ':'Remove user ')+(user.email||user.name));
   if(reason){button.addEventListener('click',()=>{$('practiceUsersStatus').textContent=reason;window.open(SHARED_FOLDER_LINK,'_blank','noopener,noreferrer');});}
   else button.addEventListener('click',()=>confirmPracticeUserRemoval(user));
   action.append(button);
  }
  row.append(action);body.append(row);
 }
}
async function renderPracticeUsers(){
 if(!isOwner||practiceUsersLoading)return;
 practiceUsersLoading=true;
 const status=$('practiceUsersStatus'),button=$('practiceUsersRefresh');
 button.disabled=true;status.textContent='Loading practice users…';
 drawPracticeUsers(practicePermissionUsers([]));
 try{
  const folder=await graph(sharedPath());
  const drive=folder.parentReference?.driveId;
  if(!drive||!folder.id)throw Error('The shared practice folder could not be identified.');
  let next='/drives/'+encodeURIComponent(drive)+'/items/'+encodeURIComponent(folder.id)+'/permissions';
  const base=next;
  const permissions=[],seen=new Set();
  while(next){
   if(seen.has(next))throw Error('The user list could not be loaded completely.');
   seen.add(next);
   const page=await graph(next);permissions.push(...(page.value||[]));next=page['@odata.nextLink']||'';
  }
  if(!isOwner)return;
  practiceUsersSnapshot={base,permissions};
  const rows=practicePermissionUsers(permissions);drawPracticeUsers(rows);
  const unnamedLinks=permissions.some(p=>p.link&&['anonymous','organization'].includes(p.link.scope));
  status.textContent=rows.length+' practice user'+(rows.length===1?'':'s')+'.'+(unnamedLinks?' Access through general sharing links cannot be listed by name.':'');
  return rows;
 }catch(error){status.textContent='Unable to load the full practice user list: '+(error?.message||'Please try again.');return null;}
 finally{practiceUsersLoading=false;button.disabled=false;}
}
$('practiceTab-users').addEventListener('click',()=>selectPracticeSettingsTab('users'));
$('practiceTab-list').addEventListener('click',()=>selectPracticeSettingsTab('list'));
$('practiceTab-reports').addEventListener('click',()=>selectPracticeSettingsTab('reports'));
$('practiceUsersRefresh').addEventListener('click',()=>void renderPracticeUsers());

function renderPracticeSettings(){
 const input=$('practiceNameInput');if(!input)return;
 updateHomePracticeName();
 if(document.activeElement!==input)input.value=practiceSettings.name;
 const months=practiceMonths(),root=$('practiceListGraph');root.replaceChildren();
 if(!months.length){root.textContent='Load appointment reports to show the practice list size timeline.';return;}
 if(!months.includes(practiceSelectedMonth))practiceSelectedMonth=months[months.length-1];
 const values=practiceListValues(months),selectedIndex=months.indexOf(practiceSelectedMonth);
 const minValue=Math.min(...values),maxValue=Math.max(...values);
 const bottom=Math.max(0,Math.floor((minValue-1500)/1000)*1000),top=Math.max(bottom+3000,Math.ceil((maxValue+1500)/1000)*1000);
 const width=Math.max(820,months.length*24+100),height=370,L=65,R=24,T=25,B=62,plotWidth=width-L-R,plotHeight=height-T-B;
 const x=i=>L+(months.length===1?.5:i/(months.length-1))*plotWidth;
 const y=value=>T+(top-value)/(top-bottom)*plotHeight;
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 '+width+' '+height);svg.setAttribute('role','img');svg.setAttribute('aria-label','Monthly registered practice population, editable by dragging points');
 const add=(tag,attrs,parent=svg)=>{const el=document.createElementNS(ns,tag);for(const [key,value]of Object.entries(attrs))el.setAttribute(key,String(value));parent.append(el);return el;};
 for(let i=0;i<=5;i++){const value=bottom+(top-bottom)*i/5,yy=y(value);add('line',{x1:L,x2:width-R,y1:yy,y2:yy,stroke:'#e6edf3'});const text=add('text',{x:L-10,y:yy+4,'text-anchor':'end',fill:'#6c7d8e','font-size':12});text.textContent=Math.round(value).toLocaleString('en-GB');}
 const tickEvery=Math.max(1,Math.ceil(months.length/12));
 months.forEach((month,i)=>{if(i%tickEvery!==0&&i!==months.length-1)return;const label=add('text',{x:x(i),y:height-25,'text-anchor':'middle',fill:'#63798e','font-size':11});label.textContent=new Date(month+'-01T12:00:00Z').toLocaleDateString('en-GB',{month:'short',year:'2-digit',timeZone:'UTC'});});
 add('polyline',{points:values.map((v,i)=>x(i)+','+y(v)).join(' '),fill:'none',stroke:'#177bb8','stroke-width':3,'stroke-linecap':'round','stroke-linejoin':'round'});
 const edit=(i,value)=>{practiceSelectedMonth=months[i];practiceSettings.anchors[months[i]]=Math.max(0,Math.min(1000000,Math.round(value/10)*10));savePracticeSettings();renderPracticeSettings();};
 months.forEach((month,i)=>{
  const circle=add('circle',{cx:x(i),cy:y(values[i]),r:i===selectedIndex?7:4.5,fill:month in practiceSettings.anchors?'#0b639e':'#ffffff',stroke:'#177bb8','stroke-width':i===selectedIndex?3:2,class:'practice-point','data-index':i});
  const title=add('title',{},circle);title.textContent=month+': '+values[i].toLocaleString('en-GB');
  circle.addEventListener('pointerdown',event=>{
   event.preventDefault();practiceSelectedMonth=month;circle.setPointerCapture(event.pointerId);
   const move=e=>{const bounds=svg.getBoundingClientRect();const yy=(e.clientY-bounds.top)*height/bounds.height;const value=top-(yy-T)/plotHeight*(top-bottom);practiceSettings.anchors[month]=Math.max(0,Math.min(1000000,Math.round(value/10)*10));const updated=practiceListValues(months);svg.querySelector('polyline').setAttribute('points',updated.map((v,j)=>x(j)+','+y(v)).join(' '));svg.querySelectorAll('.practice-point').forEach((dot,j)=>dot.setAttribute('cy',y(updated[j])));$('practiceListValue').value=practiceSettings.anchors[month];$('practiceListSelectedMonth').textContent=month;};
   const end=()=>{circle.removeEventListener('pointermove',move);savePracticeSettings();renderPracticeSettings();};
   circle.addEventListener('pointermove',move);circle.addEventListener('pointerup',end,{once:true});circle.addEventListener('pointercancel',end,{once:true});
  });
  circle.addEventListener('click',()=>{practiceSelectedMonth=month;renderPracticeSettings();});
 });
 root.append(svg);
 $('practiceListSelectedMonth').textContent=new Date(practiceSelectedMonth+'-01T12:00:00Z').toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'UTC'});
 $('practiceListValue').value=values[selectedIndex];$('practiceListClear').disabled=!(practiceSelectedMonth in practiceSettings.anchors);
 $('practiceListStatus').textContent='Showing '+months[0]+' to '+months[months.length-1]+' · '+Object.keys(practiceSettings.anchors).length+' manually set months · Saved to practice workspace when connected.';
}
$('practiceNameInput')?.addEventListener('input',e=>{practiceSettings.name=e.target.value;savePracticeSettings();});
$('practiceListValue')?.addEventListener('change',e=>{if(!practiceSelectedMonth)return;const value=Number(e.target.value);if(!Number.isFinite(value)||value<0)return;practiceSettings.anchors[practiceSelectedMonth]=Math.round(value);savePracticeSettings();renderPracticeSettings();});
$('practiceListClear')?.addEventListener('click',()=>{delete practiceSettings.anchors[practiceSelectedMonth];savePracticeSettings();renderPracticeSettings();});
$('practiceListReset')?.addEventListener('click',()=>{if(!confirm('Reset all monthly list size adjustments to 10,000?'))return;practiceSettings.anchors={};savePracticeSettings();renderPracticeSettings();});

const waitingFilterDisabled={consult:new Set(),capacity:new Set(),clinician:new Set()};
// Share classification work across records with the same slot/session holder.
// Each render gets its own resolver, so settings edits never leave stale mappings.
function chartDimensionLookup(resolve){
 const slots=new Map();
 return row=>{
  let clinicians=slots.get(row.slot);if(!clinicians){clinicians=new Map();slots.set(row.slot,clinicians);}
  let people=clinicians.get(row.clinician);if(!people){people=new Map();clinicians.set(row.clinician,people);}
  if(!people.has(row.person))people.set(row.person,resolve(row));return people.get(row.person);
 };
}
const waitingMonthCache=new WeakMap();
function waitingRecordMonths(rows){
 if(!waitingMonthCache.has(rows))waitingMonthCache.set(rows,[...new Set(rows.map(row=>row.appointmentMonth).filter(Boolean))].sort());
 return waitingMonthCache.get(rows);
}
function waitingRowDimensions(r){
 const clinicianType=effectiveClinicianType(r.clinician,r.person);
 return {
  urgency:capacityUrgencyCategory(r.slot),
  consult:consultCategoryNames.includes(consultAssignments[r.slot])?consultAssignments[r.slot]:(suggestConsultMode(r.slot)||''),
  capacity:capacityCategoryNames.includes(capacityAssignments[r.slot])?capacityAssignments[r.slot]:'',
  clinician:clinicianGroupAssignments[clinicianType]||''
 };
}
function setupWaitingAppointmentSlider(){
 const start=$('waitingRangeStart'),end=$('waitingRangeEnd'),fill=$('waitingRangeFill');
 if(!start||!end||!fill)return;
 const reportDate=reportRangeDate();
 const reportMonth=reportDate?Number(reportDate.slice(0,4))*12+Number(reportDate.slice(5,7))-1:null;
 const months=waitingRecordMonths(waitingTimeRecords);
 const first=months[0],last=months.at(-1);
 const toIndex=m=>Number(m.slice(0,4))*12+Number(m.slice(5,7))-1;
 const toMonth=i=>String(Math.floor(i/12)).padStart(4,'0')+'-'+String(i%12+1).padStart(2,'0');
 if(!first){$('waitingRangeFromLabel').textContent='—';$('waitingRangeToLabel').textContent='—';return}
 const limit=reportMonth??toIndex(last);
 const low=Math.min(toIndex(first),limit),high=Math.max(low,Math.min(toIndex(last),limit)),bounds=first+'|'+toMonth(high);
 const [a,b]=monthRangeSelection('waitingRange',low,high);
 waitingAppointmentMonthBounds=bounds;waitingAppointmentMonthStart=toMonth(a);waitingAppointmentMonthEnd=toMonth(b);
 for(const input of [start,end]){input.min=String(low);input.max=String(high);input.step='1';input.disabled=low===high;}
 start.value=String(a);end.value=String(b);
 const label=i=>new Date(Date.UTC(Math.floor(i/12),i%12,1)).toLocaleDateString('en-GB',{month:'short',year:'numeric',timeZone:'UTC'});
 $('waitingRangeFromLabel').textContent='Start of '+label(a);$('waitingRangeToLabel').textContent=reportRangeEndLabel(b);
 const trackWidth=fill.parentElement.clientWidth,thumb=20,sliderLeft=start.getBoundingClientRect().left-fill.parentElement.getBoundingClientRect().left;
 const travel=Math.max(0,start.clientWidth-thumb),span=Math.max(1,high-low);
 const left=sliderLeft+thumb/2+(a-low)/span*travel,right=sliderLeft+thumb/2+(b-low)/span*travel;
 fill.style.left=left+'px';fill.style.right=Math.max(0,trackWidth-right)+'px';
 if(!start.dataset.bound){
  const changed=which=>{
   let x=Number(start.value),y=Number(end.value);
   if(which==='start'&&x>y)y=x;
   if(which==='end'&&y<x)x=y;
   waitingAppointmentMonthStart=toMonth(x);waitingAppointmentMonthEnd=toMonth(y);
   saveMonthRange('waitingRange',waitingAppointmentMonthStart,waitingAppointmentMonthEnd);
   renderWaitingTimesChart();
  };
  start.addEventListener('input',()=>changed('start'));
  end.addEventListener('input',()=>changed('end'));
  start.dataset.bound=end.dataset.bound='1';
 }
}
function setupWaitingTrendSlider(){
 const start=$('waitingTrendRangeStart'),end=$('waitingTrendRangeEnd'),fill=$('waitingTrendRangeFill');
 if(!start||!end||!fill)return;
 const reportDate=reportRangeDate();
 const reportMonth=reportDate?Number(reportDate.slice(0,4))*12+Number(reportDate.slice(5,7))-1:null;
 const months=waitingTrendAvailableMonths;
 const first=months[0],last=months.at(-1);
 const toIndex=m=>Number(m.slice(0,4))*12+Number(m.slice(5,7))-1;
 const toMonth=i=>String(Math.floor(i/12)).padStart(4,'0')+'-'+String(i%12+1).padStart(2,'0');
 if(!first){$('waitingTrendRangeFromLabel').textContent='—';$('waitingTrendRangeToLabel').textContent='—';return}
 const limit=reportMonth??toIndex(last);
 const low=Math.min(toIndex(first),limit),high=Math.max(low,Math.min(toIndex(last),limit)),bounds=first+'|'+toMonth(high);
 const [a,b]=monthRangeSelection('waitingTrendRange',low,high);
 waitingTrendMonthBounds=bounds;waitingTrendMonthStart=toMonth(a);waitingTrendMonthEnd=toMonth(b);
 for(const input of [start,end]){input.min=String(low);input.max=String(high);input.step='1';input.disabled=low===high;}
 start.value=String(a);end.value=String(b);
 const label=i=>new Date(Date.UTC(Math.floor(i/12),i%12,1)).toLocaleDateString('en-GB',{month:'short',year:'numeric',timeZone:'UTC'});
 $('waitingTrendRangeFromLabel').textContent='Start of '+label(a);$('waitingTrendRangeToLabel').textContent=reportRangeEndLabel(b);
 const trackWidth=fill.parentElement.clientWidth,thumb=20,sliderLeft=start.getBoundingClientRect().left-fill.parentElement.getBoundingClientRect().left;
 const travel=Math.max(0,start.clientWidth-thumb),span=Math.max(1,high-low);
 const left=sliderLeft+thumb/2+(a-low)/span*travel,right=sliderLeft+thumb/2+(b-low)/span*travel;
 fill.style.left=left+'px';fill.style.right=Math.max(0,trackWidth-right)+'px';
 if(!start.dataset.bound){
  const changed=which=>{
   let x=Number(start.value),y=Number(end.value);
   if(which==='start'&&x>y)y=x;
   if(which==='end'&&y<x)x=y;
   waitingTrendMonthStart=toMonth(x);waitingTrendMonthEnd=toMonth(y);
   saveMonthRange('waitingTrendRange',waitingTrendMonthStart,waitingTrendMonthEnd);
   renderWaitingTrendChart();
  };
  start.addEventListener('input',()=>changed('start'));
  end.addEventListener('input',()=>changed('end'));
  start.dataset.bound=end.dataset.bound='1';
 }
}
function waitingMatches(r,ignore){
 if(r.status!=='Booked'||excludedSlotTypes.has(r.slot))return false;
 if(waitingAppointmentMonthStart&&r.appointmentMonth<waitingAppointmentMonthStart)return false;
 if(waitingAppointmentMonthEnd&&r.appointmentMonth>waitingAppointmentMonthEnd)return false;
 const d=waitingRowDimensions(r);
 if(!isDashboardToggleOption(d.urgency))return false;
 if(ignore!=='urgency'&&waitingDisabledUrgency.has(d.urgency))return false;
 for(const kind of ['consult','purpose','capacity','clinician']){
  if(ignore!==kind&&waitingFilterDisabled[kind].has(d[kind]))return false;
 }
 return true;
}
function installWaitingCardTooltip(target,total){
 if(!target||typeof target.on!=='function')return;
 target.querySelector('.availability-tooltip-card')?.remove();
 const card=document.createElement('div');card.className='availability-tooltip-card';card.hidden=true;target.append(card);
 if(typeof target.removeAllListeners==='function'){target.removeAllListeners('plotly_hover');target.removeAllListeners('plotly_unhover')}
 target.on('plotly_hover',data=>{
  const point=data.points?.find(p=>Number.isFinite(p.y));if(!point){card.hidden=true;return}
  card.replaceChildren();
  const heading=document.createElement('div');heading.className='availability-tooltip-heading';heading.textContent=point.x+'–'+(Number(point.x)+1)+' days';card.append(heading);
  const line=document.createElement('div');line.className='availability-tooltip-line';
  const dot=document.createElement('span');dot.className='availability-tooltip-dot';dot.style.backgroundColor='#7ea9c5';
  const value=document.createElement('span');value.textContent=Number(point.y).toLocaleString('en-GB')+' appointments ('+(total?(100*point.y/total).toFixed(1):'0.0')+'%)';line.append(dot,value);card.append(line);
  card.hidden=false;
  const rect=target.getBoundingClientRect(),parent=card.offsetParent||target,parentRect=parent.getBoundingClientRect(),event=data.event;
  const clientX=event?.clientX??rect.left+rect.width/2,clientY=event?.clientY??rect.top+rect.height/2;
  const left=Math.max(parentRect.left+8,Math.min(parentRect.right-card.offsetWidth-8,clientX+18));
  const top=clientY+card.offsetHeight+18>parentRect.bottom?clientY-card.offsetHeight-16:clientY+14;
  card.style.left=left-parentRect.left+'px';card.style.top=Math.max(parentRect.top+8,top)-parentRect.top+'px';
 });
 target.on('plotly_unhover',()=>{card.hidden=true});
}
function renderWaitingTimesChart(){
 const chart=$('waitingTimesChart'),root=$('waitingUrgencyToggles');
 if(!chart||!root||$('waitingTimesPage')?.classList.contains('hidden')||!window.Plotly)return;
 setupWaitingAppointmentSlider();
 const kinds=['urgency','consult','capacity','clinician'];
 const optionsByKind=Object.fromEntries(kinds.map(k=>[k,new Set()]));
 const bins=new Map(),bySlot=new Map();
 const rows=[];
 const dimensionsFor=chartDimensionLookup(waitingRowDimensions);
 // Calculate each row's dimensions and selection once, then reuse for all filter counts.
 for(const r of waitingTimeRecords){
  if(!locumMatches(r,'waitingTimesPage'))continue;
  if(r.status!=='Booked'||excludedSlotTypes.has(r.slot))continue;
  if(waitingAppointmentMonthStart&&r.appointmentMonth<waitingAppointmentMonthStart)continue;
  if(waitingAppointmentMonthEnd&&r.appointmentMonth>waitingAppointmentMonthEnd)continue;
  const d=dimensionsFor(r);
  if(!isDashboardToggleOption(d.urgency)||!groupUrgencyNames.includes(d.urgency))continue;
  optionsByKind.urgency.add(d.urgency);
  const enabled={
   urgency:!waitingDisabledUrgency.has(d.urgency),
   consult:!waitingFilterDisabled.consult.has(d.consult),
   capacity:!waitingFilterDisabled.capacity.has(d.capacity),
   clinician:!waitingFilterDisabled.clinician.has(d.clinician)
  };
  const off=kinds.filter(k=>!enabled[k]);
  for(const kind of kinds)if(off.length===0||(off.length===1&&off[0]===kind))optionsByKind[kind].add(d[kind]);
  if(off.length)continue;
  bins.set(r.day,(bins.get(r.day)||0)+r.count);
  let item=bySlot.get(r.slot);
  if(!item){item={total:0,day0:0};bySlot.set(r.slot,item)}
  item.total+=r.count;if(r.day===0)item.day0+=r.count;
 }
 const makeToggle=(container,name,checked,colour,onChange)=>{
  const row=document.createElement('label');row.className='filter-row';
  const sw=document.createElement('span');sw.className='switch';
  const input=document.createElement('input');input.type='checkbox';input.setAttribute('role','switch');input.checked=checked;input.dataset.filterName=name;
  const track=document.createElement('span');track.className='switch-track';track.style.setProperty('--switch-on',colour);
  sw.append(input,track);const title=document.createElement('span');title.textContent=name;row.append(sw,title);container.append(row);
  input.addEventListener('change',()=>{onChange(input.checked);renderWaitingTimesChart()});
 };
 root.replaceChildren();
 for(const name of groupUrgencyNames.filter(n=>isDashboardToggleOption(n)&&(!optionsByKind.urgency.size||optionsByKind.urgency.has(n))))
  makeToggle(root,name,!waitingDisabledUrgency.has(name),urgencyGroupColour(name),checked=>{if(checked)waitingDisabledUrgency.delete(name);else waitingDisabledUrgency.add(name)});
 const dimensions=[['consult','waitingConsultToggles',consultCategoryNames,consultModeColours],['capacity','waitingCapacityToggles',capacityCategoryNames,capacityColours],['clinician','waitingClinicianToggles',clinicianGroupNames,clinicianGroupColours]];
 for(const [kind,id,allNames,colours] of dimensions){
  const container=$(id);if(!container)continue;
  const options=allNames.filter(n=>isDashboardToggleOption(n)&&optionsByKind[kind].has(n));
  container.replaceChildren();
  for(const name of options)makeToggle(container,name,!waitingFilterDisabled[kind].has(name),kind==='clinician'?clinicianGroupColour(name):typeColour(name,colours),checked=>{if(checked)waitingFilterDisabled[kind].delete(name);else waitingFilterDisabled[kind].add(name)});
  const panel=container.closest('section');if(panel)panel.hidden=!options.length;
 }
 updateCollapsedFilterSummaries();
 const breakdown=$('waitingSlotBreakdown');
 if(breakdown){
  const sorted=[...bySlot].sort((a,b)=>b[1].day0-a[1].day0||b[1].total-a[1].total);
  breakdown.replaceChildren();
  if(!sorted.length)breakdown.textContent='No matching booked appointments with valid waiting times.';
  else{
   const table=document.createElement('table');table.className='waiting-diagnostic-table';
   const thead=document.createElement('thead'),heading=document.createElement('tr');
   for(const label of ['Slot type','Appointments','Day 0 (0–<24h)','Day 0 %']){const th=document.createElement('th');th.textContent=label;heading.append(th)}
   thead.append(heading);table.append(thead);
   const tbody=document.createElement('tbody');
   const addRow=(name,total,day0,isTotal=false)=>{
    const tr=document.createElement('tr');if(isTotal)tr.className='waiting-diagnostic-total';
    for(const value of [name,total.toLocaleString('en-GB'),day0.toLocaleString('en-GB'),(total?100*day0/total:0).toFixed(1)+'%']){const td=document.createElement('td');td.textContent=value;tr.append(td)}
    tbody.append(tr);
   };
   addRow('All selected slot types',sorted.reduce((n,[,v])=>n+v.total,0),sorted.reduce((n,[,v])=>n+v.day0,0),true);
   for(const [name,v] of sorted)addRow(name,v.total,v.day0);
   table.append(tbody);breakdown.append(table);
  }
 }
 const days=[...bins.keys()].sort((a,b)=>a-b),max=days.at(-1)??0;
 // Plot only populated days; a bar still occupies one day on the continuous axis.
 const total=[...bins.values()].reduce((sum,n)=>sum+n,0);
 const suppress=$('waitingSuppressSmallBins')?.checked??true;
 const cutoff=total*0.0035;
 const visibleDays=suppress?days.filter(day=>bins.get(day)>=cutoff):days;
 const x=visibleDays,y=visibleDays.map(day=>bins.get(day));
 const note=$('waitingTimesNote');if(note)note.textContent=days.length?'Each bar represents one complete 24-hour waiting-time interval (minutes ÷ 1,440).'+(suppress?' Bins below 0.35% of '+total.toLocaleString('en-GB')+' appointments are hidden ('+(days.length-visibleDays.length)+' bins).':' All non-empty bins are shown.'):'No waiting-time records for the selected filters.';
 renderPreferencePlot(chart,[{type:'bar',x,y,width:0.94,hoverinfo:'none',marker:{color:'#7ea9c5'},text:y.map(n=>total?(100*n/total).toFixed(1)+'%':'0%'),textposition:'outside',textfont:{size:10,color:'#47687f'},cliponaxis:false,hovertemplate:'%{x}–%{customdata} days<br>%{y:,} appointments<br>%{text} of total<extra></extra>',customdata:x.map(v=>v+1)}],{
  height:560,autosize:true,margin:{l:75,r:25,t:55,b:75},paper_bgcolor:'#fff',plot_bgcolor:'#fff',bargap:0.04,
  xaxis:{title:'Waiting time (days)',dtick:max<=35?1:undefined,gridcolor:'#edf1f5',rangemode:'tozero'},
  yaxis:{title:'Number of appointments',rangemode:'tozero',gridcolor:'#edf1f5'},showlegend:false
 },{responsive:true,displayModeBar:false}).then(()=>installWaitingCardTooltip(chart,total));
}
$('waitingSuppressSmallBins')?.addEventListener('change',renderWaitingTimesChart);
$('waitingTrendSuppressSmall')?.addEventListener('change',renderWaitingTrendChart);
$('waitingTrendIgnoreRoutineSameDay')?.addEventListener('change',renderWaitingTrendChart);
function installTrendCardTooltip(target,useHours){
 if(!target||typeof target.on!=='function')return;
 target.querySelector('.availability-tooltip-card')?.remove();
 const card=document.createElement('div');card.className='availability-tooltip-card';card.hidden=true;target.append(card);
 if(typeof target.removeAllListeners==='function'){target.removeAllListeners('plotly_hover');target.removeAllListeners('plotly_unhover')}
 target.on('plotly_hover',data=>{
  const point=data.points?.find(p=>Number.isFinite(p.y));if(!point){card.hidden=true;return}
  const month=new Date(String(point.x).slice(0,10)+'T12:00:00Z');
  const heading=document.createElement('div');heading.className='availability-tooltip-heading';heading.textContent=month.toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'UTC'});
  const line=document.createElement('div');line.className='availability-tooltip-line';
  const dot=document.createElement('span');dot.className='availability-tooltip-dot';dot.style.backgroundColor=point.data.line?.color||'#638fac';
  const value=document.createElement('span');value.textContent=point.data.name+': '+Number(point.y).toFixed(1)+' '+(useHours?'hours':'days');
  line.append(dot,value);card.replaceChildren(heading,line);card.hidden=false;
  const parent=card.offsetParent||target,rect=parent.getBoundingClientRect(),event=data.event;
  const x=event?.clientX??rect.left+rect.width/2,y=event?.clientY??rect.top+rect.height/2;
  card.style.left=Math.max(8,Math.min(rect.width-card.offsetWidth-8,x-rect.left+18))+'px';
  card.style.top=Math.max(8,(y+card.offsetHeight+18>rect.bottom?y-card.offsetHeight-16:y+14)-rect.top)+'px';
 });
 target.on('plotly_unhover',()=>{card.hidden=true});
}
function waitingTrendMonthAxis(first,last,width){
 const axis={type:'date',title:'Appointment month',gridcolor:'#edf1f5',tickformat:'%b %Y',hoverformat:'%b %Y',automargin:true};
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(first)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(last)||first>last)return axis;
 const start=new Date(first+'-01T00:00:00Z'),end=new Date(last+'-01T00:00:00Z');
 const months=(end.getUTCFullYear()-start.getUTCFullYear())*12+end.getUTCMonth()-start.getUTCMonth()+1;
 const labelSlots=Math.max(2,Math.floor((width-100)/76));
 const step=[1,2,3,4,6,12,24].find(n=>Math.ceil(months/n)<=labelSlots)||Math.ceil(months/labelSlots);
 const tick0=first+'-01';
 start.setUTCDate(start.getUTCDate()-12);
 end.setUTCDate(end.getUTCDate()+12);
 return {...axis,tick0,dtick:'M'+step,range:[start.toISOString(),end.toISOString()]};
}
function renderWaitingTrendChart(){
 const chart=$('waitingTrendChart'),root=$('waitingTrendUrgencyToggles');
 if(!chart||!root||$('waitingOverTimePage')?.classList.contains('hidden')||!window.Plotly)return;
 setupWaitingTrendSlider();
 const kinds=['urgency','consult','capacity','clinician'];
 const optionsByKind=Object.fromEntries(kinds.map(k=>[k,new Set()]));
 const byGroup=new Map();
 const suppressSmall=$('waitingTrendSuppressSmall')?.checked??true;
 const ignoreRoutineSameDay=$('waitingTrendIgnoreRoutineSameDay')?.checked??true;
 const eligibleCounts=new Map();
 const dimensionsFor=chartDimensionLookup(waitingRowDimensions);
 for(const r of waitingTrendRecords){
  if(!locumMatches(r,'waitingOverTimePage'))continue;
  if(r.status!=='Booked'||excludedSlotTypes.has(r.slot)||!r.appointmentDate||!Number.isFinite(r.leadMinutes))continue;
  if(waitingTrendMonthStart&&r.appointmentMonth<waitingTrendMonthStart)continue;
  if(waitingTrendMonthEnd&&r.appointmentMonth>waitingTrendMonthEnd)continue;
  const d=dimensionsFor(r);
  if(!isDashboardToggleOption(d.urgency)||!groupUrgencyNames.includes(d.urgency))continue;
  optionsByKind.urgency.add(d.urgency);
  const enabled={urgency:!waitingTrendDisabledUrgency.has(d.urgency)};
  for(const kind of kinds.slice(1))enabled[kind]=!waitingTrendDisabled[kind].has(d[kind]);
  const off=kinds.filter(k=>!enabled[k]);
  for(const kind of kinds)if(!off.length||(off.length===1&&off[0]===kind))optionsByKind[kind].add(d[kind]);
  if(off.length)continue;
  if(ignoreRoutineSameDay&&/^routine$/i.test(d.urgency)&&r.leadMinutes<1440)continue;
  const month=r.appointmentMonth,key=d.urgency+'|'+month;
  eligibleCounts.set(d.urgency,(eligibleCounts.get(d.urgency)||0)+r.count);
  if(!byGroup.has(key))byGroup.set(key,{urgency:d.urgency,month,count:0,values:[]});
  const bucket=byGroup.get(key);bucket.count+=r.count;bucket.values.push([r.leadMinutes/1440,r.count]);
 }
 const toggle=(container,name,checked,colour,change)=>{
  const row=document.createElement('label');row.className='filter-row';
  const sw=document.createElement('span');sw.className='switch';const input=document.createElement('input');input.type='checkbox';input.setAttribute('role','switch');input.dataset.filterName=name;input.checked=checked;
  const track=document.createElement('span');track.className='switch-track';track.style.setProperty('--switch-on',colour);sw.append(input,track);
  const label=document.createElement('span');label.textContent=name;row.append(sw,label);container.append(row);
  input.addEventListener('change',()=>{change(input.checked);renderWaitingTrendChart()});
 };
 root.replaceChildren();
 for(const name of groupUrgencyNames.filter(n=>isDashboardToggleOption(n)&&(!optionsByKind.urgency.size||optionsByKind.urgency.has(n))))
  toggle(root,name,!waitingTrendDisabledUrgency.has(name),urgencyGroupColour(name),on=>{if(on)waitingTrendDisabledUrgency.delete(name);else waitingTrendDisabledUrgency.add(name)});
 const dimensions=[['consult','waitingTrendConsultToggles',consultCategoryNames,consultModeColours],['capacity','waitingTrendCapacityToggles',capacityCategoryNames,capacityColours],['clinician','waitingTrendClinicianToggles',clinicianGroupNames,clinicianGroupColours]];
 for(const [kind,id,names,colours] of dimensions){
  const container=$(id);if(!container)continue;container.replaceChildren();
  const options=names.filter(n=>isDashboardToggleOption(n)&&optionsByKind[kind].has(n));
  for(const name of options)toggle(container,name,!waitingTrendDisabled[kind].has(name),kind==='clinician'?clinicianGroupColour(name):typeColour(name,colours),on=>{if(on)waitingTrendDisabled[kind].delete(name);else waitingTrendDisabled[kind].add(name)});
  const panel=container.closest('section');if(panel)panel.hidden=!options.length;
 }
 updateCollapsedFilterSummaries();
 const median=values=>{
  // Trend records are sorted by leadMinutes at load time, so buckets are already ordered.
  const n=values.reduce((sum,p)=>sum+p[1],0);
  if(!n)return null;
  const at=rank=>{let seen=0;for(const [v,count] of values){seen+=count;if(seen>=rank)return v}return values.at(-1)[0]};
  return (at(Math.floor((n+1)/2))+at(Math.floor((n+2)/2)))/2;
 };
 const traces=[];
 let highestMedian=0;
 let suppressedCount=0;
 for(const group of groupUrgencyNames){
  if(waitingTrendDisabledUrgency.has(group))continue;
  const points=[...byGroup.values()].filter(v=>v.urgency===group).sort((a,b)=>a.month.localeCompare(b.month));
  const total=eligibleCounts.get(group)||0;
  const shown=points.filter(v=>!suppressSmall||v.count>=total*0.0035);
  suppressedCount+=points.length-shown.length;
  if(!shown.length)continue;
  const medians=shown.map(v=>median(v.values));
  highestMedian=Math.max(highestMedian,...medians);
  traces.push({type:'scatter',mode:'lines+markers',name:group,x:shown.map(v=>v.month+'-01'),y:medians,line:{color:urgencyGroupColour(group),width:2.5,shape:'spline',smoothing:0.65},marker:{size:5},connectgaps:false,hovertemplate:'%{x|%b %Y}<br>'+group+': %{y:.1f} days<extra></extra>'});
 }
 const useHours=highestMedian>0&&highestMedian*1.12<2;
 if(useHours)for(const trace of traces){trace.y=trace.y.map(v=>v*24);trace.hovertemplate=trace.hovertemplate.replace(' days',' hours');}
 const note=$('waitingTrendNote');if(note)note.textContent='Monthly median of booked-to-slot waiting times (days).'+(suppressSmall?' Months below 0.35% of the selected Appointment Types total are hidden ('+suppressedCount+' points).':'')+(ignoreRoutineSameDay?' Routine appointments booked less than one day ahead are excluded.':'');
 renderPreferencePlot(chart,traces,{height:560,autosize:true,margin:{l:72,r:25,t:40,b:75},paper_bgcolor:'#fff',plot_bgcolor:'#fff',hovermode:'x unified',hoverlabel:{bgcolor:'#fff',bordercolor:'#dce6ef',font:{color:'#142d43',size:12},align:'left'},xaxis:waitingTrendMonthAxis(waitingTrendMonthStart,waitingTrendMonthEnd,chart.clientWidth||600),yaxis:{title:{text:useHours?'Hours':'Days',standoff:12},rangemode:'tozero',gridcolor:'#edf1f5'},legend:{orientation:'h',y:1.13,x:0}},{responsive:true,displayModeBar:false},false).then(()=>installTrendCardTooltip(chart,useHours));
}

// Day View uses appointment-date availability snapshots and Monday–Friday navigation.

let dayView2Tooltip=null;
function hideDayView2Tooltip(){if(dayView2Tooltip)dayView2Tooltip.hidden=true;}
function positionDayView2Tooltip(event,anchor){
 const card=dayView2Tooltip;if(!card||card.hidden)return;
 const bounds=anchor.getBoundingClientRect();
 const x=event?.clientX??bounds.left+bounds.width/2,y=event?.clientY??bounds.top;
 card.style.left=Math.max(12,Math.min(window.innerWidth-card.offsetWidth-12,x+16))+'px';
 const top=y+card.offsetHeight+16>window.innerHeight?y-card.offsetHeight-14:y+14;
 card.style.top=Math.max(12,Math.min(window.innerHeight-card.offsetHeight-12,top))+'px';
}
function installDayView2GroupTooltip(group,{name,date,counts,colour}){
 const show=(event,anchor=group)=>{
  if(!dayView2Tooltip){dayView2Tooltip=document.createElement('div');dayView2Tooltip.className='availability-tooltip-card day-view2-tooltip';dayView2Tooltip.id='dayView2Tooltip';dayView2Tooltip.setAttribute('role','tooltip');document.body.append(dayView2Tooltip);}
  const card=dayView2Tooltip;card.replaceChildren();
  const heading=document.createElement('div');heading.className='availability-tooltip-heading';heading.textContent=name;
  const day=document.createElement('div');day.className='availability-tooltip-line day-view2-tooltip-date';day.textContent=date;
  card.append(heading,day);
  const statuses=[['missedEmpty','Missed Empty','stripe'],['booked','Booked',colour],['available','Available','#ffffff'],['embargoed','Embargoed','#586674'],['blocked','Blocked','#354454']];
  let total=0;
  for(const [status,label,fill] of statuses){
   const count=Number(counts[status])||0;total+=count;
   const row=document.createElement('div');row.className='availability-tooltip-line';
   const dot=document.createElement('span');dot.className='availability-tooltip-dot';if(status==='missedEmpty')dot.style.background='repeating-linear-gradient(135deg,#fff 0px,#fff 5px,'+colour+' 5px,'+colour+' 6px)';else dot.style.backgroundColor=fill;
   const caption=document.createElement('span');caption.className='day-view2-tooltip-label';caption.textContent=label;
   const value=document.createElement('strong');value.textContent=count.toLocaleString('en-GB');
   row.append(dot,caption,value);card.append(row);
  }
  const row=document.createElement('div');row.className='availability-tooltip-line availability-tooltip-total';
  const caption=document.createElement('span');caption.className='day-view2-tooltip-label';caption.textContent='Total';
  const value=document.createElement('strong');value.textContent=total.toLocaleString('en-GB');row.append(caption,value);card.append(row);
  anchor.setAttribute('aria-describedby',card.id);card.hidden=false;positionDayView2Tooltip(event,anchor);
 };
 group.addEventListener('pointerenter',event=>{if(event.pointerType!=='touch')show(event);});
 group.addEventListener('pointermove',event=>positionDayView2Tooltip(event,group));
 group.addEventListener('pointerleave',hideDayView2Tooltip);
 group.addEventListener('focusin',event=>show(null,event.target));
 group.addEventListener('focusout',event=>{if(!group.contains(event.relatedTarget))hideDayView2Tooltip();});
 group.addEventListener('click',event=>show(event,event.target));
}
document.addEventListener('pointerdown',event=>{if(!event.target.closest('.day-view2-urgency-span'))hideDayView2Tooltip();});
document.addEventListener('scroll',hideDayView2Tooltip,true);
window.addEventListener('resize',hideDayView2Tooltip);
document.addEventListener('keydown',event=>{if((event.key?.startsWith(iqStorageScope)?event.key.slice(iqStorageScope.length):null)==='Escape')hideDayView2Tooltip();});

const dayView2DisabledUrgencies=new Set();
let dayView2PreferencesAccount=null;
function syncDayView2Preferences(){
 const account=chartPreferenceAccount();if(account===dayView2PreferencesAccount)return;
 dayView2PreferencesAccount=account;dayView2DisabledUrgencies.clear();
 if(!account)return;
 const date=readChartPreferences()['dayView2:selectedDate'];
 $('dayView2Date').value=typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)?date:'';
 const saved=readChartPreferences()['dayView2:disabledUrgencies'];
 if(Array.isArray(saved))for(const name of saved)if(typeof name==='string')dayView2DisabledUrgencies.add(name);
}
function chooseDayView2Date(date){
 $('dayView2Date').value=date;writeChartPreference('dayView2:selectedDate',date);
 writeChartPreference('month:dayView2Page:dayView2CalendarMonth',date.slice(0,7));
 closeDayView2Calendar();renderDayView2();
}
function saveDayView2Preferences(){writeChartPreference('dayView2:disabledUrgencies',[...dayView2DisabledUrgencies]);}
let dayView2SegmentObserver=null;
function layoutDayView2SegmentCounts(root){
 for(const segment of root.querySelectorAll('.day-view2-segment')){const text=segment.dataset.count||'';segment.textContent=segment.clientWidth>=text.length*8+12?text:'';}
 for(const rail of root.querySelectorAll('.day-view2-pace-rail'))layoutDayView2PaceRail(rail);
}
function isDayView2SlotReportRecord(row){
 return row.source!=='signposting'&&row.clinician!=='Signposting (no clinician recorded)';
}
function dayView2LondonClock(value=new Date()){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(value).map(part=>[part.type,part.value]));
 return {date:p.year+'-'+p.month+'-'+p.day,minute:Number(p.hour)*60+Number(p.minute)+Number(p.second)/60};
}
// Missed slots are measured against the imported report snapshot, never the live clock.
function capacitySnapshotClock(){
 return Number.isFinite(capacityCSVLatestModified)?dayView2LondonClock(new Date(capacityCSVLatestModified)):null;
}
function isMissedAvailableSlot(row,clock=capacitySnapshotClock()){
 return !!clock&&(row.date<clock.date||(row.date===clock.date&&Number.isFinite(row.minute)&&row.minute<clock.minute));
}
function dayView2Time(minute){
 const value=Math.floor(minute),hour=Math.floor(value/60)%24;
 return (hour%12||12)+':'+String(value%60).padStart(2,'0')+(hour>=12?'pm':'am');
}

function dayView2RefreshAge(timestamp,now=Date.now()){
 if(timestamp===null||!Number.isFinite(timestamp))return 'Data refreshed: timestamp unavailable';
 const minutes=Math.floor(Math.max(0,now-timestamp)/60000);
 if(minutes===0)return 'Data refreshed just now';
 if(minutes<60)return 'Data refreshed '+minutes+' minute'+(minutes===1?'':'s')+' ago';
 const hours=Math.floor(minutes/60);
 if(minutes<240)return 'Data refreshed '+hours+' hour'+(hours===1?'':'s')+' '+(minutes%60)+' minute'+(minutes%60===1?'':'s')+' ago';
 if(hours<24)return 'Data refreshed '+hours+' hour'+(hours===1?'':'s')+' ago';
 const days=Math.floor(hours/24);return 'Data refreshed '+days+' day'+(days===1?'':'s')+' ago';
}
function updateDayView2RefreshAge(){
 const label=$('dayView2Refreshed');if(!label)return;
 label.textContent=dayView2RefreshAge(capacityCSVLatestModified);
 label.title=capacityCSVLatestModified===null?'No imported Slot Report timestamp is available.':'Latest imported Slot Report: '+new Date(capacityCSVLatestModified).toLocaleString('en-GB',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true,timeZone:'Europe/London'});
}
function dayView2UrgencyOrder(name){
 const key=name.toLowerCase().replace(/[^a-z0-9]/g,'');
 if(key==='sameday')return 0;
 if(key==='within3days'||key==='withinthreedays')return 1;
 if(key.includes('urgent')&&key.includes('extra'))return 3;
 return 2;
}
function dayView2LocalDate(){
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const p=Object.fromEntries(parts.map(part=>[part.type,part.value]));
 return p.year+'-'+p.month+'-'+p.day;
}
function dayView2AddDays(date,days){
 const value=new Date(date+'T12:00:00Z');value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10);
}

function dayView2IsWorkingDay(date){
 const day=new Date(date+'T12:00:00Z').getUTCDay();return day>=1&&day<=5;
}
function dayView2WorkingDate(date){
 while(!dayView2IsWorkingDay(date))date=dayView2AddDays(date,1);return date;
}
function dayView2AddWorkingDays(date,days){
 if(!days)return dayView2WorkingDate(date);
 const step=days<0?-1:1;
 for(let count=0;count<Math.abs(days);){date=dayView2AddDays(date,step);if(dayView2IsWorkingDay(date))count++;}
 return date;
}
function dayView2DateLabel(date){
 const d=new Date(date+'T12:00:00Z'),day=d.getUTCDate(),lastTwo=day%100;
 const suffix=lastTwo>=11&&lastTwo<=13?'th':({1:'st',2:'nd',3:'rd'}[day%10]||'th');
 return d.toLocaleDateString('en-GB',{weekday:'long',timeZone:'UTC'})+' '+day+suffix+' '+d.toLocaleDateString('en-GB',{month:'long',timeZone:'UTC'});
}
function closeDayView2Calendar(){
 const calendar=$('dayView2Calendar');if(calendar)calendar.hidden=true;
 $('dayView2DatePicker')?.setAttribute('aria-expanded','false');
}
function renderDayView2Calendar(){
 const month=$('dayView2CalendarMonth'),grid=$('dayView2CalendarDays');
 if(!month||!grid)return;
 if(!/^\d{4}-\d{2}$/.test(month.value))month.value=($('dayView2Date').value||dayView2WorkingDate(dayView2LocalDate())).slice(0,7);
 const [year,m]=month.value.split('-').map(Number),first=new Date(Date.UTC(year,m-1,1,12)),padding=(first.getUTCDay()+6)%7,last=new Date(Date.UTC(year,m,0,12)).getUTCDate();
 grid.replaceChildren();
 for(let i=0;i<padding;i++){const blank=document.createElement('span');blank.setAttribute('aria-hidden','true');grid.append(blank);}
 for(let day=1;day<=last;day++){
  const date=month.value+'-'+String(day).padStart(2,'0'),button=document.createElement('button');
  button.type='button';button.textContent=String(day);button.disabled=!dayView2IsWorkingDay(date);
  button.setAttribute('aria-label',dayView2DateLabel(date)+(button.disabled?' · weekend unavailable':''));
  button.setAttribute('aria-pressed',String(date===$('dayView2Date').value));
  button.dataset.date=date;
  button.addEventListener('click',()=>{chooseDayView2Date(date);$('dayView2DatePicker').focus();});
  grid.append(button);
 }
}
$('dayView2DatePicker')?.addEventListener('click',()=>{
 const calendar=$('dayView2Calendar'),open=calendar.hidden;
 calendar.hidden=!open;$('dayView2DatePicker').setAttribute('aria-expanded',String(open));
 if(open){
  const month=$('dayView2CalendarMonth');
  month.value=readChartPreferences()['month:dayView2Page:dayView2CalendarMonth']||($('dayView2Date').value||dayView2WorkingDate(dayView2LocalDate())).slice(0,7);
  renderDayView2Calendar();
 }
});
$('dayView2CalendarMonth')?.addEventListener('change',renderDayView2Calendar);
for(const [id,step] of [['dayView2CalendarPrevious',-1],['dayView2CalendarNext',1]]){
 $(id)?.addEventListener('click',()=>{
  const input=$('dayView2CalendarMonth'),d=new Date(input.value+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+step);input.value=d.toISOString().slice(0,7);input.dispatchEvent(new Event('change',{bubbles:true}));
 });
}
document.addEventListener('click',event=>{if(!event.target.closest('#dayView2DateControls'))closeDayView2Calendar();});
document.addEventListener('keydown',event=>{if((event.key?.startsWith(iqStorageScope)?event.key.slice(iqStorageScope.length):null)==='Escape'&&!$('dayView2Calendar')?.hidden){closeDayView2Calendar();$('dayView2DatePicker')?.focus();}});

// Source arrays are replaced on import; WeakMap indexes cannot serve stale rows.
const dayView2DateIndexes=new WeakMap();
function dayView2RowsForDates(rows,dates){
 let index=dayView2DateIndexes.get(rows);
 if(!index){index=new Map();for(const row of rows){if(!index.has(row.date))index.set(row.date,[]);index.get(row.date).push(row);}dayView2DateIndexes.set(rows,index);}
 const selected=[];for(const date of dates)for(const row of index.get(date)||[])selected.push(row);return selected;
}
function collectDayView2Capacity(date,names,disabled,rows,clock=capacitySnapshotClock()){
 date=dayView2WorkingDate(date);
 const statuses=['missedEmpty','booked','available','embargoed','blocked'];
 const empty=()=>({missedEmpty:0,booked:0,available:0,embargoed:0,blocked:0});
 const active=names.filter(name=>!disabled.has(name));
 const days=new Map(Array.from({length:8},(_,i)=>[dayView2AddWorkingDays(date,i),{groups:new Map(active.map(name=>[name,empty()])),totals:empty(),unknown:0,matched:0}]));
 for(const r of dayView2RowsForDates(rows,days.keys())){
  const day=days.get(r.date);
  if(!day||excludedSlotTypes.has(r.slot)||!locumMatches(r,'dayView2Page'))continue;
  const group=day.groups.get(capacityUrgencyCategory(r.slot));
  if(!group)continue;
  const count=Number(r.count);
  if(!Number.isFinite(count)||count<=0)continue;
  day.matched+=count;
  let status=String(r.availability||'').trim().toLowerCase();
  if(status==='available'&&isMissedAvailableSlot(r,clock))status='missedEmpty';
  if(!statuses.includes(status)){day.unknown+=count;continue;}
  group[status]+=count;day.totals[status]+=count;
 }
 return days;
}

// Compare appointments scheduled for today with prior matching weekdays at the
// same report-clock time. Do not treat missing reports/timestamps as zero demand.
function calculateDayView2PaceBaseline({date,minute,remainingMinute=minute,names,availability,bookings,excluded,groupForSlot,holidays}){
 const target=new Date(date+'T12:00:00Z'),year=target.getUTCFullYear()-1,month=target.getUTCMonth();
 const start=new Date(Date.UTC(year,month,Math.min(target.getUTCDate(),new Date(Date.UTC(year,month+1,0)).getUTCDate()),12)).toISOString().slice(0,10);
 const weekStart=day=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10);};
 const holidayWeeks=new Set([...holidays].map(weekStart));
 const active=new Set(names),candidates=new Map();
 // Every matching weekday in the previous calendar year; no 12-sample cap.
 for(let day=dayView2AddDays(date,-7);day>=start;day=dayView2AddDays(day,-7)){
  if(!holidayWeeks.has(weekStart(day)))candidates.set(day,{date:day,total:0,booked:0,timed:0,byTime:0,later:0});
 }
 for(const row of availability){
  const day=candidates.get(row.date);
  if(!day||!isDayView2SlotReportRecord(row)||excluded.has(row.slot)||!active.has(groupForSlot(row.slot)))continue;
  const status=String(row.availability||'').trim().toLowerCase(),count=Number(row.count);
  if(!['booked','available','embargoed','blocked'].includes(status)||!Number.isFinite(count)||count<=0)continue;
  day.total+=count;if(status==='booked')day.booked+=count;
 }
 for(const row of bookings){
  const day=candidates.get(row.date);
  if(!day||!isDayView2SlotReportRecord(row)||excluded.has(row.slot)||!active.has(groupForSlot(row.slot)))continue;
  const count=Number(row.count),clock=Number(row.bookedMinute);
  if(!Number.isFinite(count)||count<=0||row.bookedMinute==null||!Number.isFinite(clock)||clock<0||clock>=1440||!/^\d{4}-\d{2}-\d{2}$/.test(row.bookedDay||''))continue;
  // Late-entered bookings are known timestamps, but did not exist by the
  // comparison clock on the appointment date. They are not missing history.
  day.timed+=count;
  if(row.bookedDay<row.date||(row.bookedDay===row.date&&clock<=minute))day.byTime+=count;
  if(row.bookedDay===row.date&&clock>remainingMinute)day.later+=count;
 }
 const reported=[...candidates.values()].filter(day=>day.total>0);
 const samples=reported.filter(day=>day.booked===0?day.timed===0:day.timed>=day.booked*.9&&day.timed<=day.booked+0.0001).map(day=>{
  const estimated=day.booked>day.timed+0.0001;
  // Small timestamp gaps should not discard an otherwise usable report.
  // Scale only high-coverage days; never assume a missing report is zero.
  return {...day,estimated,byTime:estimated?Math.min(day.booked,day.byTime*day.booked/day.timed):day.byTime,remaining:estimated?day.later*day.booked/day.timed:day.later};
 });
 const diagnostics={samples,start,reportedDays:reported.length,incompleteDays:reported.length-samples.length,estimatedDays:samples.filter(day=>day.estimated).length,holidayWeeksExcluded:holidayWeeks.size};
 if(samples.length<6)return {ready:false,...diagnostics};
 const values=samples.map(day=>day.byTime).sort((a,b)=>a-b),mean=values.reduce((a,b)=>a+b,0)/values.length;
 const quantile=p=>{const position=(values.length-1)*p,low=Math.floor(position),high=Math.ceil(position);return values[low]+(values[high]-values[low])*(position-low);};
 const tolerance=Math.max(2,mean*.05);
 return {ready:true,...diagnostics,mean,low:Math.max(0,Math.min(quantile(.15),mean-tolerance)),high:Math.max(quantile(.85),mean+tolerance)};
}
// The historical 15th–85th percentile band remains the normal range.
const DAY_VIEW2_PACE_RATINGS=[
 {label:'Much lower than usual',color:'#244A92',text:'#FFFFFF'},
 {label:'Well below the normal range',color:'#3769AF',text:'#FFFFFF'},
 {label:'Lower than normal',color:'#518CC5',text:'#FFFFFF'},
 {label:'Just below the normal range',color:'#77B2D4',text:'#17334C'},
 {label:'At the lower end of the normal range',color:'#9BCED1',text:'#17334C'},
 {label:'A little below average',color:'#B6DDD0',text:'#17334C'},
 {label:'About average',color:'#B9D9B2',text:'#17334C'},
 {label:'A little above average',color:'#D8DEA0',text:'#17334C'},
 {label:'At the upper end of the normal range',color:'#E9D27E',text:'#17334C'},
 {label:'Just above the normal range',color:'#F2B65F',text:'#17334C'},
 {label:'Higher than normal',color:'#EC9250',text:'#17334C'},
 {label:'Well above the normal range',color:'#DE6848',text:'#FFFFFF'},
 {label:'Much higher than usual',color:'#BE3F45',text:'#FFFFFF'}
];
function dayView2PaceClassification(actual,baseline){
 if(!baseline?.ready||!Number.isFinite(actual)||!Number.isFinite(baseline.mean)||!Number.isFinite(baseline.low)||!Number.isFinite(baseline.high))return null;
 const mean=baseline.mean,low=baseline.low,high=baseline.high;
 const margin=Math.max(5,mean*.15,mean-low,high-mean);
 const halfMargin=margin/2;
 if(actual<low){
  const distance=low-actual;
  return distance>=margin*2?0:distance>=margin?1:distance>=halfMargin?2:3;
 }
 if(actual>high){
  const distance=actual-high;
  return distance>=margin*2?12:distance>=margin?11:distance>=halfMargin?10:9;
 }
 // Within the normal range, split either side of the historical mean into
 // a lower/upper end, a little below/above average, and about average.
 if(actual<mean){
  const span=Math.max(0,mean-low);
  const fraction=span>0?(actual-low)/span:1;
  return fraction<1/3?4:fraction<2/3?5:6;
 }
 if(actual>mean){
  const span=Math.max(0,high-mean);
  const fraction=span>0?(actual-mean)/span:0;
  return fraction>2/3?8:fraction>1/3?7:6;
 }
 return 6;
}
function layoutDayView2PaceRail(rail){
 const width=rail.clientWidth;if(!width)return;
 for(const label of rail.querySelectorAll('.day-view2-pace-rail-label')){
  const half=label.getBoundingClientRect().width/2;
  label.style.left=Math.max(half,Math.min(width-half,width*Number(label.dataset.position)/100))+'px';
 }
}
function createDayView2PaceRail(actual,baseline,total,clock){
 const wrapper=document.createElement('div');wrapper.className='day-view2-pace-rail-wrap';
 const lower=Math.ceil(baseline.low),upper=Math.floor(baseline.high),typical=Math.round(baseline.mean);
 const max=Math.max(1,total,actual,Math.ceil(baseline.high),typical),percent=value=>100*value/max;
 const rail=document.createElement('div');rail.className='day-view2-pace-rail';rail.setAttribute('role','img');
 rail.setAttribute('aria-label',actual.toLocaleString('en-GB')+' booked at '+clock+'; typical '+typical.toLocaleString('en-GB')+' by '+clock+'; usual range '+lower.toLocaleString('en-GB')+' to '+upper.toLocaleString('en-GB')+' by '+clock);
 const mark=(className,left,width)=>{const node=document.createElement('span');node.className=className;node.setAttribute('aria-hidden','true');if(left!=null)node.style.left=percent(left)+'%';if(width!=null)node.style.width=percent(width)+'%';rail.append(node);return node;};
 mark('day-view2-pace-rail-track');
 mark('day-view2-pace-rail-range',baseline.low,baseline.high-baseline.low);
 mark('day-view2-pace-rail-actual',actual);
 mark('day-view2-pace-rail-typical',baseline.mean);
 const label=(text,className,value)=>{const node=mark('day-view2-pace-rail-label '+className,value);node.textContent=text;node.dataset.position=String(percent(value));return node;};
 label('Actual '+actual.toLocaleString('en-GB')+' at '+clock,'day-view2-pace-rail-actual-label',actual);
 label('Typical '+typical.toLocaleString('en-GB')+' by '+clock,'day-view2-pace-rail-typical-label',baseline.mean);
 wrapper.append(rail);return wrapper;
}
function dayView2PaceBaseline(date,minute,names,holidays,remainingMinute=minute){
 const key=JSON.stringify([date,minute,remainingMinute,[...names].sort(),[...excludedSlotTypes].sort()]);
 if(capacityPaceCache?.key===key&&capacityPaceCache.availability===availabilityRecords&&capacityPaceCache.bookings===appointmentTimeRecords)return capacityPaceCache.result;
 const comparisonDates=[];for(let offset=7;offset<=371;offset+=7)comparisonDates.push(dayView2AddDays(date,-offset));
 const result=calculateDayView2PaceBaseline({date,minute,remainingMinute,names,availability:dayView2RowsForDates(availabilityRecords,comparisonDates).filter(row=>locumMatches(row,'dayView2Page')),bookings:dayView2RowsForDates(appointmentTimeRecords,comparisonDates).filter(row=>locumMatches(row,'dayView2Page')),excluded:excludedSlotTypes,groupForSlot:capacityUrgencyCategory,holidays});
 capacityPaceCache={key,availability:availabilityRecords,bookings:appointmentTimeRecords,result};return result;
}

function dayView2PaceContext(date,names,totals){
 if(date!==dayView2LocalDate())return null;
 const now=Date.now(),hasTimestamp=Number.isFinite(capacityCSVLatestModified);
 const snapshot=hasTimestamp?new Date(Math.min(now,capacityCSVLatestModified)):null;
 const snapshotClock=snapshot?dayView2LondonClock(snapshot):null;
 const snapshotDate=snapshotClock?.date,minute=snapshotClock?Math.floor(snapshotClock.minute):null,clock=snapshotClock?dayView2Time(minute):null;
 const remainingMinute=Math.max(minute||0,Math.floor(dayView2LondonClock(new Date(now)).minute)),remainingClock=dayView2Time(remainingMinute);
 const weekday=new Date(date+'T12:00:00Z').toLocaleDateString('en-GB',{weekday:'long',timeZone:'UTC'});
 const year=Number(date.slice(0,4)),holidays=new Set([...englandWalesBankHolidays(year-1),...englandWalesBankHolidays(year)]);
 const total=Object.values(totals).reduce((sum,count)=>sum+count,0);
 let baseline=null,state='unavailable',status,description;
 if(!names.length){status='Select Appointment Types';description='Choose an appointment type to compare today’s booking pace.';}
 else if(!total){status='No Slot Report data';description='No Slot Report capacity is reported for today and the selected Appointment Types.';}
 else if(!hasTimestamp){status='Snapshot time unavailable';description='Import a Slot Report with a file timestamp to compare the same time of day.';}
 else if(snapshotDate!==date){status='Awaiting today’s data';description='The latest Slot Report is from '+snapshot.toLocaleDateString('en-GB',{day:'numeric',month:'long',timeZone:'Europe/London'})+'. Refresh today’s report for a weekday comparison.';}
 else if([...holidays].some(holiday=>mondayOf(holiday)===mondayOf(date))){status='Bank holiday week';description='A normal '+weekday+' comparison is not shown during a bank-holiday week.';}
 else{
  baseline=dayView2PaceBaseline(date,minute,names,holidays,remainingMinute);const ratingLevel=dayView2PaceClassification(totals.booked,baseline);state=ratingLevel==null?'unavailable':String(ratingLevel);
  if(!baseline.ready){status=baseline.reportedDays>=6?'Booking-time data incomplete':'Not enough history';description=baseline.reportedDays>=6?baseline.reportedDays+' non-bank-holiday '+weekday+' Slot Reports found in the last 12 months; '+baseline.samples.length+' have at least 90% booking-time coverage.':baseline.samples.length+' of 6 required comparable '+weekday+' Slot Reports available in the last 12 months.';}
  else status=DAY_VIEW2_PACE_RATINGS[Number(state)]?.label||'About average';
 }
 return {date,names,totals,total,actual:totals.booked,weekday,minute,clock,remainingMinute,remainingClock,baseline,state,status,description};
}
function createDayView2BookingPace(date,names,totals,context=dayView2PaceContext(date,names,totals)){
 if(!context)return null;
 const {clock,baseline,state,status,description,total}=context;
 const box=document.createElement('section');box.className='day-view2-booking-pace';box.setAttribute('aria-label','Booking pace for today, Slot Reports only');box.dataset.paceState=state;
 const header=document.createElement('div');header.className='day-view2-pace-heading';
 const title=document.createElement('strong');title.textContent='Booking pace'+(clock?' · as of '+clock:'');
 const badge=document.createElement('span');badge.className='day-view2-pace-badge';badge.textContent=status;badge.setAttribute('role','status');const rating=baseline?.ready?DAY_VIEW2_PACE_RATINGS[Number(state)]:null;if(rating){badge.style.backgroundColor=rating.color;badge.style.color=rating.text;}
 header.append(title,badge);box.append(header);
 if(description){const subtitle=document.createElement('p');subtitle.className='day-view2-pace-subtitle';subtitle.textContent=description;box.append(subtitle);}
 if(baseline?.ready){
  const details=document.createElement('details');details.className='day-view2-pace-details';
  const summary=document.createElement('summary');summary.textContent='Show me more detail';
  const comparison=createDayView2PaceRail(totals.booked,baseline,total,clock);
  details.append(summary,comparison);box.append(details);
  details.addEventListener('toggle',()=>{if(details.isConnected)writeChartPreference('dayView2:paceExpanded',details.open);if(details.open)requestAnimationFrame(()=>layoutDayView2PaceRail(comparison.querySelector('.day-view2-pace-rail')));});
 }
 return box;
}
// Conditional remaining-day demand: favour historical days with a similar
// booked-so-far count, then cautiously adjust for today's observed pace.
function calculateDayView2FurtherBookings(actual,baseline){
 if(!baseline?.ready)return {ready:false};
 const samples=baseline.samples.filter(day=>Number.isFinite(day.remaining)&&day.remaining>=0);
 if(samples.length<6)return {ready:false};
 const scale=Math.max(5,baseline.mean*.2,(baseline.high-baseline.low)/2);
 const ratio=Math.max(.5,Math.min(1.75,(actual+10)/(baseline.mean+10)));
 const confidence=(actual+baseline.mean)/(actual+baseline.mean+30);
 const pace=1+confidence*(ratio-1);
 const candidates=samples.map(day=>({value:day.remaining*pace,weight:1/(1+((day.byTime-actual)/scale)**2)})).sort((a,b)=>a.value-b.value);
 const weights=candidates.reduce((sum,item)=>sum+item.weight,0);
 const mean=candidates.reduce((sum,item)=>sum+item.value*item.weight,0)/weights;
 const quantile=p=>{let cumulative=0;for(const item of candidates){cumulative+=item.weight;if(cumulative>=weights*p)return item.value;}return candidates[candidates.length-1].value;};
 const spread=Math.sqrt(mean);
 return {ready:true,mean,low:Math.max(0,Math.floor(Math.min(quantile(.15),mean-spread))),high:Math.max(0,Math.ceil(Math.max(quantile(.85),mean+spread))),samples:samples.length};
}
function createDayView2FurtherBooking(context){
 if(!context)return null;
 const box=document.createElement('section');box.className='day-view2-further-booking';box.setAttribute('aria-label','Expected further booking from Slot Reports');
 const header=document.createElement('div');header.className='day-view2-pace-heading';
 const title=document.createElement('strong');title.textContent='Expected further booking';header.append(title);box.append(header);
 const forecast=calculateDayView2FurtherBookings(context.actual,context.baseline);
 const value=document.createElement('span');value.className='day-view2-further-range';value.setAttribute('role','status');
 if(forecast.ready){
  value.textContent=forecast.high===0?'No further bookings expected':forecast.low===forecast.high?forecast.low.toLocaleString('en-GB')+' more today':forecast.low.toLocaleString('en-GB')+'–'+forecast.high.toLocaleString('en-GB')+' more today';
  box.dataset.expectedLow=String(forecast.low);box.dataset.expectedHigh=String(forecast.high);
 }else value.textContent=context.status||'Not enough history';
 header.append(value);
 const note=document.createElement('p');note.className='day-view2-pace-subtitle';
 note.textContent=forecast.ready?'Indicative demand after '+context.remainingClock+', using the '+context.clock+' Slot Report pace and similar '+context.weekday+'s. '+context.totals.available.toLocaleString('en-GB')+' Slot Report slots are still available today; Missed Empty is excluded.':'An estimate will appear when today’s Slot Report and enough comparable booking-time history are available.';
 box.append(note);return box;
}

function renderDayView2(){
 const page=$('dayView2Page'),input=$('dayView2Date'),filters=$('dayView2UrgencyToggles');
 if(!page||page.classList.contains('hidden')||!input||!filters)return;
 syncDayView2Preferences();
 input.value=dayView2WorkingDate(input.value||dayView2LocalDate());
 $('dayView2DatePicker').textContent=new Date(input.value+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
 syncDayView2Preferences();
 const date=input.value,names=prioritySort('urgency',groupUrgencyNames.filter(isDashboardToggleOption));
 const signature=JSON.stringify(names);
 if(filters.dataset.groups!==signature){
  filters.dataset.groups=signature;filters.replaceChildren();
  for(const name of names){
   const label=document.createElement('label');label.className='filter-row';
   const sw=document.createElement('span');sw.className='switch';
   const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.setAttribute('role','switch');checkbox.dataset.filterName=name;checkbox.setAttribute('aria-label','Include '+name);
   const track=document.createElement('span');track.className='switch-track';
   const caption=document.createElement('span');caption.textContent=name;
   sw.append(checkbox,track);label.append(sw,caption);filters.append(label);
   checkbox.addEventListener('change',()=>{if(checkbox.checked)dayView2DisabledUrgencies.delete(name);else dayView2DisabledUrgencies.add(name);saveDayView2Preferences();renderDayView2();});
  }
 }
 filters.querySelectorAll('input[data-filter-name]').forEach(checkbox=>{
  checkbox.checked=!dayView2DisabledUrgencies.has(checkbox.dataset.filterName);
  checkbox.nextElementSibling.style.setProperty('--switch-on',urgencyGroupColour(checkbox.dataset.filterName));
 });
 const snapshotClock=capacitySnapshotClock();
 const days=collectDayView2Capacity(date,names,dayView2DisabledUrgencies,availabilityRecords,snapshotClock),selected=days.get(date),totals=selected.totals;
 const slotTotals=collectDayView2Capacity(date,names,dayView2DisabledUrgencies,dayView2RowsForDates(availabilityRecords,days.keys()).filter(isDayView2SlotReportRecord),snapshotClock).get(date).totals;
 const paceContext=dayView2PaceContext(date,[...selected.groups.keys()],slotTotals);
 const paceExpanded=readChartPreferences()['dayView2:paceExpanded']===true;
 const statuses=['missedEmpty','booked','available','embargoed','blocked'];
 const number=n=>n.toLocaleString('en-GB');
 const total=statuses.reduce((sum,status)=>sum+totals[status],0);
 $('dayView2SelectedDate').textContent=dayView2DateLabel(date)+' '+date.slice(0,4);
 updateDayView2RefreshAge();

 const urgencyLegend=$('dayView2UrgencyLegend');urgencyLegend.replaceChildren();
 for(const name of [...selected.groups.keys()].sort((a,b)=>dayView2UrgencyOrder(a)-dayView2UrgencyOrder(b))){
  const key=document.createElement('span');const dot=document.createElement('i');dot.className='day-view2-urgency-key';dot.style.backgroundColor=urgencyGroupColour(name);dot.setAttribute('aria-hidden','true');
  key.append(dot,document.createTextNode(name));urgencyLegend.append(key);
 }
 $('dayView2Total').textContent=number(total)+' total slots';
 const bookable=totals.booked+totals.available+totals.missedEmpty;
 $('dayView2Fill').textContent=bookable?Math.round(100*totals.booked/bookable)+'% of bookable capacity filled':'No bookable slots reported';
 $('dayView2Detail').textContent='Select a capacity segment for its count and meaning.';
 const lanes=$('dayView2Lanes');hideDayView2Tooltip();dayView2SegmentObserver?.disconnect();lanes.replaceChildren();
 // Shared count axis across every appointment-type bar on all three dates.
 const visibleDays=Array.from({length:3},(_,i)=>days.get(dayView2AddWorkingDays(date,i)));
 const scaleMax=Math.max(1,...visibleDays.flatMap(day=>[...day.groups.values()].map(counts=>statuses.reduce((sum,status)=>sum+counts[status],0))));

 for(let offset=0;offset<=2;offset++){
 const laneDate=dayView2AddWorkingDays(date,offset),laneDay=days.get(laneDate),laneTotals=laneDay.totals;
 const laneTotal=statuses.reduce((sum,status)=>sum+laneTotals[status],0);
 const laneDateLabel=dayView2DateLabel(laneDate);
 const previousDate=offset?dayView2AddWorkingDays(date,offset-1):null;
 const weekendGap=previousDate&&dayView2AddDays(previousDate,1)!==laneDate;
 if(weekendGap){const gap=document.createElement('div');gap.className='day-view2-weekend-gap';gap.textContent='Weekend · '+dayView2DateLabel(dayView2AddDays(previousDate,1))+' – '+dayView2DateLabel(dayView2AddDays(laneDate,-1));lanes.append(gap);}
 const lane=document.createElement('section');lane.className='day-view2-lane';lane.dataset.date=laneDate;
 const heading=document.createElement('div');heading.className='day-view2-lane-heading';
 const title=document.createElement('h3');title.textContent=offset===0?'Capacity by Appointment Types':(offset===1?(!weekendGap&&date===dayView2LocalDate()?'Tomorrow':'Next working day'):'Two working days ahead')+' · '+laneDateLabel;
 const summary=document.createElement('span');summary.textContent=number(laneTotals.booked)+' booked · '+number(laneTotals.available)+' available'+(laneTotals.missedEmpty?' · '+number(laneTotals.missedEmpty)+' Missed Empty':'')+' · '+number(laneTotal)+' total';
 heading.append(title,summary);
 const bar=document.createElement('div');bar.className='day-view2-bar';bar.setAttribute('role','group');bar.setAttribute('aria-label',laneDateLabel+' capacity by Appointment Types, then booking status');

 const orderedGroups=[...laneDay.groups].sort((a,b)=>dayView2UrgencyOrder(a[0])-dayView2UrgencyOrder(b[0]));
 for(const [name,counts] of orderedGroups){
  const groupTotal=statuses.reduce((sum,status)=>sum+counts[status],0);
  if(!groupTotal)continue;
  const colour=urgencyGroupColour(name);
  const groupSpan=document.createElement('div');groupSpan.className='day-view2-urgency-span';groupSpan.style.setProperty('width',(100*groupTotal/scaleMax)+'%','important');groupSpan.style.flex='0 0 auto';groupSpan.setAttribute('role','group');groupSpan.setAttribute('aria-label',name);
  installDayView2GroupTooltip(groupSpan,{name,date:laneDateLabel,counts,colour});

  for(const status of statuses){
   if(!counts[status])continue;
   const segment=document.createElement('button');segment.type='button';segment.className='day-view2-segment day-view2-'+status;segment.style.flex=String(counts[status]);
   segment.dataset.count=number(counts[status]);segment.dataset.date=laneDate;segment.dataset.urgency=name;segment.dataset.status=status;
   if(status==='booked'||status==='missedEmpty'){
    segment.style.setProperty('--day-view2-group-colour',colour);
    const hex=/^#([0-9a-f]{6})$/i.exec(colour);
    if(hex&&status==='booked'){const rgb=[0,2,4].map(i=>parseInt(hex[1].slice(i,i+2),16)/255).map(c=>c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4));segment.style.setProperty('--day-view2-booked-text',0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2]>0.179?'#152b43':'#ffffff');}
   }
   segment.setAttribute('aria-label',laneDateLabel+' · '+name+': '+number(counts[status])+' '+(status==='missedEmpty'?'Missed Empty':status)+' slots');
   if(counts[status]/laneTotal>=.04)segment.textContent=number(counts[status]);
   segment.addEventListener('click',()=>{
    const meaning={missedEmpty:'An unbooked slot whose appointment start time was before the imported Slot Report refresh time.',booked:'Already booked for this appointment date.',available:'An unbooked slot whose start time has not passed in the loaded report.',embargoed:'Held from booking. The report does not supply a release time.',blocked:'Currently unavailable; these slots are not counted as free to book.'};
    $('dayView2Detail').textContent=laneDateLabel+' · '+name+' · '+number(counts[status])+' '+(status==='missedEmpty'?'Missed Empty':status)+' slots. '+meaning[status];
   });
   groupSpan.append(segment);
  }
  const groupRow=document.createElement('div');groupRow.className='day-view2-group-row';
  const groupLabel=document.createElement('span');groupLabel.className='day-view2-group-name';groupLabel.textContent=name;
  const track=document.createElement('div');track.className='day-view2-group-track';track.append(groupSpan);
  groupRow.append(groupLabel,track);bar.append(groupRow);
 }
 lane.append(heading,bar);
 if(offset===0){const pace=createDayView2BookingPace(date,[...selected.groups.keys()],slotTotals,paceContext);if(pace){if(paceExpanded)pace.querySelector('details')?.setAttribute('open','');lane.append(pace);}const further=createDayView2FurtherBooking(paceContext);if(further)lane.append(further);}
 if(!laneTotal){
  const noData=document.createElement('p');noData.className='muted day-view2-note';
  noData.textContent=!laneDay.groups.size?'Select an appointment type to view capacity.':'No capacity reported for '+laneDateLabel+' and the selected Appointment Types.';
  lane.append(noData);
 }
 if(laneDay.unknown&&offset>0){const unknownNote=document.createElement('p');unknownNote.className='muted day-view2-note';unknownNote.textContent=number(laneDay.unknown)+' slots with unrecognised statuses are excluded from this day’s totals.';lane.append(unknownNote);}
 lanes.append(lane);
 }

 requestAnimationFrame(()=>layoutDayView2SegmentCounts(lanes));
 if(typeof ResizeObserver!=='undefined'){dayView2SegmentObserver=new ResizeObserver(()=>layoutDayView2SegmentCounts(lanes));dayView2SegmentObserver.observe(lanes);}
 const empty=$('dayView2Empty');
 empty.classList.toggle('hidden',total>0);
 empty.textContent=!selected.groups.size?'Select an appointment type to view capacity.':!availabilityRecords.length?'Load your Slot Reports to view daily capacity.':selected.unknown?'No recognised capacity statuses for this date and selection.':'No capacity reported for this date and selection.';
 const unknown=$('dayView2Unknown');unknown.classList.toggle('hidden',selected.unknown===0);unknown.textContent=number(selected.unknown)+' slots have an unrecognised status and are excluded from these totals.';
 const upcoming=$('dayView2Upcoming');upcoming.replaceChildren();
 for(let i=1;i<=7;i++){
  const nextDate=dayView2AddWorkingDays(date,i),day=days.get(nextDate),card=document.createElement('button');
  card.type='button';card.className='secondary day-view2-upcoming-day';
  const dateLabel=document.createElement('strong');dateLabel.textContent=new Date(nextDate+'T12:00:00Z').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'});
  const embargoed=document.createElement('span');embargoed.textContent=number(day.totals.embargoed)+' embargoed';
  const blocked=document.createElement('span');blocked.textContent=number(day.totals.blocked)+' blocked';
  card.append(dateLabel,embargoed,blocked);
  if(!day.matched){const note=document.createElement('small');note.textContent='No capacity reported';card.append(note);}
  card.setAttribute('aria-label','View '+dateLabel.textContent+': '+embargoed.textContent+', '+blocked.textContent);
  card.addEventListener('click',()=>{chooseDayView2Date(nextDate);});upcoming.append(card);
 }
}
setInterval(()=>{if(!$('dayView2Page')?.classList.contains('hidden'))renderDayView2();},60000);
$('dayView2Date')?.addEventListener('change',()=>chooseDayView2Date($('dayView2Date').value));
$('dayView2Today')?.addEventListener('click',()=>{chooseDayView2Date(dayView2WorkingDate(dayView2LocalDate()));});
$('dayView2Previous')?.addEventListener('click',()=>{chooseDayView2Date(dayView2AddWorkingDays($('dayView2Date').value||dayView2LocalDate(),-1));});
$('dayView2Next')?.addEventListener('click',()=>{chooseDayView2Date(dayView2AddWorkingDays($('dayView2Date').value||dayView2LocalDate(),1));});

const workspacePages=[['workforceNeedPage','navWorkforceNeed','workforceNeed'],['workforcePlanningPage','navWorkforcePlanning','workforcePlanning'],['homePage','navHome','home'],['routineCapacityPage','navRoutineCapacity','routineCapacity'],['chartPage','navChart','chart'],['waitingTimesPage','navWaitingTimes','waitingTimes'],['waitingOverTimePage','navWaitingTrend','waitingTrend'],['categoryPage','navCategories','categories'],['availabilityPage','navAvailability','availability'],['routineAvailabilityPage','navRoutineAvailability','routineAvailability'],['dayView2Page','navDayView2','dayView'],['bookingTimesPage','navBookingTimes','bookingTimes'],['signpostingPage','navSignposting','signposting'],['rapidHealthPage','navRapidHealth','rapidHealth'],['peoplePage','navPeople','people'],['practiceSettingsPage','navPracticeSettings','practiceSettings'],['personalSettingsPage','navPersonalSettings','personalSettings']];
function showPage(which,{historyMode='push'}={}){
 if(which==='dayView2')which='dayView';
 const forecastMode=which==='dailyForecast'?'daily':which==='weeklyForecast'?'weekly':null;
 const known=forecastMode||which==='chart2'||workspacePages.some(([, , name])=>name===which);
 if(!known||(!isOwner&&['categories','people','practiceSettings'].includes(which))){
  if(historyMode!=='push')showPage('home',{historyMode});
  return;
 }
 if(historyMode!=='restore')iqBridge?.recordWorkspacePage(which,historyMode==='replace');
 writeChartPreference('workspacePage',which);
 $('navChart2').classList.toggle('active',which==='chart2');
 if(forecastMode){
  window.openWorkspaceForecast?.(forecastMode);
  return;
 }
 updateDashboardDateContext();refreshPrimaryApptTypeBoxes();
 closeDayView2Calendar();
 closeDashboardMenus();hideDayView2Tooltip();
 for(const id of ['dailyForecastPage','weeklyForecastPage'])$(id)?.classList.add('hidden');
 for(const id of ['navDailyForecast','navWeeklyForecast'])$(id)?.classList.remove('active');
 historicChart2=which==='chart2';
 const pageName=historicChart2?'chart':which;
 $('historicChartTitle').textContent=historicChart2?'Historic Booking Activity 2':'Historic Booking Activity';
 $('historicBreakdown').hidden=!historicChart2;
 $('historicCombineRow').hidden=historicChart2;
 if(!historicChart2)$('historicSeriesLegend').hidden=true;
 for(const [page,nav,name] of workspacePages){
  $(page).classList.toggle('hidden',pageName!==name);$(nav).classList.toggle('active',which===name);
 }
 if(which==='workforceNeed')window.renderWeeklyPlanning?.();
 if(which==='workforcePlanning')window.renderWorkforcePlanning?.();
 if(which==='home'){updateHomePracticeName();window.updateHomeOverview?.();}
 if(pageName==='chart')setTimeout(()=>{refresh();scheduleChartResize()},0);
 else if(which==='waitingTimes')setTimeout(renderWaitingTimesChart,0);
 else if(which==='routineCapacity')setTimeout(()=>window.renderRoutineCapacity?.(),0);
 else if(which==='waitingTrend')setTimeout(renderWaitingTrendChart,0);
 else if(which==='availability')setTimeout(renderAvailabilityChart,0);
 else if(which==='routineAvailability')setTimeout(renderRoutineAvailabilityChart,0);

 else if(which==='dayView')setTimeout(renderDayView2,0);
 else if(which==='bookingTimes')setTimeout(renderBookingTimesChart,0);
 else if(which==='signposting')setTimeout(renderSignpostingChart,0);
 else if(which==='rapidHealth')renderRapidHealthTable();
 else if(which==='people'){renderPeopleGroups();renderPeopleGroupFilter();renderPeople();}
 else if(which==='personalSettings'){renderPersonalSettings();}
 else if(which==='practiceSettings'){selectPracticeSettingsTab(readChartPreferences()['practiceSettings:tab']);}
 else if(which==='categories'){restorePersonalSettingsWorkspace();renderSlotGroupBoxes();renderSlotTable();renderEditor();renderGroupUrgencyEditor();renderClinicianEditor();renderClinicianGroupEditor();renderConsultEditor()}
}
$('navChart2').onclick=()=>showPage('chart2');
$('historicBreakdown').addEventListener('click',event=>{
 const button=event.target.closest('[data-historic-breakdown]');
 if(!button||button.dataset.historicBreakdown===historicChartBreakdown())return;
 writeChartPreference('historicChart2:breakdown',button.dataset.historicBreakdown);
 if(window.Plotly)Plotly.purge($('combinedDemandChart'));
 scheduleDemandRefresh();
});
$('navWorkforcePlanning').onclick=()=>showPage('workforcePlanning');
document.getElementById('navWorkforceNeed').onclick=()=>showPage('workforceNeed');document.getElementById('navHome').onclick=()=>showPage('home');document.getElementById('navRoutineCapacity').onclick=()=>showPage('routineCapacity');document.getElementById('navChart').onclick=()=>showPage('chart');document.getElementById('navWaitingTimes').onclick=()=>showPage('waitingTimes');document.getElementById('navWaitingTrend').onclick=()=>showPage('waitingTrend');document.getElementById('navCategories').onclick=()=>showPage('categories');document.getElementById('navAvailability').onclick=()=>showPage('availability');document.getElementById('navRoutineAvailability').onclick=()=>showPage('routineAvailability');
document.getElementById('navDayView2').onclick=()=>showPage('dayView');document.getElementById('navBookingTimes').onclick=()=>showPage('bookingTimes');document.getElementById('navSignposting').onclick=()=>showPage('signposting');document.getElementById('navRapidHealth').onclick=()=>showPage('rapidHealth');document.getElementById('navPeople').onclick=()=>showPage('people');document.getElementById('navPracticeSettings').onclick=()=>showPage('practiceSettings');document.getElementById('navPersonalSettings').onclick=()=>showPage('personalSettings');$('personalSettingsForm').addEventListener('submit',savePersonalSettings);$('demandCombineLines')?.addEventListener('change',()=>{const chart=$('combinedDemandChart');if(chart&&window.Plotly)Plotly.purge(chart);scheduleDemandRefresh();});$('slotTableSearch').addEventListener('input',renderSlotTable);for(const id of ['slotGroupFilter','slotModeFilter','slotPurposeFilter','slotCapacityFilter'])$(id)?.addEventListener('change',renderSlotTable);$('slotUnassignedOnly').addEventListener('change',renderSlotTable);$('slotModeUnassignedOnly').addEventListener('change',renderSlotTable);$('slotPurposeUnassignedOnly').addEventListener('change',renderSlotTable);$('slotCapacityUnassignedOnly').addEventListener('change',renderSlotTable);$('peopleSearch').addEventListener('input',renderPeople);$('peopleGroupFilter').addEventListener('change',renderPeople);$('peopleUnassignedOnly').addEventListener('change',()=>{const only=$('peopleUnassignedOnly').checked;$('peopleGroupFilter').disabled=only;renderPeople()});
function renderClinicianEditor(){renderDropEditor('clinician');updateClinicianChartFilter()}
function renderClinicianGroupEditor(){renderDropEditor('clinicianGroup');if(!$('peoplePage')?.classList.contains('hidden'))renderPeopleGroups()}
$('addClinicianCategory').onclick=()=>{const el=$('newClinicianCategory');const c=el.value.trim();if(!c)return;if(c.toLowerCase()==='uncategorised'||clinicianCategoryNames.some(x=>x.toLowerCase()===c.toLowerCase())){alert('This clinician category name already exists or is reserved.');return}clinicianCategoryNames.push(c);el.value='';saveCategories();renderClinicianEditor();renderClinicianGroupEditor()};
$('newClinicianCategory').addEventListener('keydown',e=>{if(e.key==='Enter')$('addClinicianCategory').click()});
$('clinicianSlotSearch').addEventListener('input',renderClinicianEditor);
$('addClinicianGroupCategory').onclick=()=>{const el=$('newClinicianGroupCategory');const c=el.value.trim();if(!c)return;if(c.toLowerCase()==='uncategorised'||clinicianGroupNames.some(x=>x.toLowerCase()===c.toLowerCase())){alert('This clinician group name already exists or is reserved.');return}clinicianGroupNames.push(c);el.value='';saveCategories();renderClinicianGroupEditor();updateClinicianChartFilter()};
$('newClinicianGroupCategory').addEventListener('keydown',e=>{if(e.key==='Enter')$('addClinicianGroupCategory').click()});
$('clinicianGroupSearch').addEventListener('input',renderClinicianGroupEditor);
function renderConsultEditor(){renderDropEditor('consult')}
$('addConsultCategory').onclick=()=>{const el=$('newConsultCategory');const c=el.value.trim();if(!c)return;if(c.toLowerCase()==='uncategorised'||consultCategoryNames.some(x=>x.toLowerCase()===c.toLowerCase())){alert('This consult mode already exists or is reserved.');return}consultCategoryNames.push(c);el.value='';saveCategories();renderConsultEditor()};
$('newConsultCategory').addEventListener('keydown',e=>{if(e.key==='Enter')$('addConsultCategory').click()});
$('consultSlotSearch').addEventListener('input',renderConsultEditor);
$('addGroupUrgencyCategory').onclick=()=>{const el=$('newGroupUrgencyCategory');const c=el.value.trim();if(!c)return;if(c.toLowerCase()==='uncategorised'||groupUrgencyNames.some(x=>x.toLowerCase()===c.toLowerCase())){alert('This group name already exists or is reserved.');return}groupUrgencyNames.push(c);el.value='';saveCategories();renderGroupUrgencyEditor();renderAvailabilityChart()};
$('newGroupUrgencyCategory').addEventListener('keydown',e=>{if(e.key==='Enter')$('addGroupUrgencyCategory').click()});
$('groupUrgencySearch').addEventListener('input',renderGroupUrgencyEditor);
rebuildCategoryFilter();renderEditor();renderGroupUrgencyEditor();renderClinicianEditor();renderClinicianGroupEditor();renderConsultEditor();consolidateUrgencyGroups();$('slotCountSort')?.addEventListener('click',()=>setSlotMappingSort(slotMappingSort==='count-desc'?'count-asc':slotMappingSort==='count-asc'?'name':'count-desc'));renderConsultModeCards();renderSlotGroupBoxes();renderSlotPurposeCategories();renderCapacityStatusCategories();
refresh();

initAuth();

function restorePersonalSettingsWorkspace(){
 const saved=readChartPreferences();
 const workspace=[...document.querySelectorAll('[data-slot-workspace]')].find(button=>button.dataset.slotWorkspace===(saved['settings:slotWorkspace']||'inclusion'));
 workspace?.click();
 const tab=[...document.querySelectorAll('[data-category-tab]')].find(button=>button.dataset.categoryTab===(saved['settings:categoryTab']||'tabUrgency'));
 tab?.click();
 const sort=saved['settings:slotSort'];setSlotMappingSort(['count-asc','count-desc','name'].includes(sort)?sort:'name');
}
document.addEventListener('click',event=>{
 const button=event.target.closest?.('[data-slot-workspace]');
 if(button)writeChartPreference('settings:slotWorkspace',button.dataset.slotWorkspace);
});
// Show one category classification at a time; the Save button stays visible.
(function setupCategoryTabs(){
 const buttons=Array.from(document.querySelectorAll('[data-category-tab]'));
 const panels=Array.from(document.querySelectorAll('.category-tab-panel'));
 function activate(target){
  writeChartPreference('settings:categoryTab',target);
  for(const button of buttons){
   const selected=button.dataset.categoryTab===target;
   button.classList.toggle('active',selected);
   button.setAttribute('aria-selected',String(selected));
   button.tabIndex=selected?0:-1;
  }
  for(const panel of panels)panel.classList.toggle('hidden',panel.id!==target);
 }
 for(const button of buttons){
  button.addEventListener('click',()=>activate(button.dataset.categoryTab));
  button.addEventListener('keydown',event=>{
   if(event.key!=='ArrowRight'&&event.key!=='ArrowLeft')return;
   event.preventDefault();
   const offset=(event.key?.startsWith(iqStorageScope)?event.key.slice(iqStorageScope.length):null)==='ArrowRight'?1:-1;
   const next=buttons[(buttons.indexOf(button)+offset+buttons.length)%buttons.length];
   activate(next.dataset.categoryTab);next.focus();
  });
 }
 activate('tabUrgency');
})();


function updateAvailabilityUrgencyFilter(){
 const select=$('availabilityUrgencyFilter');if(!select)return;
 const names=[...groupUrgencyNames];
 if(!names.includes(selectedAvailabilityUrgency))selectedAvailabilityUrgency=names[0]||'';
 const same=select.options.length===names.length&&names.every((name,i)=>select.options[i].value===name);
 if(!same){select.replaceChildren();for(const name of names){const opt=document.createElement('option');opt.value=name;opt.textContent=name;select.append(opt)}}
 select.value=selectedAvailabilityUrgency;
}
const urgentClinicianDisabled=new Set();
const urgentConsultDisabled=new Set();
// Eligibility must be independent of currently selected switches: otherwise
// disabling one dimension can cascade and lock every other dimension off.
function availabilityRecordsInRange(page){
 const urgent=page==='urgent';
 const from=urgent?-urgentWeeksBack:page==='planned'?plannedStartWeek:routineStartWeek;
 const to=urgent?urgentWeeksForward:page==='planned'?plannedEndWeek:routineEndWeek;
 const start=new Date(thisWeek+'T12:00:00Z');start.setUTCDate(start.getUTCDate()+from*7);
 const finish=new Date(thisWeek+'T12:00:00Z');finish.setUTCDate(finish.getUTCDate()+(to+1)*7);
 const first=start.toISOString().slice(0,10),last=finish.toISOString().slice(0,10);
 const urgentNames=urgent?new Set(urgentCategoryNames()):null;
 return availabilityRecords.filter(r=>{
  if(excludedSlotTypes.has(r.slot))return false;
  if(!(r.count>0)||r.date<first||r.date>=last)return false;
  const category=String(assignments[r.slot]||'').trim();
  if(!isDashboardToggleOption(capacityUrgencyCategory(r.slot))||(urgent&&!urgentNames.has(capacityUrgencyCategory(r.slot))))return false;
  if(urgent){const day=new Date(r.date+'T12:00:00Z').getUTCDay();if(day===0||day===6)return false;}
  return true;
 });
}
function availabilitySecondaryRecords(page){
 const disabled=page==='urgent'?urgentCategoryDisabled:page==='planned'?plannedDisabledTypes:routineDisabledTypes;
 return availabilityRecordsInRange(page).filter(r=>!disabled.has(capacityUrgencyCategory(r.slot)));
}
function availabilityOptionHasData(page,kind,name){
 return (kind==='category'?availabilityRecordsInRange(page):availabilitySecondaryRecords(page)).some(r=>{
  const category=String(assignments[r.slot]||'').trim();
  const clinician=clinicianGroupAssignments[effectiveClinicianType(r.clinician,r.person)];
  const consult=consultAssignments[r.slot];
  return kind==='category'?capacityUrgencyCategory(r.slot)===name:kind==='clinician'?clinician===name:consult===name;
 });
}
function availabilityHasVisibleRecords(page){
 return availabilityRecordsInRange(page).some(r=>{
  const category=String(assignments[r.slot]||'').trim();
  const clinician=clinicianGroupAssignments[effectiveClinicianType(r.clinician,r.person)];
  const consult=consultAssignments[r.slot];
  return page==='urgent'?
   !urgentCategoryDisabled.has(capacityUrgencyCategory(r.slot))&&urgentCategoryNames().includes(capacityUrgencyCategory(r.slot))&&
   clinicianGroupNames.includes(clinician)&&!urgentClinicianDisabled.has(clinician)&&
   consultCategoryNames.includes(consult)&&!urgentConsultDisabled.has(consult):
   clinicianGroupNames.includes(clinician)&&!(page==='planned'?plannedDisabledClinicianGroups:routineDisabledClinicianGroups).has(clinician)&&
   consultCategoryNames.includes(consult)&&!(page==='planned'?plannedDisabledConsultModes:routineDisabledConsultModes).has(consult)&&
   !(page==='planned'?plannedDisabledTypes:routineDisabledTypes).has(capacityUrgencyCategory(r.slot));
 });
}
function changeAvailabilityFilter(page,disabled,name,checked,checkbox){
 const previouslyOff=disabled.has(name);
 if(checked)disabled.delete(name);else disabled.add(name);
 // Reject any change that would remove every appointment from the chart.
 // If source data itself has no matches, do not block filter changes.
 if(!appointmentBulkFilterChange&&!chartPreferenceRestoring&&availabilityRecordsInRange(page).length&&!availabilityHasVisibleRecords(page)){
  if(previouslyOff)disabled.add(name);else disabled.delete(name);
  checkbox.checked=!previouslyOff;
  return;
 }
 (page==='urgent'?renderAvailabilityChart:page==='planned'?renderPlannedAvailabilityChart:renderRoutineAvailabilityChart)();
}
function removeInvalidDashboardToggles(){
 document.querySelectorAll('input[data-filter-name],input[data-classification],input[data-urgency-group]').forEach(input=>{
  const name=input.dataset.filterName||input.dataset.classification||input.dataset.urgencyGroup;
  if(!isDashboardToggleOption(name)){
   input.checked=false;
   input.closest('label.filter-row')?.remove();
  }
 });
}
function refreshAvailabilityOptionStates(page){
 removeInvalidDashboardToggles();
 // Build eligibility once per render instead of rescanning all CSV rows per toggle.
 const available={category:new Set(),clinician:new Set(),consult:new Set()};
 const disabledCategories=page==='urgent'?urgentCategoryDisabled:page==='planned'?plannedDisabledTypes:routineDisabledTypes;
 for(const row of availabilityRecordsInRange(page)){
  const group=capacityUrgencyCategory(row.slot);available.category.add(group);
  if(disabledCategories.has(group))continue;
  available.clinician.add(clinicianGroupAssignments[effectiveClinicianType(row.clinician,row.person)]);
  available.consult.add(consultAssignments[row.slot]);
 }
 const configs=page==='urgent'?
  [['urgentCategoryToggles','category',urgentCategoryDisabled],['urgentClinicianToggles','clinician',urgentClinicianDisabled],['urgentConsultToggles','consult',urgentConsultDisabled]]:
  page==='planned'?[['plannedClinicianFilters','clinician',plannedDisabledClinicianGroups],['plannedConsultFilters','consult',plannedDisabledConsultModes]]:[['routineClinicianFilters','clinician',routineDisabledClinicianGroups],['routineConsultFilters','consult',routineDisabledConsultModes]];
 for(const [id,kind,disabled] of configs){
  const root=$(id);if(!root)continue;
  for(const input of root.querySelectorAll('input[data-filter-name]')){
   const name=input.dataset.filterName;
   const possible=available[kind].has(name);
   // Keep user choices intact when an option temporarily has no data.
   // Urgency categories are configured in Slot Settings and must remain visible
   // and selectable even when there are no matching records in this date range.
   const configuredUrgency=page==='urgent'&&kind==='category';
   input.disabled=!possible&&!configuredUrgency;
   input.checked=!disabled.has(name)&&(possible||configuredUrgency);
   const row=input.closest('.filter-row');
   if(row)row.hidden=!possible&&!configuredUrgency;
   input.title=possible?'':(configuredUrgency?'No appointments in the selected date range':'No source appointments for this option in the selected date range');
  }
 }

}
const urgentDisabledClinicianTypes=new Set(),routineDisabledClinicianTypes=new Set(),plannedDisabledClinicianTypes=new Set();
function selectedClinicianTypes(page){
 const disabled=page==='urgent'?urgentClinicianDisabled:page==='planned'?plannedDisabledClinicianGroups:routineDisabledClinicianGroups;
 return clinicianCategoryNames.filter(type=>{
  const group=clinicianGroupAssignments[type];
  return group&&clinicianGroupNames.includes(group)&&!disabled.has(group);
 });
}
function renderClinicianTypeFilters(page){
 const root=$(page+'ClinicianTypeFilters');if(!root)return;
 const disabled=page==='urgent'?urgentDisabledClinicianTypes:page==='planned'?plannedDisabledClinicianTypes:routineDisabledClinicianTypes;
 const presentTypes=new Set(availabilitySecondaryRecords(page).map(r=>effectiveClinicianType(r.clinician,r.person)));
 const names=selectedClinicianTypes(page).filter(name=>presentTypes.has(name)&&isDashboardToggleOption(name));
 const existing=[...root.querySelectorAll('input[data-filter-name]')].map(input=>input.dataset.filterName);
 if(existing.length!==names.length||names.some((name,i)=>name!==existing[i])){
  root.replaceChildren();
  if(!names.length){const note=document.createElement('span');note.className='hint';note.textContent='No clinician types in selected groups';root.append(note);}
  for(const name of names){
   const row=document.createElement('label');row.className='filter-row';
   const sw=document.createElement('span');sw.className='switch';
   const input=document.createElement('input');input.type='checkbox';input.dataset.filterName=name;input.setAttribute('role','switch');input.checked=!disabled.has(name);
   const track=document.createElement('span');track.className='switch-track';
   const label=document.createElement('span');label.textContent=name;
   sw.append(input,track);row.append(sw,label);root.append(row);
   input.addEventListener('change',()=>{input.checked?disabled.delete(name):disabled.add(name);(page==='urgent'?renderAvailabilityChart:page==='planned'?renderPlannedAvailabilityChart:renderRoutineAvailabilityChart)();});
  }
 }
 updateCollapsedFilterSummaries();
}
function refreshActivitySecondarySummaries(){
 for(const id of ['demandCapacityToggles','consultChartFilters','clinicianChartFilters']){
  const root=$(id);if(!root)continue;
  root.querySelectorAll('input').forEach(input=>{
   if(!input.dataset.filterName)input.dataset.filterName=input.dataset.classification||input.getAttribute('aria-label')?.replace(/^Include /,'')||'';
  });
 }
 updateCollapsedFilterSummaries();
}
function updateCollapsedFilterSummaries(){
 document.querySelectorAll('.collapsed-selection-summary[data-summary-for]').forEach(summary=>{
  const root=$(summary.dataset.summaryFor);if(!root)return;
  const selected=[...root.querySelectorAll('input[data-filter-name]')].filter(input=>input.checked&&!input.disabled&&!input.closest('.filter-row')?.hidden).map(input=>input.dataset.filterName);
  const text=selected.length?selected.join(', '):'None selected';if(summary.textContent!==text)summary.textContent=text;
  const expanded=summary.parentElement.querySelector('.collapse-filter-button')?.getAttribute('aria-expanded')==='true';
  summary.hidden=expanded;root.hidden=!expanded;
 });
}
document.querySelectorAll('.collapse-filter-button').forEach(button=>{
 button.addEventListener('click',()=>{
  const expanded=button.getAttribute('aria-expanded')!=='true',key=chartExpansionKey(button);
  if(key&&!chartPreferenceRestoring){writeChartPreference(key,expanded);chartRestoredExpansions.set(key,expanded)}
  setSecondaryFilterExpanded(button,expanded);updateCollapsedFilterSummaries();
 });
});
function installAvailabilityCardTooltip(target){
 if(!target||typeof target.on!=='function')return;
 target.querySelector('.availability-tooltip-card')?.remove();
 const card=document.createElement('div');card.className='availability-tooltip-card';card.hidden=true;target.appendChild(card);
 if(typeof target.removeAllListeners==='function'){target.removeAllListeners('plotly_hover');target.removeAllListeners('plotly_unhover')}
 const number=n=>Number(n||0).toLocaleString('en-GB');
 target.on('plotly_hover',data=>{
  const point=data.points?.find(p=>p.x!=null&&p.curveNumber!=null);
  if(!point){card.hidden=true;return}
  const bucket=String(point.x),details=target._capacityHoverData?.get(bucket);
  card.replaceChildren();
  if(details){
   const title=document.createElement('div');title.className='availability-tooltip-heading';title.textContent=details.heading;card.append(title);
   for(const group of details.groups){
    if(!group.total)continue;
    const header=document.createElement('div');header.className='availability-tooltip-group';
    const dot=document.createElement('span');dot.className='availability-tooltip-dot';dot.style.backgroundColor=group.colour;
    const name=document.createElement('strong');name.textContent=group.name+' · '+number(group.total);
    header.append(dot,name);card.append(header);
    for(const [status,value] of group.items){
     if(!value)continue;
     const row=document.createElement('div');row.className='availability-tooltip-line availability-tooltip-subline';
     const label=document.createElement('span');label.textContent=status;
     const amount=document.createElement('span');amount.textContent=number(value);
     row.append(label,amount);card.append(row);
    }
   }
   const total=document.createElement('div');total.className='availability-tooltip-line availability-tooltip-total';total.textContent='Total: '+number(details.total);card.append(total);
   if(details.predictedNeed!=null){
    const predicted=document.createElement('div');predicted.className='availability-tooltip-line';
    predicted.textContent='Predicted need: '+number(details.predictedNeed);card.append(predicted);
   }
  }else{
   const raw=point.customdata;if(typeof raw!=='string'){card.hidden=true;return}
   const div=document.createElement('div');div.innerHTML=raw.replaceAll('<br>','<br>');card.textContent=div.textContent||'';
  }
  card.hidden=false;
  const rect=target.getBoundingClientRect(),event=data.event;
  const x=event?.clientX!=null?event.clientX-rect.left:rect.width/2;
  const y=event?.clientY!=null?event.clientY-rect.top:rect.height/2;
  card.style.left=Math.max(8,Math.min(rect.width-card.offsetWidth-8,x+18))+'px';
  card.style.top=Math.max(8,y+card.offsetHeight+18>rect.height?y-card.offsetHeight-16:y+14)+'px';
 });
 target.on('plotly_unhover',()=>{card.hidden=true});
}

function simpleAvailabilityHover(heading,labels,values,total){
 return '<b>'+heading+'</b><br>'+labels.map((label,i)=>label+': '+Number(values[i]||0).toLocaleString('en-GB')).join('<br>')+'<br><b>Total: '+total.toLocaleString('en-GB')+'</b>';
}
function renderUrgentSideFilters(){

 const build=(id,names,disabled,colour)=>{
  const root=$(id);if(!root)return;
  names=names.filter(isDashboardToggleOption);
  const previous=[...root.querySelectorAll('input[data-filter-name]')].map(el=>el.dataset.filterName);
  if(previous.length===names.length&&names.every((n,i)=>n===previous[i])){root.querySelectorAll('input[data-filter-name]').forEach(input=>input.nextElementSibling?.style.setProperty('--switch-on',id==='urgentClinicianToggles'?clinicianGroupColour(input.dataset.filterName):'#a1c8e8'));return;}
  root.replaceChildren();
  for(const name of names){
   const row=document.createElement('label');row.className='filter-row';
   const sw=document.createElement('span');sw.className='switch';
   const input=document.createElement('input');input.type='checkbox';input.setAttribute('role','switch');input.dataset.filterName=name;input.checked=!disabled.has(name);
   input.setAttribute('aria-label','Include '+name);
   const track=document.createElement('span');track.className='switch-track';track.style.setProperty('--switch-on',id==='urgentClinicianToggles'?clinicianGroupColour(name):colour);
   const caption=document.createElement('span');caption.textContent=name;
   sw.append(input,track);row.append(sw,caption);root.append(row);
   input.addEventListener('change',()=>{
    changeAvailabilityFilter('urgent',disabled,name,input.checked,input);
   });
  }
 };
 build('urgentClinicianToggles',clinicianGroupNames,urgentClinicianDisabled,'#a6d6b2');
 build('urgentConsultToggles',consultCategoryNames,urgentConsultDisabled,'#a1c8e8');
}
function urgentClinicianMatches(clinician,person){
 if(clinician==='Signposting (no clinician recorded)')return true;
 const detailed=effectiveClinicianType(clinician,person);const group=clinicianGroupAssignments[detailed];
 return clinicianGroupNames.includes(group)&&!urgentClinicianDisabled.has(group)&&!urgentDisabledClinicianTypes.has(detailed);
}
function urgentConsultMatches(slot){
 if(signpostingSlotNames.has(slot))return true;
 const mode=consultAssignments[slot];
 return isDashboardToggleOption(mode)&&consultCategoryNames.includes(mode)&&!urgentConsultDisabled.has(mode);
}
const urgentCategoryDisabled=new Set();
let urgentUrgencyDefaultsApplied=false;
function applyUrgentUrgencyDefaults(){
 if(urgentUrgencyDefaultsApplied||!urgentCategoryNames().length)return;
 urgentCategoryDisabled.clear();
 for(const name of urgentCategoryNames()){
  if(!['same day','within 3 days','111 referral'].includes(name.trim().toLowerCase()))urgentCategoryDisabled.add(name);
 }
 urgentUrgencyDefaultsApplied=true;
}

let urgentAvailabilityGranularity='day';
function setUrgentAvailabilityGranularity(mode){
 urgentAvailabilityGranularity=mode==='week'?'week':'day';
 const switchInput=$('urgentDaysWeeksSwitch');if(switchInput)switchInput.checked=urgentAvailabilityGranularity==='week';
 renderAvailabilityChart();
}
$('urgentDaysWeeksSwitch')?.addEventListener('change',event=>setUrgentAvailabilityGranularity(event.target.checked?'week':'day'));

let urgentWeeksBack=1,urgentWeeksForward=3;
function setupUrgentRangeControls(){
 const back=$('urgentWeeksBack'),forward=$('urgentWeeksForward');
 if(!back||!forward)return;
 back.value=-urgentWeeksBack;forward.value=urgentWeeksForward;
 const label=offset=>offset===0?'This week':offset===-1?'Last week':offset<0?Math.abs(offset)+' weeks ago':offset===1?'Next week':offset+' weeks ahead';
 let renderTimer=null;
 const redraw=()=>{clearTimeout(renderTimer);renderTimer=null;renderAvailabilityChart();};
 const scheduleRedraw=()=>{clearTimeout(renderTimer);renderTimer=setTimeout(redraw,160);};
 const update=(moved)=>{
  let start=Number(back.value),end=Number(forward.value);
  // Always include this week and prevent handles crossing.
  if(moved==='start')start=Math.min(start,0,end);
  if(moved==='end')end=Math.max(end,0,start);
  back.value=start;forward.value=end;
  urgentWeeksBack=-start;urgentWeeksForward=end;
  $('urgentWeeksBackValue').textContent=label(start);
  $('urgentWeeksForwardValue').textContent=label(end);
  const rail=$('urgentRangeActive');
  if(rail){rail.style.setProperty('--range-start',String((start+3)/7));rail.style.setProperty('--range-span',String((end-start)/7))}
  scheduleRedraw();
 };
 back.addEventListener('input',()=>update('start'));
 forward.addEventListener('input',()=>update('end'));
 back.addEventListener('change',redraw);
 forward.addEventListener('change',redraw);
 update();
 redraw();
}
function urgentCategoryNames(){
 // The capacity chart uses the configured urgency category list, not a legacy "Urgent" group.
 return groupUrgencyNames.filter(isDashboardToggleOption);
}
function capacityUrgencyCategory(slot){
 const detailed=assignments[slot]||'';
 return groupUrgencyNames.includes(detailed)?detailed:(groupUrgencyAssignments[detailed]||'');
}
function renderUrgentCategoryToggles(){
 const root=$('urgentCategoryToggles');if(!root)return;
 applyUrgentUrgencyDefaults();
 const names=prioritySort('urgency',urgentCategoryNames());
 const current=[...root.querySelectorAll('input[data-filter-name]')].map(x=>x.dataset.filterName);
 if(current.length===names.length&&names.every(name=>current.includes(name))){root.querySelectorAll('input[data-filter-name]').forEach(input=>input.nextElementSibling?.style.setProperty('--switch-on',urgentColour(input.dataset.filterName)));return;}
 root.replaceChildren();
 if(!names.length){root.textContent='Create Appointment Types in Slot Settings to display capacity.';return}
 for(const name of names){
  const row=document.createElement('label');row.className='filter-row';
  const sw=document.createElement('span');sw.className='switch';
  const input=document.createElement('input');input.type='checkbox';input.setAttribute('role','switch');input.dataset.filterName=name;input.checked=!urgentCategoryDisabled.has(name);
  const track=document.createElement('span');track.className='switch-track';
  const title=document.createElement('span');title.textContent=name;
  const colour=urgentColour(name);track.style.setProperty('--switch-on',colour);
  sw.append(input,track);row.append(sw,title);root.append(row);
  input.addEventListener('change',()=>{
   changeAvailabilityFilter('urgent',urgentCategoryDisabled,name,input.checked,input);
  });
 }
}
function urgentColour(name){return urgencyGroupColour(name)}
function urgentGradientStops(hex){
 const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
 const mix=(other,t)=>'#'+rgb.map((v,i)=>Math.round(v*(1-t)+other[i]*t).toString(16).padStart(2,'0')).join('');
 return [['0%',mix([255,255,255],0.37)],['17%',mix([255,255,255],0.12)],['54%',hex],['100%',mix([0,0,0],0.12)]];
}
// SVG gradient is a visual finish only. It does not alter Plotly data, bar
// positions, totals, tooltip targets, Today marker or historical shading.
// Shared flat visual treatment; saved type colours remain the source of truth.
// SVG hatch remains diagonal and dashed at every bar size and in both day/week views.
function capacityMissedPattern(svg,colour,id){
 const ns='http://www.w3.org/2000/svg';
 let defs=svg.querySelector('defs');if(!defs){defs=document.createElementNS(ns,'defs');svg.prepend(defs);}
 let pattern=[...defs.querySelectorAll('pattern')].find(node=>node.id===id);
 if(!pattern){
  pattern=document.createElementNS(ns,'pattern');pattern.id=id;
  pattern.setAttribute('patternUnits','userSpaceOnUse');pattern.setAttribute('width','7');pattern.setAttribute('height','7');
  pattern.setAttribute('patternTransform','rotate(45)');
  const background=document.createElementNS(ns,'rect');background.setAttribute('width','7');background.setAttribute('height','7');background.setAttribute('fill','#ffffff');
  const stripe=document.createElementNS(ns,'line');stripe.setAttribute('x1','0');stripe.setAttribute('x2','0');stripe.setAttribute('y1','0');stripe.setAttribute('y2','7');stripe.setAttribute('stroke-width','1.5');stripe.setAttribute('stroke-dasharray','4 3');
  pattern.append(background,stripe);defs.append(pattern);
 }
 pattern.querySelector('line').setAttribute('stroke',colour);
 return 'url(#'+id+')';
}
function applyFlatAvailabilityBars(target,isDaily=false,separateGroups=false){
 target._capacityIsDaily=isDaily;
 // Apply one shadow to the composited stacked bars, rather than each segment.
 applyCapacityChartShadows(target,isDaily);
 // Plotly SVG paths need an explicit fill: removing their fill renders them black.
 // Read each bar trace's actual marker colour, including custom colours from Slot settings.
 const barTraces=(target.data||[]).filter(trace=>trace.type==='bar');
 const rendered=target.querySelectorAll('.barlayer .trace.bars');
 // Shift each whole urgency block upward by a fixed visual gap. Counts and
 // segment heights stay untouched; empty groups do not create blank space.
 const groups=[...new Set(barTraces.map(trace=>trace.meta?.capacityGroup).filter(Boolean))];
 const offsets=new Map();
 if(separateGroups){
  const preceding=Array.from({length:barTraces[0]?.y?.length||0},()=>0);
  for(const group of groups){
   const members=barTraces.filter(trace=>trace.meta?.capacityGroup===group);
   offsets.set(group,preceding.map(n=>n*2));
   preceding.forEach((_,j)=>{if(members.some(trace=>Number(trace.y[j])>0))preceding[j]++;});
  }
 }
 rendered.forEach((traceElement,i)=>{
  const marker=barTraces[i]?.marker||{};
  const gaps=offsets.get(barTraces[i]?.meta?.capacityGroup);
  const baseColour=typeof marker.color==='string'?marker.color:'#c2cdd5';
  traceElement.querySelectorAll('.point path').forEach((path,j)=>{
   if(separateGroups&&gaps)path.setAttribute('transform','translate(0,'+(-gaps[j])+')');
   if(!(Number(barTraces[i]?.y?.[j])>0)){
    path.style.setProperty('fill','none','important');
    path.style.setProperty('stroke','none','important');
    return;
   }
   const colour=Array.isArray(marker.color)?marker.color[j]||baseColour:baseColour;
   const missed=barTraces[i]?.name?.endsWith(' · Missed Empty');
   if(missed){
    const urgency=barTraces[i]?.meta?.capacityGroup;
    const fill=capacityMissedPattern(path.ownerSVGElement,urgencyGroupColour(urgency),target.id+'-missed-'+i);
    path.style.setProperty('fill',fill,'important');
    path.style.setProperty('fill-opacity','1','important');
    path.style.setProperty('stroke','rgba(255,255,255,0.85)','important');
    path.style.setProperty('stroke-width','0.65px','important');
    path.style.removeProperty('stroke-dasharray');
    return;
   }else if(!marker.pattern?.shape)path.style.setProperty('fill',colour,'important');
   path.style.setProperty('fill-opacity','1','important');
   path.style.setProperty('stroke','rgba(255,255,255,0.85)','important');
   path.style.setProperty('stroke-width','0.65px','important');
   path.style.setProperty('stroke-linejoin','round','important');
  });
 });
 target.querySelectorAll('.urgent-whole-bar-outlines').forEach(el=>el.remove());
}

// Independent display-only capacity grouping for both availability charts.
let urgentGroupWithheld=false;
let routineGroupWithheld=false;
let plannedGroupWithheld=false;
for(const [id,isUrgent] of [['availabilityPageGroupWithheld',true],['routineAvailabilityPageGroupWithheld',false]]){
 const input=$(id);
 if(input)input.addEventListener('change',()=>{
  if(isUrgent){urgentGroupWithheld=input.checked;renderAvailabilityChart()}
  else{routineGroupWithheld=input.checked;renderRoutineAvailabilityChart()}
 });
}
let urgentSplitExtras=false,urgentAddSignposted=false;
for(const [id,setter] of [['urgentSplitExtras',value=>urgentSplitExtras=value],['urgentAddSignposted',value=>urgentAddSignposted=value]]){
 $(id)?.addEventListener('change',event=>{setter(event.target.checked);renderAvailabilityChart()});
}
// Weekly Today marker spans the visible bar: Mon 10%, Tue 30%, Wed 50%, Thu 70%, Fri 90%.
// Weekly charts use bargap 0.11, so the bar occupies 89% of its category.
function capacityTodayLabel(dateString=todayLondon){
 const date=new Date(dateString+'T12:00:00Z');
 const day=date.getUTCDate(),lastTwo=day%100;
 const suffix=lastTwo>=11&&lastTwo<=13?'th':({1:'st',2:'nd',3:'rd'}[day%10]||'th');
 const weekday=date.toLocaleDateString('en-GB',{weekday:'long',timeZone:'UTC'});
 const month=date.toLocaleDateString('en-GB',{month:'long',timeZone:'UTC'});
 return 'Today<br><span style="font-size:12px">'+weekday+' '+day+suffix+' '+month+'</span>';
}
// Keep Today inside a clear strip at the top of the plot, above the bars.
function capacityTodayAnnotation(todayX,bucketCount,width,dateString=todayLondon){
 const narrow=width<480;
 const date=new Date(dateString+'T12:00:00Z').toLocaleDateString('en-GB',{weekday:narrow?'short':'long',day:'numeric',month:narrow?'short':'long',timeZone:'UTC'});
 const plotWidth=Math.max(100,width-80),half=Math.min(0.5,(narrow?83:130)/plotWidth);
 return {xref:'paper',yref:'paper',x:Math.max(half,Math.min(1-half,(todayX+0.5)/bucketCount)),y:0.985,text:'<span style="font-weight:500">Today</span> · '+date,showarrow:false,xanchor:'center',yanchor:'top',font:{family:'Segoe UI,Arial,sans-serif',size:10,color:'#206ca6'},bgcolor:'rgba(255,255,255,0.75)',bordercolor:'#206ca6',borderwidth:1,borderpad:4};
}
function capacityWeekBeginningLabel(date){return 'w/b '+new Date(date+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'});}
function weeklyCapacityTodayX(weekIndex,dayIndex){
 const fraction=0.10+Math.min(Math.max(dayIndex,0),4)*0.20;
 return weekIndex+(fraction-0.5)*(1-0.11);
}
// Keep every availability status beside its own urgency group in a stack.
function capacityChartStatus(row,held,clock){
 let status=String(row.availability||'').trim().toLowerCase();
 if(status==='available'&&isMissedAvailableSlot(row,clock))return 'Missed Empty';
 return ({booked:'Booked',available:'Available',embargoed:held?'Held Back':'Embargoed',blocked:held?'Held Back':'Blocked'})[status]||null;
}
function capacityHoverDetails(dates,names,counts,held,heading){
 const statuses=['Missed Empty','Booked','Available',...(held?['Held Back']:['Embargoed','Blocked'])];
 const result=new Map();
 for(const date of dates){
  const groups=names.map(name=>{
   const items=statuses.map(status=>[status,counts.get(JSON.stringify([date,name,status]))||0]);
   return {name,colour:urgencyGroupColour(name),items,total:items.reduce((sum,item)=>sum+item[1],0)};
  });
  result.set(date,{heading:heading(date),groups,total:groups.reduce((sum,g)=>sum+g.total,0)});
 }
 return result;
}
function capacityGroupedSeries(dates,names,counts,held,heading,extras=[]){
 const statuses=['Missed Empty','Booked','Available',...(held?['Held Back']:['Embargoed','Blocked'])];
 const colours={'Available':'#ffffff','Embargoed':'#586674','Blocked':'#354454','Held Back':'#48535f'};
 const value=(date,group,status)=>counts.get(JSON.stringify([date,group,status]))||0;
 const totals=dates.map(date=>names.reduce((sum,group)=>sum+statuses.reduce((n,status)=>n+value(date,group,status),0),0)+extras.reduce((sum,item)=>sum+(counts.get(JSON.stringify([date,item.name]))||0),0));
 const traces=[];
 for(const group of names){
  const colour=group.endsWith(' · Extra')?(capacityColours.Extra||'#8aa6bd'):urgencyGroupColour(group);
  const summaries=dates.map(date=>simpleAvailabilityHover(heading(date)+' · '+group,statuses,statuses.map(status=>value(date,group,status)),statuses.reduce((n,status)=>n+value(date,group,status),0)));
  for(const status of statuses)traces.push({type:'bar',name:group+' · '+status,meta:{capacityGroup:group},showlegend:false,x:dates,y:dates.map(date=>value(date,group,status)),marker:{color:status==='Booked'?colour:status==='Missed Empty'?'#ffffff':colours[status],line:{width:0},...(status==='Missed Empty'?{pattern:{shape:'/',fgcolor:colour,bgcolor:'#ffffff',size:7,solidity:0.15},line:{width:0}}:{})},customdata:summaries,hovertemplate:'%{customdata}<extra></extra>'});
 }
 for(const group of names)traces.push({type:'scatter',mode:'markers',name:group,x:[null],y:[null],marker:{symbol:'circle',size:14,color:group.endsWith(' · Extra')?(capacityColours.Extra||'#8aa6bd'):urgencyGroupColour(group)},showlegend:true,hoverinfo:'skip'});
 // A patterned bar trace supplies an accurate striped legend swatch.
 traces.push({type:'bar',name:'Missed Empty',x:[null],y:[null],showlegend:true,marker:{color:'#ffffff',pattern:{shape:'/',fgcolor:'#586674',bgcolor:'#ffffff',size:7,solidity:0.15},line:{width:0}},hoverinfo:'skip'});
 for(const status of statuses.filter(s=>!['Booked','Missed Empty'].includes(s)))traces.push({type:'scatter',mode:'markers',name:status,x:[null],y:[null],marker:{symbol:'circle',size:14,color:colours[status],line:{color:status==='Available'?'#a7b8c6':colours[status],width:status==='Available'?1.5:0}},showlegend:true,hoverinfo:'skip'});
 for(const item of extras)traces.push({type:'bar',name:item.name,meta:{capacityGroup:item.name},x:dates,y:dates.map(date=>counts.get(JSON.stringify([date,item.name]))||0),marker:{color:item.colour},showlegend:true,customdata:dates.map(date=>simpleAvailabilityHover(heading(date),[item.name],[counts.get(JSON.stringify([date,item.name]))||0],counts.get(JSON.stringify([date,item.name]))||0)),hovertemplate:'%{customdata}<extra></extra>'});
 return {traces:traces.filter(trace=>trace.showlegend||trace.y.some(value=>value>0)),totals};
}
function renderAvailabilityChart(){
 const target=$('availabilityChart');
 if($('availabilityPage').classList.contains('hidden')||!window.Plotly||!target)return;
 restoreChartShadowControls();
 renderUrgentCategoryToggles();
 renderUrgentSideFilters();
 refreshAvailabilityOptionStates('urgent');
 renderClinicianTypeFilters('urgent');
 updateCollapsedFilterSummaries();
 const names=urgentCategoryNames().filter(n=>!urgentCategoryDisabled.has(n));
 const monday=new Date(thisWeek+'T12:00:00Z');const start=new Date(monday);start.setUTCDate(start.getUTCDate()-7*urgentWeeksBack);
 const weekCount=urgentWeeksBack+urgentWeeksForward+1;
 const dates=[];for(let w=0;w<weekCount;w++)for(let d=0;d<7;d++){const day=new Date(start);day.setUTCDate(start.getUTCDate()+w*7+d);dates.push(day.toISOString().slice(0,10))}
 const dateSet=new Set(dates);
 const weekdays=new Set(dates.filter(d=>{const n=new Date(d+'T12:00:00Z').getUTCDay();return n!==0&&n!==6}));
 const counts=new Map();
 const clock=capacitySnapshotClock();
 const selectedNames=new Set(names);
 for(const r of availabilityRecords){
  if(!weekdays.has(r.date)||!locumMatches(r,'availabilityPage'))continue;
  const capacityStatus=String(capacityAssignments[r.slot]||'').trim().toLowerCase();
  const referral=capacityUrgencyCategory(r.slot).trim().toLowerCase()==='111 referral';
  // Referral slots can be recorded as Sent External; retain them in their
  // configured urgency group instead of hiding them with the retired toggle.
  if(capacityStatus==='sent external'&&!referral)continue;
  if(excludedSlotTypes.has(r.slot))continue;
  if(!selectedNames.has(capacityUrgencyCategory(r.slot))||(!referral&&!urgentClinicianMatches(r.clinician,r.person))||(!referral&&!urgentConsultMatches(r.slot)))continue;
  const urgency=capacityUrgencyCategory(r.slot);
  const group=urgency;
  const label=capacityChartStatus(r,urgentGroupWithheld,clock)||(referral&&capacityStatus==='sent external'?'Booked':null);
  if(!label)continue;
  const key=JSON.stringify([r.date,group,label]);counts.set(key,(counts.get(key)||0)+r.count);
 }

 const weekly=urgentAvailabilityGranularity==='week';
 const buckets=weekly?Array.from({length:weekCount},(_,i)=>dates[i*7]):dates;
 const bucketFor=date=>weekly?mondayOf(date):date;
 if(weekly){
  const aggregated=new Map();
  for(const [key,count] of counts){const [date,...parts]=JSON.parse(key);const k=JSON.stringify([bucketFor(date),...parts]);aggregated.set(k,(aggregated.get(k)||0)+count);}
  counts.clear();for(const [key,count] of aggregated)counts.set(key,count);
 }
 const heading=date=>weekly?'Week commencing '+new Date(date+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}):new Date(date+'T12:00:00Z').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
 const extras=[];
 const {traces,totals}=capacityGroupedSeries(buckets,names,counts,urgentGroupWithheld,heading,extras);
 target._capacityHoverData=capacityHoverDetails(buckets,names,counts,urgentGroupWithheld,heading);
 const predictNeed=names.length?window.getUrgentCapacityPredictor?.(names):null;
 const predictedNeeds=buckets.map(bucket=>predictNeed?.(bucket,weekly)??null);
 const max=Math.ceil(Math.max(1,...totals,...predictedNeeds)*1.2/10)*10;
 const weekLabels=Array.from({length:weekCount},(_,i)=>{const offset=i-urgentWeeksBack;return offset===0?'This Week':offset===-1?'Last Week':offset<0?Math.abs(offset)+' weeks ago':offset===1?'Next Week':offset+' weeks'});
 const annotations=weekLabels.map((text,i)=>({x:weekly?buckets[i]:dates[i*7+2],xref:'x',y:1.045,yref:'paper',text,showarrow:false,font:{size:13,color:'#344b60'},xanchor:'center',yanchor:'bottom'}));
 const shapes=Array.from({length:weekCount-1},(_,i)=>({type:'line',xref:'x',yref:'paper',x0:weekly?i+0.5:i*7+5.5,x1:weekly?i+0.5:i*7+5.5,y0:0,y1:1,line:{color:'#bdcbd6',width:1,dash:'dot'}}));
 if(dateSet.has(todayLondon)){
  const x=weekly?weeklyCapacityTodayX(urgentWeeksBack,(new Date(todayLondon+'T12:00:00Z').getUTCDay()+6)%7):dates.indexOf(todayLondon);
  shapes.unshift({type:'rect',xref:'x',yref:'paper',x0:weekly?-.5:-.9,x1:x,y0:0,y1:1,fillcolor:'rgba(97,112,130,0.12)',line:{width:0},layer:'above'});
  shapes.push({type:'line',xref:'x',yref:'paper',x0:x,x1:x,y0:0,y1:0.91,line:{color:'#257cb6',width:2.5,dash:'dot'},layer:'above'});
  annotations.push(capacityTodayAnnotation(x,buckets.length,target.clientWidth));
 }
 buckets.forEach((date,i)=>{if((weekly||weekdays.has(date))&&totals[i])annotations.push({x:date,xref:'x',y:totals[i],yref:'y',text:String(totals[i]),showarrow:false,font:{size:weekly?13:10,color:'#425b70'},yshift:15+Math.max(0,names.length-1)*5,yanchor:'bottom'})});
 let showNeedLegend=true;
 predictedNeeds.forEach((value,index)=>{
  if(value===null)return;
  const marker={type:'line',xref:'x',yref:'y',x0:index-.46,x1:index+.46,y0:value,y1:value,layer:'above',legendgroup:'urgent-predicted-need'};
  shapes.push({...marker,showlegend:false,line:{color:'#fff',width:5,dash:'8px,4px'}});
  shapes.push({...marker,showlegend:showNeedLegend,name:'Predicted need',line:{color:'#087c83',width:3,dash:'8px,4px'}});
  showNeedLegend=false;
  const details=target._capacityHoverData.get(buckets[index]);
  if(details)details.predictedNeed=value;
 });
 const note=$('availabilityNote');if(note)note.textContent=names.length?'':'Select an Urgent detailed Appointment Types to display appointments.';
 renderPreferencePlot(target,traces,{dragmode:false,
  autosize:true,height:640,barmode:'stack',barcornerradius:weekly?6:5,bargap:weekly?0.11:0.025,margin:{l:62,r:18,t:40,b:100},paper_bgcolor:'white',plot_bgcolor:'#e1eaf1',
  legend:{orientation:'h',x:0.5,y:-0.23,xanchor:'center',yanchor:'top',font:{size:13,color:'#42576a'},bgcolor:'rgba(255,255,255,0)'},
  xaxis:{type:'category',categoryorder:'array',categoryarray:buckets,tickmode:'array',tickvals:buckets,ticktext:buckets.map(date=>weekly?capacityWeekBeginningLabel(date):weekdays.has(date)?new Date(date+'T12:00:00Z').toLocaleDateString('en-GB',{weekday:'short',timeZone:'UTC'}):''),tickangle:weekly?0:-90,tickfont:{size:12,color:'#444444'},showgrid:false,range:[weekly?-.5:-.9,buckets.length-.5],fixedrange:true},
  yaxis:{title:{text:'Appointment slots',font:{size:12,color:'#708397'}},tickfont:{size:12,color:'#52677b'},range:[0,max],gridcolor:'#e0e8ef',gridwidth:1,zeroline:false,showline:false},annotations,shapes,hovermode:'closest',hoverlabel:{bgcolor:'#ffffff',bordercolor:'#dce5ed',font:{family:'Arial',size:12,color:'#182b3b'},align:'left',namelength:0}
 },{responsive:true,displaylogo:false,displayModeBar:false,scrollZoom:false,doubleClick:false}).then(()=>{applyFlatAvailabilityBars(target,!weekly,true);installAvailabilityCardTooltip(target)});
}
window.addEventListener('resize',()=>{if(!$('availabilityPage').classList.contains('hidden'))renderAvailabilityChart()});
setupUrgentRangeControls();

// Independent filters for Routine Appointment Availability.
const routineDisabledTypes=new Set();
let routineUrgencyDefaultsApplied=false;
function applyRoutineUrgencyDefaults(){
 if(routineUrgencyDefaultsApplied||!routineDetailedTypes().length)return;
 routineDisabledTypes.clear();
 for(const name of routineDetailedTypes())if(name.trim().toLowerCase()!=='routine')routineDisabledTypes.add(name);
 routineUrgencyDefaultsApplied=true;
}
function routineDetailedTypes(){
 return groupUrgencyNames.filter(isDashboardToggleOption);
}
function renderRoutineCategoryToggles(){
 const root=$('routineCategoryToggles');if(!root)return;
 applyRoutineUrgencyDefaults();
 const names=prioritySort('urgency',routineDetailedTypes().filter(isDashboardToggleOption));
 const old=[...root.querySelectorAll('input[data-filter-name]')].map(el=>el.dataset.filterName);
 if(old.length===names.length&&names.every(name=>old.includes(name))){
  root.querySelectorAll('input[data-filter-name]').forEach(input=>input.nextElementSibling?.style.setProperty('--switch-on',urgencyGroupColour(input.dataset.filterName)));
  return;
 }
 root.replaceChildren();
 if(!names.length){root.textContent='Create Appointment Types in Slot Settings.';return}
 for(const name of names){
  const row=document.createElement('label');row.className='filter-row';
  const sw=document.createElement('span');sw.className='switch';
  const input=document.createElement('input');input.type='checkbox';input.setAttribute('role','switch');input.dataset.filterName=name;
  input.checked=!routineDisabledTypes.has(name);input.setAttribute('aria-label','Include '+name);
  const track=document.createElement('span');track.className='switch-track';
  track.style.setProperty('--switch-on',urgencyGroupColour(name));
  const caption=document.createElement('span');caption.textContent=name;
  sw.append(input,track);row.append(sw,caption);root.append(row);
  input.addEventListener('change',()=>{input.checked?routineDisabledTypes.delete(name):routineDisabledTypes.add(name);renderRoutineAvailabilityChart()});
 }
}
const routineDisabledClinicianGroups=new Set();
const routineDisabledConsultModes=new Set();
function renderRoutineAvailabilityFilters(){
 const build=(id,names,disabled,empty)=>{
  names=names.filter(isDashboardToggleOption);
  const root=$(id);if(!root)return;
  const previous=[...root.querySelectorAll('input')].map(el=>el.getAttribute('data-filter-name'));
  if(previous.length===names.length&&names.every((name,i)=>name===previous[i])){root.querySelectorAll('input[data-filter-name]').forEach(input=>input.nextElementSibling?.style.setProperty('--switch-on',id==='routineClinicianFilters'?clinicianGroupColour(input.dataset.filterName):(consultModeColours[input.dataset.filterName]||'#638fac')));return;}
  root.replaceChildren();
  if(!names.length){const note=document.createElement('span');note.className='hint';note.textContent=empty;root.append(note);return}
  for(const name of names){
   const row=document.createElement('label');row.className='filter-row';
   const switchEl=document.createElement('span');switchEl.className='switch';
   const input=document.createElement('input');input.type='checkbox';input.setAttribute('role','switch');input.setAttribute('data-filter-name',name);
   input.checked=!disabled.has(name);input.setAttribute('aria-label','Include '+name);
   const track=document.createElement('span');track.className='switch-track';track.style.setProperty('--switch-on',id==='routineClinicianFilters'?clinicianGroupColour(name):(consultModeColours[name]||'#638fac'));
   const title=document.createElement('span');title.textContent=name;
   switchEl.append(input,track);row.append(switchEl,title);root.append(row);
   input.addEventListener('change',()=>{
    changeAvailabilityFilter('routine',disabled,name,input.checked,input);
   });
  }
 };
 build('routineClinicianFilters',clinicianGroupNames,routineDisabledClinicianGroups,'Create clinician groups in Manage categories.');
 build('routineConsultFilters',consultCategoryNames,routineDisabledConsultModes,'Create consult modes in Manage categories.');
}
function routineClinicianMatches(clinician,person){
 if(clinician==='Signposting (no clinician recorded)')return true;
 const detailed=effectiveClinicianType(clinician,person);
 const group=clinicianGroupAssignments[detailed];
 return clinicianGroupNames.includes(group)&&!routineDisabledClinicianGroups.has(group)&&!routineDisabledClinicianTypes.has(detailed);
}
function routineConsultMatches(slot){
 if(signpostingSlotNames.has(slot))return true;
 const mode=consultAssignments[slot];
 return consultCategoryNames.includes(mode)&&!routineDisabledConsultModes.has(mode);
}
let routineStartWeek=-1,routineEndWeek=6;
let routineAvailabilityGranularity='week';
function setRoutineAvailabilityGranularity(mode){
 routineAvailabilityGranularity=mode==='day'?'day':'week';
 const switchInput=$('routineDaysWeeksSwitch');if(switchInput)switchInput.checked=routineAvailabilityGranularity==='week';
 renderRoutineAvailabilityChart();
}
$('routineDaysWeeksSwitch')?.addEventListener('change',event=>setRoutineAvailabilityGranularity(event.target.checked?'week':'day'));

function setupRoutineRangeControls(){
 const start=$('routineWeeksStart'),end=$('routineWeeksEnd');
 if(!start||!end)return;
 const label=n=>n===0?'This week':n===-1?'Last week':n<0?Math.abs(n)+' weeks ago':n===1?'Next week':n+' weeks ahead';
 const update=changed=>{
  let a=Number(start.value),b=Number(end.value);
  a=Math.max(-2,Math.min(0,a));
  b=Math.max(1,Math.min(7,b));
  start.value=a;end.value=b;
  routineStartWeek=a;routineEndWeek=b;
  $('routineWeeksStartValue').textContent=label(a);
  $('routineWeeksEndValue').textContent=label(b);
  const left=(a+2)/9*100,right=(b+2)/9*100;
  const active=$('routineRangeActive');active.style.left='calc(12px + (100% - 24px)*'+(left/100)+')';active.style.width='calc((100% - 24px)*'+((right-left)/100)+')';
  renderRoutineAvailabilityChart();
 };
 start.addEventListener('input',()=>update('start'));
 end.addEventListener('input',()=>update('end'));
 update('start');
}
// Visual-only finish for the Routine stacked bars. The original Plotly data,
// hover targets, shading and Today geometry are left untouched.
function renderRoutineAvailabilityChart(){
 const target=$('routineAvailabilityChart');
 if(!target||$('routineAvailabilityPage').classList.contains('hidden')||!window.Plotly)return;
 restoreChartShadowControls();
 renderRoutineAvailabilityFilters();
 renderRoutineCategoryToggles();
 refreshAvailabilityOptionStates('routine');
 renderClinicianTypeFilters('routine');
 updateCollapsedFilterSummaries();
 const isDaily=routineAvailabilityGranularity==='day';
 const start=new Date(thisWeek+'T12:00:00Z');start.setUTCDate(start.getUTCDate()+7*routineStartWeek);
 const weeks=[];
 for(let i=0;i<=routineEndWeek-routineStartWeek;i++){const d=new Date(start);d.setUTCDate(start.getUTCDate()+7*i);weeks.push(d.toISOString().slice(0,10));}
 const dates=[];
 if(isDaily){
  for(const w of weeks)for(let d=0;d<7;d++){const dt=new Date(w+'T12:00:00Z');dt.setUTCDate(dt.getUTCDate()+d);dates.push(dt.toISOString().slice(0,10));}
 }else dates.push(...weeks);
 const byBucket=new Map();
 const clock=capacitySnapshotClock();
 let matched=0;
 const bucketSet=new Set(dates);
 const activeTypes=new Set(routineDetailedTypes().filter(name=>!routineDisabledTypes.has(name)));
 const firstDate=weeks[0],lastDate=dayView2AddDays(weeks[weeks.length-1],7);
 const weekForDate=new Map();
 for(const r of availabilityRecords){
  // Discard historical rows before category checks or date parsing.
  if(r.date<firstDate||r.date>=lastDate||excludedSlotTypes.has(r.slot)||!locumMatches(r,'routineAvailabilityPage'))continue;
  const group=capacityUrgencyCategory(r.slot);
  if(!activeTypes.has(group)||!routineClinicianMatches(r.clinician,r.person)||!routineConsultMatches(r.slot))continue;
  let bucket=r.date;
  if(!isDaily){
   if(!weekForDate.has(r.date))weekForDate.set(r.date,mondayOf(r.date));
   bucket=weekForDate.get(r.date);
  }
  if(!bucketSet.has(bucket))continue;
  const label=capacityChartStatus(r,routineGroupWithheld,clock);
  if(!label)continue;
  matched+=r.count;
  const key=JSON.stringify([bucket,group,label]);byBucket.set(key,(byBucket.get(key)||0)+r.count);
 }
 const heading=date=>isDaily?new Date(date+'T12:00:00Z').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'short',timeZone:'UTC'}):'Week commencing '+new Date(date+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'});
 const plotBackground='#e1eaf1';
 const types=routineDetailedTypes().filter(name=>!routineDisabledTypes.has(name));
 const {traces,totals}=capacityGroupedSeries(dates,types,byBucket,routineGroupWithheld,heading);
 target._capacityHoverData=capacityHoverDetails(dates,types,byBucket,routineGroupWithheld,heading);
 const max=Math.max(1,...totals);
 const annotations=totals.flatMap((total,i)=>total?[{xref:'x',x:i,y:total,text:total.toLocaleString('en-GB'),showarrow:false,yshift:15+Math.max(0,types.length-1)*5,font:{size:isDaily?10:13,color:'#425b70'}}]:[]);
 const weekTitles=weeks.map((_,i)=>{const offset=routineStartWeek+i;return offset===0?'This Week':offset===-1?'Last Week':offset<0?Math.abs(offset)+' weeks ago':offset===1?'Next Week':offset+' weeks'});
 for(let i=0;i<weeks.length;i++)annotations.push({xref:'x',yref:'paper',x:isDaily?i*7+3:i,y:1.045,text:weekTitles[i],showarrow:false,font:{family:'Arial',size:13,color:'#344b60'}});
 const dayIndex=(new Date(todayLondon+'T12:00:00Z').getUTCDay()+6)%7;
 const weekIndex=weeks.indexOf(thisWeek);
 const todayX=weekIndex<0?null:isDaily?dates.indexOf(todayLondon):weeklyCapacityTodayX(weekIndex,dayIndex);
 const shapes=todayX===null?[]:[
  {type:'rect',xref:'x',yref:'paper',x0:isDaily?-0.9:-0.5,x1:todayX,y0:0,y1:1,fillcolor:'rgba(97,112,130,0.12)',line:{width:0},layer:'above'},
  {type:'line',xref:'x',yref:'paper',x0:todayX,x1:todayX,y0:0,y1:0.91,line:{color:'#257cb6',width:2.5,dash:'dot'},layer:'above'}
 ];
 for(let i=0;i<weeks.length-1;i++){const boundary=isDaily?(i+1)*7-0.5:i+0.5;shapes.push({type:'line',xref:'x',yref:'paper',x0:boundary,x1:boundary,y0:0,y1:1,line:{color:'#bdcbd6',width:1,dash:'dot'},layer:'above'});}
 if(todayX!==null)annotations.push(capacityTodayAnnotation(todayX,dates.length,target.clientWidth));
 const note=$('routineAvailabilityNote');
 if(note)note.textContent=matched?'':"No matching Routine Appointment Types appointments found. Check Manage categories → Appointment Types.";
 renderPreferencePlot(target,traces,{dragmode:false,
  height:640,autosize:true,barmode:'stack',barcornerradius:isDaily?5:6,bargap:isDaily?0.07:0.11,
  margin:{l:62,r:18,t:40,b:100},paper_bgcolor:'#fff',plot_bgcolor:plotBackground,
  legend:{orientation:'h',x:0.5,y:-0.20,xanchor:'center',yanchor:'top',font:{size:13,color:'#42576a'},traceorder:'normal'},
  xaxis:{type:'category',categoryorder:'array',categoryarray:dates,range:[isDaily?-0.9:-0.5,dates.length-0.5],tickmode:'array',tickvals:dates,ticktext:dates.map(date=>isDaily?([0,6].includes(new Date(date+'T12:00:00Z').getUTCDay())?'':new Date(date+'T12:00:00Z').toLocaleDateString('en-GB',{weekday:'short',timeZone:'UTC'})):capacityWeekBeginningLabel(date)),tickangle:isDaily?-90:0,tickfont:{size:isDaily?10:12},showticklabels:true,showgrid:false,showline:true,linecolor:'#a9b9c7',linewidth:1.5,zeroline:false,fixedrange:true},
  yaxis:{title:{text:'Appointment slots',font:{size:12,color:'#708397'}},tickfont:{size:12,color:'#52677b'},range:[0,Math.ceil(max*1.18/10)*10],gridcolor:'#e0e8ef',gridwidth:1,zeroline:false,showline:false},
  annotations,shapes,hovermode:'closest',hoverlabel:{bgcolor:'#ffffff',bordercolor:'#dce5ed',font:{family:'Arial',size:12,color:'#182b3b'},align:'left',namelength:0}
 },{responsive:true,displaylogo:false,displayModeBar:false,scrollZoom:false,doubleClick:false}).then(()=>{applyFlatAvailabilityBars(target,isDaily,true);installAvailabilityCardTooltip(target)});
}
window.addEventListener('resize',()=>{if(!$('routineAvailabilityPage').classList.contains('hidden'))renderRoutineAvailabilityChart()});
setupRoutineRangeControls();






window.addEventListener('unhandledrejection',event=>{
 const message=event.reason?.message||String(event.reason||'Unknown background error');
 console.error('Unhandled dashboard error',event.reason);
 if($('dashboardShell')&&!$('dashboardShell').classList.contains('hidden')){
  setSync('Background error: '+message+' · You are still signed in.');
 }
});
window.addEventListener('error',event=>{
 if($('dashboardShell')&&!$('dashboardShell').classList.contains('hidden')){
  setSync('Dashboard error: '+event.message+' · You are still signed in.');
 }
});


// Booking Times: independently switchable Urgency Groups, Clinician Groups and Consult modes.
const bookingTimesDisabledUrgency=new Set();
let bookingTimesUrgencyInitialised=false;
function bookingTimeAmPm(time){const [hour,minute]=time.split(':').map(Number);return String(hour%12||12)+(minute?':'+String(minute).padStart(2,'0'):'')+(hour>=12?'pm':'am');}
const bookingTimesDisabledClinician=new Set();
const bookingTimesDisabledConsult=new Set();
function bookingTimesRecordGroups(r){return {urgency:groupUrgencyAssignments[assignments[r.slot]],clinician:clinicianGroupAssignments[effectiveClinicianType(r.clinician,r.person)],consult:consultAssignments[r.slot]};}
function bookingTimesHasData(overrides={}){
 const u=overrides.urgency||bookingTimesDisabledUrgency,c=overrides.clinician||bookingTimesDisabledClinician,m=overrides.consult||bookingTimesDisabledConsult;
 return bookingTimeRecords.some(r=>{if(!(r.count>0&&Number.isFinite(r.minute)&&r.minute>=0&&r.minute<1440))return false;const g=bookingTimesRecordGroups(r);return groupUrgencyNames.includes(g.urgency)&&!u.has(g.urgency)&&clinicianGroupNames.includes(g.clinician)&&!c.has(g.clinician)&&consultCategoryNames.includes(g.consult)&&!m.has(g.consult)});
}
function bookingTimesOptions(groupsFor=chartDimensionLookup(bookingTimesRecordGroups)){
 const options={urgency:new Set(),clinician:new Set(),consult:new Set()};
 for(const row of bookingTimeRecords){
  if(!(row.count>0&&Number.isFinite(row.minute)&&row.minute>=0&&row.minute<1440))continue;
  const g=groupsFor(row),u=!bookingTimesDisabledUrgency.has(g.urgency),c=!bookingTimesDisabledClinician.has(g.clinician),m=!bookingTimesDisabledConsult.has(g.consult);
  if(c&&m)options.urgency.add(g.urgency);
  if(u&&m)options.clinician.add(g.clinician);
  if(u&&c)options.consult.add(g.consult);
 }
 return options;
}
function bookingTimesAvailableNames(dimension,names){const possible=bookingTimesOptions()[dimension];return names.filter(name=>possible.has(name));}
function bookingTimesTogglePanel(id,names,disabled,dimension){
 const root=$(id);if(!root)return;
 const current=[...root.querySelectorAll('input[data-filter-name]')].map(input=>input.dataset.filterName);
 if(current.length===names.length&&current.every((name,i)=>name===names[i])){root.querySelectorAll('input[data-filter-name]').forEach(input=>{input.checked=!disabled.has(input.dataset.filterName)});updateCollapsedFilterSummaries();return;}
 root.replaceChildren();
 if(!names.length){const span=document.createElement('span');span.className='hint';span.textContent='No data for these filters';root.append(span);updateCollapsedFilterSummaries();return;}
 for(const name of names){
  const label=document.createElement('label');label.className='filter-row';
  const switchWrap=document.createElement('span');switchWrap.className='switch';
  const input=document.createElement('input');input.type='checkbox';input.setAttribute('role',dimension==='urgency'?'radio':'switch');
  input.dataset.filterName=name;input.checked=!disabled.has(name);input.setAttribute('aria-label',(dimension==='urgency'?'Select ':'Include ')+name);
  const track=document.createElement('span');track.className='switch-track';
  track.style.setProperty('--switch-on',dimension==='urgency'?urgencyGroupColour(name):dimension==='clinician'?clinicianGroupColour(name):'#638fac');
  const caption=document.createElement('span');caption.textContent=name;
  switchWrap.append(input,track);label.append(switchWrap,caption);root.append(label);
  input.addEventListener('change',()=>{
   if(dimension==='urgency'){
    // Urgency is single-select; clicking the selected group cannot clear it.
    if(disabled.has(name)){
     const proposed=new Set(groupUrgencyNames.filter(group=>group!==name));
     if(bookingTimesHasData({urgency:proposed})){
      disabled.clear();for(const group of proposed)disabled.add(group);
      writeChartPreference('bookingTimes:urgency',name);
     }
    }
   }else{
    const proposed=new Set(disabled);if(input.checked)proposed.delete(name);else proposed.add(name);
    if(bookingTimesHasData({[dimension]:proposed})){disabled.clear();for(const group of proposed)disabled.add(group)}
    input.checked=!disabled.has(name);
   }
   renderBookingTimesChart();
  });
 }
 updateCollapsedFilterSummaries();
}
function roundBookingTimesLabels(chart){chart.querySelectorAll('.annotation .bg').forEach(rect=>{rect.setAttribute('rx','9');rect.setAttribute('ry','9');rect.style.fill='#ffffff';rect.style.stroke='#dce4ec';});}
function renderBookingTimesChart(){
 const chart=$('bookingTimesChart');
 if(!chart||$('bookingTimesPage').classList.contains('hidden')||!window.Plotly)return;
 const groupsFor=chartDimensionLookup(bookingTimesRecordGroups);
 let options=bookingTimesOptions(groupsFor);
 if(!bookingTimesUrgencyInitialised&&bookingTimeRecords.length&&groupUrgencyNames.length){
  const available=groupUrgencyNames.filter(name=>options.urgency.has(name));
  const saved=readChartPreferences();
  const legacy=available.filter(name=>saved['checkbox:bookingTimesPage:bookingTimesUrgencyFilters:'+name]===true);
  const lastChoice=saved['bookingTimes:urgency']||(legacy.length===1?legacy[0]:null);
  const preferred=available.find(name=>name===lastChoice)||available.find(name=>name.trim().toLowerCase()==='urgent')||available[0];
  if(preferred){bookingTimesDisabledUrgency.clear();for(const name of groupUrgencyNames)if(name!==preferred)bookingTimesDisabledUrgency.add(name);bookingTimesUrgencyInitialised=true;}
 }
 const availableUrgency=groupUrgencyNames.filter(name=>options.urgency.has(name));
 const selectedUrgency=availableUrgency.find(name=>!bookingTimesDisabledUrgency.has(name));
 if(!selectedUrgency&&availableUrgency.length){const fallback=availableUrgency[0];bookingTimesDisabledUrgency.clear();for(const name of groupUrgencyNames)if(name!==fallback)bookingTimesDisabledUrgency.add(name);}
 options=bookingTimesOptions(groupsFor);
 bookingTimesTogglePanel('bookingTimesUrgencyFilters',availableUrgency,bookingTimesDisabledUrgency,'urgency');
 bookingTimesTogglePanel('bookingTimesClinicianFilters',clinicianGroupNames.filter(name=>options.clinician.has(name)),bookingTimesDisabledClinician,'clinician');
 bookingTimesTogglePanel('bookingTimesConsultFilters',consultCategoryNames.filter(name=>options.consult.has(name)),bookingTimesDisabledConsult,'consult');
 const bins=Array(96).fill(0);
 let count=0;
 for(const r of bookingTimeRecords){
  if(excludedSlotTypes.has(r.slot)||!locumMatches(r,'bookingTimesPage'))continue;
  const {urgency,clinician,consult}=groupsFor(r);
  if(!groupUrgencyNames.includes(urgency)||bookingTimesDisabledUrgency.has(urgency))continue;
  if(!clinicianGroupNames.includes(clinician)||bookingTimesDisabledClinician.has(clinician))continue;
  if(!consultCategoryNames.includes(consult)||bookingTimesDisabledConsult.has(consult))continue;
  if(!Number.isFinite(r.minute)||r.minute<0||r.minute>=1440)continue;
  bins[Math.floor(r.minute/15)]+=r.count;count+=r.count;
 }
 // Preserve the full-day denominator so the 50% marker means half of all bookings.
 const times=Array.from({length:96},(_,i)=>String(Math.floor(i/4)).padStart(2,'0')+':'+String((i%4)*15).padStart(2,'0'));
 let running=0;
 const cumulative=bins.map(n=>{running+=n;return count?running/count*100:0});
 const visibleStart=24; // 06:00
 const visibleEnd=84;   // 21:00 (exclusive for 15-minute bins)
 const visibleTimes=times.slice(visibleStart,visibleEnd);
 const visibleBins=bins.slice(visibleStart,visibleEnd);
 const visibleCumulative=cumulative.slice(visibleStart,visibleEnd);
 const tickvals=visibleTimes.filter((_,i)=>i%8===0);
 const percentileMarkers=[50,75].map((percent,index)=>{
  const bin=count?cumulative.findIndex(value=>value>=percent):-1;
  if(bin<visibleStart||bin>=visibleEnd)return null;
  return {percent,time:times[bin],colour:index===0?'#526b82':'#7a6477'};
 }).filter(Boolean);
 const shapes=percentileMarkers.map(({percent,time,colour})=>({type:'line',xref:'x',yref:'y2',x0:time,x1:time,y0:0,y1:percent,line:{color:colour,width:2,dash:'dot'}}));
 // Place labels in the open area above the percentile intersection, rather
 // than on top of the cumulative line. Separate the two labels vertically.
 const annotations=percentileMarkers.map(({percent,time,colour})=>({
  xref:'x',yref:'y2',x:time,y:percent,text:'<b>'+percent+'% · '+bookingTimeAmPm(time)+'</b>',
  showarrow:false,xanchor:'center',yanchor:'bottom',yshift:percent===50?24:28,
  font:{size:15,color:'#28445c'},bgcolor:'#ffffff',bordercolor:'#dce4ec',borderwidth:1,borderpad:5
 }));
 const traces=[
  {type:'bar',name:'Bookings per 15 minutes',x:visibleTimes,y:visibleBins,marker:{color:'#8fb4d3',line:{width:0}},hovertemplate:'%{x}–15 min later<br>%{y:,} bookings<extra></extra>',yaxis:'y'},
  {type:'scatter',mode:'lines',name:'Cumulative %',x:visibleTimes,y:visibleCumulative,yaxis:'y2',line:{color:'#bc756e',width:3.5,shape:'spline',smoothing:0.8},hovertemplate:'%{x}<br>%{y:.1f}% booked by this time<extra></extra>'}
 ];
 renderPreferencePlot(chart,traces,{dragmode:false,
  height:540,autosize:true,margin:{l:90,r:95,t:75,b:85},
  paper_bgcolor:'#fff',plot_bgcolor:'#f1f3f5',bargap:0.04,
  legend:{orientation:'h',x:0,y:1.13,xanchor:'left',yanchor:'bottom'},
  xaxis:{type:'category',categoryorder:'array',categoryarray:visibleTimes,tickmode:'array',tickvals,ticktext:tickvals.map(bookingTimeAmPm),title:{text:'Booking time',font:{size:16,color:'#28445c'},standoff:18},showgrid:false,showline:true,linecolor:'#536b80',linewidth:3,ticks:'outside',tickcolor:'#536b80',tickwidth:2,ticklen:6},
  yaxis:{title:{text:'Number of bookings',font:{size:16,color:'#28445c'},standoff:14},visible:true,showticklabels:true,rangemode:'tozero',showgrid:false,zeroline:false,showline:true,linecolor:'#536b80',linewidth:3,ticks:'outside',tickcolor:'#536b80',tickwidth:2,ticklen:6},
  yaxis2:{title:'Cumulative bookings (%)',overlaying:'y',side:'right',range:[0,100],ticksuffix:'%',showgrid:true,gridcolor:'#d9e1e8',zeroline:false,showline:true,linecolor:'#536b80',linewidth:3},
  shapes,annotations,hovermode:'x unified'
 },{responsive:true,displaylogo:false,displayModeBar:false,scrollZoom:false}).then(()=>roundBookingTimesLabels(chart));
 const note=$('bookingTimesNote');
 if(note)note.textContent=count?count.toLocaleString('en-GB')+' booked appointments across the loaded CSV files and selected categories.':'No bookings match these filters. Check category assignments in Manage categories.';
}
window.addEventListener('resize',()=>{if(!$('bookingTimesPage').classList.contains('hidden'))renderBookingTimesChart()});

setupTogglePriority();


/* Appointment Type Toggle Box: shared outline fieldsets; individual types own selection. */
const PRIMARY_APPT_ROOT_IDS=['demandUrgencyToggles','urgentCategoryToggles','routineCategoryToggles','plannedCategoryToggles','dayView2UrgencyToggles','waitingUrgencyToggles','waitingTrendUrgencyToggles','dailyForecastFilters','weeklyForecastFilters','bookingTimesUrgencyFilters','planningAppointment'];
function appointmentFilterActions(group,label){
 const actions=document.createElement('span');
 actions.className='appointment-filter-actions';
 const icons=[
  [false,'Clear','<path d="m7 21-4-4a2 2 0 0 1 0-3L14 3a2 2 0 0 1 3 0l4 4a2 2 0 0 1 0 3L10 21H7Zm1-11 8 8M10 21h12"/>'],
  [true,'Select all in','<path d="m2 12 5 5L19 5m-8 12 3 3L23 9"/>']
 ];
 for(const [checked,verb,path] of icons){
  const button=document.createElement('button');
  button.type='button';
  button.title=verb+' '+label;
  button.setAttribute('aria-label',button.title);
  button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+path+'</svg>';
  button.addEventListener('click',()=>{
   appointmentBulkFilterChange=true;
   try{
    for(const input of group.querySelectorAll('label.filter-row input[type="checkbox"]')){
     if(input.disabled||input.closest('.filter-row').hidden||input.checked===checked)continue;
     input.checked=checked;
     input.dispatchEvent(new Event('change',{bubbles:true}));
    }
   }finally{appointmentBulkFilterChange=false;}
   updateCollapsedFilterSummaries();
  });
  actions.append(button);
 }
 return actions;
}
function enhancePrimaryApptTypeBox(root){
 if(!root)return;
 root.classList.add('appointment-type-toggle-box');
 const rows=[...root.querySelectorAll('label.filter-row')].filter(row=>row.querySelector('input[type="checkbox"]'));
 if(!rows.length)return;
 const entries=rows.map(row=>{
  const input=row.querySelector('input[type="checkbox"]');
  return {row,input,name:input.dataset.filterName||input.dataset.urgencyGroup||input.dataset.forecastName||row.textContent.trim()};
 });
 if(entries.some(e=>!e.name||!groupUrgencyNames.includes(e.name)))return;
 const buckets=new Map();
 for(const entry of entries){
  const category=appointmentCategoryFor(entry.name)||'Other';
  if(!buckets.has(category))buckets.set(category,[]);
  buckets.get(category).push(entry);
 }
 const order=[...new Set([...appointmentCategoryNames,'Other',...buckets.keys()])].filter(c=>buckets.get(c)?.length);
 const existing=[...root.children];
 if(existing.length===order.length&&existing.every((section,i)=>section.matches('fieldset.primary-appt-category')&&section.querySelector('legend')?.textContent===order[i]&&[...section.querySelectorAll('label.filter-row')].length===buckets.get(order[i]).length&&[...section.querySelectorAll('label.filter-row')].every((row,j)=>row===buckets.get(order[i])[j].row)))return;
 const focused=document.activeElement;
 const fragment=document.createDocumentFragment();
 for(const category of order){
  const items=buckets.get(category);if(!items?.length)continue;
  const section=document.createElement('fieldset');section.className='primary-appt-category';
  const title=document.createElement('legend');title.className='primary-appt-category-heading';title.textContent=category;
  const children=document.createElement('div');children.className='primary-appt-category-items';
  // Move the original rows, retaining their sizes, checked state and event handlers.
  for(const item of items)children.append(item.row);
  title.append(appointmentFilterActions(section,category));
  section.append(title,children);fragment.append(section);
 }
 root.replaceChildren(fragment);
 if(root.contains(focused))focused.focus();
}
function installPrimaryApptTypeBoxConvention(){
 // Observe only the small set of appointment-type filter roots, never the whole
 // dashboard: Plotly and tooltip DOM updates can otherwise cause constant work.
 for(const id of PRIMARY_APPT_ROOT_IDS){
  const root=document.getElementById(id);
  if(!root)continue;
  let pending=false;
  const refresh=()=>{
   if(pending)return;
   pending=true;
   queueMicrotask(()=>{pending=false;enhancePrimaryApptTypeBox(root);});
  };
  const observer=new MutationObserver(mutations=>{
   // Only direct child replacements indicate a filter list has been rebuilt.
   if(mutations.some(m=>m.type==='childList'))refresh();
  });
  observer.observe(root,{childList:true});
  refresh();
 }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installPrimaryApptTypeBoxConvention);
else installPrimaryApptTypeBoxConvention();

/* Shared soft-pill endpoints for mutually exclusive day/week choices. */
function enhanceTimeGroupingToggle(root){
 if(!root||root.classList.contains('soft-time-toggle'))return;
 const input=root.querySelector('.switch input');
 const endpoints=[...root.children].filter(el=>['Days','Weeks','Daily','Weekly'].includes(el.textContent.trim()));
 if(!input||endpoints.length!==2)return;
 root.classList.add('soft-time-toggle');
 root.setAttribute('role','group');
 root.setAttribute('aria-label','Time grouping');
 endpoints.forEach((original,index)=>{
  const button=document.createElement('button');
  button.type='button';button.className='time-choice-endpoint';
  button.textContent=original.textContent;button.dataset.timeChoice=index?'week':'day';
  button.addEventListener('click',event=>{
   event.preventDefault();event.stopPropagation();
   if(input.disabled||input.checked===Boolean(index))return;
   input.checked=Boolean(index);
   input.dispatchEvent(new Event('change',{bubbles:true}));
  });
  original.replaceWith(button);
 });
}
document.querySelectorAll('.days-weeks-filter-row,.forecast-basis-switch').forEach(enhanceTimeGroupingToggle);


/* Per-account inactivity timeout. Absolute timestamps survive throttled/background tabs. */
function dashboardIdleMinutes(){
 const minutes=Number(readPersonalSettings().logoutMinutes);
 return [10,30,60,120,240].includes(minutes)?minutes:30;
}
function stopDashboardIdleSession(){
 if(dashboardIdleInterval!==null)clearInterval(dashboardIdleInterval);
 dashboardIdleInterval=null;dashboardIdleState=null;
 const dialog=$('idleLogoutDialog');if(dialog?.open)dialog.close();
}
function startDashboardIdleSession(){
 const account=chartPreferenceAccount();if(!account||!folderAccessVerified)return;
 if(dashboardIdleState?.account===account)return;
 stopDashboardIdleSession();dashboardLogoutRunning=false;
 dashboardIdleState={account,key:'gp-insight-last-activity-v1:'+encodeURIComponent(account),lastActivity:Date.now(),lastWrite:0};
 recordDashboardActivity(true);
 dashboardIdleInterval=setInterval(checkDashboardInactivity,1000);
}
function recordDashboardActivity(force=false){
 const state=dashboardIdleState;if(!state||dashboardLogoutRunning)return;
 try{const shared=Number(iqLocalStorage.getItem(state.key));if(Number.isFinite(shared))state.lastActivity=Math.max(state.lastActivity,shared);}catch(_){}
 if(Date.now()-state.lastActivity>=dashboardIdleMinutes()*60000){void logoutDashboard(true);return;}
 if($('idleLogoutDialog')?.open&&!force)return;
 state.lastActivity=Date.now();
 if(force||state.lastActivity-state.lastWrite>=5000){
  state.lastWrite=state.lastActivity;
  try{iqLocalStorage.setItem(state.key,String(state.lastActivity));}catch(_){}
 }
 if(force){const dialog=$('idleLogoutDialog');if(dialog?.open)dialog.close();}
}
function checkDashboardInactivity(){
 const state=dashboardIdleState;if(!state||dashboardLogoutRunning||!folderAccessVerified)return;
 try{const saved=Number(iqLocalStorage.getItem(state.key));if(Number.isFinite(saved))state.lastActivity=Math.max(state.lastActivity,saved);}catch(_){}
 const remaining=state.lastActivity+dashboardIdleMinutes()*60000-Date.now();
 if(remaining<=0){void logoutDashboard(true);return;}
 const dialog=$('idleLogoutDialog');
 if(remaining<=30000){
  $('idleLogoutCountdown').textContent='Logout in '+Math.ceil(remaining/1000)+' seconds';
  if(!dialog.open)dialog.showModal();
 }else if(dialog.open)dialog.close();
}
async function logoutDashboard(automatic=false){
 if(dashboardLogoutRunning)return;
 const account=activeAccount,accountId=chartPreferenceAccount();
 dashboardLogoutRunning=true;stopDashboardIdleSession();
 if(accountId)try{iqLocalStorage.setItem('gp-insight-session-ended:'+encodeURIComponent(accountId),String(Date.now()));}catch(_){}
 returnToMicrosoftSignIn(false);authChecking=false;
 setStatus(automatic?'You were logged out after inactivity. Sign in to continue.':'You have been signed out.');
 setButtons();
 try{if(auth&&account)await auth.logoutRedirect({account,postLogoutRedirectUri:REDIRECT_URI});}
 catch(error){console.warn('Microsoft sign-out did not complete',error);}
 finally{dashboardLogoutRunning=false;}
}
$('idleStaySignedIn').addEventListener('click',()=>{recordDashboardActivity(true);checkDashboardInactivity();});
$('idleLogoutNow').addEventListener('click',()=>void logoutDashboard(false));
$('idleLogoutDialog').addEventListener('cancel',event=>event.preventDefault());
for(const event of ['pointerdown','pointermove','keydown','wheel','touchstart']){
 document.addEventListener(event,e=>{if(e.isTrusted)recordDashboardActivity();},{capture:true,passive:true});
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')checkDashboardInactivity();});
window.addEventListener('focus',checkDashboardInactivity);
window.addEventListener('storage',event=>{
 const state=dashboardIdleState;if(!state)return;
 if((event.key?.startsWith(iqStorageScope)?event.key.slice(iqStorageScope.length):null)==='gp-insight-session-ended:'+encodeURIComponent(state.account)){
  stopDashboardIdleSession();returnToMicrosoftSignIn(false);authChecking=false;
  setStatus('You have been signed out. Sign in to continue.');setButtons();return;
 }
 if((event.key?.startsWith(iqStorageScope)?event.key.slice(iqStorageScope.length):null)===state.key){const value=Number(event.newValue);if(Number.isFinite(value))state.lastActivity=Math.max(state.lastActivity,value);checkDashboardInactivity();}
 if((event.key?.startsWith(iqStorageScope)?event.key.slice(iqStorageScope.length):null)===personalSettingsKey()){updateHeaderIdentity();checkDashboardInactivity();}
});

async function renderActiveAnalyticsPage(){
 updateDashboardDateContext();refreshPrimaryApptTypeBoxes();
 const renderers={homePage:()=>window.updateHomeOverview?.(),workforcePlanningPage:()=>window.renderWorkforcePlanning?.(),workforceNeedPage:()=>window.renderWeeklyPlanning?.(),chartPage:refresh,waitingTimesPage:renderWaitingTimesChart,waitingOverTimePage:renderWaitingTrendChart,availabilityPage:renderAvailabilityChart,routineAvailabilityPage:renderRoutineAvailabilityChart,dayView2Page:renderDayView2,bookingTimesPage:renderBookingTimesChart,signpostingPage:renderSignpostingChart,rapidHealthPage:renderRapidHealthTable,dailyForecastPage:()=>window.refreshForecastCharts?.(),weeklyForecastPage:()=>window.refreshForecastCharts?.(),routineCapacityPage:()=>window.renderRoutineCapacity?.()};
 for(const [id,draw] of Object.entries(renderers)){const page=$(id);if(page&&!page.classList.contains("hidden"))await draw()}
}
function refreshOnDateRollover(){if(document.hidden||!folderAccessVerified)return;if(updateDashboardDateContext())void renderActiveAnalyticsPage().catch(e=>showRefreshFeedback("Chart refresh failed: "+e.message))}
setInterval(refreshOnDateRollover,60000);
document.addEventListener("visibilitychange",refreshOnDateRollover);
window.addEventListener("focus",refreshOnDateRollover);

function parseSettingsJSON(text){
 let data;
 try{data=JSON.parse(text.replace(/^\uFEFF/,''))}catch{throw Error('Settings file is not valid JSON. Ask the administrator to restore a valid settings backup.');}
 validateCloudCategories(data);
 return data;
}
function validateCloudCategories(data){
 const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 const invalid=key=>{throw Error('Invalid settings field: '+key+'. Existing settings have not been replaced.');};
 if(!object(data))invalid('settings (expected an object)');
 if(data.version!==undefined&&(!Number.isInteger(data.version)||data.version<1||data.version>9))invalid('version (supported: 1–9)');
 // Preflight every loaded field before loadCloudCategories mutates any state.
 for(const key of ['categories','clinicianCategories','consultCategories','purposeCategories','capacityCategories','clinicianGroupCategories','groupUrgencyCategories','appointmentCategoryNames','excludedSlotTypes']){
  if(data[key]!==undefined&&(!Array.isArray(data[key])||data[key].some(v=>typeof v!=='string')))invalid(key);
 }
 for(const key of ['assignments','clinicianAssignments','consultAssignments','purposeAssignments','capacityAssignments','clinicianGroupAssignments','groupUrgencyAssignments','appointmentCategoryAssignments','userTypeLocum','clinicianTypeColours','urgencyTypeColours','clinicianGroupColours','urgencyGroupColours','consultModeColours','purposeColours','capacityColours','appointmentCategoryColours']){
  if(data[key]!==undefined&&(!object(data[key])||Object.entries(data[key]).some(([k,v])=>['__proto__','constructor','prototype'].includes(k)||typeof v!=='string')))invalid(key);
 }
 if(data.analyticsRoles!==undefined&&!object(data.analyticsRoles))invalid('analyticsRoles');
 if(data.workforceWeeklySessions!==undefined&&(!Array.isArray(data.workforceWeeklySessions)||data.workforceWeeklySessions.some(entry=>
  !Array.isArray(entry)||entry.length!==3||typeof entry[0]!=='string'||!entry[0].trim()||
  !['2023','2024','2025','2026'].includes(entry[1])||!Number.isFinite(entry[2])||entry[2]<0)))invalid('workforceWeeklySessions');
 if(data.togglePriority!==undefined&&(!object(data.togglePriority)||Object.values(data.togglePriority).some(v=>!Array.isArray(v)||v.some(x=>typeof x!=='string'))))invalid('togglePriority');
 if(data.folder!==undefined&&data.folder!==null&&(!object(data.folder)||typeof data.folder.id!=='string'||!data.folder.id.trim()||(data.folder.name!==undefined&&typeof data.folder.name!=='string')))invalid('folder');
 if(data.practiceSettings!==undefined){
  const p=data.practiceSettings;
  if(!object(p)||(p.name!==undefined&&typeof p.name!=='string')||(p.anchors!==undefined&&(!object(p.anchors)||Object.entries(p.anchors).some(([k,v])=>!/^\d{4}-(0[1-9]|1[0-2])$/.test(k)||!['number','string'].includes(typeof v)||!String(v).trim()||!Number.isFinite(Number(v))||Number(v)<0))))invalid('practiceSettings');
 }
 validAssignments(data.assignments,validCategoryNames(data.categories));
 for(const [namesKey,mapKey,fallback] of [['categories','assignments',categoryNames],['clinicianCategories','clinicianAssignments',clinicianCategoryNames],['consultCategories','consultAssignments',[]],['purposeCategories','purposeAssignments',purposeCategoryNames],['capacityCategories','capacityAssignments',capacityCategoryNames],['clinicianGroupCategories','clinicianGroupAssignments',clinicianGroupNames],['groupUrgencyCategories','groupUrgencyAssignments',groupUrgencyNames],['appointmentCategoryNames',null,appointmentCategoryNames]]){
 const names=data[namesKey]===undefined?fallback:validCategoryNames(data[namesKey]);if(mapKey&&data[mapKey])validAssignments(data[mapKey],names);
 }
}
// Shared chart disclosure and rounded select menus. Native controls remain the source of truth.
let chartOptionsAccount=null;
const chartOptionsApplied=new Map();
function chartOptionsPreferenceKey(button){return 'displayOptions:'+(button.closest('[id$="Page"]')?.id||'chart')+':'+button.getAttribute('aria-controls');}
function setChartDisplayOptions(button,expanded,save=false){
 const panel=$(button.getAttribute('aria-controls'));if(!panel)return;
 button.setAttribute('aria-expanded',String(expanded));panel.hidden=!expanded;
 if(!expanded)panel.querySelectorAll('.chart-select-picker').forEach(picker=>picker._chartClose?.());
 if(save){const key=chartOptionsPreferenceKey(button);writeChartPreference(key,expanded);chartOptionsApplied.set(key,expanded);}
 scheduleChartResize();
}
function restoreChartDisplayOptions(){
 const account=chartPreferenceAccount();if(!account)return;
 if(account!==chartOptionsAccount){chartOptionsAccount=account;chartOptionsApplied.clear();}
 const saved=readChartPreferences();
 document.querySelectorAll('.chart-display-options-button[aria-controls]').forEach(button=>{
  if(button.dataset.chartOptionsBound!=='1')return;
  const key=chartOptionsPreferenceKey(button),expanded=saved[key]===true;
  if(chartOptionsApplied.get(key)===expanded)return;
  chartOptionsApplied.set(key,expanded);setChartDisplayOptions(button,expanded);
 });
}
function initializeChartSelect(select){
 if(select.dataset.chartSelectBound==='1')return;
 const model=select.dataset.chartProxy?$(select.dataset.chartProxy):null;if(select.dataset.chartProxy&&!model)return;
 select.dataset.chartSelectBound='1';
 const picker=document.createElement('div');picker.className='chart-select-picker';
 const button=document.createElement('button');button.type='button';button.className='chart-select-trigger';
 button.setAttribute('role','combobox');button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');button.setAttribute('aria-label',select.getAttribute('aria-label')||'Display option');
 const list=document.createElement('div');list.className='chart-select-list';list.id=select.id+'Options';list.hidden=true;list.setAttribute('role','listbox');list.setAttribute('aria-label',select.getAttribute('aria-label')||'Display option');button.setAttribute('aria-controls',list.id);
 const close=()=>{list.hidden=true;button.setAttribute('aria-expanded','false')};picker._chartClose=close;
 const sync=()=>{
  button.textContent=select.options[select.selectedIndex]?.textContent||'';button.disabled=select.disabled;
  [...list.children].forEach((option,i)=>option.setAttribute('aria-selected',String(i===select.selectedIndex)));
 };
 const fromModel=()=>{select.value=model.checked?select.dataset.checkedValue:[...select.options].find(option=>option.value!==select.dataset.checkedValue).value;select.disabled=model.disabled;sync();};
 const open=()=>{document.querySelectorAll('.chart-select-picker').forEach(other=>{if(other!==picker)other._chartClose?.()});list.hidden=false;button.setAttribute('aria-expanded','true');};
 [...select.options].forEach((option,i)=>{
  const item=document.createElement('button');item.type='button';item.className='chart-select-option';item.tabIndex=-1;item.textContent=option.textContent;item.setAttribute('role','option');
  item.addEventListener('click',()=>{select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));close();button.focus();});
  item.addEventListener('keydown',event=>{
   const items=[...list.children];
   if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const next=(event.key?.startsWith(iqStorageScope)?event.key.slice(iqStorageScope.length):null)==='Home'?0:(event.key?.startsWith(iqStorageScope)?event.key.slice(iqStorageScope.length):null)==='End'?items.length-1:(i+((event.key?.startsWith(iqStorageScope)?event.key.slice(iqStorageScope.length):null)==='ArrowDown'?1:-1)+items.length)%items.length;items[next].focus();}
   if((event.key?.startsWith(iqStorageScope)?event.key.slice(iqStorageScope.length):null)==='Escape'){event.preventDefault();event.stopPropagation();close();button.focus();}
   if((event.key?.startsWith(iqStorageScope)?event.key.slice(iqStorageScope.length):null)==='Tab')close();
   if(event.key.length===1&&/\S/.test(event.key)){const next=items.find(item=>item.textContent.toLowerCase().startsWith(event.key.toLowerCase()));if(next){event.preventDefault();next.focus();}}
  });list.append(item);
 });
 button.addEventListener('click',()=>{if(list.hidden)open();else close();});
 button.addEventListener('keydown',event=>{
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();open();list.children[(event.key?.startsWith(iqStorageScope)?event.key.slice(iqStorageScope.length):null)==='Home'?0:(event.key?.startsWith(iqStorageScope)?event.key.slice(iqStorageScope.length):null)==='End'?list.children.length-1:select.selectedIndex]?.focus();}
  if((event.key?.startsWith(iqStorageScope)?event.key.slice(iqStorageScope.length):null)==='Escape'){event.preventDefault();event.stopPropagation();close();}if((event.key?.startsWith(iqStorageScope)?event.key.slice(iqStorageScope.length):null)==='Tab')close();
 });
 select.addEventListener('change',()=>{if(model){model.checked=select.value===select.dataset.checkedValue;model.dispatchEvent(new Event('change',{bubbles:true}));}sync();});if(model)model.addEventListener('change',fromModel);
 picker.append(button,list);select.after(picker);select.hidden=true;if(model)fromModel();else sync();
 document.addEventListener('pointerdown',event=>{if(!picker.contains(event.target))close();});
}
function initializeChartDisplayOptions(){
 document.querySelectorAll('.chart-display-options-button[aria-controls]').forEach(button=>{
  if(button.dataset.chartOptionsBound==='1')return;button.dataset.chartOptionsBound='1';
  button.addEventListener('click',()=>setChartDisplayOptions(button,button.getAttribute('aria-expanded')!=='true',true));
  $(button.getAttribute('aria-controls'))?.addEventListener('keydown',event=>{if((event.key?.startsWith(iqStorageScope)?event.key.slice(iqStorageScope.length):null)==='Escape'){setChartDisplayOptions(button,false,true);button.focus();}});
 });
 document.querySelectorAll('select[data-chart-proxy],select[data-chart-select]').forEach(initializeChartSelect);restoreChartDisplayOptions();
}
window.gpChartOptions={restore:restoreChartDisplayOptions};
initializeChartDisplayOptions();

async function refreshDashboardData(force=true){
 if(settingsRefreshing||busy||!activeAccount||!selectedFolder)return;
 settingsRefreshing=true;
 try{
  if(cloudBusy)throw Error('Settings are still saving. Please retry shortly.');
  if(categoryDirty&&(!(await saveCloudCategories())||categoryDirty))throw Error('Settings could not finish saving; local edits were preserved.');
  await loadCloudCategories({strict:true,protectEdits:true});
  if(cloudFolder)selectedFolder=cloudFolder;
  await loadFolder(force);
 }catch(e){showRefreshFeedback('Refresh failed: '+e.message)}
 finally{settingsRefreshing=false;setButtons()}
}


function analyticsSettingsSnapshot(){
 return JSON.stringify({
  version:9,
  workforceWeeklySessions:[...workforceWeeklySessions].map(([key,value])=>[...JSON.parse(key),value]),
  analyticsRoles:ensureAnalyticsRoles(),
   togglePriority:{...togglePriority},
  practiceSettings:{name:practiceSettings.name,anchors:{...practiceSettings.anchors}},
  userTypeLocum:{...userTypeLocum},
  clinicianGroupColours:{...clinicianGroupColours},clinicianTypeColours:{...clinicianTypeColours},urgencyTypeColours:{...urgencyTypeColours},
  categories:categoryNames.slice(),
  assignments:{...assignments},
  clinicianCategories:clinicianCategoryNames.slice(),
  clinicianAssignments:{...clinicianAssignments},
  clinicianGroupCategories:clinicianGroupNames.slice(),
  clinicianGroupAssignments:{...clinicianGroupAssignments},
  consultCategories:consultCategoryNames.slice(),
  consultAssignments:{...consultAssignments},
  purposeCategories:purposeCategoryNames.slice(),purposeColours:{...purposeColours},purposeAssignments:{...purposeAssignments},capacityCategories:capacityCategoryNames.slice(),capacityColours:{...capacityColours},capacityAssignments:{...capacityAssignments},consultModeColours:{...consultModeColours},excludedSlotTypes:[...excludedSlotTypes],
  groupUrgencyCategories:groupUrgencyNames.slice(),appointmentCategoryNames:appointmentCategoryNames.slice(),appointmentCategoryAssignments:{...appointmentCategoryAssignments},appointmentCategoryColours:{...appointmentCategoryColours},
  groupUrgencyAssignments:{...groupUrgencyAssignments},
  urgencyGroupColours:{...urgencyGroupColours},
  
  updatedAt:new Date().toISOString()
 });
}
// Integration boundary for the existing analytics engine. Definitions hoist above startup.
let iqSources=[],iqContributions=new Map(),iqSettingsRevision=0,iqUploading=false;
function initAuth(){
 window.addEventListener('load',()=>void iqStart(),{once:true});
 window.addEventListener('message',event=>{if(event.source===window.parent&&event.origin===location.origin&&event.data?.type==='iq-refresh')void refreshDashboardData(true);});
}
async function iqStart(){
 if(!iqBridge){document.body.textContent='Open this dashboard through your GP Insight IQ practice workspace.';return;}
 document.body.classList.toggle('iq-viewer-workspace',!!iqBridge.viewerWorkspace);
 try{
  await iqBridge.ensure();
  activeAccount={homeAccountId:iqBridge.user.id+':'+iqBridge.practice.id,username:iqBridge.user.email,name:iqBridge.user.name||iqBridge.user.email};
  await loadSyncedChartPreferences();
  installLocumFilters();
  const topbar=document.querySelector('#dashboardShell .topbar');
  if(topbar){
   const mark=topbar.querySelector('.gp-compass-mark');if(mark){const image=document.createElement('img');image.src='overview-brand-mark.svg';image.alt='';mark.replaceChildren(image);}
   const brand=topbar.querySelector('.gp-compass-brand');brand?.setAttribute('aria-label','GP Insight IQ');
   const practiceIdentity=document.createElement('div');practiceIdentity.className='iq-header-practice';
   const caption=document.createElement('span');caption.className='iq-header-practice-caption';caption.textContent='Practice';
   const practiceName=document.createElement('span');practiceName.className='iq-header-practice-name';practiceName.textContent=iqBridge.practice.name;practiceName.title=iqBridge.practice.name;
   practiceIdentity.append(caption,practiceName);
   const reportStatus=topbar.querySelector('.header-download-status');if(reportStatus)topbar.querySelector('.header-user')?.append(reportStatus);
   topbar.insertBefore(practiceIdentity,topbar.querySelector('.top-actions'));
  }
  isOwner=iqBridge.manage;folderAccessVerified=true;folderAccessDenied=false;authenticatedOnce=true;
  selectedFolder={id:iqBridge.practice.id,name:iqBridge.practice.name};
  applyAccessMode();setButtons();iqCreateUploadPanel();
  await loadCloudCategories({strict:true});await loadFolder(true);
  restoreChartCheckboxes();
  // Seed the current browser entry without adding a stop before the overview.
  window.restoreDashboardPage=page=>showPage(page,{historyMode:'restore'});
  showPage(iqBridge.workspacePage()||'home',{historyMode:'replace'});
  startDashboardIdleSession();
  $('signIn').onclick=()=>{};$('chooseFolder').onclick=()=>{};$('sourceSetup').onclick=()=>{};
  $('refreshData').onclick=()=>void refreshDashboardData(true);
  if(iqBridge.manage){
   const settingsMenu=document.querySelector('.nav-settings-dropdown');
   if(settingsMenu&&!$('navUsersApprovals')){
    const usersButton=document.createElement('button');usersButton.id='navUsersApprovals';usersButton.type='button';usersButton.className='nav-settings-tab';usersButton.textContent='Users and Approvals';
    usersButton.addEventListener('click',()=>{document.querySelector('.nav-settings-menu')?.classList.remove('open');$('navSettingsCog')?.setAttribute('aria-expanded','false');iqBridge.users();});
    settingsMenu.append(usersButton);
   }
  }
  if(iqBridge.viewerWorkspace){
   const menu=$('headerAccountMenu');
   if(menu){
    const summary=menu.querySelector('summary');if(summary){summary.setAttribute('aria-label','Account and sign out');summary.title=iqBridge.user.email;}
    if(iqBridge.practices?.length>1){
     const label=document.createElement('label');label.className='iq-practice-switch';label.textContent='Practice';
     const select=document.createElement('select');select.setAttribute('aria-label','Select authorised practice');
     for(const practice of iqBridge.practices){const option=document.createElement('option');option.value=practice.id;option.textContent=practice.name;option.selected=practice.id===iqBridge.practice.id;select.append(option);}
     select.addEventListener('change',()=>void iqBridge.selectPractice(select.value));label.append(select);menu.querySelector('div')?.prepend(label);
    }
   }
  }
 }catch(error){document.body.replaceChildren();const message=document.createElement('p');message.textContent='The practice dashboard could not load: '+error.message;document.body.append(message);}
}
async function cloudFile(){
 const data=await iqBridge.readSettings();iqSettingsRevision=data.revision;
 if(data.settings)return data.settings;
 const defaults=JSON.parse(analyticsSettingsSnapshot());defaults.practiceSettings={name:iqBridge.practice.name,anchors:{}};return defaults;
}
async function saveCloudCategories(){
 if(!isOwner||!cloudReady||cloudBusy)return false;
 cloudBusy=true;const serial=cloudChangeSerial;
 try{
  const snapshot=JSON.parse(analyticsSettingsSnapshot());delete snapshot.folder;validateCloudCategories(snapshot);
  iqSettingsRevision=await iqBridge.saveSettings(snapshot,iqSettingsRevision);
  categoryDirty=cloudChangeSerial!==serial;cloudNotice(categoryDirty?'Saving latest changes…':'Practice settings saved.');
  if(categoryDirty){clearTimeout(cloudSaveTimer);cloudSaveTimer=setTimeout(()=>void saveCloudCategories(),850);}
  return true;
 }catch(error){categoryDirty=true;cloudNotice('Settings not saved: '+error.message);return false;}
 finally{cloudBusy=false;}
}
async function openCSVCache(){return null;}
async function graph(){throw Error('Microsoft storage is disabled in this prototype.');}
async function token(){throw Error('Microsoft authentication is disabled in this prototype.');}
function showFolderPicker(){
 if(!iqUploadElement)return;
 showPage('practiceSettings');
 selectPracticeSettingsTab('reports');
}
async function logoutDashboard(){await iqBridge?.signOut();}
function returnToMicrosoftSignIn(){void logoutDashboard();}
async function renderPracticeUsers(){
 const status=$('practiceUsersStatus');if(!status)return;
 status.replaceChildren(document.createTextNode('Invitations, approvals and suspensions are managed in Users & approvals. '));
 const button=document.createElement('button');button.type='button';button.textContent='Manage users & approvals';button.style.width='auto';button.onclick=()=>iqBridge.users();status.append(button);
 const body=$('practiceUsersBody');if(body)body.replaceChildren();
}
async function removePracticeUser(){iqBridge.users();}
async function loadFolder(force=true){
 if(!selectedFolder||busy)return;busy=true;setButtons();showRefreshFeedback('Loading practice reports…',true);
 try{
 await iqBridge.ensure();
 iqSources=await iqBridge.list();
 const items=iqSources.map(source=>({id:source.source_key,name:source.kind==='slot'?'Slot Report '+source.source_name:'Signposting Auto Report '+source.source_name,lastModifiedDateTime:source.clinical_at,size:0}));
 const fingerprint=JSON.stringify(iqSources.map(s=>[s.source_key,s.revision]));
 const aggregate=new Map(),availabilityAggregate=new Map(),bookingTimeAggregate=new Map(),appointmentTimeAggregate=new Map(),waitingAggregate=new Map(),waitingTrendAggregate=new Map(),peopleAggregate=new Map(),newSlotTypeStats=new Map();
 let valid=0,skipped=0,newSlotFiles=0,newSignpostingFiles=0,downloaded=0,reused=0;
 const newSignposting=[],pendingCache=new Map();
 const newRapidHealth=await iqBridge.rapidSummary();
 for(const source of iqSources){
  let entry=iqContributions.get(source.source_key);
  if(!entry||entry.revision!==source.revision){entry={revision:source.revision,value:await iqBridge.read(source.source_key)};downloaded++;}else reused++;
  iqContributions.set(source.source_key,entry);
  const contribution={...entry.value,version:JSON.stringify([source.source_key,source.source_name,source.clinical_at,0])};pendingCache.set(source.source_key,contribution);
  if(contribution.kind==='signposting'){newSignposting.push(...contribution.events);newSignpostingFiles++;}
  else if(contribution.kind==='slot'){newSlotFiles++;valid+=contribution.valid;skipped+=contribution.skipped;const destinations=[aggregate,availabilityAggregate,bookingTimeAggregate,peopleAggregate,newSlotTypeStats,waitingAggregate,waitingTrendAggregate,appointmentTimeAggregate];for(let m=0;m<8;m++)mergeCSVCounts(destinations[m],contribution.maps[m]);}
 }
 for(const key of iqContributions.keys())if(!pendingCache.has(key))iqContributions.delete(key);
 updateHomeReportDates(items);iqRenderSources();
  // Date the newest Slot Report CSV was last modified, committed only
 // after every changed file has downloaded and parsed successfully.
 const capacityFileDates=items.filter(file=>pendingCache.get(file.id)?.kind==='slot').map(file=>Date.parse(file.lastModifiedDateTime||'')).filter(Number.isFinite);
 capacityCSVLatestModified=capacityFileDates.length?Math.max(...capacityFileDates):null;
 updateHeaderSlotReportTime(capacityCSVLatestModified);
 slotReportCoverage=GPCorrectness.coverageFromEntries(pendingCache);
 slotTypeFileStats=newSlotTypeStats;renderSlotInclusion();
 rapidHealthSummary=newRapidHealth;
 signpostingRecords=newSignposting;signpostingFileCount=newSignpostingFiles;signpostingSlotNames=new Set(newSignposting.map(event=>event.destination));
 // Each dated signposting event is also a booked appointment for the main
 // demand/availability calculations. Its destination is its Slot Type.
 // Keep the dedicated Signposting page sourced from the original event list.
 // No clinician/person is invented: the report has no session holder field.
 // The event date is used as its booking AND appointment date.
 const signpostingClinician='Signposting (no clinician recorded)';
 for(const event of newSignposting){
  const slot=event.destination,date=event.date;
  const availabilityKey=JSON.stringify([date,slot,'Booked',signpostingClinician,'',null,'signposting']);
  availabilityAggregate.set(availabilityKey,(availabilityAggregate.get(availabilityKey)||0)+1);
  const bookedWeek=mondayOf(date);
  {
   const key=JSON.stringify([date,slot,signpostingClinician,'']);
   aggregate.set(key,(aggregate.get(key)||0)+1);
   const tm=/^(\d{1,2}):(\d{2})/.exec(event.time||'');
   if(tm&&Number(tm[1])<24&&Number(tm[2])<60){
    const minute=Number(tm[1])*60+Number(tm[2]);
    const timeKey=JSON.stringify([date,minute,slot,signpostingClinician,'']);
    bookingTimeAggregate.set(timeKey,(bookingTimeAggregate.get(timeKey)||0)+1);
    const scheduledKey=JSON.stringify([date,date,minute,slot,signpostingClinician,'','signposting']);
    appointmentTimeAggregate.set(scheduledKey,(appointmentTimeAggregate.get(scheduledKey)||0)+1);
   }
  }
 }
 waitingTimeRecords=[...waitingAggregate].map(([key,count])=>{const [slot,day,clinician,person,appointmentMonth]=JSON.parse(key);return {slot,day,clinician,person,appointmentMonth,status:'Booked',count}});
 waitingTrendRecords=[...waitingTrendAggregate].map(([key,count])=>{const [slot,clinician,person,appointmentMonth,appointmentDate,leadMinutes]=JSON.parse(key);return {slot,clinician,person,appointmentMonth,appointmentDate,leadMinutes,status:'Booked',count}}).sort((a,b)=>a.leadMinutes-b.leadMinutes);
 waitingTrendDimensionCache=new WeakMap();
 waitingTrendAvailableMonths=[...new Set(waitingTrendRecords.map(r=>r.appointmentMonth).filter(Boolean))].sort();
 appointmentTimeRecords=[...appointmentTimeAggregate].map(([key,count])=>{const [date,bookedDay,bookedMinute,slot,clinician,person,source]=JSON.parse(key);return {date,bookedDay,bookedMinute,slot,clinician,person,source:source||'slot',count}});
 bookingTimeRecords=[...bookingTimeAggregate].map(([key,count])=>{const [bookedDay,minute,slot,clinician,person]=JSON.parse(key);return {bookedDay,minute,slot,clinician,person,count}});
 availabilityRecords=[...availabilityAggregate].map(([key,count])=>{const [date,slot,availability,clinician,person,minute,source]=JSON.parse(key);return {date,slot,availability,clinician,person,minute:Number.isFinite(minute)?minute:null,source:source||'slot',count}});
 records=[...aggregate].map(([key,count])=>{const [bookedDay,slot,clinician,person]=JSON.parse(key);const bookedWeek=mondayOf(bookedDay);return {week:bookedWeek,bookedWeek,bookedDay,slot,clinician,person,status:'Booked',count}});weeks=[...new Set(records.map(r=>r.bookedWeek))].sort();types=[...new Set([...records.map(r=>r.slot),...availabilityRecords.map(r=>r.slot)])].sort();statuses=['Booked'];clinicianTypes=[...new Set([...records.map(r=>r.clinician),...availabilityRecords.map(r=>r.clinician)])].filter(Boolean).sort();
 // Assign obvious names on first encounter; retain any existing manual choices.
 // Do not guess assignments: unknown slot types stay Uncategorised until manually assigned.

 saveCategories(false);renderPeople();renderSlotInclusion();renderSlotTable();lastFingerprint=fingerprint;
const drawingErrors=[];
 for(const [label,draw] of [
  ['category filters',()=>rebuildCategoryFilter()],
  ['Appointment Types',()=>renderEditor()],
  ['clinician categories',()=>renderClinicianEditor()],
  ['clinician groups',()=>renderClinicianGroupEditor()],
  ['consult categories',()=>renderConsultEditor()],
  ['active chart',()=>renderActiveAnalyticsPage()]
 ]){
  try{await draw()}catch(error){drawingErrors.push(label+': '+(error?.message||String(error)));console.error('Dashboard rendering error in '+label,error)}
 }
 showRefreshFeedback(drawingErrors.length?'Data loaded; chart issue: '+drawingErrors.join('; '):(!isOwner?'Data refreshed · shared slot assignments: '+Object.keys(assignments).length:'Data refreshed successfully'));
 scheduleChartResize();setSync(`Downloaded ${downloaded} changed CSV file(s), reused ${reused} cached · ${newSlotFiles} Slot Report CSV files · ${newSignpostingFiles} Signposting CSV files · ${valid.toLocaleString('en-GB')} booked Slot Report rows + ${newSignposting.length.toLocaleString('en-GB')} signposting events · ${skipped.toLocaleString('en-GB')} skipped · ${Object.keys(assignments).length} assigned slot types · Updated ${new Date().toLocaleString('en-GB')}`)
 }catch(e){
 const message=e?.message||String(e);
 console.error('Practice report refresh error',e);
 showRefreshFeedback('Refresh failed: '+message);
 setSync('Refresh failed: '+message+' · You remain signed in; the existing charts have been preserved where possible.');
 }finally{busy=false;setButtons()}}

function updateHomeReportDates(items){
 const display=kind=>{const rows=iqSources.filter(row=>row.kind===kind);if(!rows.length)return 'No report uploaded';const latest=Math.max(...rows.map(row=>Date.parse(row.clinical_at)));return new Date(latest).toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/London'});};
 $('homeSlotModified').textContent=display('slot');
}
let iqUploadElement=null,iqUploadStatus=null;
function iqCreateUploadPanel(){
 if(!isOwner)return;
 const panel=document.createElement('section');panel.className='iq-import-panel';panel.id='practicePanel-reports';panel.hidden=true;iqUploadElement=panel;
 panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby','practiceTab-reports');
 const heading=document.createElement('h3');heading.textContent='Upload practice reports';
 iqUploadStatus=document.createElement('p');iqUploadStatus.className='iq-import-status';iqUploadStatus.setAttribute('role','status');
 const list=document.createElement('ul');list.id='iqSources';list.className='iq-source-list';
 panel.append(heading,iqUploadStatus,list);$('practicePanel-list').after(panel);
 iqRenderSources();
}
function iqRenderSources(){
 const list=$('iqSources');
 if(!list)return;
 list.replaceChildren();
 for(const source of iqSources){
  const row=document.createElement('li');
  const details=document.createElement('div');
  const time=new Date(source.clinical_at).toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/London'});
  details.textContent=source.source_name+' · '+source.row_count.toLocaleString('en-GB')+' records · '+time;
  const coverage=document.createElement('small');
  coverage.className='iq-source-coverage';
  coverage.textContent=iqReportCoverage(iqContributions.get(source.source_key)?.value);
  details.append(coverage);
  row.append(details);
  if(source.kind==='slot'){
   const remove=document.createElement('button');
   remove.type='button';
   remove.textContent='Remove';
   remove.setAttribute('aria-label','Remove '+source.source_name);
   remove.onclick=async()=>{
    if(iqUploading||!confirm('Remove '+source.source_name+' from this practice’s analytics?'))return;
    try{
     await iqBridge.remove(source.source_key,source.revision);
     await loadFolder(true);
    }catch(error){iqUploadStatus.textContent=error.message;}
   };
   row.append(remove);
  }
  list.append(row);
 }
}
function iqReportCoverage(contribution){
 let first='',last='';
 const include=date=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date??''))return;
  if(!first||date<first)first=date;
  if(!last||date>last)last=date;
 };
 if(contribution?.kind==='slot'){
  for(const key of contribution.maps[1].keys())include(JSON.parse(key)[0]);
 }else if(contribution?.kind==='signposting'){
  for(const event of contribution.events)include(event.date);
 }
 if(!first)return 'Date range unavailable';
 const formatter=new Intl.DateTimeFormat('en-GB',{month:'short',year:'numeric',timeZone:'UTC'});
 return formatter.format(new Date(first))+' – '+formatter.format(new Date(last));
}
async function replaceExistingCSV(file){
 if(iqUploading)return;
 if(!isOwner){csvDropStatus('Practice administrator access is required.',true);return;}
 iqUploading=true;csvDropBusy=true;
 try{
  if(!file||!file.size||file.size>50*1024*1024||! /\.(csv|json)$/i.test(file.name))throw Error('Choose one non-empty CSV or settings JSON up to 50 MB.');
  await iqBridge.ensure();
  const text=await file.text();
  if(/\.json$/i.test(file.name)){
   const settings=parseSettingsJSON(text);delete settings.folder;delete settings.peopleClinicianType;delete settings.peopleLocum;if(!confirm('Replace this practice’s shared settings with '+file.name+'? Personal display preferences are kept separately.'))return;
   iqSettingsRevision=await iqBridge.saveSettings(settings,iqSettingsRevision);await loadCloudCategories({strict:true});await loadFolder(true);iqUploadStatus.textContent='Practice settings imported.';csvDropStatus(iqUploadStatus.textContent);return;
  }
  const headers=Papa.parse(text,{header:true,preview:1}).meta.fields||[];
  if(headers.includes('request_date')&&headers.includes('request_type')){await iqBridge.importRapid(file);await loadFolder(true);iqUploadStatus.textContent='Rapid Health import finished.';csvDropStatus(iqUploadStatus.textContent);return;}
  const kind=headers.includes('Code Term')&&headers.includes('Date')?'signposting':'slot';
  const contribution=parseCSVContribution(text,kind==='slot'?'Slot Report.csv':'Signposting Auto Report.csv');
  const count=kind==='slot'?[...contribution.maps[1].values()].reduce((a,b)=>a+b,0):contribution.events.length;
  if(!count)throw Error('No valid records were found. The existing report has been preserved.');
  const existing=iqSources.find(row=>row.kind===kind&&row.source_name.toLowerCase()===file.name.toLowerCase());
  const clinical=new Date(file.lastModified);
  if(!Number.isFinite(clinical.getTime()))throw Error('Set the export date and time.');
  const message=existing?'Replace '+existing.source_name+' with this refreshed export? Its previous counts will be replaced.':'Add '+file.name+' as a new report source? Use a new source only for a separate, non-overlapping reporting period; refreshed exports should replace an existing source.';
  if(!confirm(message))return;
  iqUploadStatus.textContent='Processing and saving '+file.name+'…';
csvDropStatus(iqUploadStatus.textContent);
  await iqBridge.save({existing,kind,name:existing?.source_name||file.name,clinical_at:clinical.toISOString(),count,contribution});
  await loadFolder(true);
  iqUploadStatus.textContent='Saved '+count.toLocaleString('en-GB')+' records for '+iqBridge.practice.name+'.';
  csvDropStatus(iqUploadStatus.textContent);
 }catch(error){if(iqUploadStatus)iqUploadStatus.textContent='Upload failed: '+error.message;csvDropStatus('Upload failed: '+error.message,true);}
 finally{iqUploading=false;csvDropBusy=false;}
}
