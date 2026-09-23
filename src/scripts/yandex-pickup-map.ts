import type{MapPoint}from'./pickup-map';
type Api={ready:(ready:()=>void,error:()=>void)=>void;Map:new(...args:any[])=>any;Clusterer:new(...args:any[])=>any;Placemark:new(...args:any[])=>any};
let loading:Promise<Api>|undefined;
export function loadYandexMaps(key:string):Promise<Api>{
 if(!/^[A-Za-z0-9_-]{16,160}$/.test(key))return Promise.reject(Error('Карта временно недоступна. Выберите пункт из списка.'));
 if(loading)return loading;
 loading=new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.async=true;script.id='autoreelz-yandex-maps';
  const url=new URL('https://api-maps.yandex.ru/2.1/');url.searchParams.set('apikey',key);url.searchParams.set('lang','ru_RU');script.src=url.href;
  let done=false;const timer=setTimeout(()=>finish(),15000);
  function finish(api?:Api){if(done)return;done=true;clearTimeout(timer);if(api)resolve(api);else{script.remove();loading=undefined;reject(Error('Карта не загрузилась. Выберите пункт из списка.'));}}
  script.onerror=()=>finish();script.onload=()=>{const api=(window as unknown as {ymaps?:Api}).ymaps;if(typeof api?.ready!=='function')return finish();try{api.ready(()=>finish(api.Map&&api.Clusterer&&api.Placemark?api:undefined),()=>finish());}catch{finish();}};document.head.append(script);
 });return loading;
}
const html=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export async function createYandexPickupMap(host:HTMLElement,status:HTMLElement,onChoose:(code:string)=>void,key:string){
 const api=await loadYandexMaps(key);host.replaceChildren();
 const map=new api.Map(host,{center:[42.98,47.50],zoom:11,controls:['zoomControl','fullscreenControl']},{autoFitToViewport:'always'});
 map.behaviors.disable('scrollZoom');
 const clusterer=new api.Clusterer({preset:'islands#redClusterIcons',groupByCoordinates:false});map.geoObjects.add(clusterer);
 const markers=new Map<string,any>();let points:MapPoint[]=[],selected='';
 const positioned=(p:MapPoint)=>p.latitude!==null&&p.longitude!==null;
 function highlight(){for(const[code,marker]of markers)marker.options.set('preset',code===selected?'islands#darkBlueDotIcon':'islands#redDotIcon');}
 function choose(event:Event){const button=event.target instanceof Element?event.target.closest<HTMLButtonElement>('button[data-yandex-pickup]'):null;const code=button?.dataset.yandexPickup;if(!code||!markers.has(code))return;event.preventDefault();event.stopPropagation();onChoose(code);map.balloon.close();}
 host.addEventListener('click',choose,true);
 const observer=new ResizeObserver(()=>{if(host.clientWidth&&host.clientHeight)map.container.fitToViewport();});observer.observe(host);
 status.textContent='Нажмите на пункт на карте или выберите его в списке.';
 return{
  show(next:MapPoint[],code:string,fit=false){
   points=next;selected=code;clusterer.removeAll();markers.clear();
   for(const p of points.filter(positioned)){
    const marker=new api.Placemark([p.latitude,p.longitude],{hintContent:html(p.code+' — '+p.address),balloonContentHeader:'СДЭК '+html(p.code),balloonContentBody:`<div class="pickup-popup"><p>${html(p.address)}</p><p>${html(p.workTime)}</p><button type="button" class="button" data-yandex-pickup="${html(p.code)}">Выбрать этот ПВЗ</button></div>`},{preset:'islands#redDotIcon'});markers.set(p.code,marker);
   }
   clusterer.add([...markers.values()]);highlight();map.container.fitToViewport();
   const point=points.find(p=>p.code===selected&&positioned(p));if(point)map.setCenter([point.latitude,point.longitude],16,{duration:0});else if(fit&&markers.size){const bounds=clusterer.getBounds();if(bounds)map.setBounds(bounds,{checkZoomRange:true,zoomMargin:30,duration:0});}
  },
  select(code:string){selected=code;highlight();const p=points.find(p=>p.code===code&&positioned(p));if(p){map.setCenter([p.latitude,p.longitude],16,{duration:0});map.balloon.open([p.latitude,p.longitude],{contentHeader:'СДЭК '+html(p.code),contentBody:`<div class="pickup-popup"><p>${html(p.address)}</p><p>${html(p.workTime)}</p><button type="button" class="button" data-yandex-pickup="${html(p.code)}">Выбрать этот ПВЗ</button></div>`});}},
  destroy(){observer.disconnect();host.removeEventListener('click',choose,true);map.destroy();}
 };
}
