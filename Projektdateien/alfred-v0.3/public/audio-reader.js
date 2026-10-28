import {splitSpeechClauses} from './speech-clauses.js';
// Audio is synthesized locally. No system voice or remote service is selected silently.
export function createAudioReader({fetcher=globalThis.fetch,makeAudio=url=>new Audio(url),urls=URL,changed=()=>{},completed=()=>{}}={}){
 let epoch=0,controller=null,audio=null,url=null,queue=[];
 const stop=()=>{epoch++;queue=[];controller?.abort();controller=null;if(audio){audio.onended=null;audio.onerror=null;audio.pause();audio.src='';audio=null;}if(url){urls.revokeObjectURL(url);url=null;}changed(false);};
 const read=async (text,continuing=false)=>{
 if(typeof text!=='string'||!text.trim()||text.length>4000)throw Error('Bitte einen Vorlesetext mit höchstens 4000 Zeichen auswählen.');
 if(!continuing){stop();const parts=splitSpeechClauses(text);queue=[...parts.clauses,parts.pending].map(s=>s.trim()).filter(Boolean);text=queue.shift();}const active=epoch;controller=new AbortController();const signal=controller.signal;changed(true);
 try{
 const response=await fetcher('/api/voice/synthesize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:text.trim(),confirmed:true}),signal});
 if(!response.ok){const result=await response.json();throw Error(result.error||'Lokale Stimme nicht verfügbar.');}
 const blob=await response.blob();if(active!==epoch)return;
 if(!response.headers.get('Content-Type')?.startsWith('audio/wav')||blob.size>8000000)throw Error('Ungültige Sprachausgabe.');
 controller=null;url=urls.createObjectURL(blob);audio=makeAudio(url);
 audio.onended=()=>{if(active!==epoch)return;if(url){urls.revokeObjectURL(url);url=null;}audio=null;if(queue.length)void read(queue.shift(),true).catch(e=>changed(false,e.message));else {stop();completed();}};audio.onerror=()=>{if(active===epoch){stop();changed(false,'Wiedergabe fehlgeschlagen.');}};
 await audio.play();
 }catch(e){if(active!==epoch||signal.aborted)return;stop();throw Error(e.message||'Wiedergabe blockiert. Bitte „Vorlesen“ anklicken.');}
 };
 return {read,stop};
}
