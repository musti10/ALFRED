import {createHermesUI} from '/hermes-ui.js';
import {mergePlanningDraft} from '/task-parser.js';
import {createTasks} from '/tasks.js';
import {createMicrophone} from '/microphone.js';
import {createAudioReader} from '/audio-reader.js';
const $=s=>document.querySelector(s);let current=null,busy=false,state={chats:[],memories:[]},generation=null,messageTimer=null,lastChat=undefined,voiceReady=false,voiceMode=false,conversationTurn=false;
async function api(path,method='GET',body){const r=await fetch('/api'+path,{method,headers:method==='GET'?{}:{'Content-Type':'application/json'},body:method==='GET'?undefined:JSON.stringify(body||{})});const data=await r.json();if(!r.ok)throw Error(data.error||'Anfrage fehlgeschlagen.');return data;}
function el(tag,text,cls){const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;}
function error(e){$('#error').hidden=false;$('#error').textContent=e.message;}
async function action(fn){$('#error').hidden=true;try{await fn();}catch(e){error(e);}}
function button(text,fn,cls){const b=el('button',text,cls);b.type='button';b.disabled=busy;b.onclick=()=>action(fn);return b;}
async function refresh(){state=await api('/state');if(!state.chats.some(c=>c.id===current))current=state.chats[0]?.id||null;renderSide();await messages();}
function renderSide(){const chats=$('#chats');chats.replaceChildren();for(const c of state.chats.filter(c=>c.title.toLocaleLowerCase('de').includes($('#chat-search').value.toLocaleLowerCase('de')))){const row=el('div',null,'chat-row');const b=button(c.title,async()=>{current=c.id;renderSide();await messages();},c.id===current?'selected':'');b.setAttribute('aria-current',String(c.id===current));row.append(b,button('×',async()=>{if(confirm('Dieses Gespräch samt Verlauf löschen? Gespeicherte Erinnerungen bleiben erhalten.')){if(current===c.id)reader.stop();await api('/chats/'+c.id,'DELETE');sessionStorage.removeItem('alfred-draft:'+c.id);if(lastChat===c.id){lastChat=null;$('#input').value='';}await refresh();}},'delete'));row.lastChild.setAttribute('aria-label','Gespräch löschen');chats.append(row);}
const memories=$('#memories');memories.replaceChildren();for(const m of state.memories){const box=el('div',null,'memory');const label=el('label');const toggle=document.createElement('input');toggle.type='checkbox';toggle.checked=!!m.enabled;toggle.disabled=busy;toggle.onchange=()=>action(async()=>{await api('/memories/'+m.id,'PATCH',{content:m.content,enabled:toggle.checked});await refresh();});label.append(toggle,document.createTextNode(m.enabled?' Aktiv':' Pausiert'));box.append(label,el('p',m.content),button('Bearbeiten',async()=>{const content=prompt('Erinnerung bearbeiten (maximal 500 Zeichen):',m.content);if(content!==null){await api('/memories/'+m.id,'PATCH',{content,enabled:!!m.enabled});await refresh();}}),button('Löschen',async()=>{if(confirm('Diese Erinnerung löschen? Bisherige Chatnachrichten bleiben bestehen.')){await api('/memories/'+m.id,'DELETE');await refresh();}},'danger'));memories.append(box);}}
async function messages(){
 if(lastChat!==current){reader.stop();if(lastChat)sessionStorage.setItem('alfred-draft:'+lastChat,$('#input').value);$('#input').value=sessionStorage.getItem('alfred-draft:'+(current||'new'))||'';$('#draft-note').hidden=true;lastChat=current;}
 $('#chat-title').textContent=state.chats.find(c=>c.id===current)?.title||'Willkommen, Sir.';
 $('#rename').disabled=busy||!current;$('#export-chat').disabled=busy||!current;
 const list=$('#messages');const data=current?await api('/chats/'+current):[];list.replaceChildren();if(!data.length){const welcome=el('div',null,'welcome');const mark=el('img',null,'monogram');mark.src='/alfred-mark.svg';mark.alt='';welcome.append(mark,el('span','ALFRED','welcome-kicker'),el('h2','Bereit, wenn Sie es sind.'),el('p','Ein Gedanke. Ein Plan. Eine Frage.'));list.append(welcome);}for(const m of data){const article=el('article',null,m.role);article.append(el('small',m.role==='user'?(m.source==='hermes'?'SIE → HERMES':'SIE'):(m.source==='hermes'?'HERMES · LOKAL':'ALFRED')),el('p',m.content));const options=el('details',null,'message-actions'),controls=el('div',null,'message-action-list');options.append(el('summary','Optionen'));controls.append(button('An Hermes übergeben …',()=>hermesUI.open(m.content,current)));if(m.source==='hermes'&&m.role==='assistant')controls.append(button('Als Erinnerung auswählen',async()=>{const content=prompt('Diesen Hermes-Vorschlag als Erinnerung speichern? Bitte prüfen (maximal 500 Zeichen):',m.content.slice(0,500));if(content!==null){await api('/memories','POST',{content});await refresh();}}));if(m.role==='assistant'){const read=button('Vorlesen',()=>reader.read(m.content));read.dataset.reader='true';read.disabled=busy||!voiceReady;read.title=voiceReady?'Thorsten · Deutsch · lokal':'Lokale Stimme noch nicht eingerichtet.';controls.append(read);}if(m.role==='assistant')controls.append(button('Als Aufgabenliste übernehmen',()=>taskManager.open(m.content)));if(m.role==='assistant')controls.append(button('Kopieren',async()=>{try{await navigator.clipboard.writeText(m.content);}catch{throw Error('Kopieren ist in diesem Browser nicht verfügbar. Bitte Text markieren und ⌘C drücken.');}}));if(m.role==='user')controls.append(button('Als Erinnerung auswählen',()=>{const content=prompt('Diesen Text bewusst als Erinnerung speichern (maximal 500 Zeichen):',m.content.slice(0,500));return content===null?Promise.resolve():api('/memories','POST',{content}).then(refresh);}));options.append(controls);article.append(options);list.append(article);}list.scrollTop=list.scrollHeight;}
