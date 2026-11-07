import {weekdays,canManage,parseUpload,monthlyAverages,validateConfig,formatDate} from './core.mjs';
import {SupabaseBackend} from './backend.mjs?v=20261107-viewer-removal';
import {DemoBackend} from './demo.mjs?v=20261107-viewer-removal';
import {packContribution,unpackContribution,sourceKey} from './analytics-codec.mjs';
const $=id=>document.getElementById(id);
let backend=null,user=null,context=null,practice=null,report=null,members=[],view='analytics',loadVersion=0,busy=false,recovery=false;
let analyticsFrame=null,analyticsFrameKey=null;
const invitation=new URL(location.href).searchParams.get('invite');
const ownerSetup=new URL(location.href).searchParams.get('setup')==='1';
function node(tag,text,className){const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(className)element.className=className;return element;}
function notice(message,error=false){$('notice').textContent=message;$('notice').classList.toggle('error',error);$('notice').hidden=!message;}
function panel(title){const p=node('section',undefined,'panel'),header=node('div',undefined,'panel-header');header.append(node('h2',title));p.append(header);return p;}
function button(text,action,style='secondary'){const b=node('button',text,style);b.type='button';b.addEventListener('click',()=>run(action));return b;}
async function run(action){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await action();}catch(error){notice(error.message||'The action could not be completed.',true);}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);if(!backend){$('loginForm').hidden=true;$('forgotPassword').hidden=true;}}}
function currentApproved(){return !context?.platform_admin&&practice&&practice.active&&practice.status==='approved';}
function table(headers){const wrap=node('div',undefined,'table-scroll'),t=node('table'),head=node('thead'),row=node('tr'),body=node('tbody');for(const header of headers){const th=node('th',header);th.scope='col';row.append(th);}head.append(row);t.append(head,body);wrap.append(t);return {wrap,t,body};}
function textRow(body,values){const row=node('tr');values.forEach(v=>row.append(node('td',v)));body.append(row);return row;}
function updateShell(){
 $('login').hidden=!!user&&!recovery;$('workspace').hidden=!user||recovery;
 const viewerWorkspace=!!user&&!recovery&&!!currentApproved()&&!context?.platform_admin;
 document.body.classList.toggle('viewer-workspace',viewerWorkspace);
 if(viewerWorkspace)view='analytics';
 if(!user||recovery)return;
 $('demoBar').hidden=!backend.demo;$('accountEmail').textContent=user.email;
 $('accountRole').textContent=context?.platform_admin?'Platform administrator':practice?.role==='practice_admin'?'Practice administrator':'Practice user';
 const platformView=!!context?.platform_admin;
 if(platformView)view='practices';
 $('practicesTab').hidden=!platformView;
 document.querySelectorAll('[data-view]:not([data-view="practices"])').forEach(tab=>{
  tab.hidden=platformView||(tab.id==='usersTab'&&!canManage(practice));
 });
 $('workspaceEyebrow').textContent=platformView?'PLATFORM ADMINISTRATION':'YOUR WORKSPACE';
 $('practiceHeading').textContent=platformView?'Manage practices':practice?.name||'Your practice access';
 $('practiceSelect').closest('label').hidden=!!platformView;
 $('practiceSelect').replaceChildren();
 for(const p of context?.practices||[]){const option=node('option',p.name+(p.status!=='approved'?' · '+p.status:''));option.value=p.id;$('practiceSelect').append(option);}
 if(practice)$('practiceSelect').value=practice.id;
 $('practiceSelect').disabled=!(context?.practices?.length);
 $('pendingPanel').hidden=!!platformView||!!currentApproved();
 $('redeemForm').hidden=backend.demo||['pending','suspended'].includes(practice?.status);
 $('pendingMessage').textContent=practice?.status==='suspended'?'Your practice access is suspended. Contact your practice administrator.':practice?.status==='pending'?'Your invitation has been accepted. Your practice administrator must approve access before you can view data.':'Accept an invitation from your practice administrator to join a workspace.';
 if(invitation)$('inviteCode').value=invitation;
 if(!canManage(practice)&&view==='users')view='home';if(!context?.platform_admin&&view==='practices')view='home';
 document.querySelectorAll('[data-view]').forEach(b=>{if(b.dataset.view===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
}
function render(){
 updateShell();const content=$('content');
 const usersDialog=$('usersApprovalsDialog');
 if(usersDialog.open){if(!user||recovery||!currentApproved()||!canManage(practice))usersDialog.close();else{$('usersApprovalsContent').replaceChildren();renderUsers($('usersApprovalsContent'));}}
 const key=user&&currentApproved()?user.id+':'+practice.id+':'+practice.role:null;
 if(key!==analyticsFrameKey){analyticsFrame?.remove();analyticsFrame=null;analyticsFrameKey=null;window.DarwinAnalytics=null;}
 $('analyticsHost').hidden=view!=='analytics'||!currentApproved()||!user||recovery;
 content.hidden=view==='analytics'&&currentApproved();
 if(view==='analytics'&&currentApproved()&&user&&!recovery){renderAnalytics();return;}
 if(user&&!recovery&&view==='practices'&&context?.platform_admin){
  renderPractices(content);
  return;
 }
 content.replaceChildren();if(!user||recovery)return;
 if(!currentApproved())return;
 if(view==='users'){renderUsers(content);return;}
 if(!report){content.append(node('p','Loading practice data…','empty'));return;}
 if(view==='rapid'){renderRapid(content);return;}
 renderHome(content);
}
function renderAnalytics(){
 if(analyticsFrame)return;
 const selected=practice.id,identity=user.id,role=practice.role,targetBackend=backend;
 const check=()=>{if(backend!==targetBackend||user?.id!==identity||practice?.id!==selected||practice.role!==role||!currentApproved())throw Error('Practice access changed. Reopen the dashboard.');};
 const ensure=async()=>{check();const next=await targetBackend.context();check();const allowed=next.practices.find(p=>p.id===selected&&p.active&&p.status==='approved');if(!allowed||allowed.role!==role){context=next;practice=allowed||null;render();throw Error('Practice access changed.');}};
 const checked=async(action,manage=false)=>{await ensure();if(manage&&!canManage(practice))throw Error('Practice administrator required.');const value=await action();check();return value;};
 window.DarwinAnalytics={practice:{...practice},user:{id:user.id,email:user.email,name:user.user_metadata?.full_name||user.user_metadata?.name||''},manage:canManage(practice),platformAdmin:!!context?.platform_admin,ensure,
  viewerWorkspace:!context?.platform_admin,
  practices:(context?.practices||[]).filter(p=>p.active&&p.status==='approved').map(p=>({id:p.id,name:p.name})),
  selectPractice:id=>{check();if(!(context?.practices||[]).some(p=>p.id===id&&p.active&&p.status==='approved'))throw Error('Practice access required.');return run(()=>reload(id));},
  list:()=>checked(()=>targetBackend.analyticsSources(selected)),
  read:key=>checked(async()=>unpackContribution(await targetBackend.analyticsPayload(selected,key))),
  readSettings:()=>checked(()=>targetBackend.analyticsSettings(selected)),
  saveSettings:(settings,revision)=>checked(()=>targetBackend.saveAnalyticsSettings(selected,settings,revision),true),
  save:source=>checked(async()=>targetBackend.saveAnalyticsSource(selected,{source_key:source.existing?.source_key||await sourceKey(source.kind,source.name),kind:source.kind,source_name:source.name.slice(0,200),clinical_at:source.clinical_at,row_count:source.count,payload:await packContribution(source.contribution),revision:source.existing?.revision||0}),true),
  remove:(key,revision)=>checked(()=>targetBackend.deleteAnalyticsSource(selected,key,revision),true),
  rapidSummary:()=>checked(async()=>{const data=await targetBackend.report(selected);return data.state?{months:monthlyAverages(data.state,data.daily),total:data.daily.reduce((n,r)=>n+Number(r.other_enquiries),0),records:data.state.record_count}:null;}),
  rapidDate:()=>report?.state?.latest_request?formatDate(report.state.latest_request+'Z'):null,
  importRapid:file=>checked(()=>prepareUpload(file),true),
  users:()=>{check();if(!canManage(practice))throw Error('Practice administrator required.');openUsersApprovals();},
  signOut:()=>run(async()=>{await targetBackend.logout();user=null;context=null;practice=null;report=null;render();})
 };
 analyticsFrameKey=identity+':'+selected+':'+role;analyticsFrame=node('iframe');analyticsFrame.title='Practice Activity, Capacity, Forecast and Workforce IQ';analyticsFrame.className='analytics-frame';analyticsFrame.src='dashboard.html?v=20261106-compact-header';$('analyticsHost').replaceChildren(analyticsFrame);
}
function renderHome(content){
 const metrics=node('div',undefined,'metric-row');
 for(const [label,value,detail] of [['Rapid Health requests',(report.state?.record_count||0).toLocaleString('en-GB'),'Saved in this practice'],['Other enquiries',report.daily.reduce((sum,r)=>sum+Number(r.other_enquiries),0).toLocaleString('en-GB'),'Admin · OTHER_ENQUIRY'],['Practice access',canManage(practice)?'Administrator':'View only','Approved account']]){const card=node('div',undefined,'metric');card.append(node('span',label,'label'),node('span',value,'value'),node('span',detail,'detail'));metrics.append(card);}content.append(metrics);
 const split=node('div',undefined,'split'),latest=panel('Practice data');
 const data=table(['Report','Last successful upload']);textRow(data.body,['Direct Rapid Health',formatDate(report.state?.updated_at)]);latest.append(data.wrap);
 latest.append(node('p',report.state?'Requests covered: '+report.state.coverage_start+' to '+report.state.coverage_end+'.':'Upload the first full Rapid Health export to begin.','subtle'));
 const access=panel('Your workspace');access.append(node('p','Reports and approved users are separate for each practice.'));
 if(canManage(practice))access.append(button('Manage users & approvals',()=>{view='users';render();}));
 else access.append(node('p','Your account can view data. Uploads and approvals are managed by your practice administrator.','subtle'));
 split.append(latest,access);content.append(split);
}
function renderRapid(content){
 const p=panel('Rapid Health');
 const rows=monthlyAverages(report.state,report.daily);
 if(rows.length){const data=table(['Month',...weekdays]);data.t.className='averages';const caption=node('caption','Average daily Other enquiries. Zero-enquiry days included; partial months use only dates covered by the report.');data.t.prepend(caption);
  for(const month of rows){const row=node('tr');row.append(node('td',new Date(month.month+'-01T00:00:00Z').toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'UTC'})));month.averages.forEach((v,i)=>{const cell=node('td',v===null?'—':v.toLocaleString('en-GB',{minimumFractionDigits:1,maximumFractionDigits:1}));cell.title=month.days[i]?month.counts[i]+' enquiries across '+month.days[i]+' days':'No dates covered';row.append(cell);});data.body.append(row);}p.append(data.wrap);
 }else p.append(node('p','No Rapid Health data has been uploaded for this practice.','empty'));
 content.append(p);
 if(canManage(practice))renderUpload(content);
 const history=panel('Recent imports'),data=table(['Uploaded','Source','Added','Ignored']);
 for(const item of report.imports)textRow(data.body,[formatDate(item.imported_at),item.source_name,Number(item.added).toLocaleString('en-GB'),Number(item.skipped).toLocaleString('en-GB')]);
 history.append(report.imports.length?data.wrap:node('p','No imports yet.','subtle'));content.append(history);
}
function renderUpload(content){
 const p=panel('Upload Rapid Health data'),zone=node('div',undefined,'upload-zone');zone.tabIndex=0;zone.setAttribute('aria-label','Drop a Rapid Health CSV or select a file');
 zone.append(node('h3','Drop a CSV to update this practice'),node('p','Start with a full export. Later exports can overlap: only requests after the latest saved minute are added.'));
 const label=node('label','Choose a CSV'),input=node('input');input.type='file';input.accept='.csv,text/csv';label.append(input);zone.append(label);
 input.addEventListener('change',()=>{const file=input.files?.[0];if(file)run(()=>prepareUpload(file));});
 zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('drag-over');});zone.addEventListener('dragleave',()=>zone.classList.remove('drag-over'));
 zone.addEventListener('drop',e=>{e.preventDefault();zone.classList.remove('drag-over');if(e.dataTransfer.files.length!==1){notice('Drop one CSV at a time.',true);return;}run(()=>prepareUpload(e.dataTransfer.files[0]));});
 p.append(zone,node('p',backend.demo?'Demo imports are temporary and disappear when you leave or reload the demo.':'Only request counts and reporting coverage are stored for this MVP. The CSV and patient details are not retained.','subtle'));content.append(p);
}
async function prepareUpload(file){
 if(!canManage(practice))throw Error('Practice administrator required.');
 if(!/\.csv$/i.test(file.name)||!file.size||file.size>50*1024*1024)throw Error('Choose a non-empty CSV no larger than 50 MB.');
 if(!globalThis.Papa)throw Error('The CSV reader did not load. Reload the page.');
 const selected=practice.id,bundle=parseUpload(await file.text(),globalThis.Papa);
 if(bundle.tenant!==practice.tenant_name)throw Error('This CSV belongs to '+bundle.tenant+', not the selected practice ('+practice.tenant_name+').');
 const cutoff=report.state?.latest_request?.replace(' ','T'),newRows=bundle.rows.filter(r=>!cutoff||r.at>cutoff).reduce((sum,r)=>sum+r.total,0);
 $('importSummary').textContent='Practice: '+practice.name+'. '+newRows.toLocaleString('en-GB')+' new requests and '+(bundle.count-newRows).toLocaleString('en-GB')+' earlier or overlapping requests in '+file.name+'.';
 const accepted=await new Promise(resolve=>{const dialog=$('importDialog');dialog.returnValue='cancel';dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'),{once:true});dialog.showModal();dialog.querySelectorAll('button').forEach(b=>b.disabled=false);});
 if(!accepted)return;if(practice.id!==selected)throw Error('Practice changed. Select the file again.');
 const result=await backend.importRH(selected,bundle,file.name);await reload();notice('Import complete: '+result.added.toLocaleString('en-GB')+' requests added; '+result.skipped.toLocaleString('en-GB')+' earlier or overlapping requests ignored.');
}
function openUsersApprovals(){
 if(!user||!currentApproved()||!canManage(practice))throw Error('Practice administrator required.');
 $('usersApprovalsContent').replaceChildren();renderUsers($('usersApprovalsContent'));$('usersApprovalsDialog').showModal();
}
function renderUsers(content,{practiceId=practice?.id,people=members,refresh=reload,administratorsOnly=false}={}){
 const heading=administratorsOnly?'Administrator approvals':'Users & approvals';
 const p=panel(heading),data=table(['User','Role','Access','Actions']);
 for(const member of people){const row=node('tr'),status=node('td'),actions=node('td'),badge=node('span',member.status,'badge '+member.status);status.append(badge);row.append(node('td',member.email),node('td',member.role==='practice_admin'?'Administrator':'Viewer'),status,actions);
  const allowed=member.user_id!==user.id&&(context.platform_admin||member.role!=='practice_admin');
  if(allowed){
   const group=node('div',undefined,'actions');
   if(member.status!=='approved')group.append(button('Approve',async()=>{await backend.setStatus(practiceId,member.user_id,'approved');await refresh();notice('Practice access approved.');}));
   if(member.status!=='suspended')group.append(button('Suspend',async()=>{await backend.setStatus(practiceId,member.user_id,'suspended');await refresh();notice('Practice access suspended.');}));
   if(!administratorsOnly&&member.role==='viewer')group.append(button('Remove',async()=>{
    if(!window.confirm('Remove '+member.email+' from this practice? They will need a new invitation and approval to regain access.'))return;
    await backend.removeViewer(practiceId,member.user_id);
    await refresh();
    notice('Viewer removed. You can invite them again at any time.');
   }));
   actions.append(group);
  }
  data.body.append(row);
 }
 p.append(people.length?data.wrap:node('p',administratorsOnly?'No administrators have accepted an invitation yet.':'No users have accepted an invitation yet.','subtle'));content.append(p);
 const invite=panel(administratorsOnly?'Invite a practice administrator':'Invite a user'),form=node('form'),emailLabel=node('label','Email address'),email=node('input');email.type='email';email.required=true;email.autocomplete='off';emailLabel.append(email);form.append(emailLabel);
 const roleLabel=node('label','Role'),role=node('select');for(const [value,text] of (administratorsOnly?[['practice_admin','Practice administrator']]:[['viewer','Practice viewer']])){const option=node('option',text);option.value=value;role.append(option);}roleLabel.append(role);form.append(roleLabel);
 const submit=node('button',backend.demo?'Preview invitation':'Send invitation email','primary');submit.type='submit';form.append(submit);invite.append(node('p','We will email this person an invitation. After they verify their email and accept, approve their access above.','subtle'),form);
 const result=node('div',undefined,'invite-result');result.hidden=true;invite.append(result);
 form.addEventListener('submit',event=>{event.preventDefault();result.replaceChildren();result.hidden=true;run(async()=>{const response=await backend.invite(practiceId,email.value,role.value);result.hidden=false;
  if(backend.demo){result.textContent='Demo invitation created for '+email.value+'. No email has been sent and this link does not create a real account.';return;}
  result.append(node('p','Invitation submitted for email delivery to '+response.email+'. Ask them to check their inbox and spam folder.'),node('p','Invitation expires '+formatDate(response.expires_at),'subtle'));
 });});content.append(invite);
}
function renderPractices(content){
 const practices=[...context.practices].sort((a,b)=>a.name.localeCompare(b.name,'en-GB'));
 const revision=JSON.stringify([user.id,practices]);
 // Keep the directory and in-progress form intact during background refreshes.
 if(content.firstElementChild?.dataset.directoryRevision===revision)return;
 const directory=node('div',undefined,'platform-directory');
 directory.dataset.directoryRevision=revision;
 const totals=node('dl',undefined,'directory-totals');
 const active=practices.filter(item=>item.active).length;
 for(const [label,count] of [['Total practices',practices.length],['Active',active],['Inactive',practices.length-active]]){
  const metric=node('div');
  metric.append(node('dt',label),node('dd',count.toLocaleString('en-GB')));
  totals.append(metric);
 }
 const columns=node('div',undefined,'directory-columns');
 const listPanel=panel('Practice directory');
 const searchLabel=node('label','Find a practice');
 const search=node('input');
 search.type='search';
 search.placeholder='Search by name or tenant';
 searchLabel.append(search);
 const matches=node('p',undefined,'subtle');
 matches.setAttribute('role','status');
 const list=node('ul',undefined,'directory-list');
 const showMatches=()=>{
  const query=search.value.trim().toLocaleLowerCase('en-GB');
  const visible=practices.filter(item=>[item.name,item.tenant_name].some(value=>value.toLocaleLowerCase('en-GB').includes(query)));
  matches.textContent=visible.length+' of '+practices.length+' practices';
  list.replaceChildren();
  if(!visible.length){
   list.append(node('li',practices.length?'No practices match your search.':'Create your first practice to get started.','empty'));
   return;
  }
  for(const item of visible){
   const row=node('li',undefined,'directory-row');
   const identity=node('div',undefined,'directory-identity');
   identity.append(node('h3',item.name),node('span',item.tenant_name,'subtle'));
   const actions=node('div',undefined,'actions');
   if(item.active){
    const administrators=button('Manage administrators',()=>managePracticeAdministrators(item.id));
    administrators.setAttribute('aria-label','Manage administrators for '+item.name);
    actions.append(administrators);
   }
   row.append(identity,node('span',item.active?'Active':'Inactive',item.active?'badge approved':'badge'),actions);
   list.append(row);
  }
 };
 search.addEventListener('input',showMatches);
 showMatches();
 listPanel.append(searchLabel,matches,list);

 const create=panel('Add a practice');
 const form=node('form');
 const nameLabel=node('label','Practice name'),name=node('input');
 const tenantLabel=node('label','Rapid Health tenant name'),tenant=node('input');
 name.required=true;
 name.minLength=2;
 name.maxLength=120;
 tenant.required=true;
 tenant.pattern='[a-zA-Z0-9_\\-]{2,80}';
 tenant.placeholder='e.g. darwin';
 tenant.autocapitalize='none';
 tenant.spellcheck=false;
 const help=node('p','Use the tenant name from the practice’s Rapid Health CSV.','subtle');
 help.id='practiceTenantHelp';
 tenant.setAttribute('aria-describedby',help.id);
 nameLabel.append(name);
 tenantLabel.append(tenant);
 const submit=node('button','Create practice','primary');
 submit.type='submit';
 form.append(nameLabel,tenantLabel,help,submit);
 form.addEventListener('submit',event=>{
  event.preventDefault();
  run(async()=>{
   const id=await backend.createPractice(name.value.trim(),tenant.value.trim().toLowerCase());
   form.reset();
   await reload();
   await managePracticeAdministrators(id);
   notice('Practice created. You can now invite its administrator.');
  });
 });
 create.append(node('p','Create a workspace, then invite the practice administrator.','subtle'),form);
 columns.append(listPanel,create);
 directory.append(totals,columns);
 content.replaceChildren(directory);
}
async function managePracticeAdministrators(id){
 const target=context?.platform_admin&&context.practices.find(item=>item.id===id&&item.active);
 const directory=$('content').firstElementChild;
 if(!target||!directory)throw Error('This practice is no longer available.');
 const dialog=node('dialog');
 const heading=node('h2',target.name+' administrators');
 heading.id='platformAdministratorsHeading';
 dialog.setAttribute('aria-labelledby',heading.id);
 const closeForm=node('form');
 closeForm.method='dialog';
 const close=node('button','Close','secondary');
 closeForm.append(close);
 const header=node('div',undefined,'panel-header');
 header.append(heading,closeForm);
 const body=node('div');
 dialog.append(header,body);
 const refresh=async()=>{
  const people=await backend.members(id);
  body.replaceChildren();
  renderUsers(body,{practiceId:id,people,refresh,administratorsOnly:true});
 };
 await refresh();
 if(!directory.isConnected||!context?.platform_admin)return;
 directory.append(dialog);
 dialog.addEventListener('close',()=>dialog.remove(),{once:true});
 dialog.showModal();
}
async function reload(preferred){
 const version=++loadVersion;report=null;members=[];render();
 const next=await backend.context();if(version!==loadVersion)return;context=next;
 if(next.platform_admin){
  practice=null;
  view='practices';
  render();
  return;
 }
 const previous=preferred||practice?.id;practice=next.practices.find(p=>p.id===previous)||next.practices[0]||null;render();
 if(!currentApproved())return;
 const selected=practice.id;
 const [nextReport,nextMembers]=await Promise.all([backend.report(selected),canManage(practice)?backend.members(selected):Promise.resolve([])]);
 if(version!==loadVersion||practice.id!==selected)return;report=nextReport;members=nextMembers;render();
}
async function loadUser(){user=await backend.user();if(!user){context=null;practice=null;report=null;members=[];render();return;}await reload();}
$('loginForm').addEventListener('submit',event=>{event.preventDefault();run(async()=>{await backend.login($('email').value,$('password').value);$('password').value='';await loadUser();if(ownerSetup){await backend.claimPlatformAdmin();history.replaceState({},'',location.pathname);await reload();}else if(invitation){await backend.redeem(invitation);history.replaceState({},'',location.pathname);await reload();}});});
$('signupForm').addEventListener('submit',event=>{event.preventDefault();run(async()=>{if(!invitation&&!ownerSetup)throw Error('An invitation link is required.');const query=ownerSetup?'?setup=1':'?invite='+encodeURIComponent(invitation);const live=await backend.signup($('signupEmail').value,$('signupPassword').value,location.origin+location.pathname+query);$('signupPassword').value='';if(live){await loadUser();if(ownerSetup)await backend.claimPlatformAdmin();else await backend.redeem(invitation);await reload();}else notice('Check your email to verify your account, then return to this setup or invitation link.');});});
$('forgotPassword').addEventListener('click',()=>run(async()=>{if(!$('email').value||!$('email').checkValidity())throw Error('Enter your email address first.');await backend.reset($('email').value,location.origin+location.pathname);notice('If this account exists, a password-reset email will be sent.');}));
$('recoveryForm').addEventListener('submit',event=>{event.preventDefault();run(async()=>{await backend.password($('newPassword').value);$('newPassword').value='';recovery=false;$('recoveryForm').hidden=true;await loadUser();notice('Your password has been changed.');});});
$('showSignup').addEventListener('click',()=>{$('loginForm').hidden=true;$('signupForm').hidden=false;$('showSignup').hidden=true;});
$('returnLogin').addEventListener('click',()=>{$('loginForm').hidden=false;$('signupForm').hidden=true;$('showSignup').hidden=!invitation&&!ownerSetup;});
$('redeemForm').addEventListener('submit',event=>{event.preventDefault();run(async()=>{await backend.redeem($('inviteCode').value.trim());history.replaceState({},'',location.pathname);await reload();notice('Invitation accepted. Your practice administrator can now approve your access.');});});
$('enterDemo').addEventListener('click',()=>run(async()=>{backend=new DemoBackend();user=await backend.user();view='home';notice('Demo mode: fictional practices and accounts. No real sign-in or data storage.');await reload();}));
$('demoIdentity').addEventListener('change',()=>run(async()=>{backend.identity=$('demoIdentity').value;user=await backend.user();view='home';practice=null;await reload();}));
$('signOut').addEventListener('click',()=>run(async()=>{const old=backend;++loadVersion;user=null;context=null;practice=null;report=null;members=[];render();await old.logout();if(old.demo){backend=null;$('demoIdentity').value='platform';await initialise();}notice('Signed out.');}));
$('practiceSelect').addEventListener('change',()=>run(()=>reload($('practiceSelect').value)));
$('refresh').addEventListener('click',()=>run(async()=>{await reload();analyticsFrame?.contentWindow.postMessage({type:'iq-refresh'},location.origin);}));
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{view=b.dataset.view;render();}));
async function initialise(){
 let configured=false;try{configured=validateConfig(window.DARWIN_CONFIG);}catch(error){notice(error.message,true);}
 $('previewChoice').hidden=configured;$('loginForm').hidden=!configured;$('showSignup').hidden=!configured||(!invitation&&!ownerSetup);
 if(ownerSetup){$('authHeading').textContent='Administrator setup';$('authDescription').textContent='Use your designated administrator email to create your account or sign in.';$('showSignup').textContent='Create administrator account';$('signupForm').querySelector('button[type=submit]').textContent='Create administrator account';$('signupForm').querySelector('p').textContent='Use at least 12 characters. Verify your email to activate your designated platform administrator account.';}
 if(!configured){backend=null;render();return;}
 try{
  const {createClient}=await import('https://esm.sh/@supabase/supabase-js@2.49.8');
  const client=createClient(window.DARWIN_CONFIG.supabaseUrl,window.DARWIN_CONFIG.publishableKey,{auth:{flowType:'pkce',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});backend=new SupabaseBackend(client);
  client.auth.onAuthStateChange((event)=>{if(event==='PASSWORD_RECOVERY'){recovery=true;$('loginForm').hidden=true;$('signupForm').hidden=true;$('recoveryForm').hidden=false;render();}if(event==='SIGNED_OUT'){++loadVersion;user=null;context=null;practice=null;report=null;members=[];render();}});
  await loadUser();
  if(user&&ownerSetup){await backend.claimPlatformAdmin();history.replaceState({},'',location.pathname);await reload();}
  else if(user&&invitation){await backend.redeem(invitation);history.replaceState({},'',location.pathname);await reload();}
 }catch(error){notice('Account connection could not be completed: '+error.message,true);}
}
setInterval(()=>{if(user&&!busy&&!backend.demo&&!document.hidden)run(()=>reload());},60000);
await initialise();

