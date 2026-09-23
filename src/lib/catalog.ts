import {rubles,compareRubles,formatRubles} from './money.ts';
import {type CatalogSnapshot,type CatalogProduct,type Offer,type FitmentState} from './catalog-types.ts';
import {attributeParam,attributeValue} from './format.ts';
export interface CatalogItem {product:CatalogProduct;offer:Offer;fitment?:FitmentState}
export interface ActiveFilter {key:string;label:string}
export function catalogUrl(params:URLSearchParams,changes:Record<string,string|null>={}){
 const next=new URLSearchParams(params);if(Object.keys(changes).some(key=>key!=='page'))next.delete('page');for(const[k,v]of Object.entries(changes)){if(v===null||v==='')next.delete(k);else next.set(k,v);}const query=next.toString();return `/catalog${query?`?${query}`:''}`;
}
export function queryCatalog(params:URLSearchParams,catalog:CatalogSnapshot){
 const{products,categories,vehicles,attributeDefinitions,offerFor}=catalog;
 const categorySlug=params.get('category')??'';
 const category=categories.find(c=>c.slug===categorySlug);
 const categorySlugs=categories.filter(c=>!category||c.slug===category.slug||c.ancestorSlugs.includes(category.slug)).map(c=>c.slug);
 const query=(params.get('q')??'').trim().slice(0,100);
 const selectedVehicle=vehicles.find(v=>v.slug===params.get('vehicle'));
 const selectedVersion=selectedVehicle?.versions.find(v=>v.id===params.get('version'));
 const attributeKeys=[...new Set(categories.filter(c=>categorySlugs.includes(c.slug)).flatMap(c=>c.attributes))];
 const activeFilters:ActiveFilter[]=[];let error='';
 if(categorySlug&&!category)error='Такой категории нет. Выберите раздел из списка.';
 if(params.get('vehicle')&&!selectedVehicle)error='Выберите автомобиль из списка.';
 if(params.get('version')&&!selectedVersion)error='Выберите модификацию выбранного автомобиля.';
 const price=(name:string)=>{const raw=params.get(name);if(!raw)return undefined;if(!/^\d{1,7}(?:[.,]\d{1,2})?$/.test(raw)){error='Укажите цену числом от 0 до 9 999 999 ₽, не более двух знаков после запятой.';return undefined;}return rubles(raw.replace(',','.'));};
 const min=price('min'),max=price('max');
 if(min!==undefined&&max!==undefined&&compareRubles(min,max)>0)error='Минимальная цена не может быть больше максимальной.';
 const availability=params.get('availability')??'';
 if(availability&&!['in-stock','preorder'].includes(availability))error='Выберите корректное наличие.';
 const year=params.get('year')??'';const currentYear=new Date().getFullYear();
 if(year&&(!/^\d{4}$/.test(year)||Number(year)<1970||Number(year)>currentYear))error=`Укажите год выпуска от 1970 до ${currentYear}.`;
 const ac=params.get('ac')??'';
 if(ac&&!['yes','no','unknown'].includes(ac))error='Выберите наличие кондиционера из списка.';
 if((year||ac||params.get('version'))&&!selectedVehicle)error='Сначала выберите модель автомобиля.';
 if(selectedVehicle&&year&&((selectedVehicle.yearFrom!==null&&Number(year)<selectedVehicle.yearFrom)||(selectedVehicle.yearTo!==null&&Number(year)>selectedVehicle.yearTo)))error='Год выпуска не входит в диапазон выбранного автомобиля.';
 if(query)activeFilters.push({key:'q',label:`Поиск: ${query}`});if(category)activeFilters.push({key:'category',label:category.name});
 if(min!==undefined)activeFilters.push({key:'min',label:`От ${formatRubles(min)}`});if(max!==undefined)activeFilters.push({key:'max',label:`До ${formatRubles(max)}`});
 if(availability)activeFilters.push({key:'availability',label:availability==='in-stock'?'В наличии':'Предзаказ'});
 if(selectedVehicle)activeFilters.push({key:'vehicle',label:selectedVehicle.name});if(selectedVersion)activeFilters.push({key:'version',label:selectedVersion.name});
 if(year)activeFilters.push({key:'year',label:`Год: ${year}`});if(ac)activeFilters.push({key:'ac',label:`Кондиционер: ${ac==='yes'?'есть':ac==='no'?'нет':'неизвестно'}`});
 const values=new Map<string,string>();
 for(const key of attributeKeys){
  const raw=attributeValue(params,key);if(!raw)continue;const def=attributeDefinitions[key]!;
  if((def.type==='select'&&!def.values.some(v=>v.value===raw))||(def.type==='boolean'&&!['true','false'].includes(raw))||(def.type==='number'&&!/^-?\d+(?:[.,]\d+)?$/.test(raw))||raw.length>200)error=`Выберите корректное значение «${def.label}».`;
  else{values.set(key,def.type==='number'?String(Number(raw.replace(',','.'))):raw);activeFilters.push({key:attributeParam(key),label:`${def.label}: ${catalog.attributeLabel(key,raw)}`});}
 }
 const matches=(product:CatalogProduct,offer:Offer)=>{
  if(min!==undefined&&compareRubles(offer.priceRubles,min)<0)return false;if(max!==undefined&&compareRubles(offer.priceRubles,max)>0)return false;
  if(availability==='in-stock'&&offer.available===0)return false;if(availability==='preorder'&&offer.available>0)return false;
  const attrs=offer.variant?.attributes??product.attributes;
  return [...values].every(([key,value])=>attributeDefinitions[key]?.type==='number'?attrs[key]!==undefined&&Number(attrs[key])===Number(value):attrs[key]?.toLocaleLowerCase('ru')===value.toLocaleLowerCase('ru'));
 };
 const items:CatalogItem[]=[];let unknownFitment=false;
 const includeUnknown=params.get('include_unknown')==='1';
 for(const product of products){
  if(category&&!product.categorySlugs.some(slug=>categorySlugs.includes(slug)))continue;
  const term=query.toLocaleLowerCase('ru');const productText=[product.name,...product.categorySlugs.map(slug=>categories.find(c=>c.slug===slug)?.name)].join(' ').toLocaleLowerCase('ru');
  const matchesProduct=!term||productText.includes(term);
  const variants=product.variants.filter(v=>matchesProduct||`${v.article} ${v.label}`.toLocaleLowerCase('ru').includes(term));
  if(!matchesProduct&&!variants.length)continue;
  const offers=(product.kind==='bundle'?[offerFor(product)]:variants.map(v=>offerFor(product,v.id))).filter((o):o is Offer=>o!==null&&matches(product,o));
  const selection=selectedVehicle?{vehicleId:selectedVehicle.id,versionId:selectedVersion?.id,year:year?Number(year):undefined,ac}:undefined;
  const matching=offers.flatMap(offer=>{const fitment=selection?catalog.fitmentFor(product,offer,selection):undefined;if(fitment==='unknown')unknownFitment=true;if(fitment==='incompatible'||(fitment==='unknown'&&!includeUnknown))return[];return[{product,offer,fitment}];}).sort((a,b)=>compareRubles(a.offer.priceRubles,b.offer.priceRubles));
  if(matching[0])items.push(matching[0]);
 }
 const sort=params.get('sort')??'default';if(!['default','price-asc','price-desc','name'].includes(sort))error='Выберите сортировку из списка.';
 if(sort==='price-asc')items.sort((a,b)=>compareRubles(a.offer.priceRubles,b.offer.priceRubles));if(sort==='price-desc')items.sort((a,b)=>compareRubles(b.offer.priceRubles,a.offer.priceRubles));if(sort==='name')items.sort((a,b)=>a.product.name.localeCompare(b.product.name,'ru'));
 return{items:error?[]:items,category,query,attributeKeys,activeFilters,error,unknownFitment,includeUnknown,selectedVehicle,selectedVersion,sort};
}
