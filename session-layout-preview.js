(function(){
'use strict';
const byId=id=>document.getElementById(id);
const choices=[
 {id:'face15',label:'Face-to-face',minutes:15,kind:'face'},
 {id:'face10',label:'Face-to-face',minutes:10,kind:'face'},
 {id:'phone10',label:'Phone call',minutes:10,kind:'phone'},
 {id:'phone5',label:'Phone call',minutes:5,kind:'phone'},
 {id:'catchup10',label:'Catch-up',minutes:10,kind:'catchup'}
];
const drafts=new Map();let draft=null,selected=null;
const minutes=value=>/^\d\d:\d\d$/.test(value)?Number(value.slice(0,2))*60+Number(value.slice(3)):NaN;
const clock=value=>String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0');
const message=text=>{byId('sessionLayoutStatus').textContent=text};
function renderPalette(){
 const container=byId('sessionLayoutBlocks');container.replaceChildren();
 for(const item of choices){
  const button=document.createElement('button');button.type='button';button.className='session-layout-block-choice '+item.kind+(selected===item.id?' selected':'');button.draggable=true;button.setAttribute('aria-pressed',String(selected===item.id));
  const name=document.createElement('strong');name.textContent=item.label;const duration=document.createElement('span');duration.textContent=item.minutes+' minutes';button.append(name,duration);
  button.addEventListener('click',()=>{selected=item.id;renderPalette();message(item.label+' selected. Choose a time in the timetable.');});
  button.addEventListener('dragstart',event=>{event.dataTransfer.setData('text/plain','new:'+item.id);event.dataTransfer.effectAllowed='copy';});
  container.append(button);
 }
}
function addAt(type,time,existing){
 const item=existing?choices.find(choice=>choice.id===existing.type):choices.find(choice=>choice.id===type);
 if(!item)return;
 if(time<draft.start||time+item.minutes>draft.end){message('That block does not fit within the session times.');return;}
 if(draft.blocks.some(block=>block!==existing&&time<block.start+choices.find(choice=>choice.id===block.type).minutes&&time+item.minutes>block.start)){message('That time overlaps another block. Choose an empty time.');return;}
 if(existing)existing.start=time;else draft.blocks.push({type:item.id,start:time});
 message(item.label+' added at '+clock(time)+'.');renderTimeline();
}
function renderTimeline(){
 const root=byId('sessionLayoutTimeline');root.replaceChildren();const count=(draft.end-draft.start)/5;
 root.style.setProperty('--session-layout-rows',count);byId('sessionLayoutDuration').textContent=(draft.end-draft.start)/60+' hours';
 byId('sessionLayoutCount').textContent=draft.blocks.length+' '+(draft.blocks.length===1?'block':'blocks');
 for(let i=0;i<count;i++){
  const time=draft.start+i*5,slot=document.createElement('button');slot.type='button';slot.className='session-layout-slot'+(time%30===0?' major':'');slot.style.gridRow=String(i+1);slot.setAttribute('aria-label','Add selected block at '+clock(time));
  if(time%15===0||i===0){const label=document.createElement('span');label.textContent=clock(time);slot.append(label);}
  slot.addEventListener('click',()=>{if(selected)addAt(selected,time);else message('First select an appointment block on the left.');});
  slot.addEventListener('dragover',event=>{event.preventDefault();event.dataTransfer.dropEffect='copy';});
  slot.addEventListener('drop',event=>{event.preventDefault();const [kind,value]=event.dataTransfer.getData('text/plain').split(':');if(kind==='new')addAt(value,time);if(kind==='move'){const block=draft.blocks[Number(value)];if(block)addAt(block.type,time,block);}});
  root.append(slot);
 }
 draft.blocks.forEach((block,index)=>{
  const item=choices.find(choice=>choice.id===block.type),card=document.createElement('div');card.className='session-layout-placed '+item.kind;card.style.gridRow=(1+(block.start-draft.start)/5)+' / span '+(item.minutes/5);card.draggable=true;
  const label=document.createElement('span');label.textContent=clock(block.start)+'–'+clock(block.start+item.minutes)+' · '+item.label+' · '+item.minutes+' min';
  const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','Remove '+item.label+' at '+clock(block.start));remove.addEventListener('click',()=>{draft.blocks.splice(index,1);renderTimeline();message('Block removed.');});
  card.addEventListener('dragstart',event=>{event.dataTransfer.setData('text/plain','move:'+index);event.dataTransfer.effectAllowed='move';});card.append(label,remove);root.append(card);
 });
}
function changeTimes(){
 const start=minutes(byId('sessionLayoutStart').value),end=minutes(byId('sessionLayoutEnd').value);
 if(!Number.isFinite(start)||!Number.isFinite(end)||start%5||end%5||end<=start||end-start>720){byId('sessionLayoutStart').value=clock(draft.start);byId('sessionLayoutEnd').value=clock(draft.end);message('Choose a start and end in five-minute steps, with an end after the start and no more than 12 hours apart.');return;}
 if(draft.blocks.some(block=>block.start<start||block.start+choices.find(choice=>choice.id===block.type).minutes>end)){byId('sessionLayoutStart').value=clock(draft.start);byId('sessionLayoutEnd').value=clock(draft.end);message('Remove or move blocks outside the new time range first.');return;}
 draft.start=start;draft.end=end;message('');renderTimeline();
}
window.openSessionLayoutPreview=row=>{
 if(!row||!byId('sessionLayoutEditor'))return;
 if(!drafts.has(row.id))drafts.set(row.id,{start:510,end:750,blocks:[]});draft=drafts.get(row.id);selected=null;
 byId('sessionLayoutTitle').textContent=row.name+' session';byId('sessionLayoutStart').value=clock(draft.start);byId('sessionLayoutEnd').value=clock(draft.end);
 byId('sessionBuilderTypesContent').hidden=true;byId('sessionLayoutEditor').hidden=false;byId('sessionBuilderPage').querySelector('.session-builder-tabs').hidden=true;
 message('');renderPalette();renderTimeline();byId('sessionLayoutBack').focus();
};
byId('sessionLayoutBack')?.addEventListener('click',()=>{byId('sessionLayoutEditor').hidden=true;byId('sessionBuilderTypesContent').hidden=false;byId('sessionBuilderPage').querySelector('.session-builder-tabs').hidden=false;});
byId('sessionLayoutStart')?.addEventListener('change',changeTimes);byId('sessionLayoutEnd')?.addEventListener('change',changeTimes);
})();
