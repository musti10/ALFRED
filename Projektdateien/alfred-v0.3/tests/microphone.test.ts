import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMicrophone} from '../public/microphone.js';
const tick=()=>new Promise<void>(r=>setImmediate(r));
test('Aufnahme nur auf Klick, Mikrofon vor Erkennung aus, Text nur als Entwurf',async()=>{
 const originals=new Map(['document','window','navigator','fetch','AudioContext','AudioWorkletNode'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const nodes=new Map<string,any>();const $=(id:string)=>{if(!nodes.has(id))nodes.set(id,{hidden:false,disabled:false,textContent:'',classList:{toggle(){}},focus(){},onclick:null});return nodes.get(id);};
 let busy=false,asked=0,trackStopped=false,appended='',failure='',lastNode:any,resolveText:any,transcripts=0;
 const track={stop(){trackStopped=true;},onended:null};
 const context={sampleRate:48000,resume:async()=>{},close:async()=>{},audioWorklet:{addModule:async()=>{}},createMediaStreamSource:()=>({connect(){},disconnect(){}}),destination:{}};
 try{
 Object.defineProperty(globalThis,'document',{configurable:true,value:{querySelector:$,addEventListener(){},hidden:false}});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>{asked++;return {getTracks:()=>[track]};}}}});
 const AudioContext=function(){return context;};const AudioWorkletNode=function(){lastNode={connect(){},disconnect(){},port:{onmessage:null,postMessage(){}}};return lastNode;};
 Object.defineProperty(globalThis,'AudioContext',{configurable:true,value:AudioContext});Object.defineProperty(globalThis,'AudioWorkletNode',{configurable:true,value:AudioWorkletNode});
 Object.defineProperty(globalThis,'window',{configurable:true,value:{AudioContext,AudioWorkletNode,addEventListener(){}}});
 Object.defineProperty(globalThis,'fetch',{configurable:true,value:async(url:string)=>{if(url.endsWith('/status'))return {json:async()=>({ready:true})};assert.equal(trackStopped,true);return new Promise(r=>resolveText=r);}});
 const microphone=createMicrophone({isBusy:()=>busy,setBusy:(v:boolean)=>busy=v,stopReading(){},showError:(m:string)=>failure=m,appendText:(text:string)=>appended=text,onTranscript:()=>{assert.equal(busy,false);assert.equal(trackStopped,true);transcripts++;}});
 await microphone.initialize();assert.equal(asked,0);assert.equal($('#mic').disabled,false);
 $('#mic').onclick();await tick();assert.equal(asked,1);assert.equal(busy,true);assert.equal($('#record-stop').hidden,false);
 const data=Float32Array.from({length:48000},(_,i)=>Math.sin(i/10)*0.2);lastNode.port.onmessage({data});await tick();assert.equal(trackStopped,true);assert.equal(appended,'');
 resolveText({ok:true,json:async()=>({text:'Ein bearbeitbarer Entwurf.'})});await tick();assert.equal(appended,'Ein bearbeitbarer Entwurf.');assert.equal(busy,false);assert.equal(failure,'');assert.equal(transcripts,1);assert.match($('#mic-status').textContent,/selbst auf Senden/);
 }finally{for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete (globalThis as any)[key];}}
});
