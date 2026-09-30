import {managerPage,managerDirty} from './manager-page';
import {renderManagedOrder} from './commerce';
import {safeOrderReturn} from '../lib/manager-workspace';
import type {ManagerOrderView} from '../lib/management-types';
const root=document.querySelector<HTMLElement>('[data-workspace="order"]');
if(root){const id=root.dataset.orderId!,back=root.querySelector<HTMLAnchorElement>('[data-order-back]')!,returnTo=safeOrderReturn(new URLSearchParams(location.search).get('returnTo')),url=new URL(returnTo,location.origin);url.searchParams.set('restore','1');back.href=url.pathname+url.search;
 const page=managerPage(root,async signal=>{const order=await page.get<ManagerOrderView>('/api/manager/order?id='+encodeURIComponent(id),signal);const card=await renderManagedOrder(order,{refresh:async()=>{managerDirty(false);await page.reload();},error:page.showError,notify:message=>{managerDirty(false);page.notify(message);}});return()=>{root.querySelector('[data-order-title]')!.textContent='Заказ '+order.number;root.querySelector('[data-order-detail]')!.replaceChildren(card);document.title='Заказ '+order.number+' · AUTO REELZ';};});root.addEventListener('input',event=>{if((event.target as Element).closest('[data-edit-form]'))managerDirty(true);});root.addEventListener('change',event=>{if((event.target as Element).closest('[data-edit-form]'))managerDirty(true);});void page.reload();}
