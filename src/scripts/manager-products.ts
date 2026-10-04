import {productTrash} from './product-trash';
import {managerPage,node,link} from './manager-page';
import {productLifecycle} from './product-lifecycle';
import type {DashboardQuality} from '../lib/dashboard';
const root=document.querySelector<HTMLElement>('[data-workspace="products"]');
if(root){
 const $=<T extends HTMLElement=HTMLElement>(s:string)=>root.querySelector<T>(s)!;
 type Product={imageId?:string|null;id:string;name:string;slug:string;status:string;kind:string;is_demo:boolean;category_id?:string|null;category_ids?:string[]};
 let products:Product[]=[],deleted:Product[]=[],drafts:{id:string;name:string;imageId?:string|null;category_id?:string|null}[]=[],quality:DashboardQuality[]=[],current=1;
 let categories:{id:string;name:string;parent_id:string|null}[]=[];
 const cms=document.querySelector<HTMLElement>('[data-cms-url]')!.dataset.cmsUrl!;
 $<HTMLInputElement>('[data-product-incomplete]').checked=new URLSearchParams(location.search).get('incomplete')==='1';
 const actionButton=(name:string,id:string,action:'archive'|'restore'|'purge')=>{const b=node('button',action==='archive'?'Удалить':action==='purge'?'Удалить окончательно':'Восстановить','dash-button'+(action!=='restore'?' dash-danger':''));b.type='button';b.setAttribute('aria-label',`${action==='archive'?'Удалить':action==='purge'?'Удалить окончательно':'Восстановить'}: ${name}`);b.addEventListener('click',()=>void lifecycle.open(id,action));return b;};
 function identity(imageId:string|null|undefined,copy:HTMLElement){
  const group=node('div','','mgr-product-identity'),thumb=node('div','','mgr-product-thumbnail'),fallback=node('span',imageId?'Фото…':'Нет фото');thumb.append(fallback);
  if(imageId&&/^[0-9a-f-]{36}$/i.test(imageId)){const img=node('img');img.width=96;img.height=96;img.alt='';img.loading='lazy';img.decoding='async';img.src='/api/manager/product-image?id='+encodeURIComponent(imageId)+'&thumbnail=1';img.addEventListener('load',()=>{fallback.hidden=true;img.classList.add('is-loaded');});img.addEventListener('error',()=>{img.remove();fallback.textContent='Фото недоступно';});thumb.append(img);}
  copy.classList.add('mgr-product-copy');group.append(thumb,copy);return group;
 }
 function categoryMatches(item:{category_id?:string|null;category_ids?:string[]}){
  const selected=$<HTMLSelectElement>('[data-product-category]').value,ids=[item.category_id,...(item.category_ids??[])].filter(Boolean);
  if(!selected)return true;if(selected==='none')return !ids.length;
  return ids.some(id=>{const visited=new Set<string>();while(id&&!visited.has(id)){if(id===selected)return true;visited.add(id);id=categories.find(c=>c.id===id)?.parent_id??undefined;}return false;});
 }
 function render(){
  const archived=$<HTMLSelectElement>('[data-product-scope]').value==='archived',q=$<HTMLInputElement>('[data-product-search]').value.trim().toLocaleLowerCase('ru-RU'),only=$<HTMLInputElement>('[data-product-incomplete]').checked,demo=$<HTMLInputElement>('[data-product-demo]').checked;
  $<HTMLInputElement>('[data-product-incomplete]').disabled=archived;
  $('[data-product-purge-all]').hidden=!archived||!deleted.length;
  const filtered=(archived?deleted:products).filter(p=>categoryMatches(p)&&(demo||!p.is_demo)&&(archived||!only||quality.some(v=>v.id===p.id))&&p.name.toLocaleLowerCase('ru-RU').includes(q));
  const pages=Math.max(1,Math.ceil(filtered.length/20));current=Math.min(current,pages);$('[data-product-count]').textContent=`Найдено: ${filtered.length}`;$('[data-product-empty]').hidden=filtered.length>0;
  const list=$('[data-product-list]');list.replaceChildren();
  for(const p of filtered.slice((current-1)*20,current*20)){
   const row=node('article','','mgr-product-row'),copy=node('div'),issues=quality.find(v=>v.id===p.id)?.issues??[];
   copy.append(node('h3',p.name),node('p',p.kind==='bundle'?'Комплект':'Отдельный товар','dash-help'));
   const tags=node('div','','dash-tags');tags.append(node('span',archived?'Удалён с сайта':p.status==='published'?'Опубликован':'Черновик','dash-tag'));if(p.is_demo)tags.append(node('span','Демонстрационный','dash-tag warning'));
   copy.append(tags,node('p',archived?'Можно восстановить в черновик. Заказы и остатки сохранены.':issues.length?issues.join(' · '):p.is_demo?'Демонстрационный товар не участвует в проверке готовности.':'По проверяемым полям данные заполнены.','dash-help'));
   const actions=node('div','','mgr-row-actions');actions.append(link(archived?'Открыть карточку':'Редактировать','/manager/products/edit?id='+p.id,'dash-button'));
   if(p.slug)actions.append(link('Открыть CMS',`${cms}/content/ar_products/${p.id}`,'dash-button'));actions.append(actionButton(p.name,p.id,archived?'restore':'archive'));if(archived)actions.append(actionButton(p.name,p.id,'purge'));row.append(identity(p.imageId,copy),actions);list.append(row);
  }
  const saved=$('[data-product-drafts]');saved.replaceChildren();const visible=drafts.filter(d=>categoryMatches(d)&&d.name.toLocaleLowerCase('ru-RU').includes(q));$('[data-product-drafts-panel]').hidden=archived||!visible.length;
  if(!archived)for(const draft of visible){const row=node('div','','mgr-product-row'),actions=node('div','','mgr-row-actions');actions.append(link('Продолжить','/manager/products/edit?id='+draft.id,'dash-button'),actionButton(draft.name,draft.id,'archive'));row.append(identity(draft.imageId,node('strong',draft.name)),actions);saved.append(row);}
  const nav=$('[data-product-pagination]');const btn=(label:string,step:number)=>{const b=node('button',label,'dash-button');b.type='button';b.disabled=step<0?current<=1:current>=pages;b.addEventListener('click',()=>{current+=step;render();});return b;};nav.replaceChildren(btn('← Назад',-1),node('span',`Страница ${current} из ${pages}`),btn('Далее →',1));
 }
 const lifecycle=productLifecycle(root,{done:async action=>{page.notify(action==='archive'?'Товар перенесён в раздел «Удалённые».':action==='purge'?'Товар удалён окончательно.':'Товар восстановлен в черновик.');await page.reload();},error:e=>page.showError(e)});
 const page=managerPage(root,async signal=>{
  const [data,saved,archived]=await Promise.all([page.get<{products:Product[];quality:DashboardQuality[];categories?:typeof categories}>('/api/manager/catalog-readiness',signal),page.get<{drafts:{id:string;name:string;imageId?:string|null;category_id?:string|null}[]}>('/api/manager/product-editor?drafts=1',signal),page.get<{products:Product[]}>('/api/manager/product-lifecycle?archived=1',signal)]);
  return()=>{products=data.products;quality=data.quality;drafts=saved.drafts;deleted=archived.products;categories=data.categories??[];
   const select=$<HTMLSelectElement>('[data-product-category]'),selected=select.value;select.replaceChildren();
   for(const [value,label] of [['','Все категории'],['none','Без категории']]){const option=node('option',label);option.value=value;select.append(option);}
   for(const category of categories){const names=[category.name],visited=new Set([category.id]);let parent=category.parent_id;while(parent&&!visited.has(parent)){visited.add(parent);const row=categories.find(c=>c.id===parent);if(!row)break;names.unshift(row.name);parent=row.parent_id;}const option=node('option',names.join(' / '));option.value=category.id;select.append(option);}
   select.value=selected;if(select.selectedIndex<0)select.value='';render();};
 });
 const trash=productTrash(root,{done:async count=>{page.notify(`Окончательно удалено товаров: ${count}.`);await page.reload();},error:e=>page.showError(e)});
 $('[data-product-purge-all]').addEventListener('click',()=>void trash.open());
 root.querySelectorAll('[data-product-category],[data-product-search],[data-product-incomplete],[data-product-demo],[data-product-scope]').forEach(el=>el.addEventListener(el instanceof HTMLInputElement&&el.type==='search'?'input':'change',()=>{current=1;render();}));void page.reload();
}
