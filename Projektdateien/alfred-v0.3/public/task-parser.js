export function localDay(date=new Date()) {return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');}
export function parseTaskLines(text){
 const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
 if(lines.length>50)throw Error('Bitte höchstens 50 Aufgaben auf einmal übernehmen.');
 return lines.map(line=>{
 const clean=line.replace(/\*\*/g,'').replace(/^(?:[-*•]|\d+[.)])\s+/,'').replace(/^\[[ xX]\]\s*/,'');
 const timed=clean.match(/^(\d{1,2})[:.](\d{2})(?:\s*Uhr)?\s*(?:[-–—:]\s*|\s+)(.+)$/i);
 const time=timed?timed[1].padStart(2,'0')+':'+timed[2]:'';
 const content=(timed?timed[3]:clean).trim();
 if(time&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error('Ungültige Uhrzeit: '+time);
 if(!content||content.length>400)throw Error('Jede Aufgabe braucht 1–400 Zeichen.');
 return {text:content,time};
 });
}
export function suggestedTaskLines(text){
 const lines=text.split(/\r?\n/).map(line=>line.trim().replace(/\*\*/g,'')).filter(Boolean);
 const candidates=lines.filter(line=>/^(?:[-*•]\s+|\d+[.)]\s+|\d{1,2}[:.]\d{2})/.test(line));
 return (candidates.length?candidates:lines).join('\n');
}

export function buildPlanningDraft(day,tasks){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||Number.isNaN(Date.parse(day+'T12:00:00Z'))||new Date(day+'T12:00:00Z').toISOString().slice(0,10)!==day)throw Error('Bitte ein gültiges Datum wählen.');
 const open=tasks.filter(task=>task.done===0||task.done===false);
 if(!open.length)throw Error('Für diesen Tag gibt es keine offenen Aufgaben.');
 const date=day.split('-').reverse().join('.');
 const lines=open.map(task=>(task.time?task.time+' · ':'')+task.text);
 const draft='Bitte hilf mir, den '+date+' ruhig und ohne Zeitdruck zu planen.\n\nMeine offenen Aufgaben für diesen Tag:\n'+lines.map(line=>'- '+line).join('\n')+'\n\nBerücksichtige vorhandene Uhrzeiten möglichst und plane großzügige Pausen ein. Wenn Zeiten nicht zusammenpassen, sage es mir. Erstelle einen einfachen Vorschlag mit Uhrzeiten. Ändere oder erledige keine gespeicherten Aufgaben; ich prüfe deinen Vorschlag selbst.';
 if(draft.length>4000)throw Error('Die offenen Aufgaben sind für eine einzelne Chatnachricht zu umfangreich. Bitte eine kleinere Auswahl selbst in den Chat kopieren.');
 return draft;
}
export function mergePlanningDraft(existing,draft){
 if(existing.includes(draft))return existing;
 const next=existing.trim()?existing+'\n\n'+draft:draft;
 if(next.length>4000)throw Error('Zusammen mit deinem bisherigen Entwurf wären es mehr als 4000 Zeichen. Bitte zuerst den Entwurf kürzen.');
 return next;
}
