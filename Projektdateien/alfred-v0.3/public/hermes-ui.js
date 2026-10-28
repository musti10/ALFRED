import {selectedMemoryDraft} from '/hermes-memory.js';
const $=selector=>document.querySelector(selector);
export function createHermesUI({api,isBusy,setBusy,showError,onResult}){
 let running=false,controller=null,loadingMemories=false,memoriesInserted=false,memorySnapshot=[],opening=0;
 const update=()=>{$('#hermes-submit').disabled=running||loadingMemories||!$('#hermes-text').value.trim()||$('#hermes-text').value.length>4000;$('#hermes-text').disabled=running;$('#hermes-cancel').textContent=running?'Anfrage stoppen':'Schließen';$('#hermes-count').textContent=$('#hermes-text').value.length+' / 4000 Zeichen';$('#hermes-memory-load').disabled=running||loadingMemories||memoriesInserted;$('#hermes-memory-insert').disabled=running||loadingMemories||memoriesInserted;for(const check of document.querySelectorAll('#hermes-memory-options input'))check.disabled=running||memoriesInserted;};
 const status=async()=>{const label=$('#hermes-status');$('#hermes-check').disabled=true;label.textContent='Hermes wird geprüft …';try{const s=await api('/hermes/status');label.textContent=s.ready?'Bereit':s.message;label.title=s.message;label.className=s.ready?'online':'';$('#hermes-model').textContent=s.model;}catch{label.textContent='Hermes-Verbindung konnte nicht geprüft werden.';}finally{$('#hermes-check').disabled=isBusy();}};
 const open=(text,chatId)=>{
 if(isBusy())return;
 const value=String(text||'').trim();if(!value){showError('Bitte zuerst eine Nachricht schreiben oder eine Aufgabe auswählen.');return;}
 if(value.length>4000){showError('Für Hermes höchstens 4000 Zeichen auswählen. Bitte den Text zuerst kürzen.');return;}
 opening++;memorySnapshot=[];memoriesInserted=false;loadingMemories=false;$('#hermes-memory-options').replaceChildren();$('#hermes-memory-picker').hidden=true;$('#hermes-memory-note').textContent='Keine Erinnerung ausgewählt. Auch aktive Erinnerungen werden nicht automatisch mitgegeben.';
 $('#hermes-text').value=value;$('#hermes-chat').value=chatId||'';$('#hermes-progress').textContent='Noch nicht gesendet. Du kannst den Text bearbeiten.';update();$('#hermes-dialog').showModal();$('#hermes-text').focus();
 };
 const cancel=()=>{if(running){controller?.abort();$('#hermes-progress').textContent='Anfrage wird gestoppt …';$('#hermes-cancel').disabled=true;}else {opening++;$('#hermes-dialog').close();}};
 $('#hermes-cancel').onclick=cancel;
 $('#hermes-dialog').addEventListener('cancel',event=>{event.preventDefault();cancel();});
 $('#hermes-text').addEventListener('input',update);
 $('#hermes-form').onsubmit=async event=>{
 event.preventDefault();if(running||loadingMemories||isBusy())return;
 const content=$('#hermes-text').value.trim();if(!content||content.length>4000)return;
 running=true;controller=new AbortController();setBusy(true);update();$('#hermes-cancel').disabled=false;
 const started=Date.now();const progress=()=>{$('#hermes-progress').textContent='Hermes antwortet lokal · '+Math.floor((Date.now()-started)/1000)+' s. Die erste Antwort kann länger dauern.';};progress();const timer=setInterval(progress,1000);
 try{
 const r=await fetch('/api/hermes/requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content,chatId:$('#hermes-chat').value||null,confirmed:true}),signal:controller.signal});
 const result=await r.json();if(!r.ok)throw Error(result.error||'Hermes-Anfrage fehlgeschlagen.');
 $('#hermes-dialog').close();await onResult(result.chatId);
 }catch(e){$('#hermes-progress').textContent=controller.signal.aborted?'Gestoppt. Der geprüfte Text bleibt hier als Entwurf erhalten.':e.message;}
 finally{clearInterval(timer);running=false;controller=null;setBusy(false);update();$('#hermes-cancel').disabled=false;}
 };
 $('#hermes-memory-load').onclick=async()=>{
 if(running||loadingMemories||memoriesInserted)return;
 const token=opening;loadingMemories=true;update();$('#hermes-memory-note').textContent='Aktive Erinnerungen werden geladen …';
 try{
 const state=await api('/state');if(token!==opening||!$('#hermes-dialog').open)return;
 memorySnapshot=state.memories.filter(memory=>memory.enabled===1||memory.enabled===true).map(memory=>({...memory}));
 const options=$('#hermes-memory-options');options.replaceChildren();
 for(const memory of memorySnapshot){const label=document.createElement('label'),check=document.createElement('input'),text=document.createElement('span');check.type='checkbox';check.value=memory.id;check.checked=false;text.textContent=memory.content;label.append(check,text);options.append(label);}
 $('#hermes-memory-picker').hidden=!memorySnapshot.length;
 const paused=state.memories.length-memorySnapshot.length;
 $('#hermes-memory-note').textContent=memorySnapshot.length?'Einzeln auswählen. Pausierte Erinnerungen sind ausgeschlossen'+(paused?' ('+paused+').':'.')+' Noch wird nichts übergeben.':'Keine aktiven Erinnerungen vorhanden. Pausierte Erinnerungen bleiben ausgeschlossen.';
 }catch(e){if(token===opening)$('#hermes-memory-note').textContent=e.message;}
 finally{if(token===opening){loadingMemories=false;update();}}
 };
 $('#hermes-memory-insert').onclick=async()=>{
 if(running||loadingMemories||memoriesInserted)return;
 const token=opening;loadingMemories=true;update();
 try{
 const ids=[...document.querySelectorAll('#hermes-memory-options input:checked')].map(check=>check.value);
 const state=await api('/state');if(token!==opening||!$('#hermes-dialog').open)return;
 const next=selectedMemoryDraft($('#hermes-text').value,state.memories,ids);
 $('#hermes-text').value=next;memoriesInserted=true;$('#hermes-memory-picker').hidden=true;
 $('#hermes-memory-note').textContent=ids.length+' ausgewählte Erinnerung(en) stehen jetzt im Vorschautext. Dort vor dem Senden bearbeiten oder entfernen. Deine gespeicherten Erinnerungen wurden nicht geändert.';update();$('#hermes-text').focus();
 }catch(e){if(token===opening)$('#hermes-memory-note').textContent=e.message;}
 finally{if(token===opening){loadingMemories=false;update();}}
 };
 $('#hermes-check').onclick=status;
 return {open,status};
}
