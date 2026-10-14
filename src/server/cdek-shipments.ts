import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {query,transaction} from './db.ts';
import {orderRow,event} from './orders.ts';
import {StoreError,uuid,text,iso} from './errors.ts';
import {idempotent,sign,equal} from './security.ts';
import {shipmentConfig,requireShipmentConfig,shipmentPayload,type ShipmentConfig} from './cdek-shipment-policy.ts';
import {createCdekClient} from './adapters/cdek.ts';
import {createCdekOrdersClient,cdekErrorMessage} from './adapters/cdek-orders.ts';
import type {ShipmentPreview,ShipmentWorkspace,ShipmentSummary} from '../lib/cdek-shipments.ts';

export async function shipmentHistory(c:PoolClient,id:string,key:string,kind:string,detail:Record<string,unknown>){await c.query('INSERT INTO ar_cdek_history(shipment_id,deduplication_key,kind,detail) VALUES($1,$2,$3,$4) ON CONFLICT(deduplication_key) DO NOTHING',[id,key,kind,detail]);}
export async function shipmentWorkspace(id:string):Promise<ShipmentWorkspace>{
 id=uuid(id);let config:ShipmentConfig|null=null,reason:string|null=null;
 try{config=shipmentConfig();if(!config)reason='Отправления СДЭК пока отключены. Ручное управление доставкой доступно ниже.';}catch(e){reason=e instanceof StoreError?e.message:'Подключение СДЭК требует проверки.';}
 return transaction(async c=>{
  const order=await orderRow(c,id);const shipments:ShipmentSummary[]=[];
  if((await c.query("SELECT to_regclass('public.ar_cdek_shipments') AS table_name")).rows[0].table_name){const rows=(await c.query('SELECT * FROM ar_cdek_shipments WHERE order_id=$1 ORDER BY created_at DESC LIMIT 20',[id])).rows;
   for(const s of rows){const print=(await c.query('SELECT id,state,last_error,expires_at FROM ar_cdek_prints WHERE shipment_id=$1 ORDER BY created_at DESC LIMIT 1',[s.id])).rows[0];
    const history=(await c.query('SELECT kind,detail,created_at FROM ar_cdek_history WHERE shipment_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50',[s.id])).rows;
    const same=config?.accountHash===s.account_hash&&config?.environment===s.environment;
    shipments.push({id:s.id,state:s.state,environment:s.environment,number:s.number,trackingNumber:s.tracking_number,carrierCode:s.carrier_code,error:s.last_error,updatedAt:iso(s.updated_at)!,canCancel:same&&s.state==='ready'&&s.carrier_code==='CREATED',canPrint:same&&s.state==='ready'&&Boolean(s.provider_uuid),print:print?{id:print.id,state:print.state==='ready'&&new Date(print.expires_at).getTime()<Date.now()?'expired':print.state,error:print.last_error}:null,history:history.map(h=>({kind:h.kind,at:iso(h.created_at)!,message:typeof h.detail.message==='string'?h.detail.message:''}))});
   }
  }
  return{mode:config?.environment??'disabled',enabled:!!config,reason,orderId:id,package:order.shipping_package??null,shipments};
 },false);
}
export async function previewShipment(body:Record<string,unknown>,directoryOverride?:ReturnType<typeof createCdekClient>):Promise<ShipmentPreview>{
 const config=requireShipmentConfig(),id=uuid(body.orderId);
 const prepared=await transaction(async c=>shipmentPayload(await orderRow(c,id),body,config),false);
 const directory=directoryOverride??createCdekClient(config),pack={id:'shipment',name:'Посылка',...prepared.input};
 try{
  const origin=await directory.getPoint(config.fromPoint,pack);if(!origin?.reception)throw new StoreError('CDEK_ORIGIN','Пункт отправления не принимает эту посылку.');
  if('delivery_point' in prepared.payload&&prepared.payload.delivery_point){const point=await directory.getPoint(prepared.payload.delivery_point,pack);const order=await transaction(c=>orderRow(c,id),false);if(!point?.handout||point.cityCode!==order.delivery_snapshot.cityCode)throw new StoreError('CDEK_POINT','ПВЗ не подходит для этой посылки. Проверьте доставку заказа.');}
 }catch(e){if(e instanceof StoreError)throw e;throw new StoreError('CDEK_CHECK',cdekErrorMessage(e),503);}
 const expires=Date.now()+300000,token=expires+'.'+sign(`cdek-preview:${expires}:${prepared.fingerprint}`);
 return{token,expiresAt:new Date(expires).toISOString(),environment:config.environment,recipient:prepared.payload.recipient.name,phone:prepared.payload.recipient.phones[0]!.number,destination:prepared.destination,origin:config.fromPoint,tariff:prepared.payload.tariff_code,parcel:prepared.input,items:prepared.payload.packages[0]!.items.map(i=>({name:i.name,quantity:i.amount,unitPrice:i.cost,weightG:i.weight})),declaredValue:prepared.declaredValue,collectionAmount:'0.00'};
}
export async function queueShipment(actor:{id:string},body:Record<string,unknown>){
 const config=requireShipmentConfig(),id=uuid(body.orderId);
 return transaction(c=>idempotent(c,'cdek-create:'+actor.id,body.idempotencyKey,body,async()=>{
  const row=await orderRow(c,id,undefined,true),p=shipmentPayload(row,body,config);
  const [expires,signature]=String(body.previewToken??'').split('.');
  if(!expires||!signature||!/^\d{13}$/.test(expires)||Number(expires)<Date.now()||Number(expires)>Date.now()+300000||!equal(signature,sign(`cdek-preview:${expires}:${p.fingerprint}`)))throw new StoreError('CDEK_PREVIEW','Проверьте посылку ещё раз: подтверждение устарело или данные изменились.',409);
  const active=(await c.query("SELECT id,fingerprint FROM ar_cdek_shipments WHERE order_id=$1 AND state NOT IN ('rejected','cancelled')",[id])).rows[0];
  if(active){if(active.fingerprint===p.fingerprint)return{id:active.id};throw new StoreError('CDEK_ACTIVE','Для этого заказа уже создаётся или существует отправление.',409);}
  if(Number((await c.query('SELECT count(*) n FROM ar_cdek_shipments WHERE order_id=$1',[id])).rows[0].n)>=20)throw new StoreError('CDEK_LIMIT','Для заказа уже сохранено 20 попыток. Проверьте историю.',409);
  const shipmentId=randomUUID(),number='AR-'+shipmentId.replaceAll('-','');
  await c.query('INSERT INTO ar_cdek_shipments(id,order_id,environment,account_hash,number,payload,fingerprint,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[shipmentId,id,config.environment,config.accountHash,number,{...p.payload,number},p.fingerprint,actor.id]);
  await shipmentHistory(c,shipmentId,'queued:'+shipmentId,'queued',{message:'Создание отправления поставлено в очередь.',actorId:actor.id});
  await event(c,id,'cdek_queued',config.environment==='test'?'Тестовое отправление СДЭК поставлено в очередь.':'Отправление СДЭК поставлено в очередь.',actor.id);
  return{id:shipmentId};
 }),false);
}
async function ownedShipment(c:PoolClient,id:string,config:ShipmentConfig){const s=(await c.query('SELECT * FROM ar_cdek_shipments WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!s)throw new StoreError('CDEK_NOT_FOUND','Отправление не найдено.',404);if(s.environment!==config.environment||s.account_hash!==config.accountHash)throw new StoreError('CDEK_ACCOUNT','Отправление относится к другому подключению СДЭК.',409);return s;}
export async function shipmentCommand(actor:{id:string},body:Record<string,unknown>){
 const config=requireShipmentConfig(),id=uuid(body.shipmentId),action=String(body.action);
 if(!['cancel','refresh','print'].includes(action))throw new StoreError('CDEK_ACTION','Неизвестное действие.');
 return transaction(c=>idempotent(c,'cdek-'+action+':'+actor.id,body.idempotencyKey,body,async()=>{
  const s=await ownedShipment(c,id,config);
  if(action==='cancel'){
   const reason=text(body.reason,'Причина отмены',3,500);
   if(s.lease_until&&new Date(s.lease_until).getTime()>Date.now())throw new StoreError('CDEK_BUSY','Сейчас проверяется статус СДЭК. Повторите отмену после обновления.',409);
   if(s.state!=='ready'||s.carrier_code!=='CREATED')throw new StoreError('CDEK_CANCEL','Отмена доступна только до передачи посылки СДЭК. Обновите статус.',409);
   await c.query("UPDATE ar_cdek_shipments SET state='cancel_queued',next_check_at=now(),updated_at=now() WHERE id=$1",[id]);
   await shipmentHistory(c,id,'cancel:'+body.idempotencyKey,'cancel',{message:'Запрошена отмена отправления: '+reason,actorId:actor.id});
  }else if(action==='print'){
   if(s.state!=='ready'||!s.provider_uuid)throw new StoreError('CDEK_PRINT','Дождитесь регистрации накладной в СДЭК.',409);
   await c.query("UPDATE ar_cdek_prints SET state='expired' WHERE shipment_id=$1 AND state='ready' AND expires_at<now()",[id]);
   if(body.retryUncertain===true)await c.query("UPDATE ar_cdek_prints SET state='failed',last_error='По решению менеджера запрошен новый PDF; накладная не создаётся повторно.' WHERE shipment_id=$1 AND state='uncertain'",[id]);
   const old=(await c.query("SELECT id FROM ar_cdek_prints WHERE shipment_id=$1 AND state NOT IN ('failed','expired')",[id])).rows[0];
   if(!old){await c.query('INSERT INTO ar_cdek_prints(shipment_id) VALUES($1)',[id]);await shipmentHistory(c,id,'print:'+body.idempotencyKey,'print',{message:'Запрошена накладная PDF.',actorId:actor.id});}
  }else{
   await c.query("UPDATE ar_cdek_shipments SET next_check_at=LEAST(next_check_at,GREATEST(now(),updated_at+interval '30 seconds')) WHERE id=$1 AND state NOT IN ('cancelled','rejected')",[id]);
   await c.query("UPDATE ar_cdek_prints SET next_check_at=LEAST(next_check_at,GREATEST(now(),updated_at+interval '30 seconds')) WHERE shipment_id=$1 AND state='pending'",[id]);
  }return{id};
 }),false);
}
export async function shipmentPdf(printId:string){
 const config=requireShipmentConfig();const p=(await query('SELECT p.*,s.account_hash,s.environment FROM ar_cdek_prints p JOIN ar_cdek_shipments s ON s.id=p.shipment_id WHERE p.id=$1',[uuid(printId)])).rows[0];
 if(!p||p.state!=='ready'||!p.provider_uuid||new Date(p.expires_at).getTime()<Date.now()||p.account_hash!==config.accountHash||p.environment!==config.environment)throw new StoreError('CDEK_PDF','Ссылка на накладную устарела или файл ещё не готов. Сформируйте накладную снова.',409);
 try{return await createCdekOrdersClient(config).pdf(p.provider_uuid);}catch(e){throw new StoreError('CDEK_PDF',cdekErrorMessage(e),503);}
}
