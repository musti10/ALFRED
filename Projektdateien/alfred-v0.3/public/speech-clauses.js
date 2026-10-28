// Adapted from dnhkng/GLaDOS, src/glados/core/speech_chunking.py (MIT).
// Upstream ea018f57fac8bbdde5057b65e372ddf9ac0758a8. See third-party/GLaDOS-MIT.txt.
// Changes: JavaScript port and protection of common German abbreviations.
export function splitSpeechClauses(text){
 const boundary=/[.!?;:]+["”’)]*(?=\s|$)|\n+/g;
 const clauses=[];let start=0;
 for(const match of text.matchAll(boundary)){
 const prefix=text.slice(start,match.index),end=match.index+match[0].length;
 if(/https?:\/\/\S*$|https?$/.test(prefix))continue;
 if(/[.:]/.test(match[0][0])&&/\d$/.test(prefix)&&end===text.length)continue;
 if(match[0][0]==='.'&&/(?:\b(?:Dr|Prof|Nr|bzw|ca|usw|z\.\s*B|d\.\s*h)|\bz(?=\.|$)|\bd(?=\.|$))$/i.test(prefix))continue;
 const clause=text.slice(start,end);if(clause.trim())clauses.push(clause);start=end;
 }
 return {clauses,pending:text.slice(start)};
}
