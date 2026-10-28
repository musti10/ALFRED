import {splitSpeechClauses} from './speech-clauses.js';
// Only explicitly local voices are eligible. Never fall back to a remote/default voice.
export function localGermanVoice(voices) {
 return voices.find(voice=>voice.localService===true && /^de(?:[-_]|$)/i.test(voice.lang))||null;
}
export function speechChunks(text) {
 const {clauses,pending}=splitSpeechClauses(text.trim());const parts=[];
 for(const clause of [...clauses,pending]){
 let remaining=clause.trim();
 while(remaining){let end=Math.min(remaining.length,240);if(end<remaining.length){const space=remaining.lastIndexOf(' ',end);if(space>80)end=space;else if(/[\uD800-\uDBFF]/.test(remaining[end-1])&&/[\uDC00-\uDFFF]/.test(remaining[end]))end--;}
 parts.push(remaining.slice(0,end));remaining=remaining.slice(end).trimStart();}
 }
 const chunks=[];let current='';
 for(const part of parts){if(current&&current.length+1+part.length>240){chunks.push(current);current='';}current=current?current+' '+part:part;}
 if(current)chunks.push(current);return chunks;
}
export function createReader(synth,Utterance,changed=()=>{}) {
 let run=0,current=null;
 const stop=()=>{run++;current=null;synth?.cancel();changed(false);};
 const read=text=>{
 const voice=localGermanVoice(synth?.getVoices()||[]);
 if(!voice)throw Error('Keine lokale deutsche Stimme verfügbar. Bitte eine deutsche Systemstimme auf dem Mac bereitstellen oder einen anderen Browser verwenden.');
 stop();const active=run;const chunks=speechChunks(text);if(!chunks.length)return;
 const next=()=>{if(active!==run)return;const chunk=chunks.shift();if(!chunk){current=null;changed(false);return;}
 current=new Utterance(chunk);current.voice=voice;current.lang=voice.lang;current.rate=0.95;
 current.onend=next;current.onerror=e=>{if(active===run){stop();if(!['canceled','interrupted'].includes(e.error))changed(false,'Vorlesen konnte nicht gestartet werden.');}};
 changed(true);synth.speak(current);
 };next();
 };
 return {read,stop};
}
