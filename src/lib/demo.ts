import {rubles,sumRubles,multiplyRubles,discountRubles,type Rubles} from './money.ts';
export {formatRubles as money} from './money.ts';
/** Explicit fixtures for stage 2. These are not the owner's actual inventory. */
export type AttributeKey = 'illumination' | 'surface' | 'material';
export interface DemoVariant {
  id: string;
  article: string;
  label: string;
  priceRubles: Rubles;
  stock: number;
  attributes: Partial<Record<AttributeKey, string>>;
}
export interface DemoProduct {
  id: string;
  slug: string;
  name: string;
  category: string;
  kind: 'single' | 'bundle';
  description: string;
  image: string;
  variants: DemoVariant[];
  components?: { skuId: string; quantity: number }[];
  discountBps?: number;
}
export interface Category {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  icon: string;
  attributes: AttributeKey[];
}
export const demoNotice = 'Демонстрационный каталог. Цены, остатки и характеристики — примеры. Совместимость требует проверки по данным владельца.';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const categories: Category[] = [
  { id:id(1),slug:'heaters',name:'Блоки отопителя',shortName:'Блоки отопителя',icon:'panel',attributes:['illumination','surface','material'] },
  { id:id(2),slug:'consoles',name:'Автомобильные консоли',shortName:'Консоли',icon:'console',attributes:['surface','material'] },
  { id:id(3),slug:'radios',name:'Android-магнитолы',shortName:'Android-магнитолы',icon:'display',attributes:[] },
  { id:id(4),slug:'vents',name:'Воздуховоды AMG',shortName:'Воздуховоды AMG',icon:'vent',attributes:['illumination','surface'] },
  { id:id(5),slug:'bundles',name:'Готовые комплекты',shortName:'Комплекты',icon:'box',attributes:[] },
  { id:id(6),slug:'knobs',name:'Ручки КПП',shortName:'Ручки КПП',icon:'knob',attributes:['material','surface'] },
  { id:id(7),slug:'vent-adapters',name:'Панели для дефлекторов AMG',shortName:'Панели AMG',icon:'panel',attributes:['surface','material'] },
  { id:id(8),slug:'radio-frames',name:'Рамки под Android-магнитолы',shortName:'Рамки магнитол',icon:'display',attributes:['surface','material'] },
  { id:id(9),slug:'adapters',name:'Переходные панели',shortName:'Переходные панели',icon:'panel',attributes:['surface','material'] },
  { id:id(10),slug:'covers',name:'Чехлы на ручки КПП',shortName:'Чехлы КПП',icon:'knob',attributes:['material'] },
];
export const vehicles = [
  ['granta','Лада Гранта'],['kalina','Лада Калина'],['priora-1','Лада Приора 1'],['priora-2','Лада Приора 2'],
  ['vesta','Лада Веста'],['vaz-2110','ВАЗ-2110'],['vaz-2114','ВАЗ-2114'],['duster','Renault Duster'],
].map(([slug,name],i)=>({ id:id(50+i), slug:slug!, name:name! }));
export const attributeDefinitions: Record<AttributeKey, { label:string; values:{ value:string; label:string; color?:string }[] }> = {
  illumination: {label:'Подсветка',values:[{value:'red',label:'Красная',color:'#CB181A'},{value:'blue',label:'Синяя',color:'#315FA5'},{value:'white',label:'Белая',color:'#FFFFFF'},{value:'rgb',label:'RGB',color:'#93549B'}]},
  surface: {label:'Поверхность',values:[{value:'matte',label:'Матовая'},{value:'gloss',label:'Глянцевая'}]},
  material: {label:'Материал',values:[{value:'demo-plastic',label:'Пластик · пример'},{value:'demo-metal',label:'Металл · пример'}]},
};
const description = 'Здесь будет описание конкретного изделия: назначение, особенности установки и комплектация. Точные сведения добавим после получения товарных данных. Сейчас показан демонстрационный образец интерфейса.';
export const products: DemoProduct[] = [
  {id:id(100),slug:'heater-control',name:'Блок управления отопителем',category:'heaters',kind:'single',description,image:'/images/placeholder-console.svg',variants:[
    {id:id(1001),article:'DEMO-HEATER-R',label:'Красная подсветка',priceRubles:'4900.00',stock:7,attributes:{illumination:'red',surface:'matte',material:'demo-plastic'}},
    {id:id(1002),article:'DEMO-HEATER-B',label:'Синяя подсветка',priceRubles:'5100.00',stock:3,attributes:{illumination:'blue',surface:'matte',material:'demo-plastic'}},
    {id:id(1003),article:'DEMO-HEATER-W',label:'Белая подсветка',priceRubles:'5300.00',stock:0,attributes:{illumination:'white',surface:'gloss',material:'demo-plastic'}},
  ]},
  {id:id(101),slug:'interior-console',name:'Автомобильная консоль',category:'consoles',kind:'single',description,image:'/images/placeholder-interior.svg',variants:[
    {id:id(1011),article:'DEMO-CONSOLE-M',label:'Матовая поверхность',priceRubles:'6900.00',stock:4,attributes:{surface:'matte',material:'demo-plastic'}},
    {id:id(1012),article:'DEMO-CONSOLE-G',label:'Глянцевая поверхность',priceRubles:'7200.00',stock:0,attributes:{surface:'gloss',material:'demo-plastic'}},
  ]},
  {id:id(102),slug:'amg-vent',name:'Воздуховод AMG с подсветкой',category:'vents',kind:'single',description,image:'/images/placeholder-vent.svg',variants:[
    {id:id(1021),article:'DEMO-VENT-R',label:'Красная подсветка',priceRubles:'2400.00',stock:12,attributes:{illumination:'red',surface:'matte'}},
    {id:id(1022),article:'DEMO-VENT-RGB',label:'RGB-подсветка',priceRubles:'3200.00',stock:2,attributes:{illumination:'rgb',surface:'matte'}},
  ]},
  {id:id(103),slug:'android-radio',name:'Android-магнитола',category:'radios',kind:'single',description,image:'/images/placeholder-radio.svg',variants:[
    {id:id(1031),article:'DEMO-RADIO',label:'Базовое исполнение',priceRubles:'14900.00',stock:0,attributes:{}},
  ]},
  {id:id(104),slug:'gear-knob',name:'Ручка переключения передач',category:'knobs',kind:'single',description,image:'/images/placeholder-knob.svg',variants:[
    {id:id(1041),article:'DEMO-KNOB',label:'Матовое исполнение',priceRubles:'1800.00',stock:8,attributes:{surface:'matte',material:'demo-metal'}},
  ]},
  {id:id(105),slug:'radio-frame',name:'Рамка под Android-магнитолу',category:'radio-frames',kind:'single',description,image:'/images/placeholder-frame.svg',variants:[
    {id:id(1051),article:'DEMO-FRAME',label:'Матовая поверхность',priceRubles:'1500.00',stock:6,attributes:{surface:'matte',material:'demo-plastic'}},
  ]},
  {id:id(106),slug:'interior-kit',name:'Комплект для обновления интерьера',category:'bundles',kind:'bundle',description:'Пример фиксированного комплекта: блок отопителя с красной подсветкой, матовая консоль и два воздуховода с красной подсветкой. Состав и все данные демонстрационные. Реальную совместимость компонентов ещё нужно подтвердить.',image:'/images/placeholder-kit.svg',variants:[],components:[{skuId:id(1001),quantity:1},{skuId:id(1011),quantity:1},{skuId:id(1021),quantity:2}],discountBps:500},
  {id:id(107),slug:'multimedia-kit',name:'Комплект мультимедиа',category:'bundles',kind:'bundle',description:'Демонстрационный фиксированный комплект: Android-магнитола и рамка. Применимость не подтверждена. Отсутствие одного компонента переводит весь комплект в предзаказ.',image:'/images/placeholder-kit.svg',variants:[],components:[{skuId:id(1031),quantity:1},{skuId:id(1051),quantity:1}],discountBps:500},
];
export function findSku(skuId: string) {
  for (const product of products) {
    const variant = product.variants.find(v=>v.id===skuId);
    if (variant) return {product,variant};
  }
  return undefined;
}
export interface Offer {priceRubles:Rubles;available:number;variant?:DemoVariant}
export function offerFor(product:DemoProduct, skuId?:string|null):Offer|null {
  if (product.kind==='bundle') {
    if (skuId) return null;
    const required=new Map<string,number>();
    for(const c of product.components??[])required.set(c.skuId,(required.get(c.skuId)??0)+c.quantity);
    if(!required.size)return null;
    const totals:Rubles[]=[];let available=Infinity;
    try {
      for(const [skuId,quantity] of required){const found=findSku(skuId);if(!found)return null;totals.push(multiplyRubles(found.variant.priceRubles,quantity));available=Math.min(available,Math.floor(found.variant.stock/quantity));}
      return {priceRubles:discountRubles(sumRubles(totals),product.discountBps??0),available};
    } catch(error) {if(error instanceof RangeError)return null;throw error;}
  }
  const variant=skuId?product.variants.find(v=>v.id===skuId):product.variants[0];
  return variant?{variant,priceRubles:rubles(variant.priceRubles),available:variant.stock}:null;
}
export function attributeLabel(key:AttributeKey,value:string){return attributeDefinitions[key].values.find(v=>v.value===value)?.label??value;}
export function productHref(product:DemoProduct,variant?:DemoVariant){return `/product/${product.slug}${variant?`?sku=${variant.id}`:''}`;}