function lock(value){busy=value;$('#send').textContent=value?'ALFRED denkt …':'Senden ↗';for(const e of document.querySelectorAll('button,input[type=checkbox]'))e.disabled=value;$('#input').disabled=value;$('#memory-input').disabled=value;$('#stop').hidden=!value;$('#stop').disabled=false;$('#audio-stop').disabled=false;$('#send').hidden=value;$('#rename').disabled=value||!current;$('#export-chat').disabled=value||!current;$('#chat-search').disabled=value;$('#voice-mode').disabled=value||!voiceReady;$('#conversation').disabled=!conversationTurn&&(value||!voiceReady);microphone?.update();taskManager?.updateDisabled();}
$('#new').onclick=()=>action(async()=>{current=(await api('/chats','POST')).id;await refresh();$('#input').focus();});
$('#stop').onclick=()=>{generation?.abort();$('#stop').disabled=true;};
$('#composer').onsubmit=e=>{e.preventDefault();if(busy)return;action(async()=>{
 const content=$('#input').value.trim();if(!content)return;
 const speakThisAnswer=voiceMode;let spokenAnswer=null;reader.stop();generation=new AbortController();const signal=generation.signal;lock(true);const started=Date.now();$('#timing').textContent='Antwort wird vorbereitet …';messageTimer=setInterval(()=>{$('#timing').textContent='Antwort läuft · '+Math.floor((Date.now()-started)/1000)+' s';},1000);
 try{
 if(!current){current=(await api('/chats','POST')).id;lastChat=current;sessionStorage.removeItem('alfred-draft:new');}
 sessionStorage.setItem('alfred-draft:'+current,content);
 signal.throwIfAborted();
 const list=$('#messages');list.querySelector('.welcome')?.remove();
 const user=el('article',null,'user');user.append(el('small','SIE'),el('p',content));
 const preview=el('article',null,'assistant');const progress=el('small','ALFRED · WIRD VORBEREITET');const text=el('p','');preview.append(progress,text);list.append(user,preview);list.scrollTop=list.scrollHeight;
 const r=await fetch('/api/chats/'+current+'/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content,stream:true,engine:speakThisAnswer?'pipecat':'alfred'}),signal});
 if(!r.ok){const data=await r.json();throw Error(data.error||'Anfrage fehlgeschlagen.');}
 if(!r.body)throw Error('Keine Verbindung zum Antwortstrom.');
 let pending='',completed=false;const decoder=new TextDecoder();
 const consume=line=>{if(!line.trim())return;const part=JSON.parse(line);
 if(part.type==='error')throw Error(part.error);
 if(part.type==='status')progress.textContent=part.message;
 const follow=list.scrollHeight-list.scrollTop-list.clientHeight<100;
 if(part.type==='delta'){progress.textContent='ALFRED · ANTWORTET';text.textContent+=part.content;}
 if(part.type==='done'){completed=true;spokenAnswer=part.content;text.textContent=part.content;progress.textContent='ALFRED';}
 if(follow)list.scrollTop=list.scrollHeight;
 };
 for await(const chunk of r.body){pending+=decoder.decode(chunk,{stream:true});let n;while((n=pending.indexOf('\n'))>=0){consume(pending.slice(0,n));pending=pending.slice(n+1);}}
 pending+=decoder.decode();consume(pending);
 if(!completed)throw Error('Verbindung unterbrochen. Der Entwurf bleibt erhalten.');
 $('#input').value='';$('#draft-note').hidden=true;sessionStorage.removeItem('alfred-draft:'+current);
 }catch(e){if(signal.aborted){$('#error').hidden=false;$('#error').textContent='Gestoppt. Ihr Entwurf bleibt erhalten.';}else throw e;}
 finally{clearInterval(messageTimer);messageTimer=null;$('#timing').textContent='Dauer: '+Math.floor((Date.now()-started)/1000)+' s';generation=null;if(!spokenAnswer&&conversationTurn)endConversation();lock(false);await refresh();$('#input').focus();if(spokenAnswer&&speakThisAnswer&&voiceMode&&!document.hidden)void reader.read(spokenAnswer).catch(error);}
 });};
$('#input').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('#composer').requestSubmit();}};
$('#memory-form').onsubmit=e=>{e.preventDefault();action(async()=>{await api('/memories','POST',{content:$('#memory-input').value});$('#memory-input').value='';await refresh();});};
$('#erase').onclick=()=>action(async()=>{if(confirm('Wirklich ALLE Gespräche, Erinnerungen und Aufgaben auf diesem Mac löschen?')){reader.stop();await api('/data','DELETE');for(const key of Object.keys(sessionStorage)){if(key.startsWith('alfred-draft:'))sessionStorage.removeItem(key);}lastChat=null;current=null;$('#input').value='';await refresh();await taskManager.load();}});
async function status(){try{const s=await api('/status');$('#status').textContent=s.ready?(voiceMode?'Lokal · Stimme':'Lokal · alfred'):s.message;$('#status').className=s.ready?'online':'';}catch{$('#status').textContent='ALFRED-Server nicht erreichbar';}}
action(refresh);status();setInterval(status,30000);

