import type {BackupStatus} from '../lib/backup-status';
export function backupPanel(root:HTMLElement){
 const $=(name:string)=>root.querySelector<HTMLElement>('[data-backup-'+name+']')!;let serial=0;
 const date=(v:string|null)=>v?new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',dateStyle:'short',timeStyle:'short'}).format(new Date(v))+' МСК':'Пока нет';
 function clear(){serial++;for(const name of ['message','copy','verified','size','schedule'])$(name).textContent='—';}
 async function load(){const id=++serial;try{const r=await fetch('/api/manager/backup-status',{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error();const data=await r.json() as BackupStatus;if(id!==serial)return;
  $('message').textContent=data.message;$('message').className=data.state==='error'||data.stale||data.verificationDue?'dash-message dash-error':'dash-help';$('copy').textContent=date(data.lastSuccessAt);$('verified').textContent=date(data.lastVerifiedAt);$('size').textContent=data.bytes===null?'—':new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(data.bytes/1024/1024)+' МБ';$('schedule').textContent=data.scheduled?'Каждый час · 24 часовые, 7 дневных, 4 недельные, 3 месячные':'Автоматический запуск ещё не включён.';
 }catch{if(id===serial){$('message').textContent='Не удалось обновить состояние резервных копий.';$('message').className='dash-message dash-error';}}}
 return{load,clear};
}
