import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../public/recorder-worklet.js',import.meta.url),'utf8');
test('Browser turn detection rejects scattered noise and preserves a longer German clause pause',()=>{
 const context=vm.createContext({AudioWorkletProcessor:class{},registerProcessor(){}});vm.runInContext(code,context);const Detector=vm.runInContext('SpeechTurnDetector',context);
 const cases=JSON.parse(readFileSync(new URL('./fixtures/turn-cases.json',import.meta.url),'utf8'));
 for(const scenario of cases){const detector=new Detector();let result='waiting',at=0;for(const [db,dt] of scenario.frames){at++;result=detector.update(10**(db/20),dt);if(result!=='waiting')break;}assert.equal(result,scenario.decision,scenario.name);assert.equal(at,scenario.at,scenario.name);}
});
test('AudioWorklet emits one completed turn and manual dictation remains manual',()=>{
 let Processor:any;const messages:any[]=[];vm.runInNewContext(code,{sampleRate:1000,AudioWorkletProcessor:class{port={postMessage:(m:any)=>messages.push(m),onmessage:null}},registerProcessor:(_n:any,C:any)=>Processor=C});
 const p=new Processor({processorOptions:{autoEnd:true}});for(let i=0;i<5;i++)p.process([[new Float32Array(100).fill(.1)]]);for(let i=0;i<19;i++)p.process([[new Float32Array(100)]]);assert.equal(messages.length,0);p.process([[new Float32Array(100)]]);assert.equal(messages.length,1);p.process([[new Float32Array(100)]]);assert.equal(messages.length,1);
 messages.length=0;const manual=new Processor({processorOptions:{autoEnd:false}});for(let i=0;i<200;i++)manual.process([[new Float32Array(100)]]);assert.equal(messages.length,0);
});
