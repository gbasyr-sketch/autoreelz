import {node} from './manager-page';
import {commerceGet,commerceCommand,CommerceError} from './commerce';
import {blankVehicle,vehicleName,normalizeVehicle,normalizeVersion,type VehicleData,type VersionData,type VehicleEntry,type VehicleKind,type VehicleSaveResult} from '../lib/vehicle-editor';
type Target={kind:VehicleKind;id?:string;vehicleId?:string;vehicleName?:string;done:(result:VehicleSaveResult)=>void;focus:()=>void};
type Hooks={busy:(value:boolean)=>void;error:(error:unknown)=>void};
export function vehicleEditor(dialog:HTMLDialogElement,hooks:Hooks){
 const q=<T extends HTMLElement>(s:string)=>dialog.querySelector<T>(s)!;
 const form=q<HTMLFormElement>('[data-ve-form]'),fields=q<HTMLFieldSetElement>('[data-ve-fields]'),inputs=q<HTMLElement>('[data-ve-inputs]'),error=q<HTMLElement>('[data-ve-error]'),submit=q<HTMLButtonElement>('[data-ve-save]');
 let target:Target|null=null,id='',token:string|null=null,working=false,loading=false,dirty=false,epoch=0,controller:AbortController|null=null;
 function controls(){fields.disabled=working||loading||Boolean(target?.id&&token===null);submit.disabled=fields.disabled;q<HTMLButtonElement>('[data-ve-close]').disabled=working;q<HTMLButtonElement>('[data-ve-cancel]').disabled=working;form.setAttribute('aria-busy',String(working||loading));q('[data-ve-loading]').hidden=!loading;}
 function failure(e:unknown){error.textContent=e instanceof Error?e.message:'Не удалось сохранить запись.';error.hidden=false;if(e instanceof CommerceError&&(e.status===401||e.status===403)){lock();hooks.error(e);}}
 function field(label:string,name:string,value:string,wide=false,area=false,help='',max=200){const wrap=node('label','','dash-field'+(wide?' ve-wide':'')),input=area?node('textarea'):node('input');input.name=name;input.value=value;input.maxLength=max;if(input instanceof HTMLInputElement){input.type='text';if(name.startsWith('year'))input.inputMode='numeric';}wrap.append(node('span',label),input);if(help)wrap.append(node('small',help,'dash-help'));inputs.append(wrap);return input;}
 function render(data:VehicleData|VersionData,entry?:VehicleEntry){
  inputs.replaceChildren();q('[data-ve-usage]').textContent=entry?`Связано с карточками: ${entry.usage.products}; с сохранёнными черновиками: ${entry.usage.drafts}. Для другого автомобиля создайте новую запись.`:'Новая запись появится в общем списке после сохранения.';
  if(target?.kind==='vehicle'){
   const d=data as VehicleData,make=field('Марка','make',d.make,false,false,'Например, Лада или ВАЗ.',100),model=field('Модель','model',d.model,false,false,'Например, Приора или 2110.',100),generation=field('Поколение / кузов','generation',d.generation,true,false,'Неизвестно — оставьте пустым.',100),name=field('Название в списке','name',d.name,true,false,'Из марки, модели и поколения. Можно изменить вручную.');let manual=!!entry;
   name.addEventListener('input',()=>manual=!!name.value.trim());for(const el of [make,model,generation])el.addEventListener('input',()=>{if(!manual)name.value=vehicleName({make:make.value,model:model.value,generation:generation.value});});
   field('Год выпуска от','yearFrom',d.yearFrom,false,false,'Неизвестно — оставьте пустым.',4);field('Год выпуска до','yearTo',d.yearTo,false,false,'Неизвестно — оставьте пустым.',4);
   q('[data-ve-address]').textContent=entry?.slug?`Адрес /cars/${entry.slug} сохранится. Название изменится во всех связанных товарах.`:'Адрес страницы автомобиля будет создан автоматически.';
  }else{const d=data as VersionData;field('Название модификации','name',d.name,true,false,'Укажите только подтверждённое название.');field('Примечание','note',d.note,true,true,'Необязательно.',2000);q('[data-ve-address]').textContent=`Автомобиль: ${entry?.vehicleName||target?.vehicleName||''}. Перенос к другому автомобилю не выполняется.`;}
 }
 async function load(){if(!target?.id)return;const serial=epoch;controller?.abort();controller=new AbortController();loading=true;error.hidden=true;q('[data-ve-reload]').hidden=true;controls();
  try{const entry=await commerceGet<VehicleEntry>('/api/manager/vehicles?kind='+target.kind+'&id='+encodeURIComponent(target.id),{signal:controller.signal});if(serial!==epoch)return;token=entry.token;render(entry.data,entry);if(target.kind==='version')target.vehicleId=(entry.data as VersionData).vehicleId;}
  catch(e){if(serial!==epoch)return;failure(e);q('[data-ve-reload]').hidden=false;}
  finally{if(serial===epoch){loading=false;controls();submit.disabled=token===null;}}
 }
 function lock(){dirty=false;epoch++;controller?.abort();controller=null;target=null;working=false;loading=false;inputs.replaceChildren();error.hidden=true;q('[data-ve-usage]').textContent='';q('[data-ve-address]').textContent='';if(dialog.open)dialog.close();hooks.busy(false);}
 function close(){if(!working)dialog.close();}
 function open(next:Target){if(dialog.open)return;epoch++;dirty=false;target=next;id=next.id??crypto.randomUUID();token=null;error.hidden=true;q('[data-ve-reload]').hidden=true;
  q('[data-ve-title]').textContent=next.kind==='vehicle'?(next.id?'Изменить автомобиль':'Добавить автомобиль'):(next.id?'Изменить модификацию':'Добавить модификацию');submit.textContent=next.id?'Сохранить изменения':'Сохранить и выбрать';
  render(next.kind==='vehicle'?blankVehicle():{vehicleId:next.vehicleId??'',name:'',note:''});hooks.busy(true);dialog.showModal();q<HTMLButtonElement>('[data-ve-close]').focus();if(next.id)void load();else{loading=false;controls();inputs.querySelector<HTMLInputElement>('input')?.focus();}
 }
 form.addEventListener('input',()=>{dirty=true;error.hidden=true;});
 window.addEventListener('beforeunload',event=>{if(dialog.open&&(dirty||working)){event.preventDefault();}});
 form.addEventListener('submit',event=>{event.preventDefault();void(async()=>{if(!target||working||loading||target.id&&token===null)return;error.hidden=true;const serial=epoch,current=target,values=Object.fromEntries(new FormData(form));let data:VehicleData|VersionData;
  try{data=current.kind==='vehicle'?normalizeVehicle(values):normalizeVersion({...values,vehicleId:current.vehicleId??''});}catch(e){failure(e);return;}
  working=true;controls();try{const result=await commerceCommand<VehicleSaveResult>('/api/manager/vehicles',{action:'save',kind:current.kind,id,token,data});if(serial!==epoch)return;current.done(result);dialog.close();}
  catch(e){if(serial===epoch)failure(e);}finally{if(serial===epoch){working=false;controls();}}
 })();});
 q('[data-ve-close]').addEventListener('click',close);q('[data-ve-cancel]').addEventListener('click',close);q('[data-ve-reload]').addEventListener('click',()=>void load());
 dialog.addEventListener('cancel',e=>{if(working)e.preventDefault();});dialog.addEventListener('close',()=>{const previous=target;epoch++;controller?.abort();target=null;inputs.replaceChildren();working=loading=false;hooks.busy(false);previous?.focus();});
 return{open,lock};
}
