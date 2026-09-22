import {getSession,CommerceError} from './commerce';
import type {FavoritesView} from '../lib/social-types';
const KEY='autoreelz-favorites-guest-v2',LEGACY='autoreelz-new-demo-favorites-v1';
const valid=(id:unknown):id is string=>typeof id==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id);
type Merge={owner:string;key:string;ids:string[]};
type Guest={ids:string[];merges:Merge[]};
function read():Guest{
 const raw=localStorage.getItem(KEY);
 if(!raw){const old=JSON.parse(localStorage.getItem(LEGACY)??'[]');return{ids:Array.isArray(old)?old.filter(valid).slice(0,500):[],merges:[]};}
 const value=JSON.parse(raw);
 return{ids:Array.isArray(value.ids)?value.ids.filter(valid).slice(0,500):[],merges:Array.isArray(value.merges)?value.merges.filter((m:Merge)=>typeof m.owner==='string'&&valid(m.key)&&Array.isArray(m.ids)).map((m:Merge)=>({...m,ids:m.ids.filter(valid).slice(0,500)})):[]};
}
function save(state:Guest){localStorage.setItem(KEY,JSON.stringify(state));localStorage.removeItem(LEGACY);}
async function identity(email:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(email));return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');}
async function api(body?:object,csrfToken?:string):Promise<FavoritesView>{
 const response=await fetch('/api/social/favorites',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(20000),...(body?{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken!},body:JSON.stringify(body)}:{})});
 const result=await response.json();if(!response.ok)throw new CommerceError(result?.error?.message??'Избранное временно недоступно.',response.status,result?.error?.code);return result;
}
let queue=Promise.resolve();
function serial<T>(fn:()=>Promise<T>):Promise<T>{
 const task=queue.then(()=>navigator.locks?navigator.locks.request('autoreelz-favorites',fn):fn());queue=task.then(()=>{},()=>{});return task;
}
export function initFavorites(notify:(text:string)=>void){
 let ids=new Set<string>();
 const buttons=()=>[...document.querySelectorAll<HTMLButtonElement>('[data-favorite]')];
 const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('autoreelz-social'):null;
 function render(view:FavoritesView){
  ids=new Set(view.productIds);
  buttons().forEach(button=>{const selected=ids.has(button.dataset.favorite!);button.setAttribute('aria-pressed',String(selected));const name=button.closest('[data-product-id]')?.querySelector('.card-title')?.textContent??document.querySelector('h1')?.textContent??'товар';button.setAttribute('aria-label',`${selected?'Убрать из избранного':'В избранное'}: ${name.trim()}`);});
  const page=document.querySelector('[data-favorites-page]');if(!page)return;
  let count=0;page.querySelectorAll<HTMLElement>('.cards-grid>[data-product-id]').forEach(card=>{card.hidden=!ids.has(card.dataset.productId!);if(!card.hidden)count++;});
  const empty=page.querySelector<HTMLElement>('[data-favorites-empty]');if(empty)empty.hidden=count>0;
  const label=page.querySelector('[data-favorites-count]');if(label)label.textContent=`Доступных товаров в избранном: ${count}`;
  const note=page.querySelector('[data-favorites-note]');if(note)note.textContent=view.authenticated?'Избранное сохранено в вашем аккаунте и доступно на других устройствах.':'Избранное сохранено в этом браузере. После входа оно объединится с вашим аккаунтом.';
 }
 async function sync(toggle?:{id:string;selected:boolean}){return serial(async()=>{
  buttons().forEach(button=>button.disabled=true);
  const error=document.querySelector<HTMLElement>('[data-favorites-error]');if(error)error.hidden=true;
  try{
   const session=await getSession(true);let remote=await api();let state=read();
   if(remote.authenticated&&session.email){
    const owner=await identity(session.email);
    if(state.ids.length){
     // Keep the guest batch durably until acknowledged; assign it to this account
     // so a logout/login with another email cannot merge somebody else's batch.
     state.merges.push({owner,key:crypto.randomUUID(),ids:[...new Set(state.ids)]});state.ids=[];save(state);
    }
    for(const merge of state.merges.filter(m=>m.owner===owner)){
     remote=await api({action:'merge',productIds:merge.ids,idempotencyKey:merge.key},session.csrfToken);
     state=read();state.merges=state.merges.filter(m=>m.key!==merge.key);save(state);
    }
    if(toggle){const action=toggle.selected?'add':'remove';remote=await api({action,productId:toggle.id,idempotencyKey:crypto.randomUUID()},session.csrfToken);notify(action==='add'?'Товар сохранён в избранном аккаунта.':'Товар удалён из избранного.');channel?.postMessage('refresh');}
    render(remote);
   }else{
    if(toggle){const selected=new Set(state.ids);if(!toggle.selected)selected.delete(toggle.id);else{if(selected.size>=500)throw new Error('В избранном может быть не более 500 товаров.');selected.add(toggle.id);}state.ids=[...selected];save(state);notify(selected.has(toggle.id)?'Товар сохранён в избранном этого браузера.':'Товар удалён из избранного.');}
    render({authenticated:false,productIds:state.ids});
   }
  }catch(cause){const message=cause instanceof Error?cause.message:'Не удалось загрузить избранное.';if(error){error.textContent=message;error.hidden=false;}if(toggle)notify(message);}
  finally{buttons().forEach(button=>button.disabled=false);}
 });}
 document.addEventListener('click',event=>{const button=event.target instanceof Element?event.target.closest<HTMLButtonElement>('button[data-favorite]'):null;if(button&&valid(button.dataset.favorite))void sync({id:button.dataset.favorite,selected:!ids.has(button.dataset.favorite)});});
 window.addEventListener('focus',()=>void sync());
 window.addEventListener('pageshow',event=>{if(event.persisted)void sync();});
 window.addEventListener('storage',event=>{if(event.key===KEY||event.key===LEGACY)void sync();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void sync();});
 if(channel)channel.onmessage=()=>{render({authenticated:false,productIds:[]});void sync();};
 const account=document.querySelector('[data-account-email]');if(account)new MutationObserver(()=>{render({authenticated:false,productIds:[]});channel?.postMessage('refresh');void sync();}).observe(account,{childList:true,subtree:true});
 document.querySelector('[data-retry-favorites]')?.addEventListener('click',()=>void sync());
 void sync();
}
