import {localDay,parseTaskLines,suggestedTaskLines,buildPlanningDraft} from './task-parser.js';
const $=selector=>document.querySelector(selector);
const element=(tag,text)=>{const node=document.createElement(tag);if(text)node.textContent=text;return node;};
export function createTasks({api,isBusy,showError,onPlan,onHermes}){
 let pending=false,loading=false,request=0;
 $('#task-day').value=localDay();
 const updateDisabled=()=>{const disabled=pending||loading||isBusy();for(const control of document.querySelectorAll('.tasks-panel button,.tasks-panel input,#task-dialog button,#task-dialog input,#task-dialog textarea'))control.disabled=disabled;};
 const load=async()=>{
 const active=++request,day=$('#task-day').value;loading=true;updateDisabled();
 try{
 const tasks=await api('/tasks?day='+encodeURIComponent(day));if(active!==request)return;
 const list=$('#tasks-list');list.replaceChildren();
 const completed=tasks.filter(task=>task.done).length;$('#tasks-summary').textContent=tasks.length?completed+' von '+tasks.length+' erledigt':'Noch keine Aufgaben für diesen Tag.';
 for(const task of tasks){
 const row=element('div');row.className='task-row'+(task.done?' completed':'');
 const label=element('label'),check=element('input');check.type='checkbox';check.checked=!!task.done;check.setAttribute('aria-label',task.text+' als erledigt markieren');
 check.onchange=()=>{void run(async()=>{await api('/tasks/'+task.id,'PATCH',{text:task.text,time:task.time,done:check.checked});await load();});};
 const text=element('span',(task.time?task.time+' · ':'')+task.text);label.append(check,text);row.append(label);
 const controls=element('div');controls.className='task-row-actions';
 const edit=element('button','Bearbeiten');edit.type='button';edit.onclick=()=>{void run(async()=>{const value=prompt('Aufgabe bearbeiten, optional mit Uhrzeit (z. B. 09:00 Frühstücken):',(task.time?task.time+' ':'')+task.text);if(value===null)return;const parsed=parseTaskLines(value);if(parsed.length!==1)throw Error('Bitte genau eine Aufgabe eingeben.');await api('/tasks/'+task.id,'PATCH',{...parsed[0],done:!!task.done});await load();});};
 const remove=element('button','Löschen');remove.type='button';remove.className='danger';remove.onclick=()=>{void run(async()=>{if(confirm('Diese Aufgabe löschen?')){await api('/tasks/'+task.id,'DELETE');await load();}});};
 controls.append(edit,remove);row.append(controls);list.append(row);
 }
 }catch(e){if(active===request){$('#tasks-list').replaceChildren();$('#tasks-summary').textContent='Aufgaben konnten nicht geladen werden.';showError(e.message);}}
 finally{if(active===request){loading=false;updateDisabled();}}
 };
 const run=async(fn)=>{if(pending||loading||isBusy())return;pending=true;updateDisabled();try{await fn();}catch(e){showError(e.message);if($('#task-dialog').open)$('#task-import-preview').textContent=e.message;else await load();}finally{pending=false;updateDisabled();}};
 const preview=()=>{try{const tasks=parseTaskLines($('#task-import-text').value);$('#task-import-preview').textContent=tasks.length+' Aufgabe(n) werden erst nach Ihrer Bestätigung gespeichert.';}catch(e){$('#task-import-preview').textContent=e.message;}};
 const open=(text='')=>{if(isBusy()||pending||loading)return;$('#task-import-day').value=$('#task-day').value;$('#task-import-text').value=suggestedTaskLines(text);preview();$('#task-dialog').showModal();$('#task-import-text').focus();};
 $('#task-day').onchange=()=>{void load();};
 $('#tasks-today').onclick=()=>{$('#task-day').value=localDay();void load();};
 $('#tasks-tomorrow').onclick=()=>{const tomorrow=new Date();tomorrow.setHours(12,0,0,0);tomorrow.setDate(tomorrow.getDate()+1);$('#task-day').value=localDay(tomorrow);void load();};
 $('#task-form').onsubmit=event=>{event.preventDefault();void run(async()=>{await api('/tasks','POST',{day:$('#task-day').value,tasks:[{text:$('#task-text').value,time:$('#task-time').value}]});$('#task-text').value='';$('#task-time').value='';await load();});};
 $('#tasks-hermes').onclick=()=>{void run(async()=>{const day=$('#task-day').value;const fresh=await api('/tasks?day='+encodeURIComponent(day));onHermes(buildPlanningDraft(day,fresh));});};
 $('#task-plan').onclick=()=>{void run(async()=>{const day=$('#task-day').value;const fresh=await api('/tasks?day='+encodeURIComponent(day));onPlan(buildPlanningDraft(day,fresh));});};
 $('#task-batch').onclick=()=>open();
 $('#task-import-text').oninput=preview;
 $('#task-import-cancel').onclick=()=>$('#task-dialog').close();
 $('#task-import-form').onsubmit=event=>{event.preventDefault();void run(async()=>{const tasks=parseTaskLines($('#task-import-text').value);if(!tasks.length)throw Error('Bitte mindestens eine Aufgabe eintragen.');const day=$('#task-import-day').value;await api('/tasks','POST',{day,tasks});$('#task-day').value=day;$('#task-dialog').close();await load();});};
 return {load,open,updateDisabled};
}
