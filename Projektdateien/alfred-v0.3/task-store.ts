import {randomUUID} from 'node:crypto';
export function validDay(day:unknown):day is string {
 if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day))return false;
 const date=new Date(day+'T12:00:00Z');return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===day;
}
export function validTask(task:any){return task&&typeof task.text==='string'&&task.text.trim().length>0&&task.text.length<=400&&typeof task.time==='string'&&(/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(task.time)||task.time==='');}
export function initializeTasks(db:any){db.exec(`CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,day TEXT NOT NULL,text TEXT NOT NULL,time TEXT NOT NULL DEFAULT '',done INTEGER NOT NULL DEFAULT 0,created TEXT DEFAULT CURRENT_TIMESTAMP); CREATE INDEX IF NOT EXISTS tasks_day ON tasks(day);`);}
export function listTasks(db:any,day:string){return db.prepare("SELECT * FROM tasks WHERE day=? ORDER BY CASE WHEN time='' THEN 1 ELSE 0 END,time,rowid").all(day);}
export function addTasks(db:any,day:string,tasks:any[]){
 let added=0;const known=new Set(listTasks(db,day).map((t:any)=>t.time+'\n'+t.text));
 const insert=db.prepare('INSERT INTO tasks(id,day,text,time,done,created) VALUES(?,?,?,?,?,?)');
 for(const task of tasks){const text=task.text.trim(),key=task.time+'\n'+text;if(known.has(key))continue;known.add(key);const created=typeof task.created==='string'&&task.created.length<=40&&!Number.isNaN(Date.parse(task.created))?task.created:new Date().toISOString();insert.run(randomUUID(),day,text,task.time,task.done?1:0,created);added++;}return added;
}
