import {createMicrophone} from '/microphone.js';
const $=s=>document.querySelector(s);let busy=false,controller=null,audio=null,audioURL=null,run=0;
const showError=message=>{$('#error').hidden=false;$('#error').textContent=message;};
const stopAudio=()=>{if(audio){audio.pause();audio.src='';audio=null;}if(audioURL){URL.revokeObjectURL(audioURL);audioURL=null;}};
const lock=value=>{busy=value;$('#send').disabled=value;$('#input').disabled=value;$('#speak').disabled=value;$('#stop').hidden=!value;microphone?.update();};
const microphone=createMicrophone({isBusy:()=>busy,setBusy:lock,stopReading:stopAudio,showError,appendText:text=>{const old=$('#input').value.trim(),next=(old?old+'\n':'')+text;if(next.length>4000)throw Error('Entwurf zu lang. Bitte zuerst kürzen.');$('#input').value=next;}});
$('#form').onsubmit=async event=>{event.preventDefault();if(busy)return;const content=$('#input').value.trim();if(!content)return;
const active=++run;stopAudio();$('#error').hidden=true;controller=new AbortController();lock(true);$('#answer').hidden=true;$('#progress').textContent='Pipecat fragt das lokale Modell an …';
try{const response=await fetch('/api/answer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content,confirmed:true,speak:$('#speak').checked}),signal:controller.signal});const result=await response.json();if(!response.ok)throw Error(result.error||'Sprachtest fehlgeschlagen.');if(active!==run)return;$('#answer').textContent=result.content;$('#answer').hidden=false;$('#progress').textContent='Antwort erhalten. Mikrofon bleibt aus.';
if(result.audio){const bytes=Uint8Array.from(atob(result.audio),c=>c.charCodeAt(0));audioURL=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));audio=new Audio(audioURL);audio.onended=()=>{stopAudio();$('#stop').hidden=true;};$('#stop').hidden=false;try{await audio.play();}catch{showError('Der Browser hat die Wiedergabe blockiert. Der Antworttext steht oben.');stopAudio();$('#stop').hidden=true;}}
}catch(e){if(active===run)showError(controller.signal.aborted?'Gestoppt. Dein Text bleibt erhalten.':e.message);}
finally{if(active===run){controller=null;lock(false);$('#stop').hidden=!audio;}}};
$('#stop').onclick=()=>{run++;controller?.abort();controller=null;stopAudio();microphone.cancel();lock(false);$('#progress').textContent='Gestoppt. Mikrofon aus.';};
window.addEventListener('pagehide',()=>{run++;controller?.abort();stopAudio();microphone.cancel();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){run++;controller?.abort();controller=null;stopAudio();lock(false);$('#progress').textContent='Pausiert. Mikrofon aus.';}});
await microphone.initialize();try{const s=await fetch('/api/status').then(r=>r.json());$('#status').textContent=s.message;}catch{$('#status').textContent='Sprachlabor nicht erreichbar.';}