$('#input').addEventListener('input',()=>{sessionStorage.setItem('alfred-draft:'+(current||'new'),$('#input').value);});
$('#chat-search').oninput=renderSide;
$('#rename').onclick=()=>action(async()=>{if(!current)return;const title=prompt('Name für dieses Gespräch (maximal 100 Zeichen):',state.chats.find(c=>c.id===current)?.title);if(title!==null){await api('/chats/'+current,'PATCH',{title});await refresh();}});
function download(url){const a=el('a');a.href=url;a.download='';document.body.append(a);a.click();a.remove();}
$('#export-chat').onclick=()=>{if(current)download('/api/chats/'+current+'/export');};
$('#backup').onclick=()=>download('/api/export');
$('#restore').onclick=()=>$('#backup-file').click();
$('#backup-file').onchange=e=>action(async()=>{
 const file=e.target.files[0];e.target.value='';if(!file)return;
 if(file.size>5242880)throw Error('Die Sicherung darf höchstens 5 MB groß sein.');
 let backup;try{backup=JSON.parse(await file.text());}catch{throw Error('Die Datei enthält kein gültiges JSON.');}
 if(backup?.format!=='alfred-backup'||![1,2,3].includes(backup.version)||!Array.isArray(backup.chats)||!Array.isArray(backup.messages)||!Array.isArray(backup.memories))throw Error('Bitte eine ALFRED-Sicherung auswählen.');
 if(!confirm('Diese Sicherung hinzufügen?\n\n'+backup.chats.length+' Gespräche, '+backup.messages.length+' Nachrichten und bis zu '+backup.memories.length+' Erinnerungen sowie '+(Array.isArray(backup.tasks)?backup.tasks.length:0)+' Aufgaben.\n\nVorhandene Chats bleiben erhalten. Erneutes Einlesen erzeugt zusätzliche Chats. Neue Erinnerungen werden PAUSIERT angelegt; aktivieren Sie sie nach Prüfung selbst.'))return;
 const result=await api('/import','POST',backup);await refresh();await taskManager.load();alert('Sicherung eingelesen: '+result.chats+' Gespräche und '+result.memories+' neue, pausierte Erinnerungen und '+(result.tasks||0)+' Aufgaben.');
});

