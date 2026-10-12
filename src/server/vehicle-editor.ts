import type {PoolClient} from 'pg';
import {transaction} from './db.ts';
import {hash,canonical,idempotent} from './security.ts';
import {StoreError,uuid} from './errors.ts';
import {productSlug,type EditorOptions} from '../lib/product-editor.ts';
import {normalizeVehicle,normalizeVersion,type VehicleKind,type VehicleEntry,type VehicleSaveResult,type VehicleData,type VersionData} from '../lib/vehicle-editor.ts';
type Row=Record<string,any>;
function kind(value:unknown):VehicleKind{if(value!=='vehicle'&&value!=='version')throw new StoreError('VEHICLE_INPUT','Выберите автомобиль или модификацию.');return value;}
const conflict=()=>new StoreError('VEHICLE_CONFLICT','Запись изменена в другой вкладке или CMS. Закройте окно и откройте её заново; введённые данные пока остаются здесь.',409);
export async function vehicleOptions(c:PoolClient):Promise<EditorOptions['vehicles']>{
 const cars=(await c.query('SELECT id,name FROM ar_vehicles ORDER BY name,id')).rows,versions=(await c.query('SELECT id,vehicle_id,name FROM ar_vehicle_versions ORDER BY name,id')).rows;
 return cars.map(v=>({id:v.id,name:v.name,versions:versions.filter(m=>m.vehicle_id===v.id).map(m=>({id:m.id,name:m.name}))}));
}
async function row(c:PoolClient,type:VehicleKind,id:string,lock=false):Promise<Row|undefined>{return (await c.query(`SELECT * FROM ${type==='vehicle'?'ar_vehicles':'ar_vehicle_versions'} WHERE id=$1${lock?' FOR UPDATE':''}`,[id])).rows[0];}
const token=(r:Row)=>hash(canonical(r));
async function usage(c:PoolClient,type:VehicleKind,id:string){
 const column=type==='vehicle'?'vehicle_id':'version_id',field=type==='vehicle'?'vehicleId':'versionId';
 const products=Number((await c.query(`SELECT count(DISTINCT product_id)::int n FROM ar_fitment WHERE ${column}=$1`,[id])).rows[0].n);
 const drafts=Number((await c.query(`SELECT count(*)::int n FROM ar_product_editor_drafts d WHERE d.payload IS NOT NULL AND (EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(d.payload->'fitment','[]'::jsonb)) f WHERE f->>$2=$1) OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(d.payload->'variants','[]'::jsonb)) v CROSS JOIN LATERAL jsonb_array_elements(coalesce(v->'fitment','[]'::jsonb)) f WHERE f->>$2=$1))`,[id,field])).rows[0].n);
 return{products,drafts};
}
export async function readVehicleEntry(typeInput:unknown,idInput:unknown):Promise<VehicleEntry>{
 const type=kind(typeInput),id=uuid(idInput);return transaction(async c=>{const current=await row(c,type,id);if(!current)throw new StoreError('VEHICLE_MISSING','Запись не найдена. Обновите список автомобилей.',404);
  return{kind:type,id,token:token(current),data:type==='vehicle'?{make:current.make,model:current.model,generation:current.generation,name:current.name,yearFrom:String(current.year_from??''),yearTo:String(current.year_to??'')}:{vehicleId:current.vehicle_id,name:current.name,note:current.note??''},...(type==='vehicle'?{slug:current.slug}:{vehicleName:(await c.query('SELECT name FROM ar_vehicles WHERE id=$1',[current.vehicle_id])).rows[0]?.name}),usage:await usage(c,type,id)};
 });
}
export async function saveVehicleEntry(actor:{id:string},body:Record<string,unknown>):Promise<VehicleSaveResult>{
 if(body.action!=='save')throw new StoreError('VEHICLE_ACTION','Поддерживается только сохранение автомобиля или модификации.');
 const type=kind(body.kind),id=uuid(body.id),expected=body.token;if(expected!==null&&(typeof expected!=='string'||! /^[a-f0-9]{64}$/.test(expected)))throw new StoreError('VEHICLE_INPUT','Обновите запись перед сохранением.');
 let data:VehicleData|VersionData;try{data=type==='vehicle'?normalizeVehicle(body.data):normalizeVersion(body.data);}catch(e){throw new StoreError('VEHICLE_FIELDS',e instanceof Error?e.message:'Проверьте данные автомобиля.');}
 try{return await transaction(c=>idempotent(c,`vehicle-editor:${actor.id}`,body.idempotencyKey,{type,id,expected,data},async()=>{
  // Serialize dictionary writers, including Directus, for duplicate and stale-edit checks.
  await c.query('LOCK TABLE ar_vehicles,ar_vehicle_versions IN SHARE ROW EXCLUSIVE MODE');
  const current=await row(c,type,id,true);if(current?expected!==token(current):expected!==null)throw conflict();
  const duplicate=await c.query(`SELECT 1 FROM ${type==='vehicle'?'ar_vehicles':'ar_vehicle_versions'} WHERE id<>$1 AND lower(regexp_replace(btrim(name),'[[:space:]]+',' ','g'))=lower($2)${type==='version'?' AND vehicle_id=$3':''} LIMIT 1`,type==='vehicle'?[id,data.name]:[id,data.name,(data as VersionData).vehicleId]);
  if(duplicate.rowCount)throw new StoreError('VEHICLE_DUPLICATE',type==='vehicle'?'Автомобиль с таким названием уже есть. Выберите его в списке или уточните поколение.':'Такая модификация уже есть у этого автомобиля.',409);
  if(type==='vehicle'){
   const d=data as VehicleData,values=[id,d.make,d.model,d.generation,d.name,d.yearFrom?Number(d.yearFrom):null,d.yearTo?Number(d.yearTo):null];
   if(current)await c.query('UPDATE ar_vehicles SET make=$2,model=$3,generation=$4,name=$5,year_from=$6,year_to=$7 WHERE id=$1',values);
   else{let slug=productSlug(d.name)||'car';if((await c.query('SELECT 1 FROM ar_vehicles WHERE slug=$1',[slug])).rowCount)slug+='-'+id.slice(0,8);await c.query('INSERT INTO ar_vehicles(id,make,model,generation,name,year_from,year_to,slug) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[...values,slug]);}
  }else{
   const d=data as VersionData;if(current&&current.vehicle_id!==d.vehicleId)throw new StoreError('VEHICLE_PARENT','Нельзя перенести модификацию к другому автомобилю. Создайте новую запись.');
   if(!(await c.query('SELECT id FROM ar_vehicles WHERE id=$1 FOR KEY SHARE',[d.vehicleId])).rowCount)throw new StoreError('VEHICLE_MISSING','Автомобиль не найден. Обновите список.',404);
   if(current)await c.query('UPDATE ar_vehicle_versions SET name=$2,note=$3 WHERE id=$1',[id,d.name,d.note||null]);else await c.query('INSERT INTO ar_vehicle_versions(id,vehicle_id,name,note) VALUES($1,$2,$3,$4)',[id,d.vehicleId,d.name,d.note||null]);
  }
  const after=await row(c,type,id);await c.query('INSERT INTO ar_vehicle_editor_events(kind,entity_id,actor_id,action,before_data,after_data) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)',[type,id,actor.id,current?'update':'create',current?JSON.stringify(current):null,JSON.stringify(after)]);
  return{kind:type,id,created:!current,vehicles:await vehicleOptions(c)};
 }),false);}catch(e){if(e instanceof StoreError)throw e;if(['23505','23503','23514'].includes((e as{code?:string}).code??''))throw new StoreError('VEHICLE_RULE','Не удалось сохранить запись. Проверьте название, годы и автомобиль.',409);throw e;}
}
