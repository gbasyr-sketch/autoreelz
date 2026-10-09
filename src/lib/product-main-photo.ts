import type {EditorData,EditorPhoto} from './product-editor.ts';

export type MainPhotoTarget='all'|{variantId:string};

function firstPhoto(photos:EditorPhoto[],photo:EditorPhoto,label:string){
 const selected=photos.find(p=>p.id===photo.id)??photo;
 const result=[selected,...photos.filter(p=>p.id!==photo.id)].map(p=>({...p}));
 if(result.length>12)throw Error(`В галерее «${label}» уже 12 фото. Уберите одно фото и повторите. Пока ничего не изменено.`);
 return result;
}

/** Plan every affected gallery before changing the form; never drop a photo to fit the limit. */
export function setProductMainPhoto(data:EditorData,photo:EditorPhoto,target:MainPhotoTarget){
 if(target==='all'){
  const common=firstPhoto(data.photos,photo,'Общие фотографии');
  const variants=data.variants.filter(v=>v.mediaMode==='replace').map(v=>({v,photos:firstPhoto(v.photos,photo,v.name||v.article||'Вариант')}));
  data.photos.splice(0,data.photos.length,...common);
  for(const {v,photos} of variants)v.photos.splice(0,v.photos.length,...photos);
  return;
 }
 const variant=data.variants.find(v=>v.id===target.variantId);
 if(!variant||data.kind==='bundle')throw Error('Вариант больше недоступен. Выберите его заново.');
 // When detaching inheritance, retain both visible common photos and any stored private photos.
 const source=variant.mediaMode==='inherit'?[...data.photos,...variant.photos.filter(p=>!data.photos.some(c=>c.id===p.id))]:variant.photos;
 const photos=firstPhoto(source,photo,variant.name||variant.article||'Вариант');
 variant.photos.splice(0,variant.photos.length,...photos);
 variant.mediaMode='replace';
}
