import {getSession} from './commerce';
const form=document.querySelector<HTMLFormElement>('.js-review-form');
if(form){
 const error=form.querySelector<HTMLElement>('[data-review-error]')!;
 const success=form.parentElement!.querySelector<HTMLElement>('[data-review-success]')!;
 const fileInput=form.elements.namedItem('files') as HTMLInputElement;
 let busy=false,pending:{fingerprint:string;key:string}|null=null;
 function showError(message:string,field?:HTMLInputElement|HTMLTextAreaElement){error.replaceChildren();error.append(document.createTextNode(message));if(field){field.setAttribute('aria-invalid','true');if(!field.id)field.id=`review-${field.name}`;const link=document.createElement('a');link.href=`#${field.id}`;link.textContent=' Исправить поле';error.append(link);}error.hidden=false;error.focus();}
 form.addEventListener('focusout',event=>{const field=event.target;if(field instanceof HTMLInputElement||field instanceof HTMLTextAreaElement){if(field.willValidate)field.setAttribute('aria-invalid',String(!field.validity.valid));}});
 fileInput.addEventListener('change',()=>{const files=Array.from(fileInput.files??[]);form.querySelector('[data-review-selected]')!.textContent=files.length?`Выбрано фотографий: ${files.length}`:'';if(files.length>5)showError('Можно приложить не более пяти фотографий.',fileInput);else{fileInput.removeAttribute('aria-invalid');error.hidden=true;}});
 form.addEventListener('submit',event=>{event.preventDefault();void(async()=>{
  if(busy)return;error.hidden=true;
  const files=Array.from(fileInput.files??[]);
  if(files.length>5||files.some(file=>file.size<1||file.size>10*1024*1024||!['image/jpeg','image/png','image/webp'].includes(file.type))){showError('Выберите до пяти непустых фото JPEG, PNG или WebP, каждое не больше 10 МБ.',fileInput);return;}
  const body=form.elements.namedItem('body') as HTMLTextAreaElement;
  if(body.value.trim().length<20){showError('Напишите отзыв от 20 символов.',body);return;}
  busy=true;const button=form.querySelector<HTMLButtonElement>('button[type=submit]')!;button.disabled=true;button.setAttribute('aria-busy','true');button.textContent='Отправляем отзыв…';
  try{
   const session=await getSession(true);if(!session.email)throw new Error('Сначала войдите по email из заказа.');
   const data=new FormData(form);data.delete('files');for(const file of files)data.append('files',file);
   const digests=await Promise.all(files.map(async file=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('')));
   const fingerprint=JSON.stringify([...data.entries()].filter(([,v])=>typeof v==='string'))+digests.join(':');
   if(!pending||pending.fingerprint!==fingerprint)pending={fingerprint,key:crypto.randomUUID()};data.set('idempotencyKey',pending.key);
   const response=await fetch('/api/social/reviews',{method:'POST',credentials:'same-origin',headers:{'X-CSRF-Token':session.csrfToken},body:data,signal:AbortSignal.timeout(90000)});
   const result=await response.json();if(!response.ok){if(response.status<500&&response.status!==429)pending=null;throw new Error(result?.error?.message??'Не удалось отправить отзыв.');}
   pending=null;form.hidden=true;success.textContent='Спасибо! Отзыв отправлен на проверку. Он появится вместе с фотографиями после одобрения.';success.hidden=false;success.focus();
  }catch(cause){showError(cause instanceof Error?cause.message:'Не удалось отправить отзыв. Данные формы сохранены — повторите отправку.');}
  finally{busy=false;button.disabled=false;button.removeAttribute('aria-busy');button.textContent='Отправить на проверку';}
 })();});
}
