const menu=document.querySelector<HTMLElement>('[data-manager-menu]'),toggle=document.querySelector<HTMLButtonElement>('[data-menu-toggle]');
function setMenu(open:boolean){if(menu)menu.dataset.menuOpen=String(open);toggle?.setAttribute('aria-expanded',String(open));}
toggle?.addEventListener('click',()=>setMenu(toggle.getAttribute('aria-expanded')!=='true'));menu?.addEventListener('keydown',event=>{if(event.key==='Escape'&&toggle?.getAttribute('aria-expanded')==='true'){setMenu(false);toggle.focus();}});
let dirty=false;window.addEventListener('autoreelz:manager-dirty',((event:CustomEvent<boolean>)=>{dirty=event.detail;document.documentElement.dataset.managerDirty=String(dirty);}) as EventListener);
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();}});
document.addEventListener('click',event=>{const action=(event.target as Element).closest('a[href],[data-staff-logout]');if(!action||!dirty)return;if(action instanceof HTMLAnchorElement&&(action.hash&&action.pathname===location.pathname&&action.search===location.search||action.target==='_blank'))return;if(!confirm('Есть несохранённые изменения. Уйти со страницы?')){event.preventDefault();event.stopImmediatePropagation();return;}dirty=false;document.documentElement.dataset.managerDirty='false';},true);
// Compatibility with saved links from the previous combined screen.
if(['/manager','/manager/orders'].includes(location.pathname)){
 const p=new URLSearchParams(location.search),sku=p.get('sku'),order=p.get('order');const valid=(s:string|null)=>s&&/^[a-f0-9-]{36}$/i.test(s);
 if(location.hash.startsWith('#manager-stock')||valid(sku)){const q=new URLSearchParams();if(valid(sku))q.set('sku',sku!);if(location.hash==='#manager-stock-adjust')q.set('action','adjust');location.replace('/manager/stock'+(q.size?'?'+q:''));}
 else if(location.hash==='#manager-notifications'||location.hash==='#manager-mail')location.replace('/manager/service?tab='+(location.hash==='#manager-mail'?'mail':'notifications'));
 else if(valid(order))location.replace('/manager/orders/'+encodeURIComponent(order!));
}

if(location.pathname==='/manager'){const f=new URLSearchParams(location.search).get('filter');if(f&&['packing','quote','confirm','review','ordinary','preorder'].includes(f))location.replace('/manager/orders?'+(['ordinary','preorder'].includes(f)?'kind=':'task=')+f);}
