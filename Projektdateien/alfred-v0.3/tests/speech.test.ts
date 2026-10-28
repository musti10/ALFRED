import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localGermanVoice,speechChunks,createReader} from '../public/speech.js';
test('Vorlesen wählt ausschließlich lokale deutsche Stimmen und stoppt die Warteschlange',()=>{
 const remote={lang:'de-DE',localService:false};const local={lang:'de-DE',localService:true};
 assert.equal(localGermanVoice([remote,{lang:'en-US',localService:true}]),null);
 assert.equal(localGermanVoice([remote,local]),local);
 const chunks=speechChunks('Ein längerer Text. '.repeat(70));assert.ok(chunks.every(c=>c.length<=240));assert.equal(chunks.join(' '),'Ein längerer Text. '.repeat(70).trim());
 let voices=[remote];const spoken:any[]=[];const synth={getVoices:()=>voices,cancel:()=>{},speak:(u:any)=>spoken.push(u)};
 class Utterance{text:string;constructor(text:string){this.text=text;}}
 const reader=createReader(synth,Utterance);assert.throws(()=>reader.read('Hallo'),/Keine lokale/);assert.equal(spoken.length,0);
 voices=[remote,local];reader.read('Ein längerer Text. '.repeat(70));assert.equal(spoken[0].voice,local);
 const first=spoken[0];reader.stop();first.onend();assert.equal(spoken.length,1);
});

test('Übernommener Sprachbaustein erhält Zahlen, URLs und deutsche Abkürzungen und bevorzugt Satzgrenzen',async()=>{
 const {splitSpeechClauses}=await import('../public/speech-clauses.js');
 assert.deepEqual(splitSpeechClauses('Hallo! Wie geht es dir? Rest'),{clauses:['Hallo!',' Wie geht es dir?'],pending:' Rest'});
 assert.deepEqual(splitSpeechClauses('Um 09:'),{clauses:[],pending:'Um 09:'});
 const sentence='Dr. Müller kommt z. B. um 09:30 Uhr. Danach geht es weiter.';
 assert.equal(splitSpeechClauses(sentence).clauses[0],'Dr. Müller kommt z. B. um 09:30 Uhr.');
 const link='Siehe https://example.org/test?a=1.2 und antworte danach.';assert.deepEqual(splitSpeechClauses(link).clauses,[link]);
 const first='Das ist ein vollständiger erster Satz mit genügend Wörtern. '.repeat(3).trim();const second='Nun folgt ein zweiter eigener Abschnitt, der nicht mitten im Satz abgeschnitten werden soll.';
 const chunks=speechChunks(first+' '+second);assert.equal(chunks[0],first);assert.equal(chunks[1],second);
 const long='😀'.repeat(250);const unicode=speechChunks(long);assert.ok(unicode.every(chunk=>chunk.length<=240));assert.equal(unicode.join(''),long);assert.ok(unicode.every(chunk=>!/^\p{Surrogate}|\p{Surrogate}$/u.test(chunk)));
 assert.deepEqual(speechChunks('  \n '),[]);
});
