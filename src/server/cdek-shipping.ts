import type{DeliveryInput,QuoteGroup,ShippingQuote}from'../lib/commerce-types.ts';
import{sumRubles}from'./pricing.ts';
import{StoreError}from'./errors.ts';
import{CdekError,type createCdekClient}from'./adapters/cdek.ts';
import{cdekClient,cdekConfig}from'./shipping-policy.ts';
import{pendingShipping}from'./adapters/shipping.ts';
type Client=ReturnType<typeof createCdekClient>;
export function createCdekShipping(makeClient:()=>Client=cdekClient){
 async function normalize(delivery:DeliveryInput):Promise<DeliveryInput>{
  if(delivery.manual)return{...delivery,provider:'manual'};
  try{
   const client=makeClient();const[city,point]=await Promise.all([client.getCity(delivery.cityCode!),delivery.method==='pickup_point'?client.getPoint(delivery.pointCode!):null]);
   if(!city)throw new StoreError('CDEK_CITY','Выберите населённый пункт из списка СДЭК.');
   if(delivery.method==='pickup_point'&&(!point||!point.handout||point.cityCode!==city.code))throw new StoreError('CDEK_POINT','Выберите действующий ПВЗ в выбранном городе.');
   return{method:delivery.method,city:city.name,cityCode:city.code,address:point?.address??delivery.address,provider:'cdek',...(point?{pointCode:point.code}:{})};
  }catch(e){if(e instanceof CdekError||e instanceof StoreError&&e.code==='SHIPPING_SETUP')return{...delivery,provider:'manual',manual:true};throw e;}
 }
 async function enrich(groups:QuoteGroup[],delivery:DeliveryInput):Promise<QuoteGroup[]>{
  return Promise.all(groups.map(async group=>{
   const pack=group.shipping.packageSnapshot;if(!pack||delivery.provider==='manual')return group;
   let shipping:ShippingQuote;
   try{
    const config=cdekConfig(),client=makeClient();
    const[origin,destination]=await Promise.all([client.getPoint(config.fromPoint,pack),delivery.method==='pickup_point'?client.getPoint(delivery.pointCode!,pack):null]);
    if(!origin?.reception||origin.cityCode!==config.fromCity)throw new CdekError('ORIGIN_PACKAGE');
    if(delivery.method==='pickup_point'&&(!destination?.handout||destination.cityCode!==delivery.cityCode))throw new CdekError('POINT_PACKAGE');
    const carrier=await client.quote({fromCity:config.fromCity,fromPoint:config.fromPoint,cityCode:delivery.cityCode!,pointCode:delivery.pointCode,address:delivery.address,method:delivery.method,pack});
    shipping={status:'quoted',costRubles:carrier.costRubles,label:'СДЭК — '+carrier.tariffName,reason:null,packageSnapshot:pack,provider:'cdek',carrier};
   }catch(e){if(!(e instanceof CdekError)&&!(e instanceof StoreError&&e.code==='SHIPPING_SETUP'))throw e;const reason=e instanceof CdekError&&['ORIGIN_PACKAGE','POINT_PACKAGE'].includes(e.code)?'Выбранный пункт не подтвердил приём этой упаковки. Стоимость и пункт уточнит менеджер.':'СДЭК не подтвердил тариф. Стоимость доставки уточнит менеджер до оплаты.';shipping={...pendingShipping(reason,pack),provider:'manual'};}
   return{...group,shipping,totalRubles:shipping.costRubles===null?null:sumRubles([group.productTotalRubles,shipping.costRubles])};
  }));
 }
 return{normalize,enrich};
}
export const cdekShipping=createCdekShipping();
