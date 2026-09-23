import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
export interface MapPoint {code:string;address:string;workTime:string;latitude:number|null;longitude:number|null}
export function createPickupMap(host:HTMLElement,status:HTMLElement,onChoose:(code:string)=>void){
 host.replaceChildren();const map=L.map(host,{scrollWheelZoom:false,zoomControl:false,zoomAnimation:!matchMedia('(prefers-reduced-motion: reduce)').matches,minZoom:3,maxZoom:19}).setView([42.98,47.50],11);
 L.control.zoom({position:'topright',zoomInTitle:'Приблизить',zoomOutTitle:'Отдалить'}).addTo(map);
 const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',referrerPolicy:'strict-origin-when-cross-origin'}).addTo(map);
 tiles.on('tileerror',()=>{status.textContent='Подложка карты недоступна. Выберите ПВЗ в списке ниже.';});tiles.on('tileload',()=>{status.textContent='Нажмите на пункт на карте или выберите его в списке.';});
 const layers=L.layerGroup().addTo(map);let points:MapPoint[]=[],selected='';
 const located=(p:MapPoint):p is MapPoint&{latitude:number;longitude:number}=>p.latitude!==null&&p.longitude!==null;
 function content(items:MapPoint[]){const box=document.createElement('div');box.className='pickup-popup';for(const p of items){const title=document.createElement('strong'),address=document.createElement('p'),hours=document.createElement('p'),button=document.createElement('button');title.textContent='СДЭК '+p.code;address.textContent=p.address;hours.textContent=p.workTime;button.type='button';button.className='button';button.textContent='Выбрать этот ПВЗ';button.addEventListener('click',()=>{onChoose(p.code);map.closePopup();});box.append(title,address,hours,button);}return box;}
 function paint(){
  layers.clearLayers();const groups=new Map<string,(MapPoint&{latitude:number;longitude:number})[]>();
  for(const p of points.filter(located)){const pos=map.project([p.latitude,p.longitude],map.getZoom());const key=map.getZoom()>=18?`${p.latitude}:${p.longitude}`:`${Math.floor(pos.x/54)}:${Math.floor(pos.y/54)}`;const values=groups.get(key)??[];values.push(p);groups.set(key,values);}
  for(const group of groups.values()){
   const lat=group.reduce((n,p)=>n+p.latitude,0)/group.length,lng=group.reduce((n,p)=>n+p.longitude,0)/group.length,multiple=group.length>1;
   const icon=L.divIcon({className:`pickup-marker ${multiple?'cluster':''} ${group.some(p=>p.code===selected)?'selected':''}`,html:multiple?String(group.length):'<span aria-hidden="true"></span>',iconSize:multiple?[40,40]:[30,36],iconAnchor:multiple?[20,20]:[15,36]});
   const marker=L.marker([lat,lng],{icon,keyboard:true,title:multiple?`${group.length} пунктов СДЭК`:`СДЭК ${group[0]!.code}: ${group[0]!.address}`}).addTo(layers);
   marker.getElement()?.setAttribute('aria-label',multiple?`Показать ${group.length} пунктов СДЭК`:`СДЭК ${group[0]!.code}: ${group[0]!.address}`);
   if(multiple&&map.getZoom()<18)marker.on('click',()=>{map.setView([lat,lng],Math.min(map.getZoom()+2,19),{animate:false});});else marker.bindPopup(content(group),{maxWidth:280});
  }
 }
 // Projected cluster cells change with zoom, not panning. Repainting on
 // moveend would destroy a popup when Leaflet auto-pans to keep it visible.
 map.on('zoomend',paint);
 const observer=new ResizeObserver(()=>{if(host.clientWidth&&host.clientHeight)map.invalidateSize({pan:false});});observer.observe(host);
 return{show(next:MapPoint[],code:string,fit=false){points=next;selected=code;map.invalidateSize({pan:false});const coords=points.filter(located).map(p=>[p.latitude,p.longitude] as [number,number]);if(fit&&coords.length)map.fitBounds(L.latLngBounds(coords),{padding:[28,28],maxZoom:14,animate:false});paint();},select(code:string){selected=code;const p=points.find(p=>p.code===code);if(p&&located(p))map.setView([p.latitude,p.longitude],Math.max(map.getZoom(),15),{animate:false});paint();},destroy(){observer.disconnect();map.remove();}};
}
