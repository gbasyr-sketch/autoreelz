import {commerceCommand} from './commerce';
const key='autoreelz.owner.logout.v1';let exiting=false;
function hidePrivate(){document.documentElement.dataset.staffExiting='true';window.dispatchEvent(new Event('autoreelz:staff-exiting'));}
function leave(){hidePrivate();location.replace('/manager?logged_out=1');}
document.querySelectorAll<HTMLButtonElement>('[data-staff-logout]').forEach(button=>button.addEventListener('click',async()=>{
 if(exiting)return;exiting=true;hidePrivate();button.disabled=true;button.textContent='Выходим…';const error=button.parentElement?.querySelector<HTMLElement>('[data-staff-logout-error]');if(error)error.hidden=true;
 try{await commerceCommand('/api/manager/logout',{});try{localStorage.setItem(key,Date.now().toString());}catch{}leave();}
 catch(e){if(error){error.textContent=e instanceof Error?e.message:'Выход не завершён. Повторите попытку.';error.hidden=false;}exiting=false;button.disabled=false;button.textContent='Повторить выход';}
}));
window.addEventListener('storage',event=>{if(event.key===key&&event.newValue)leave();});
window.addEventListener('pageshow',event=>{if(event.persisted){hidePrivate();location.reload();}});
