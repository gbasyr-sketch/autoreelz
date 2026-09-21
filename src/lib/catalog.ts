import {products,categories,vehicles,attributeDefinitions,offerFor,type DemoProduct,type Offer,type AttributeKey} from './demo.ts';

export interface CatalogItem {product:DemoProduct;offer:Offer}
export interface ActiveFilter {key:string;label:string}
export function catalogUrl(params:URLSearchParams,changes:Record<string,string|null>={}){
  const next=new URLSearchParams(params);
  for(const[k,v]of Object.entries(changes)){if(v===null||v==='')next.delete(k);else next.set(k,v);}
  const query=next.toString();return `/catalog${query?`?${query}`:''}`;
}
export function queryCatalog(params:URLSearchParams){
  const categorySlug=params.get('category')??'';
  const category=categories.find(c=>c.slug===categorySlug);
  const query=(params.get('q')??'').trim().slice(0,100);
  const selectedVehicle=vehicles.find(v=>v.slug===params.get('vehicle'));
  const attributeKeys:AttributeKey[]=category?category.attributes:['illumination','surface','material'];
  const activeFilters:ActiveFilter[]=[];
  let error='';
  if(categorySlug&&!category)error='Такой категории нет. Выберите раздел из списка.';
  if(params.has('vehicle')&&params.get('vehicle')&&!selectedVehicle)error='Выберите автомобиль из списка.';
  const price=(name:string)=>{
    const raw=params.get(name);if(!raw)return undefined;
    if(!/^\d{1,7}(?:[.,]\d{1,2})?$/.test(raw)){error='Укажите цену числом от 0 до 9 999 999 ₽, не более двух знаков после запятой.';return undefined;}
    return Math.round(Number(raw.replace(',','.'))*100);
  };
  const min=price('min'),max=price('max');
  if(min!==undefined&&max!==undefined&&min>max)error='Минимальная цена не может быть больше максимальной.';
  const availability=params.get('availability')??'';
  if(availability&&!['in-stock','preorder'].includes(availability))error='Выберите корректное наличие.';
  const year=params.get('year')??'';
  if(year&&(!/^\d{4}$/.test(year)||Number(year)<1970||Number(year)>2026))error='Укажите год выпуска от 1970 до 2026.';
  const ac=params.get('ac')??'';
  if(ac&&!['yes','no','unknown'].includes(ac))error='Выберите наличие кондиционера из списка.';
  if((year||ac)&&!selectedVehicle)error='Сначала выберите модель автомобиля.';
  if(query)activeFilters.push({key:'q',label:`Поиск: ${query}`});
  if(category)activeFilters.push({key:'category',label:category.name});
  if(min!==undefined)activeFilters.push({key:'min',label:`От ${min/100} ₽`});
  if(max!==undefined)activeFilters.push({key:'max',label:`До ${max/100} ₽`});
  if(availability)activeFilters.push({key:'availability',label:availability==='in-stock'?'В наличии':'Предзаказ'});
  if(selectedVehicle)activeFilters.push({key:'vehicle',label:selectedVehicle.name});
  if(year)activeFilters.push({key:'year',label:`Год: ${year}`});
  if(ac)activeFilters.push({key:'ac',label:`Кондиционер: ${ac==='yes'?'есть':ac==='no'?'нет':'неизвестно'}`});
  for(const key of attributeKeys){
    const raw=params.get(key);if(!raw)continue;
    const option=attributeDefinitions[key].values.find(v=>v.value===raw);
    if(!option)error=`Выберите корректное значение «${attributeDefinitions[key].label}».`;
    else activeFilters.push({key,label:`${attributeDefinitions[key].label}: ${option.label}`});
  }
  const matches=(offer:Offer)=>{
    if(min!==undefined&&offer.priceKopecks<min)return false;
    if(max!==undefined&&offer.priceKopecks>max)return false;
    if(availability==='in-stock'&&offer.available===0)return false;
    if(availability==='preorder'&&offer.available>0)return false;
    return attributeKeys.every(key=>!params.get(key)||offer.variant?.attributes[key]===params.get(key));
  };
  const items:CatalogItem[]=[];
  for(const product of products){
    if(category&&product.category!==category.slug)continue;
    const term=query.toLocaleLowerCase('ru');
    const productText=[product.name,categories.find(c=>c.slug===product.category)?.name].join(' ').toLocaleLowerCase('ru');
    const matchesProduct=!term||productText.includes(term);
    // An article/variant-only match must stay on that SKU through every filter.
    const matchingVariants=product.variants.filter(v=>matchesProduct||`${v.article} ${v.label}`.toLocaleLowerCase('ru').includes(term));
    if(!matchesProduct&&!matchingVariants.length)continue;
    const offers=product.kind==='bundle'?[offerFor(product)]:matchingVariants.map(v=>offerFor(product,v.id));
    const matching=offers.filter((o):o is Offer=>o!==null&&matches(o)).sort((a,b)=>a.priceKopecks-b.priceKopecks);
    if(matching[0])items.push({product,offer:matching[0]});
  }
  const sort=params.get('sort')??'default';
  if(sort==='price-asc')items.sort((a,b)=>a.offer.priceKopecks-b.offer.priceKopecks);
  if(sort==='price-desc')items.sort((a,b)=>b.offer.priceKopecks-a.offer.priceKopecks);
  if(sort==='name')items.sort((a,b)=>a.product.name.localeCompare(b.product.name,'ru'));
  const unknownFitment=Boolean(selectedVehicle);
  const includeUnknown=params.get('include_unknown')==='1';
  return {items:error||(unknownFitment&&!includeUnknown)?[]:items,category,query,attributeKeys,activeFilters,error,unknownFitment,includeUnknown,selectedVehicle,sort};
}
