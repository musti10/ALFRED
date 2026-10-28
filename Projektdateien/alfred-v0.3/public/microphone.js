import {encodeWav} from './pcm.js';
const $=selector=>document.querySelector(selector);
export function createMicrophone({isBusy,setBusy,stopReading,showError,appendText,onRecording=()=>{},onTranscript=()=>{}}){
 let ready=false,phase='idle',run=0,stream=null,context=null,node=null,source=null,timer=null,controller=null,rate=48000,started=0;
 const status=message=>{$('#mic-status').textContent=message;};
 const update=()=>{$('#mic').disabled=!ready||isBusy();$('#mic').hidden=phase!=='idle';$('#record-stop').hidden=phase!=='recording';$('#record-stop').disabled=false;$('#record-cancel').hidden=phase==='idle';$('#record-cancel').disabled=false;$('.voice-controls').classList.toggle('recording',phase==='recording');};
 const release=()=>{clearInterval(timer);timer=null;stream?.getTracks().forEach(track=>track.stop());stream=null;source?.disconnect();source=null;node?.disconnect();node=null;if(context){void context.close().catch(()=>{});context=null;}};
 const reset=message=>{release();phase='idle';setBusy(false);update();status(message);};
 const cancel=()=>{run++;controller?.abort();controller=null;reset('Verworfen. Mikrofon aus. Ihr Entwurf bleibt erhalten.');};
 const process=async(data,active)=>{
 if(active!==run||phase!=='recording')return;
 const inputRate=rate;release();phase='transcribing';update();status('Mikrofon aus · Sprache wird auf diesem Mac erkannt …');
 controller=new AbortController();
 try{
 const wav=encodeWav(data,inputRate);
 const response=await fetch('/api/voice/transcribe',{method:'POST',headers:{'Content-Type':'audio/wav'},body:wav,signal:controller.signal});
 const result=await response.json();if(!response.ok)throw Error(result.error||'Spracherkennung fehlgeschlagen.');
 if(active!==run)return;
 appendText(result.text);reset('Text prüfen und selbst auf Senden klicken.');$('#input').focus();onTranscript();
 }catch(e){if(active!==run)return;reset('Mikrofon aus. Aufnahme nicht gespeichert.');showError(e.message);}
 finally{if(active===run)controller=null;}
 };
 const start=async(autoEnd=false)=>{
 if(isBusy()||!ready)return;
 const active=++run;phase='asking';stopReading();setBusy(true);update();status('Bitte Mikrofonzugriff im Browser erlauben …');
 try{
 const capture=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true},video:false});
 if(active!==run){capture.getTracks().forEach(track=>track.stop());return;}
 stream=capture;const captureContext=new AudioContext();context=captureContext;await captureContext.resume();await captureContext.audioWorklet.addModule('/recorder-worklet.js');
 if(active!==run)return;
 rate=context.sampleRate;source=context.createMediaStreamSource(stream);node=new AudioWorkletNode(context,'alfred-recorder',{channelCount:1,channelCountMode:'explicit',processorOptions:{autoEnd}});
 node.port.onmessage=event=>{if(event.data?.noSpeech){if(active===run){cancel();showError('Keine Sprache erkannt. Unterhaltung beendet.');}return;}void process(event.data,active);};source.connect(node);node.connect(context.destination);
 phase='recording';started=Date.now();onRecording();update();status('Aufnahme · 0 / 60 s');
 timer=setInterval(()=>{status('Aufnahme · '+Math.min(60,Math.floor((Date.now()-started)/1000))+' / 60 s');},500);
 stream.getTracks().forEach(track=>{track.onended=()=>{if(active===run&&phase==='recording')cancel();};});
 }catch(e){if(active!==run)return;reset('Mikrofon aus.');showError(e.name==='NotAllowedError'?'Mikrofonzugriff nicht erlaubt. Sie können weiterhin tippen.':e.name==='NotFoundError'?'Kein Mikrofon gefunden.':'Aufnahme konnte nicht gestartet werden. Bitte den Browser prüfen.');}
 };
 $('#mic').onclick=()=>{void start();};
 $('#record-stop').onclick=()=>{if(phase==='recording'){status('Aufnahme wird beendet …');$('#record-stop').disabled=true;node?.port.postMessage('stop');}};
 $('#record-cancel').onclick=cancel;
 window.addEventListener('pagehide',()=>{run++;controller?.abort();release();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&phase!=='idle')cancel();});
 const initialize=async()=>{
 if(!navigator.mediaDevices?.getUserMedia||!window.AudioWorkletNode||!window.AudioContext){status('Spracheingabe in diesem Browser nicht verfügbar. Bitte Safari oder Chrome verwenden.');return;}
 try{const response=await fetch('/api/voice/status');const result=await response.json();ready=!!result.ready;status(ready?'Mikrofon aus':result.message);update();}
 catch{status('Spracheingabe nicht erreichbar.');}
 };
 return {initialize,update,cancel,start};
}
