import {analyticsPage,analyticsReferrer,PRIVACY_VERSION,PRIVACY_VETO,type PrivacyState,type PrivacyChoice} from '../lib/privacy-consent';
import {commerceCommand,commerceGet} from './commerce';
type Ym=((...args:unknown[])=>void)&{a?:unknown[][];l?:number};
const element=document.querySelector<HTMLElement>('[data-privacy]');
if(element){
 const root=element;
 let state:PrivacyState=JSON.parse(root.dataset.state!),busy=false,active=false,loading:HTMLScriptElement|null=null,epoch=0,decisionEpoch=0,expiryTimer:ReturnType<typeof setTimeout>|undefined;
 const win=window as typeof window&{ym?:Ym},banner=root.querySelector<HTMLElement>('[data-privacy-banner]')!,dialog=root.querySelector<HTMLDialogElement>('[data-privacy-dialog]')!;
 // Keep the notice above visible fixed shopping/navigation bars, including wrapped labels.
 const bottomBars=[...document.querySelectorAll<HTMLElement>('.mobile-purchase,.mobile-nav')];
 function positionBanner(){
  let bottom=24;
  for(const bar of bottomBars){
   const rect=bar.getBoundingClientRect();
   if(rect.height>0&&getComputedStyle(bar).position==='fixed')bottom=Math.max(bottom,window.innerHeight-rect.top+12);
  }
  banner.style.setProperty('--privacy-bottom',`${bottom}px`);
  const clearance=banner.hidden?0:bottom+banner.getBoundingClientRect().height+12;
  document.documentElement.style.setProperty('--privacy-clearance',`${clearance}px`);
 }
 const bannerLayout=new ResizeObserver(positionBanner);
 [banner,...bottomBars].forEach(node=>bannerLayout.observe(node));
 window.addEventListener('resize',positionBanner,{passive:true});
 let returnFocus:HTMLElement|null=null;
 function veto(){try{if(localStorage.getItem(PRIVACY_VETO)==='1')return true;}catch{}return document.cookie.split(';').some(v=>v.trim()==='ar_analytics_off=1');}
 function setVeto(value:boolean){try{value?localStorage.setItem(PRIVACY_VETO,'1'):localStorage.removeItem(PRIVACY_VETO);}catch{}document.cookie=`ar_analytics_off=${value?'1':''}; Path=/; SameSite=Lax; Max-Age=${value?15552000:0}${location.protocol==='https:'?'; Secure':''}`;}
 function permitted(){return root.dataset.trackPage==='true'&&state.enabled&&state.choice==='accepted'&&state.version===PRIVACY_VERSION&&!!state.expiresAt&&state.expiresAt>Date.now()&&!veto()&&analyticsPage(new URL(location.href));}
 function clearAnalyticsCookies(){
  for(const part of document.cookie.split(';')){const name=part.trim().split('=')[0]!;if(!/^_ym_[A-Za-z0-9_]+$/.test(name))continue;for(const domain of ['',`; Domain=${location.hostname}`,`; Domain=.${location.hostname}`])document.cookie=`${name}=; Path=/; Max-Age=0${domain}${location.protocol==='https:'?'; Secure':''}`;}
  try{for(const key of Object.keys(localStorage))if(/^_ym/.test(key))localStorage.removeItem(key);}catch{}
 }
 function stop(){epoch++;if(loading){loading.onload=null;loading.remove();loading=null;}if(active&&state.counterId)win.ym?.(Number(state.counterId),'destruct');if(win.ym?.a)win.ym.a=[];active=false;clearAnalyticsCookies();}
 function start(){
  if(active||loading||!permitted()||!state.counterId)return;
  if(!win.ym){const queue:Ym=(...args)=>{queue.a??=[];queue.a.push(args);};queue.l=Date.now();win.ym=queue;}
  const generation=++epoch,script=document.createElement('script');loading=script;script.async=true;script.src='https://mc.yandex.ru/metrika/tag.js';script.referrerPolicy='origin';
  script.onload=()=>{loading=null;if(generation!==epoch||!permitted()||!state.counterId)return;
   active=true;const id=Number(state.counterId),url=location.origin+location.pathname,referrer=analyticsReferrer(document.referrer,location.origin);
   if(!win.ym){const queue:Ym=(...args)=>{queue.a??=[];queue.a.push(args);};queue.l=Date.now();win.ym=queue;}
   win.ym(id,'init',{defer:true,url,referrer,webvisor:false,clickmap:false,trackLinks:false,trackHash:false,accurateTrackBounce:false});
   win.ym(id,'hit',url,{title:document.title,referer:referrer});
  };script.onerror=()=>{loading=null;script.remove();};document.head.append(script);
 }
 function armExpiry(){clearTimeout(expiryTimer);if(!state.expiresAt)return;expiryTimer=setTimeout(()=>{if(state.expiresAt&&state.expiresAt<=Date.now()){state.choice=null;stop();render();}else armExpiry();},Math.max(0,Math.min(state.expiresAt-Date.now(),86400000)));}
 function render(){if(state.expiresAt&&state.expiresAt<=Date.now()){state.choice=null;state.expiresAt=null;}banner.hidden=state.choice!==null;positionBanner();root.querySelector('[data-privacy-current]')!.textContent=state.choice==='accepted'&&!veto()?'Ваш выбор: аналитика разрешена.':'Ваш выбор: только необходимые cookies.';root.querySelectorAll<HTMLButtonElement>('[data-privacy-accept]').forEach(b=>b.hidden=!state.enabled);permitted()?start():stop();armExpiry();}
 function message(text:string){root.querySelectorAll<HTMLElement>('[data-privacy-status]').forEach(n=>{n.textContent=text;n.hidden=!text;});}
 function close(){dialog.close();returnFocus?.focus({preventScroll:true});}
 function open(event:Event){returnFocus=event.currentTarget as HTMLElement;message('');dialog.showModal();}
 document.querySelectorAll('[data-privacy-settings]').forEach(b=>b.addEventListener('click',open));root.querySelector('[data-privacy-close]')!.addEventListener('click',close);dialog.addEventListener('cancel',()=>returnFocus?.focus({preventScroll:true}));
 async function choose(choice:PrivacyChoice){
  if(busy)return;busy=true;message('');const decision=++decisionEpoch;if(choice==='rejected'){setVeto(true);stop();}
  const buttons=Array.from(root.querySelectorAll<HTMLButtonElement>('[data-privacy-accept],[data-privacy-reject]'));buttons.forEach(b=>b.disabled=true);
  try{state=await commerceCommand<PrivacyState>('/api/privacy',{choice,version:PRIVACY_VERSION});if(choice==='accepted'&&decision===decisionEpoch)setVeto(false);try{localStorage.setItem('autoreelz.privacy-changed',String(Date.now()));}catch{}render();if(dialog.open)close();}
  catch(e){message(e instanceof Error?e.message:'Не удалось сохранить выбор. Аналитика не включена.');}
  finally{busy=false;buttons.forEach(b=>b.disabled=false);}
 }
 root.querySelectorAll('[data-privacy-accept]').forEach(b=>b.addEventListener('click',()=>void choose('accepted')));root.querySelectorAll('[data-privacy-reject]').forEach(b=>b.addEventListener('click',()=>void choose('rejected')));
 async function refresh(){try{state=await commerceGet<PrivacyState>('/api/privacy');render();}catch{stop();}}
 window.addEventListener('storage',e=>{if([PRIVACY_VETO,'autoreelz.privacy-changed'].includes(e.key??'')){decisionEpoch++;if(veto())stop();void refresh();}});
 window.addEventListener('pagehide',stop);window.addEventListener('pageshow',e=>{if(e.persisted)void refresh();});document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void refresh();});
 render();
}
