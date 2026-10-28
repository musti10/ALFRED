import {spawn} from 'node:child_process';
import {existsSync,readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
export const HERMES_MODEL='qwen3.5:4b-q4_K_M';
// A separate process prevents framework state from affecting ALFRED. No shell, no prompt in argv.
export function workerCall(executable:string,args:string[],input:string,{signal,timeout=180000,env,cwd,label='Hermes',maxOutputBytes=262144}:{signal?:AbortSignal,timeout?:number,env?:NodeJS.ProcessEnv,cwd?:string,label?:string,maxOutputBytes?:number}={}) {
 return new Promise<any>((resolve,reject)=>{
 if(signal?.aborted)return reject(Error(`${label}-Anfrage abgebrochen.`));
 const child=spawn(executable,args,{env,cwd,detached:process.platform!=='win32',stdio:['pipe','pipe','ignore']});
 let output='',size=0,failure='',closed=false,killTimer:ReturnType<typeof setTimeout>|undefined;
 const stop=(message:string)=>{if(closed||failure)return;failure=message;try{process.kill(-child.pid!,'SIGTERM');}catch{child.kill('SIGTERM');}killTimer=setTimeout(()=>{if(!closed){try{process.kill(-child.pid!,'SIGKILL');}catch{child.kill('SIGKILL');}}},1500);killTimer.unref();};
 const abort=()=>stop(`${label}-Anfrage abgebrochen.`);signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(()=>stop(`${label} hat das Zeitlimit erreicht. Bitte kürzer fragen.`),timeout);timer.unref();
 const clean=()=>{closed=true;clearTimeout(timer);clearTimeout(killTimer);signal?.removeEventListener('abort',abort);};
 child.on('error',()=>{clean();reject(Error(`${label} konnte nicht gestartet werden.`));});
 child.stdout.setEncoding('utf8');child.stdout.on('data',(data:string)=>{size+=Buffer.byteLength(data);if(size>maxOutputBytes)stop(`${label}-Antwort zu umfangreich.`);else output+=data;});
 child.stdin.on('error',()=>{});child.stdin.end(input);
 child.on('close',code=>{clean();if(failure)return reject(Error(failure));if(code!==0)return reject(Error(`${label} konnte keine vollständige lokale Antwort liefern.`));
 try{const value=JSON.parse(output);if(!value||typeof value!=='object'||value.error)throw Error();resolve(value);}catch{reject(Error(`${label} hat keine gültige Antwort geliefert.`));}});
 });
}
export function createHermes({home=homedir(),timeout=180000}={}) {
 const installation=join(home,'.hermes','hermes-agent');
 let executable='';try{const tools=join(home,'.hermes','tools');for(const name of readdirSync(tools).filter(n=>n.startsWith('python-')).sort().reverse()){const path=join(tools,name,'bin','python3');if(existsSync(path)){executable=path;break;}}}catch{}
 const present=()=>!!executable&&existsSync(join(installation,'hermes_bootstrap.py'));
 const env={HOME:home,PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'de_DE.UTF-8',PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1',NO_PROXY:'127.0.0.1,localhost,::1'};
 const call=async(mode:string,input:string,signal?:AbortSignal)=>{const temporary=mkdtempSync(join(tmpdir(),'alfred-hermes-request-'));try{return await workerCall(executable,['-I',join(root,'integrations','hermes-worker.py'),installation,mode],input,{env:{...env,ALFRED_HERMES_WORKSPACE:temporary},cwd:root,signal,timeout:mode==='status'?20000:timeout});}finally{rmSync(temporary,{recursive:true,force:true});}};
 let checked=0,cached:any=null,inflight:Promise<any>|null=null;
 return {
 async status(){
 if(!present())return {ready:false,model:HERMES_MODEL,message:'Hermes-Laufzeit fehlt auf diesem Mac.'};
 if(cached&&Date.now()-checked<30000)return cached;
 if(inflight)return inflight;
 inflight=(async()=>{try{const s=await call('status','');cached={ready:s.ready===true&&s.tools===0&&s.model===HERMES_MODEL,model:HERMES_MODEL,message:'Lokale Hermes-Laufzeit geprüft · ohne Werkzeuge'};}catch{cached={ready:false,model:HERMES_MODEL,message:'Hermes-Laufzeit konnte nicht sicher geprüft werden.'};}checked=Date.now();return cached;})();
 try{return await inflight;}finally{inflight=null;}
 },
 async run(content:string,signal:AbortSignal){
 if(!present())throw Error('Hermes-Laufzeit fehlt auf diesem Mac.');
 const result=await call('run',JSON.stringify({content}),signal);
 if(result.model!==HERMES_MODEL||result.tools!==0||typeof result.content!=='string'||!result.content.trim()||result.content.length>64000)throw Error('Ungültige Hermes-Antwort.');
 return {content:result.content,model:HERMES_MODEL};
 }
 };
}
