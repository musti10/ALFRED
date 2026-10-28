import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {workerCall} from './hermes.ts';
const backend=dirname(fileURLToPath(import.meta.url));
export function createSpeechBridge({project=process.env.ALFRED_PROJECT_DIR||join(backend,'..','..')}={}){
 const python=join(project,'Sprachlabor','.venv','bin','python');
 const present=()=>existsSync(python)&&existsSync(join(project,'Sprachlabor','labor.py'))&&existsSync(join(project,'Stimmen','Thorsten','de_DE-thorsten-high.onnx'));
 const env={HOME:homedir(),PATH:'/usr/bin:/bin',LANG:'de_DE.UTF-8',PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1',NO_PROXY:'127.0.0.1,localhost,::1',OMP_NUM_THREADS:'2'};
 const call=(mode:string,payload:unknown,signal?:AbortSignal)=>workerCall(python,['-I',join(backend,'integrations','speech-worker.py'),project,mode],JSON.stringify(payload),{env,cwd:backend,signal,label:'Sprachmodus',timeout:mode==='speak'?80000:mode==='status'?15000:150000,maxOutputBytes:mode==='speak'?12000000:262144});
 let cached:any=null,checked=0,inflight:Promise<any>|null=null;
 return {
 async status(){
 if(!present())return {ready:false,voice:'Thorsten',message:'Lokaler Sprachmodus noch nicht eingerichtet.'};
 if(cached&&Date.now()-checked<30000)return cached;if(inflight)return inflight;
 inflight=(async()=>{try{const result=await call('status',{});cached={...result,ready:result.ready===true&&result.voice==='Thorsten',message:'Thorsten · Deutsch · lokal'};}catch{cached={ready:false,voice:'Thorsten',message:'Sprachmodus konnte nicht geprüft werden.'};}checked=Date.now();return cached;})();
 try{return await inflight;}finally{inflight=null;}
 },
 async answer(payload:{content:string,history:any[],memories:any[]},signal:AbortSignal){
 if(!present())throw Error('Lokaler Sprachmodus fehlt.');const result=await call('chat',payload,signal);
 if(result.engine!=='pipecat'||result.model!=='qwen3.5:4b-q4_K_M'||typeof result.content!=='string'||!result.content.trim()||result.content.length>2000)throw Error('Keine vollständige Sprachmodus-Antwort.');return result.content;
 },
 async synthesize(text:string,signal:AbortSignal){
 if(!present())throw Error('Lokale Stimme fehlt.');const result=await call('speak',{content:text},signal);
 if(result.voice!=='Thorsten'||typeof result.wav!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(result.wav))throw Error('Ungültige Sprachausgabe.');
 const audio=Buffer.from(result.wav,'base64');if(audio.length<44||audio.length>8000000||audio.toString('ascii',0,4)!=='RIFF'||audio.toString('ascii',8,12)!=='WAVE')throw Error('Ungültige lokale WAV-Ausgabe.');return audio;
 }
 };
}
