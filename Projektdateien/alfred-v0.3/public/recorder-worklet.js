// Energy-based turn state: continuous onset, a longer clause pause, and explicit limits.
// This is not semantic VAD; real microphone/noise quality still requires comparison.
class SpeechTurnDetector {
 constructor(){this.elapsed=0;this.onset=0;this.quiet=0;this.heard=false;}
 update(level,dt){
 this.elapsed+=dt;
 if(level>0.012){this.onset+=Math.min(dt,0.15);this.quiet=0;if(this.onset+1e-9>=0.3)this.heard=true;}
 else{this.onset=0;this.quiet+=dt;}
 if(!this.heard&&this.elapsed>=20-1e-9)return 'noSpeech';
 if(this.heard&&(this.quiet>=2-1e-9||this.elapsed>=45-1e-9))return 'complete';
 return 'waiting';
 }
}
class AlfredRecorder extends AudioWorkletProcessor {
 constructor(options){super();this.auto=!!options?.processorOptions?.autoEnd;this.turn=new SpeechTurnDetector();this.chunks=[];this.size=0;this.stopped=false;this.port.onmessage=event=>{if(event.data==='stop')this.flush();};}
 flush(){if(this.stopped)return;this.stopped=true;const data=new Float32Array(this.size);let offset=0;for(const chunk of this.chunks){data.set(chunk,offset);offset+=chunk.length;}this.chunks=[];this.port.postMessage(data,[data.buffer]);}
 process(inputs){
 if(this.stopped)return false;const input=inputs[0]?.[0];if(!input)return true;
 this.chunks.push(input.slice());this.size+=input.length;
 if(this.auto){let power=0;for(const v of input)power+=v*v;const result=this.turn.update(Math.sqrt(power/input.length),input.length/sampleRate);
 if(result==='complete'){this.flush();return false;}
 if(result==='noSpeech'){this.stopped=true;this.chunks=[];this.port.postMessage({noSpeech:true});return false;}}
 if(this.size>=sampleRate*60){this.flush();return false;}return true;
 }
}
registerProcessor('alfred-recorder',AlfredRecorder);
