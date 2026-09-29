import type {CatalogSnapshot} from './catalog-types.ts';
import type {ContentSnapshot} from './content.ts';
export interface HomeReview {id:string;authorName:string;body:string;productName?:string;productSlug?:string;createdAt?:string;isDemo:boolean}
/** Owner-requested fictional product examples, never reviews/purchases in the DB. */
export function demoProductReviews(catalog:CatalogSnapshot,mode:string):HomeReview[]{
 if(!['local-test','staging'].includes(mode))return[];
 const examples=[
  {category:'heaters',authorName:'Алексей',body:'Больше всего понравился вид блока вечером: подсветка добавляет салону аккуратный акцент. Перед установкой отдельно сверял разъём и исполнение своего автомобиля.'},
  {category:'consoles',authorName:'Руслан',body:'С новой консолью центральная часть салона выглядит собраннее. При примерке уделил внимание зазорам вокруг соседних деталей — хотелось, чтобы всё смотрелось аккуратно.'},
  {category:'vents',authorName:'Марина',body:'Воздуховоды заметно меняют впечатление от передней панели. Мне нравится их форма: небольшая деталь, а интерьер воспринимается по-другому.'},
  {category:'gear-knobs',authorName:'Дмитрий',body:'Ручка КПП стала небольшим, но заметным обновлением салона. Понравился внешний вид; цвет выбирал так, чтобы он сочетался с остальными деталями.'},
 ];
 return examples.flatMap((example,index)=>{const product=catalog.products.find(p=>!p.isDemo&&p.category===example.category&&catalog.offerFor(p));return product?[{id:`layout-product-${index}`,authorName:example.authorName,body:example.body,productName:product.name,productSlug:product.slug,isDemo:true}]:[];});
}
export function homeSelection(catalog:CatalogSnapshot,content:ContentSnapshot){
 const offers=catalog.products.flatMap(product=>{const offer=catalog.offerFor(product);return offer?[{product,offer}]:[];});
 const real=offers.filter(i=>!i.product.isDemo),candidates=real.length?real:offers;
 const featured:typeof offers=[];
 for(const item of candidates)if(!featured.some(i=>i.product.category===item.product.category)){featured.push(item);if(featured.length===8)break;}
 for(const item of candidates)if(featured.length<8&&!featured.includes(item))featured.push(item);
 const categoryCards=catalog.categories.filter(c=>candidates.some(i=>i.product.category===c.slug)).slice(0,6).map(category=>({category,item:candidates.find(i=>i.product.category===category.slug)!}));
 const realArticles=content.articles.filter(a=>!a.isDemo);
 return{featured,categoryCards,heroItem:candidates[0],articles:(realArticles.length?realArticles:content.articles).slice(0,6),about:content.pages.find(p=>p.slug==='about')};
}
