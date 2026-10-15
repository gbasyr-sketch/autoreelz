import type {CatalogSnapshot} from './catalog-types.ts';
import type {ContentSnapshot} from './content.ts';
export interface HomeReview {id:string;authorName:string;body:string;productName?:string;productSlug?:string;createdAt?:string;isDemo:boolean}
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
