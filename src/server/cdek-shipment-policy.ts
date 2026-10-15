import {appConfig,setting} from './config.ts';
import {StoreError,integer} from './errors.ts';
import {hash,canonical} from './security.ts';
import {rubles,sumRubles,multiplyRubles} from '../lib/money.ts';
import type {ShipmentInput,ShipmentMode} from '../lib/cdek-shipments.ts';
import type {OrderLineSnapshot,DeliveryInput} from '../lib/commerce-types.ts';
export function shipmentConfig(){
 const mode=setting('CDEK_SHIPMENTS_MODE','disabled') as ShipmentMode;
 if(!['disabled','test','live'].includes(mode))throw new StoreError('CDEK_SETUP','Неизвестный режим отправлений.',503);
 if(mode==='disabled')return null;
 if(mode==='live'&&(appConfig().mode!=='production'||setting('CDEK_SHIPMENTS_ALLOW_LIVE')!=='true'))throw new StoreError('CDEK_LIVE_DISABLED','Реальные отправления ещё не включены.',503);
 const clientId=setting(mode==='test'?'CDEK_TEST_CLIENT_ID':'CDEK_CLIENT_ID'),clientSecret=setting(mode==='test'?'CDEK_TEST_CLIENT_SECRET':'CDEK_CLIENT_SECRET'),fromPoint=(mode==='test'?setting('CDEK_TEST_FROM_PVZ'):'')||setting('CDEK_FROM_PVZ');
 if(!clientId||!clientSecret||!/^[-\w]{1,64}$/.test(fromPoint))throw new StoreError('CDEK_SETUP','Настройте отдельный доступ к отправлениям СДЭК и пункт отправления.',503);
 return{environment:mode,clientId,clientSecret,fromPoint,accountHash:hash(mode+':'+clientId)};
}
export type ShipmentConfig=NonNullable<ReturnType<typeof shipmentConfig>>;
export function requireShipmentConfig(){const c=shipmentConfig();if(!c)throw new StoreError('CDEK_DISABLED','Создание отправлений СДЭК пока отключено.',503);return c;}
export function canShip(row:Record<string,any>){
 if(row.status!=='paid'||row.payment_status!=='paid')throw new StoreError('CDEK_PAYMENT','Отправление доступно после подтверждённой оплаты.',409);
 if(['supplier_pending','supplier_paid'].includes(row.allocation_state))throw new StoreError('STOCK_REQUIRED','Сначала внесите приход и выделите весь состав заказа с нашего склада.',409);
 if(!['quoted','packing'].includes(row.delivery_status))throw new StoreError('CDEK_ALREADY_SENT','Заказ уже отмечен отправленным или полученным. Проверьте существующую накладную.',409);
 if(row.tracking_number)throw new StoreError('CDEK_EXISTING_TRACK','У заказа уже есть трек-номер. Проверьте его, прежде чем создавать новое отправление.',409);
}
export function shipmentPayload(row:Record<string,any>,raw:Record<string,unknown>,config:ShipmentConfig){
 canShip(row);
 const input:ShipmentInput={weightG:integer(raw.weightG,'Вес посылки',1,200000),lengthMm:integer(raw.lengthMm,'Длина',1,3000),widthMm:integer(raw.widthMm,'Ширина',1,3000),heightMm:integer(raw.heightMm,'Высота',1,3000),itemWeights:[]};
 const lines=row.items_snapshot as OrderLineSnapshot[],delivery=row.delivery_snapshot as DeliveryInput;
 if(!Array.isArray(lines)||!lines.length||lines.length>100||!Array.isArray(raw.itemWeights)||raw.itemWeights.length!==lines.length)throw new StoreError('CDEK_ITEMS','Укажите вес каждой позиции заказа.');
 input.itemWeights=raw.itemWeights.map(w=>integer(w,'Вес одной единицы товара',1,200000));
 if(lines.reduce((s,l,i)=>s+l.quantity*input.itemWeights[i]!,0)>input.weightG)throw new StoreError('CDEK_WEIGHT','Вес посылки меньше суммарного веса товаров.');
 if(delivery.provider!=='cdek'||!Number.isSafeInteger(delivery.cityCode)||delivery.cityCode!<=0)throw new StoreError('CDEK_ADDRESS','В заказе нет подтверждённого города СДЭК. Используйте ручное оформление и сохраните трек-номер.');
 if(delivery.method==='pickup_point'&&!/^[-\w]{1,64}$/.test(delivery.pointCode??''))throw new StoreError('CDEK_ADDRESS','В заказе не указан ПВЗ СДЭК.');
 if(delivery.method==='courier'&&(!delivery.address||delivery.address.length>300))throw new StoreError('CDEK_ADDRESS','В заказе не указан полный адрес доставки.');
 const items=lines.map((l,i)=>{
  const cost=rubles(l.unitPriceRubles);integer(l.quantity,'Количество',1,999);
  if(multiplyRubles(cost,l.quantity)!==rubles(l.lineTotalRubles))throw new StoreError('CDEK_AMOUNT','Сумма позиции заказа требует проверки.');
  return{name:[l.name,l.variantLabel].filter(Boolean).join(' · ').slice(0,200),ware_key:(l.article||l.skuId||l.productId).slice(0,100),payment:{value:'0.00'},cost,weight:input.itemWeights[i]!,amount:l.quantity};
 });
 const declaredValue=sumRubles(items.map(i=>multiplyRubles(i.cost,i.amount)));
 if(declaredValue!==rubles(row.product_total_rubles))throw new StoreError('CDEK_AMOUNT','Состав и сумма заказа не совпадают.');
 // Never disclose real customer contacts to CDEK's shared public test account.
 const recipient=config.environment==='test'?{name:'Тест интеграции AUTO REELZ',phones:[{number:'+70000000001'}]}:{name:row.customer_name,phones:[{number:row.customer_phone}]};
 const payload={type:1,number:'preview',tariff_code:delivery.method==='pickup_point'?136:137,shipment_point:config.fromPoint,
  ...(delivery.method==='pickup_point'?{delivery_point:delivery.pointCode}:{to_location:{code:delivery.cityCode,address:config.environment==='test'?'Тестовая улица, 1':delivery.address}}),
  recipient,delivery_recipient_cost:{value:'0.00'},packages:[{number:'1',weight:input.weightG,length:Math.ceil(input.lengthMm/10),width:Math.ceil(input.widthMm/10),height:Math.ceil(input.heightMm/10),items}]};
 const fingerprint=hash(canonical({orderId:row.id,shippingVersion:row.shipping_version,shippingCost:row.shipping_cost_rubles,payload,account:config.accountHash,input}));
 return{input,payload,fingerprint,declaredValue,destination:delivery.method==='pickup_point'?`${delivery.city} · ${delivery.pointCode} · ${delivery.address}`:`${delivery.city} · ${config.environment==='test'?'Тестовая улица, 1':delivery.address}`};
}
