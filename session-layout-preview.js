(function(){
'use strict';
const byId=id=>document.getElementById(id);
const choices=[
 {id:'face15',label:'Face-to-face',minutes:15,kind:'face'},
 {id:'face10',label:'Face-to-face',minutes:10,kind:'face'},
 {id:'phone10',label:'Phone call',minutes:10,kind:'phone'},
 {id:'phone5',label:'Phone call',minutes:5,kind:'phone'},
 {id:'visit30',label:'Visit',minutes:30,kind:'visit'},
 {id:'catchup10',label:'Catch-up',minutes:10,kind:'catchup'},
 {id:'admin',label:'Admin',minutes:15,kind:'admin'}
];
let draft=null,sessionId=null,selected=null,movingBlock=null,dragKind='',hasChanges=false;
const durationOf=block=>block.type==='admin'?block.duration:choices.find(choice=>choice.id===block.type).minutes;
const dirty=()=>{hasChanges=true;byId('sessionLayoutSaveStatus').textContent='Unsaved changes';};
const minutes=value=>/^\d\d:\d\d$/.test(value)?Number(value.slice(0,2))*60+Number(value.slice(3)):NaN;
const clock=value=>String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0');
const message=text=>{byId('sessionLayoutStatus').textContent=text};
// Use the same consultation-mode colours as Slot Settings, including its defaults.
function applyConsultColour(element,kind){
 const patterns={face:/^(?:f2f|facetoface|inperson|clinicappointment|inclinic)$/,phone:/^(?:phone|telephone|telephoneconsultation|phonecall|telephony)$/,visit:/^(?:visit|homevisit|homevisiting|domiciliary|housecall)$/};
 if(!patterns[kind])return;
 const normal=name=>String(name).toLowerCase().replace(/[^a-z0-9]/g,'');
 const modes=typeof consultCategoryNames==='undefined'?[]:consultCategoryNames;
 const mode=modes.find(name=>patterns[kind].test(normal(name)));
 let colour='';
 if(mode&&typeof consultModeColours!=='undefined'&&typeof typeColour==='function')colour=typeColour(mode,consultModeColours);
 else if(kind==='visit'&&typeof appointmentCategoryNames!=='undefined'&&typeof appointmentCategoryColours!=='undefined'&&typeof typeColour==='function'){
  const home=appointmentCategoryNames.find(name=>normal(name)==='homevisit');if(home)colour=typeColour(home,appointmentCategoryColours);
 }
 if(!/^#[0-9a-f]{6}$/i.test(colour))return;
 const rgb=[1,3,5].map(index=>parseInt(colour.slice(index,index+2),16));
 const background=rgb.map(value=>Math.round(value*0.2+255*0.8));
 const luminance=values=>values.map(value=>{const c=value/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;}).reduce((sum,c,index)=>sum+c*[0.2126,0.7152,0.0722][index],0);
 const bgLight=luminance(background),contrast=values=>(bgLight+0.05)/(luminance(values)+0.05);
 // Pale version of the configured colour makes its darker text clearly visible.
 let factor=0.53,text=rgb.map(value=>Math.round(value*factor));
 while(contrast(text)<4.5&&factor>0.1){factor-=0.05;text=rgb.map(value=>Math.round(value*factor));}
 element.style.backgroundColor='rgb('+background.join(',')+')';element.style.borderLeftColor=colour;element.style.color='rgb('+text.join(',')+')';
}
function renderPalette(){
 const container=byId('sessionLayoutBlocks');container.replaceChildren();
 for(const item of choices){
  const button=document.createElement('button');button.type='button';button.className='session-layout-block-choice '+item.kind+(selected===item.id?' selected':'');button.draggable=true;applyConsultColour(button,item.kind);button.setAttribute('aria-pressed',String(selected===item.id));
  const name=document.createElement('strong');name.textContent=item.label;const duration=document.createElement('span');duration.textContent=item.minutes+' minutes';button.append(name,duration);
  button.addEventListener('click',()=>{selected=item.id;movingBlock=null;renderPalette();renderTimeline();message(item.label+' selected. Choose a time in the timetable.');});
  button.addEventListener('dragstart',event=>{event.dataTransfer.setData('text/plain','new:'+item.id);event.dataTransfer.effectAllowed='copy';dragKind='new';});
  container.append(button);
 }
}
function addAt(type,time,existing){
 const item=existing?choices.find(choice=>choice.id===existing.type):choices.find(choice=>choice.id===type);
 if(!item)return;
 const duration=existing?durationOf(existing):item.minutes;
 if(time<draft.start||time+duration>draft.end){message('That block does not fit within the session times.');return;}
 if(draft.blocks.some(block=>block!==existing&&time<block.start+durationOf(block)&&time+duration>block.start)){message('That time overlaps another block. Choose an empty time.');return;}
 if(existing)existing.start=time;else draft.blocks.push(item.id==='admin'?{type:item.id,start:time,duration:item.minutes}:{type:item.id,start:time});dirty();
 movingBlock=null;message(item.label+(existing?' moved to ':' added at ')+clock(time)+'.');renderTimeline();
}
function timeAt(clientY){
 const root=byId('sessionLayoutTimeline'),rect=root.getBoundingClientRect();
 if(clientY<rect.top||clientY>=rect.bottom)return null;
 const rowHeight=(rect.height-2)/((draft.end-draft.start)/5);
 return Math.min(draft.end-5,draft.start+Math.max(0,Math.floor((clientY-rect.top-1)/rowHeight))*5);
}
function renderTimeline(){
 const root=byId('sessionLayoutTimeline');root.replaceChildren();const count=(draft.end-draft.start)/5;
 root.style.setProperty('--session-layout-rows',count);byId('sessionLayoutDuration').textContent=(draft.end-draft.start)/60+' hours';
 byId('sessionLayoutCount').textContent=draft.blocks.length+' '+(draft.blocks.length===1?'block':'blocks');
 const tally={face:0,phone:0,visit:0};for(const block of draft.blocks){const kind=choices.find(choice=>choice.id===block.type)?.kind;if(Object.hasOwn(tally,kind))tally[kind]++;}
 byId('sessionLayoutFaceCount').textContent=String(tally.face);byId('sessionLayoutPhoneCount').textContent=String(tally.phone);byId('sessionLayoutVisitCount').textContent=String(tally.visit);byId('sessionLayoutTotalCount').textContent=String(tally.face+tally.phone+tally.visit);
 for(let i=0;i<count;i++){
  const time=draft.start+i*5,slot=document.createElement('button');slot.type='button';slot.className='session-layout-slot'+(time%30===0?' major':'');slot.style.gridRow=String(i+1);slot.setAttribute('aria-label','Add selected block at '+clock(time));
  if(time%15===0||i===0){const label=document.createElement('span');label.textContent=clock(time);slot.append(label);}
  slot.addEventListener('click',()=>{if(movingBlock)addAt(movingBlock.type,time,movingBlock);else if(selected)addAt(selected,time);else message('First select an appointment block or an existing appointment.');});
  root.append(slot);
 }
 draft.blocks.forEach((block,index)=>{
  const item=choices.find(choice=>choice.id===block.type),duration=durationOf(block),card=document.createElement('div');card.className='session-layout-placed '+item.kind+(movingBlock===block?' moving':'');card.style.gridRow=(1+(block.start-draft.start)/5)+' / span '+(duration/5);card.draggable=true;applyConsultColour(card,item.kind);card.tabIndex=0;card.setAttribute('role','button');card.setAttribute('aria-label','Move '+item.label+' at '+clock(block.start));
  const label=document.createElement('span');label.textContent=clock(block.start)+'–'+clock(block.start+duration)+' · '+item.label+' · '+duration+' min';
  const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','Remove '+item.label+' at '+clock(block.start));remove.addEventListener('click',()=>{if(movingBlock===block)movingBlock=null;draft.blocks.splice(index,1);dirty();renderTimeline();message('Block removed.');});
  if(block.type==='admin'){
   for(const edge of ['top','bottom']){
    const handle=document.createElement('button');handle.type='button';handle.className='session-layout-resize '+edge;handle.setAttribute('aria-label','Resize Admin '+edge+' edge');handle.title='Drag to resize in 5 minute steps';
    const resize=delta=>{
     const start=edge==='top'?block.start+delta:block.start,end=edge==='bottom'?block.start+block.duration+delta:block.start+block.duration;
     if(start<draft.start||end>draft.end||end-start<5||draft.blocks.some(other=>other!==block&&start<other.start+durationOf(other)&&end>other.start)){message('Admin must fit within the session without overlapping another block.');return;}
     block.start=start;block.duration=end-start;dirty();renderTimeline();message('Admin block is '+block.duration+' minutes.');
    };
    let origin=null;
    handle.addEventListener('pointerdown',event=>{event.preventDefault();event.stopPropagation();origin=event.clientY;handle.setPointerCapture(event.pointerId);});
    handle.addEventListener('pointerup',event=>{event.preventDefault();event.stopPropagation();if(origin===null)return;const rect=root.getBoundingClientRect(),rowHeight=(rect.height-2)/((draft.end-draft.start)/5),delta=Math.round((event.clientY-origin)/rowHeight)*5;origin=null;if(delta)resize(delta);});
    handle.addEventListener('pointercancel',()=>{origin=null;});
    handle.addEventListener('keydown',event=>{if(!['ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();event.stopPropagation();resize(event.key==='ArrowUp'?-5:5);});
    card.append(handle);
   }
  }
  const selectMove=()=>{movingBlock=block;selected=null;renderPalette();renderTimeline();message('Choose a new time for '+item.label+'.');};
  let touchStart=null,suppressClick=false;
  card.addEventListener('pointerdown',event=>{if(event.pointerType!=='touch'||event.target.closest('button'))return;touchStart={x:event.clientX,y:event.clientY,moved:false};card.setPointerCapture(event.pointerId);});
  card.addEventListener('pointermove',event=>{if(!touchStart)return;if(Math.hypot(event.clientX-touchStart.x,event.clientY-touchStart.y)>8)touchStart.moved=true;});
  card.addEventListener('pointerup',event=>{if(!touchStart)return;const moved=touchStart.moved;touchStart=null;if(!moved)return;suppressClick=true;const time=timeAt(event.clientY);if(time!==null)addAt(block.type,time,block);else message('Drop the block onto a time in the timetable.');});
  card.addEventListener('click',event=>{if(event.target.closest('button'))return;if(suppressClick){suppressClick=false;return;}selectMove();});
  card.addEventListener('keydown',event=>{if(event.target!==card||!['Enter',' '].includes(event.key))return;event.preventDefault();selectMove();});
  card.addEventListener('dragstart',event=>{event.dataTransfer.setData('text/plain','move:'+index);event.dataTransfer.effectAllowed='move';dragKind='move';});card.append(label,remove);root.append(card);
 });
}
function changeTimes(){
 const start=minutes(byId('sessionLayoutStart').value),end=minutes(byId('sessionLayoutEnd').value);
 if(!Number.isFinite(start)||!Number.isFinite(end)||start%5||end%5||end<=start||end-start>720){byId('sessionLayoutStart').value=clock(draft.start);byId('sessionLayoutEnd').value=clock(draft.end);message('Choose a start and end in five-minute steps, with an end after the start and no more than 12 hours apart.');return;}
 if(draft.blocks.some(block=>block.start<start||block.start+durationOf(block)>end)){byId('sessionLayoutStart').value=clock(draft.start);byId('sessionLayoutEnd').value=clock(draft.end);message('Remove or move blocks outside the new time range first.');return;}
 draft.start=start;draft.end=end;dirty();message('');renderTimeline();
}
window.openSessionLayoutPreview=row=>{
 if(!row||!byId('sessionLayoutEditor'))return;
 sessionId=row.id;const saved=window.getSessionBuilderLayout?.(row.id);draft=saved?JSON.parse(JSON.stringify(saved)):{start:510,end:750,blocks:[]};selected=null;movingBlock=null;hasChanges=false;byId('sessionLayoutSaveStatus').textContent='';
 byId('sessionLayoutTitle').textContent=row.name+' session';byId('sessionLayoutStart').value=clock(draft.start);byId('sessionLayoutEnd').value=clock(draft.end);
 byId('sessionBuilderTypesContent').hidden=true;byId('sessionLayoutEditor').hidden=false;byId('sessionBuilderPage').querySelector('.session-builder-tabs').hidden=true;
 message('');renderPalette();renderTimeline();byId('sessionLayoutBack').focus();
};
byId('sessionLayoutSave')?.addEventListener('click',async()=>{
 const button=byId('sessionLayoutSave'),snapshot=JSON.stringify(draft),savedId=sessionId;button.disabled=true;byId('sessionLayoutSaveStatus').textContent='Saving…';
 try{await window.saveSessionBuilderLayout(savedId,JSON.parse(snapshot));if(sessionId===savedId){hasChanges=JSON.stringify(draft)!==snapshot;byId('sessionLayoutSaveStatus').textContent=hasChanges?'Unsaved changes':'Session layout saved.';}}
 catch(error){byId('sessionLayoutSaveStatus').textContent=error.message||'Could not save the session layout.';}
 finally{button.disabled=false;}
});
byId('sessionLayoutTimeline')?.addEventListener('dragover',event=>{event.preventDefault();event.dataTransfer.dropEffect=dragKind==='move'?'move':'copy';});
byId('sessionLayoutTimeline')?.addEventListener('drop',event=>{event.preventDefault();const time=timeAt(event.clientY);if(time===null)return;const [kind,value]=event.dataTransfer.getData('text/plain').split(':');if(kind==='new')addAt(value,time);if(kind==='move'){const block=draft.blocks[Number(value)];if(block)addAt(block.type,time,block);}dragKind='';});
byId('sessionLayoutBack')?.addEventListener('click',()=>{if(byId('sessionLayoutSave').disabled){message('Please wait for the layout to finish saving.');return;}if(hasChanges&&!confirm('Leave without saving this session layout?'))return;byId('sessionLayoutEditor').hidden=true;byId('sessionBuilderTypesContent').hidden=false;byId('sessionBuilderPage').querySelector('.session-builder-tabs').hidden=false;});
byId('sessionLayoutStart')?.addEventListener('change',changeTimes);byId('sessionLayoutEnd')?.addEventListener('change',changeTimes);
})();
