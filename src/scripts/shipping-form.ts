import {yandexMapConsent} from '../lib/checkout-confirmations';
import type{DeliveryInput}from'../lib/commerce-types';
type City={code:number;name:string;region:string;subRegion:string};
type Point={code:string;name:string;cityCode:number;city:string;address:string;workTime:string;latitude:number|null;longitude:number|null};
type PickupMap=ReturnType<typeof import('./pickup-map')['createPickupMap']>;
export function initShippingForm(form:HTMLFormElement,onChange:()=>void=()=>{},acceptMap:()=>Promise<unknown>=async()=>{throw Error('Согласие на карту недоступно.');}){
 const field=<T extends HTMLInputElement|HTMLSelectElement>(name:string)=>form.elements.namedItem(name) as T;
 const q=<T extends HTMLElement>(selector:string)=>form.querySelector<T>(selector)!;
 const method=form.elements.namedItem('method') as HTMLSelectElement|RadioNodeList;const onMethod=(fn:()=>void)=>form.querySelectorAll('[name=method]').forEach(n=>n.addEventListener('change',fn));const city=field<HTMLInputElement>('city'),address=field<HTMLInputElement>('address');
 const enabled=q<HTMLElement>('[data-shipping-provider]').dataset.shippingProvider==='cdek';
 if(!enabled){onMethod(()=>{q('[data-address-label]').textContent=method.value==='courier'?'Адрес доставки: улица, дом, квартира':'Адрес пункта выдачи';});return()=>({method:method.value as DeliveryInput['method'],city:city.value.trim(),address:address.value.trim()});}
 const cities=field<HTMLSelectElement>('cityCode'),points=field<HTMLSelectElement>('pointCode'),filter=field<HTMLInputElement>('pointSearch'),manual=field<HTMLInputElement>('manualDelivery');
 const search=q<HTMLButtonElement>('[data-find-city]'),more=q<HTMLButtonElement>('[data-more-points]'),status=q('[data-shipping-status]'),error=q('[data-shipping-error]');
 const cityMap=new Map<string,City>(),pointMap=new Map<string,Point>();let generation=0,page=0,hasMore=false;let map:PickupMap|undefined,mapPromise:Promise<PickupMap>|undefined;
 let mapAllowed=false,latestMap:{items:Point[];fit:boolean}|undefined;
 function mapPoints(items:Point[],fit=false){
  latestMap={items,fit};
  const consentHost=q<HTMLElement>('[data-pickup-map]');
  if(consentHost.dataset.mapProvider==='yandex'&&!mapAllowed){
   if(!consentHost.querySelector('[data-enable-map]')){
    const box=document.createElement('div');box.className='map-consent';
    const intro=document.createElement('p');intro.textContent='Карта — внешний сервис Яндекса. Выбор из списка и расчёт доставки доступны без её подключения.';
    const details=document.createElement('details'),summary=document.createElement('summary'),copy=document.createElement('p');summary.textContent=yandexMapConsent.title;copy.textContent=yandexMapConsent.body;details.append(summary,copy);
    for(const[label,url]of [['Политика Яндекса',yandexMapConsent.policyUrl],['Условия API',yandexMapConsent.termsUrl]]){const a=document.createElement('a');a.textContent=label!;a.href=url!;a.target='_blank';a.rel='noopener noreferrer';details.append(a,document.createTextNode(' · '));}
    const choice=document.createElement('label');choice.className='confirmation-choice';const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.dataset.mapConsent='';const label=document.createElement('span');label.textContent=yandexMapConsent.label;choice.append(checkbox,label);
    const enable=document.createElement('button');enable.type='button';enable.className='button-secondary';enable.dataset.enableMap='';enable.textContent='Включить Яндекс.Карту';
    const feedback=document.createElement('p');feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
    enable.addEventListener('click',()=>void(async()=>{
     if(!checkbox.checked){feedback.textContent='Чтобы включить карту, подтвердите отдельное согласие. Или выберите ПВЗ из списка.';checkbox.focus();return;}
     enable.disabled=true;checkbox.disabled=true;feedback.textContent='Сохраняем выбор…';
     try{await acceptMap();mapAllowed=true;consentHost.replaceChildren();if(latestMap)mapPoints(latestMap.items,latestMap.fit);}
     catch{feedback.textContent='Не удалось сохранить согласие. Повторите или выберите пункт из списка.';enable.disabled=false;checkbox.disabled=false;}
    })());box.append(intro,details,choice,enable,feedback);consentHost.replaceChildren(box);
   }return;
  }
  const current=generation,host=q<HTMLElement>('[data-pickup-map]'),notice=q<HTMLElement>('[data-map-status]');
  const choose=(code:string)=>{points.value=code;details();map?.select(code);status.textContent='Выбран ПВЗ '+code;onChange();requestAnimationFrame(()=>field<HTMLInputElement>('selectedPointCode').focus({preventScroll:true}));};
  if(!mapPromise)mapPromise=(host.dataset.mapProvider==='yandex'?import('./yandex-pickup-map').then(m=>m.createYandexPickupMap(host,notice,choose,host.dataset.yandexApiKey??'')):import('./pickup-map').then(m=>m.createPickupMap(host,notice,choose))).then(value=>map=value);
  void mapPromise.then(m=>{if(current===generation){m.show(items,points.value,fit);if(points.value)m.select(points.value);}}).catch(()=>{notice.textContent='Карта не загрузилась. Выберите ПВЗ из списка ниже.';mapPromise=undefined;});
 }
 function option(value:string,label:string){const o=document.createElement('option');o.value=value;o.textContent=label;return o;}
 function resetPoints(){pointMap.clear();points.replaceChildren(option('','Сначала выберите город'));filter.value='';q('[data-point-details]').textContent='';hasMore=false;more.hidden=true;field<HTMLInputElement>('selectedPointCode').value='';field<HTMLInputElement>('selectedPointAddress').value='';map?.show([],'');}
 function mode(){const direct=method.value==='courier',useManual=manual.checked;q('[data-cdek-controls]').hidden=useManual;q('[data-point-controls]').hidden=useManual||direct||!cities.value;cities.required=!useManual;points.required=!useManual&&!direct;cities.disabled=useManual;points.disabled=useManual||direct;q('[data-address-field]').hidden=!useManual&&!direct;address.required=useManual||direct;q('[data-address-label]').textContent=direct?'Адрес доставки: улица, дом, квартира':'Адрес пункта выдачи';}
 function details(){const p=pointMap.get(points.value);field<HTMLInputElement>('selectedPointCode').value=p?.code??'';field<HTMLInputElement>('selectedPointAddress').value=p?.address??'';q('[data-point-details]').textContent=p?`${p.code} · ${p.address}. ${p.workTime}`:'';}
 function renderPoints(fit=false){const selected=points.value,needle=filter.value.trim().toLocaleLowerCase('ru');const matches=[...pointMap.values()].filter(p=>(p.code+' '+p.address+' '+p.name).toLocaleLowerCase('ru').includes(needle));points.replaceChildren(option('',matches.length?'Выберите пункт выдачи':'Пункты не найдены'));for(const p of matches)points.append(option(p.code,`${p.code} — ${p.address}`));if(matches.some(p=>p.code===selected))points.value=selected;details();more.hidden=!hasMore;mapPoints(matches,fit);}
 async function get(path:string){const r=await fetch(path,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(20000)});const body=await r.json();if(!r.ok)throw Error(body.error?.message??'Справочник временно недоступен.');return body;}
 const requests=new WeakMap<HTMLElement,number>();
 async function run(control:HTMLElement,work:()=>Promise<void>){
  if(control instanceof HTMLButtonElement&&control.disabled)return;
  const id=(requests.get(control)??0)+1;requests.set(control,id);control.setAttribute('aria-busy','true');if(control instanceof HTMLButtonElement)control.disabled=true;error.hidden=true;status.textContent='Загружаем данные СДЭК…';let trackedGeneration=generation;
  try{const task=work();trackedGeneration=generation;await task;}catch(e){if(trackedGeneration!==generation||requests.get(control)!==id)return;status.textContent='';error.textContent=e instanceof Error?e.message:'СДЭК временно недоступен. Укажите адрес вручную.';error.hidden=false;error.focus({preventScroll:true});}finally{if(requests.get(control)===id){control.removeAttribute('aria-busy');if(control instanceof HTMLButtonElement)control.disabled=false;}}
 }
 async function loadPoints(nextPage:number){const current=generation,code=cities.value;if(!code||manual.checked||method.value!=='pickup_point')return;const data=await get(`/api/shipping/points?cityCode=${encodeURIComponent(code)}&page=${nextPage}`);if(current!==generation)return;for(const p of data.items as Point[])pointMap.set(p.code,p);page=nextPage;hasMore=Boolean(data.hasMore);renderPoints(nextPage===0);status.textContent=pointMap.size?`Найдено пунктов: ${pointMap.size}. Выберите подходящий адрес.`:'В этом городе пункты не найдены. Можно выбрать курьера или указать адрес вручную.';}
 city.addEventListener('input',()=>{generation++;cityMap.clear();cities.replaceChildren(option('','Найдите город заново'));resetPoints();mode();onChange();});
 address.addEventListener('input',onChange);
 search.addEventListener('click',()=>void run(search,async()=>{if(city.value.trim().length<2){city.focus();throw Error('Введите полное название населённого пункта.');}const current=++generation;cityMap.clear();cities.replaceChildren(option('','Ищем…'));resetPoints();mode();const data=await get('/api/shipping/cities?q='+encodeURIComponent(city.value.trim()));if(current!==generation)return;cities.replaceChildren(option('',data.items.length?'Выберите населённый пункт':'Ничего не найдено'));for(const c of data.items as City[]){cityMap.set(String(c.code),c);cities.append(option(String(c.code),[...new Set([c.name,c.region,c.subRegion].filter(Boolean))].join(' · ')));}status.textContent=data.items.length?'Выберите населённый пункт и регион из списка.':'Населённый пункт не найден. Проверьте название или укажите адрес вручную.';cities.focus();}));
 cities.addEventListener('change',()=>{generation++;resetPoints();mode();onChange();if(method.value==='pickup_point')void run(q('[data-point-controls]'),()=>loadPoints(0));});
 onMethod(()=>{generation++;mode();onChange();if(method.value==='pickup_point'&&cities.value&&!manual.checked)void run(q('[data-point-controls]'),()=>loadPoints(0));});
 manual.addEventListener('change',()=>{generation++;mode();onChange();status.textContent=manual.checked?'Заказ можно оформить. Стоимость доставки уточнит менеджер до оплаты.':'';if(!manual.checked&&method.value==='pickup_point'&&cities.value)void run(q('[data-point-controls]'),()=>loadPoints(0));});
 q('[data-select-from-list]').addEventListener('click',()=>points.focus());filter.addEventListener('input',()=>{const before=points.value;renderPoints(true);if(before!==points.value)onChange();});points.addEventListener('change',()=>{details();map?.select(points.value);onChange();});more.addEventListener('click',()=>void run(more,()=>loadPoints(page+1)));mode();
 return():DeliveryInput=>{
  if(manual.checked)return{method:method.value as DeliveryInput['method'],city:city.value.trim(),address:address.value.trim(),manual:true};
  const c=cityMap.get(cities.value),p=pointMap.get(points.value);if(!c)throw Error('Выберите населённый пункт СДЭК.');if(method.value==='pickup_point'&&!p)throw Error('Выберите пункт выдачи СДЭК.');
  return{method:method.value as DeliveryInput['method'],city:c.name,cityCode:c.code,address:method.value==='pickup_point'?p!.address:address.value.trim(),...(method.value==='pickup_point'?{pointCode:p!.code}:{})};
 };
}
