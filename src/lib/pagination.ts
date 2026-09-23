export const CATALOG_PAGE_SIZE=12;
export function paginate<T>(items:T[],raw:string|null,size=CATALOG_PAGE_SIZE){
 const valid=raw===null||/^[1-9]\d{0,5}$/.test(raw);
 const page=valid&&raw?Number(raw):1,totalPages=Math.max(1,Math.ceil(items.length/size));
 const invalid=!valid||page>totalPages;
 return{page,totalPages,total:items.length,invalid,items:invalid?[]:items.slice((page-1)*size,page*size)};
}
