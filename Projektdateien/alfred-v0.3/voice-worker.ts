import {parentPort,workerData} from 'node:worker_threads';
try{
 globalThis.fetch=async()=>{throw Error('Netzwerkzugriff bei lokaler Spracherkennung deaktiviert.');};
 const {pipeline,env}=await import('@huggingface/transformers');
 env.allowRemoteModels=false;
 env.allowLocalModels=true;
 env.localModelPath=workerData.modelPath+'/';
 env.useFSCache=false;
 const recognizer=await pipeline('automatic-speech-recognition','onnx-community/whisper-base',{device:'cpu',dtype:'q8',local_files_only:true,session_options:{intraOpNumThreads:4,interOpNumThreads:1}});
 const result=await recognizer(workerData.audio,{language:'german',task:'transcribe',chunk_length_s:30,stride_length_s:5,return_timestamps:false});
 const text=String((result as any).text||'').trim();
 if(!text)throw Error();
 parentPort!.postMessage({text});
 await recognizer.dispose();
}catch{
 parentPort!.postMessage({error:'Keine Sprache erkannt oder lokales Modell nicht ladbar. Bitte erneut versuchen und Einrichtung prüfen.'});
}