const reader=createAudioReader({completed:()=>{if(conversationTurn&&!document.hidden)void microphone.start(true);},changed:(speaking,message)=>{$('#audio-stop').hidden=!speaking;if(message){endConversation();error(Error(message));}}});
$('#audio-stop').onclick=()=>{endConversation();reader.stop();};
window.addEventListener('pagehide',reader.stop);

const microphone=createMicrophone({
 onTranscript:()=>{if(conversationTurn)$('#composer').requestSubmit();},
 onRecording:()=>{if(voiceReady)setVoiceMode(true);},
 isBusy:()=>busy,
 setBusy:value=>{lock(value);if(value){$('#stop').hidden=true;$('#send').hidden=true;}},
 stopReading:()=>reader.stop(),
 showError:message=>{endConversation();error(Error(message));},
 appendText:text=>{const field=$('#input');const next=(field.value.trim()?field.value.trim()+'\n':'')+text;if(next.length>4000)throw Error('Mit Ihrem Entwurf ist der Text zu lang. Bitte zuerst den Entwurf kürzen und erneut aufnehmen.');field.value=next;sessionStorage.setItem('alfred-draft:'+(current||'new'),next);field.focus();}
});
microphone.initialize();
function endConversation(){conversationTurn=false;$('#conversation').innerHTML='<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4"/></svg>';$('#conversation').setAttribute('aria-label','Unterhaltung starten');$('#conversation').setAttribute('aria-pressed','false');}
$('#conversation').onclick=()=>{if(conversationTurn){endConversation();setVoiceMode(false);generation?.abort();return;}if(!voiceReady)return;if($('#input').value.trim()){error(Error('Bitte den vorhandenen Entwurf zuerst senden oder leeren.'));return;}conversationTurn=true;$('#conversation').innerHTML='<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';$('#conversation').setAttribute('aria-label','Unterhaltung beenden');$('#conversation').setAttribute('aria-pressed','true');setVoiceMode(true);void microphone.start(true);};
$('#mic').addEventListener('click',()=>{endConversation();});
$('#record-cancel').addEventListener('click',()=>{endConversation();});

const taskManager=createTasks({api,isBusy:()=>busy,showError:message=>{endConversation();error(Error(message));},onHermes:draft=>hermesUI.open(draft,current),onPlan:draft=>{
 const field=$('#input');const next=mergePlanningDraft(field.value,draft);
 if(field.value.trim()&&!field.value.includes(draft)&&!confirm('Die Aufgaben an deinen vorhandenen Entwurf anhängen? Dein bisheriger Text bleibt erhalten.'))return;
 field.value=next;sessionStorage.setItem('alfred-draft:'+(current||'new'),next);
 $('#draft-note').textContent='Offene Aufgaben als Entwurf eingefügt. Bitte prüfen und selbst senden. Deine Aufgabenliste wurde nicht verändert.';$('#draft-note').hidden=false;
 field.scrollIntoView({behavior:'smooth',block:'center'});field.focus();
}});
taskManager.load();

const hermesUI=createHermesUI({api,isBusy:()=>busy,setBusy:lock,showError:message=>{endConversation();error(Error(message));},onResult:async id=>{const draft=$('#input').value,previous=current;current=id;await refresh();if(!previous&&draft){$('#input').value=draft;sessionStorage.setItem('alfred-draft:'+id,draft);sessionStorage.removeItem('alfred-draft:new');}}});
$('#hermes-draft').onclick=()=>hermesUI.open($('#input').value,current);
hermesUI.status();

function setVoiceMode(value){voiceMode=!!value&&voiceReady;$('#voice-mode').textContent=voiceMode?'Stimme an':'Stimme aus';$('#voice-mode').setAttribute('aria-pressed',String(voiceMode));if(!voiceMode){endConversation();microphone.cancel();reader.stop();}void status();}
$('#voice-mode').onclick=()=>setVoiceMode(!voiceMode);
(async()=>{try{const info=await api('/voice/output/status');voiceReady=!!info.ready;$('#voice-mode').title=info.ready?'Sprachmodus · Pipecat + Thorsten · nur auf Knopfdruck':info.message;$('#voice-mode').disabled=busy||!voiceReady;$('#conversation').disabled=busy||!voiceReady;for(const b of document.querySelectorAll('[data-reader]'))b.disabled=busy||!voiceReady;}catch{$('#voice-mode').title='Sprachmodus nicht erreichbar.';}})();
document.addEventListener('visibilitychange',()=>{if(document.hidden){endConversation();reader.stop();}});
