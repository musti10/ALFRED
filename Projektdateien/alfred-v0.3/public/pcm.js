export function encodeWav(samples,sourceRate){
 if(!Number.isFinite(sourceRate)||sourceRate<16000)throw Error('Ungültige Abtastrate.');
 const count=Math.floor(samples.length*16000/sourceRate);const buffer=new ArrayBuffer(44+count*2);const view=new DataView(buffer);
 const text=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
 text(0,'RIFF');view.setUint32(4,buffer.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,count*2,true);
 // Average input intervals before decimation; capture is mono.
 const ratio=sourceRate/16000;
 for(let i=0;i<count;i++){const start=Math.floor(i*ratio),end=Math.min(samples.length,Math.floor((i+1)*ratio));let sum=0;for(let j=start;j<end;j++)sum+=samples[j];const sample=Math.max(-1,Math.min(1,sum/Math.max(1,end-start)));view.setInt16(44+i*2,sample<0?sample*32768:sample*32767,true);}
 return buffer;
}
