import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
test('Dialog erkennt Sprechpause, wartet bei Stille und endet ohne erfundene Eingabe',()=>{
 let Processor:any;const messages:any[]=[];const context={sampleRate:1000,AudioWorkletProcessor:class{port={postMessage:(m:any)=>messages.push(m),onmessage:null};},registerProcessor:(_name:string,C:any)=>Processor=C};
 vm.runInNewContext(readFileSync(new URL('../public/recorder-worklet.js',import.meta.url),'utf8'),context);
 const p=new Processor({processorOptions:{autoEnd:true}});for(let i=0;i<5;i++)p.process([[new Float32Array(100)]]);assert.equal(messages.length,0);
 for(let i=0;i<4;i++)p.process([[new Float32Array(100).fill(.1)]]);for(let i=0;i<13;i++)p.process([[new Float32Array(100)]]);assert.equal(messages.length,0);p.process([[new Float32Array(100)]]);assert.equal(messages.length,1);assert.equal(messages[0].length,2300);
 messages.length=0;const quiet=new Processor({processorOptions:{autoEnd:true}});for(let i=0;i<200;i++)quiet.process([[new Float32Array(100)]]);assert.equal(messages.length,1);assert.equal(messages[0].noSpeech,true);
 messages.length=0;const manual=new Processor({processorOptions:{autoEnd:false}});for(let i=0;i<200;i++)manual.process([[new Float32Array(100)]]);assert.equal(messages.length,0);
});
