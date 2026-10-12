import type {EditorFitment,EditorOptions} from './product-editor.ts';
export type VehicleKind='vehicle'|'version';
export type VehicleData={make:string;model:string;generation:string;name:string;yearFrom:string;yearTo:string};
export type VersionData={vehicleId:string;name:string;note:string};
export type VehicleEntry={kind:VehicleKind;id:string;token:string;data:VehicleData|VersionData;slug?:string;vehicleName?:string;usage:{products:number;drafts:number}};
export type VehicleSaveResult={kind:VehicleKind;id:string;created:boolean;vehicles:EditorOptions['vehicles']};
export const blankVehicle=():VehicleData=>({make:'',model:'',generation:'',name:'',yearFrom:'',yearTo:''});
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Не удалось прочитать данные автомобиля.');return v as Record<string,unknown>;}
function line(v:unknown,label:string,max:number,required=true){if(typeof v!=='string'||v.length>max||/[\u0000-\u001f\u007f]/.test(v))throw Error(`Проверьте поле «${label}».`);const s=v.trim().replace(/\s+/g,' ');if(required&&!s)throw Error(`Заполните поле «${label}».`);return s;}
export function vehicleName(data:Pick<VehicleData,'make'|'model'|'generation'>){return[data.make,data.model,data.generation].map(v=>v.trim()).filter(Boolean).join(' ');}
export function normalizeVehicle(value:unknown):VehicleData{
 const d=object(value),make=line(d.make,'Марка',100),model=line(d.model,'Модель',100),generation=line(d.generation,'Поколение',100,false),name=line(d.name,'Название в списке',200);
 const year=(v:unknown,label:string)=>{const s=line(v,label,4,false);if(s&&(!/^\d{4}$/.test(s)||Number(s)<1970||Number(s)>2100))throw Error(`«${label}»: укажите год от 1970 до 2100 или оставьте пустым.`);return s;};
 const yearFrom=year(d.yearFrom,'Год выпуска от'),yearTo=year(d.yearTo,'Год выпуска до');if(yearFrom&&yearTo&&Number(yearFrom)>Number(yearTo))throw Error('Конечный год не может быть раньше начального.');
 return{make,model,generation,name,yearFrom,yearTo};
}
export function normalizeVersion(value:unknown):VersionData{
 const d=object(value),vehicleId=line(d.vehicleId,'Автомобиль',36),name=line(d.name,'Название модификации',200);
 if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(vehicleId))throw Error('Выберите автомобиль для модификации.');
 if(typeof d.note!=='string'||d.note.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(d.note))throw Error('Примечание: не более 2000 символов.');
 return{vehicleId:vehicleId.toLowerCase(),name,note:d.note.replace(/\r\n?/g,'\n').trim()};
}
export function selectFitmentVehicle(row:EditorFitment,id:string){if(row.vehicleId!==id){row.vehicleId=id;row.versionId='';row.state='unknown';}}
export function selectFitmentVersion(row:EditorFitment,id:string){if(row.versionId!==id){row.versionId=id;row.state='unknown';}}
