import type {VideoEmbed} from './content.ts';

export type ProductVideo=VideoEmbed&{sourceUrl:string};
export function productVideo(input:unknown):ProductVideo|null{
 if(typeof input!=='string'||input.length>2048||/[<>\\\u0000-\u0020]/.test(input.trim()))return null;
 let url:URL;try{url=new URL(input.trim());}catch{return null;}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash)return null;
 const host=url.hostname.replace(/^www\./,'');
 if(host==='rutube.ru'){
  const match=url.pathname.match(/^\/(?:video|shorts|play\/embed)\/([a-f0-9]{32})\/?$/i);if(!match)return null;
  // Private links require an access token; do not silently strip it and promise playback.
  if(url.searchParams.has('p'))return null;
  const id=match[1]!.toLowerCase(),watchUrl=`https://rutube.ru/video/${id}/`;
  return{provider:'RUTUBE',watchUrl,sourceUrl:watchUrl,embedUrl:`https://rutube.ru/play/embed/${id}?autoplay=false`};
 }
 if(!['vk.com','m.vk.com','vk.ru','vkvideo.ru'].includes(host))return null;
 const direct=url.pathname.match(/^\/video(-?[1-9]\d{0,19})_([1-9]\d{0,19})\/?$/);
 let oid=direct?.[1],id=direct?.[2],hash:string|null=null;
 if(!direct){
  if(url.pathname!=='/video_ext.php')return null;
  if(['oid','id','hash'].some(k=>url.searchParams.getAll(k).length>1))return null;
  oid=url.searchParams.get('oid')??undefined;id=url.searchParams.get('id')??undefined;hash=url.searchParams.get('hash');
 }
 if(!oid||!id||! /^-?[1-9]\d{0,19}$/.test(oid)||! /^[1-9]\d{0,19}$/.test(id)||(hash!==null&&!/^[A-Za-z0-9_-]{8,128}$/.test(hash)))return null;
 const embed=new URL('https://vkvideo.ru/video_ext.php');embed.searchParams.set('oid',oid);embed.searchParams.set('id',id);if(hash)embed.searchParams.set('hash',hash);embed.searchParams.set('autoplay','0');
 const watchUrl=`https://vkvideo.ru/video${oid}_${id}`;
 return{provider:'VK Видео',watchUrl,embedUrl:embed.href,sourceUrl:hash?embed.href:watchUrl};
}

export const productVideoHelp='Вставьте HTTPS-ссылку на ролик RUTUBE или VK Видео. Для VK также подходит ссылка плеера video_ext.php. Каналы, плейлисты и HTML-код не поддерживаются.';
