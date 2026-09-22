import type {PoolClient} from 'pg';
import type {ShopSession} from '../lib/commerce-types.ts';
import type {FavoritesView,ReviewView,ReviewsView} from '../lib/social-types.ts';
import {transaction} from './db.ts';
import {StoreError,uuid,text,multilineText,iso} from './errors.ts';
import {equal,idempotent,sign} from './security.ts';
import type {ReviewPhoto} from './social-photos.ts';

const visibleProduct=`p.status='published' AND NOT EXISTS(WITH RECURSIVE parents AS (SELECT * FROM ar_categories WHERE id=p.category_id UNION ALL SELECT x.* FROM ar_categories x JOIN parents a ON x.id=a.parent_id) SELECT 1 FROM parents WHERE status<>'published')`;
async function customer(c:PoolClient,session:ShopSession,required=false){
 const row=(await c.query(`SELECT s.csrf_token,s.customer_id,c.email FROM ar_web_sessions s LEFT JOIN ar_customers c ON c.id=s.customer_id WHERE s.id=$1 AND s.expires_at>now() ${required?'FOR UPDATE OF s':''}`,[session.id])).rows[0];
 if(!row||!equal(row.csrf_token,session.csrfToken))throw new StoreError('SESSION_CHANGED','Сессия обновилась. Обновите страницу.',401);
 if(!row.customer_id){if(required)throw new StoreError('AUTH_REQUIRED','Войдите по коду на email.',401);return null;}
 if(required)await c.query('SELECT id FROM ar_customers WHERE id=$1 FOR UPDATE',[row.customer_id]);
 return{id:row.customer_id as string,email:row.email as string};
}
async function favoriteIds(c:PoolClient,id:string){return(await c.query('SELECT product_id FROM ar_favorites WHERE customer_id=$1 ORDER BY created_at,id',[id])).rows.map(r=>r.product_id as string);}
export async function getFavorites(session:ShopSession):Promise<FavoritesView>{return transaction(async c=>{const owner=await customer(c,session);return{authenticated:Boolean(owner),productIds:owner?await favoriteIds(c,owner.id):[]};});}
export async function changeFavorites(session:ShopSession,body:Record<string,unknown>):Promise<FavoritesView>{
 const action=body.action;if(typeof action!=='string'||!['merge','add','remove'].includes(action))throw new StoreError('FAVORITE_ACTION','Неподдерживаемое действие с избранным.');
 const values=action==='merge'?body.productIds:[body.productId];
 if(!Array.isArray(values)||values.length>500)throw new StoreError('FAVORITE_LIMIT','В избранном может быть не более 500 товаров.');
 const ids=[...new Set(values.map(uuid))].sort();
 return transaction(async c=>{
  const owner=(await customer(c,session,true))!;
  await idempotent(c,`favorites:${owner.id}`,body.idempotencyKey,{action,ids},async()=>{
   if(action==='remove')await c.query('DELETE FROM ar_favorites WHERE customer_id=$1 AND product_id=ANY($2::uuid[])',[owner.id,ids]);
   else{
    const allowed=(await c.query(`SELECT p.id FROM ar_products p WHERE p.id=ANY($1::uuid[]) AND ${visibleProduct}`,[ids])).rows.map(r=>r.id as string);
    if(action==='add'&&!allowed.length)throw new StoreError('PRODUCT_UNAVAILABLE','Товар сейчас недоступен.',404);
    const existing=await favoriteIds(c,owner.id);
    if(new Set([...existing,...allowed]).size>500)throw new StoreError('FAVORITE_LIMIT','В избранном может быть не более 500 товаров.');
    for(const id of allowed)await c.query('INSERT INTO ar_favorites(customer_id,product_id) VALUES($1,$2) ON CONFLICT(customer_id,product_id) DO NOTHING',[owner.id,id]);
   }
   return{ok:true};
  });
  // Replayed commands return current state, never a stale list that revives a removal.
  return{authenticated:true,productIds:await favoriteIds(c,owner.id)};
 });
}
async function eligible(c:PoolClient,email:string,productId:string){
 return(await c.query(`SELECT id,number FROM ar_orders o WHERE o.customer_email=$1 AND o.status='paid' AND o.payment_status='paid' AND o.delivery_status='delivered' AND o.delivered_at IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(o.items_snapshot) line WHERE line->>'productId'=$2) ORDER BY o.created_at DESC`,[email,productId])).rows as {id:string;number:string}[];
}
async function reviewView(c:PoolClient,row:Record<string,any>,privateView=false,staffPreview=false):Promise<ReviewView>{
 const media=(await c.query('SELECT id,width,height FROM ar_review_media WHERE review_id=$1 ORDER BY sort',[row.id])).rows;
 return{id:row.id,productId:row.product_id,productName:row.product_name,authorName:row.author_name,body:row.body,status:row.status,...(privateView&&row.moderation_note?{moderationNote:row.moderation_note}:{}),createdAt:iso(row.created_at)!,media:staffPreview||row.status==='approved'?media.map(m=>({id:m.id,url:`/review-media/${m.id}${staffPreview?'?preview=1':''}`,width:m.width,height:m.height})):[]};
}
export async function getReviews(session:ShopSession,productIdInput:unknown):Promise<ReviewsView>{
 const productId=uuid(productIdInput);
 return transaction(async c=>{
  const owner=await customer(c,session);
  if(!(await c.query(`SELECT p.id FROM ar_products p WHERE p.id=$1 AND ${visibleProduct}`,[productId])).rowCount)throw new StoreError('PRODUCT_UNAVAILABLE','Товар сейчас недоступен.',404);
  const rows=(await c.query("SELECT r.*,p.name product_name FROM ar_reviews r JOIN ar_products p ON p.id=r.product_id WHERE r.product_id=$1 AND (r.status='approved' OR r.customer_id=$2) ORDER BY r.created_at DESC LIMIT 100",[productId,owner?.id??null])).rows;
  const existing=owner?(await c.query('SELECT 1 FROM ar_reviews WHERE product_id=$1 AND customer_id=$2',[productId,owner.id])).rowCount:0;
  const eligibleOrders=owner&&!existing?await eligible(c,owner.email,productId):[];
  const reviews:ReviewView[]=[];for(const row of rows)reviews.push(await reviewView(c,row,row.customer_id===owner?.id));
  return{reviews,canReview:eligibleOrders.length>0,eligibleOrders};
 });
}
export async function authorizeReviewUpload(session:ShopSession){
 return transaction(async c=>{
  const owner=(await customer(c,session,true))!;
  const result=await c.query(`INSERT INTO ar_rate_limits(key,count,reset_at) VALUES($1,1,now()+interval '1 hour') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN ar_rate_limits.reset_at<=now() THEN 1 ELSE ar_rate_limits.count+1 END,reset_at=CASE WHEN ar_rate_limits.reset_at<=now() THEN now()+interval '1 hour' ELSE ar_rate_limits.reset_at END WHERE ar_rate_limits.reset_at<=now() OR ar_rate_limits.count<10 RETURNING id`,[sign(`review-upload:${owner.id}`)]);
  if(!result.rowCount)throw new StoreError('RATE_LIMIT','Слишком много отправок отзыва. Попробуйте через час.',429);
 });
}
export function reviewBody(value:unknown){
 if(typeof value!=='string')throw new StoreError('REVIEW_BODY','Напишите отзыв от 20 до 5000 символов.');
 const body=value.replace(/\r\n?/g,'\n').trim();
 if(body.length<20||body.length>5000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body))throw new StoreError('REVIEW_BODY','Напишите отзыв от 20 до 5000 символов.');
 return body;
}
export async function createReview(session:ShopSession,body:Record<string,unknown>,photos:ReviewPhoto[]):Promise<ReviewView>{
 const productId=uuid(body.productId),orderId=uuid(body.orderId),authorName=text(body.authorName,'Имя автора',2,80),copy=reviewBody(body.body);
 if(photos.length>5)throw new StoreError('PHOTO_COUNT','Можно приложить не более пяти фотографий.');
 return transaction(async c=>{
  const owner=(await customer(c,session,true))!;
  const result=await idempotent(c,`review-create:${owner.id}`,body.idempotencyKey,{productId,orderId,authorName,body:copy,photos:photos.map(p=>p.digest)},async()=>{
   if(!(await c.query(`SELECT p.id FROM ar_products p WHERE p.id=$1 AND ${visibleProduct}`,[productId])).rowCount)throw new StoreError('PRODUCT_UNAVAILABLE','Товар сейчас недоступен.',404);
   // Lock the paid order against a concurrent manager correction of its delivery status.
   await c.query('SELECT id FROM ar_orders WHERE id=$1 FOR UPDATE',[orderId]);
   if(!(await eligible(c,owner.email,productId)).some(order=>order.id===orderId))throw new StoreError('REVIEW_PURCHASE','Отзыв доступен после оплаты и получения этого товара.',403);
   if((await c.query('SELECT id FROM ar_reviews WHERE customer_id=$1 AND product_id=$2',[owner.id,productId])).rowCount)throw new StoreError('REVIEW_EXISTS','Вы уже оставили отзыв об этом товаре.',409);
   const row=(await c.query('INSERT INTO ar_reviews(customer_id,product_id,order_id,author_name,body) VALUES($1,$2,$3,$4,$5) RETURNING id',[owner.id,productId,orderId,authorName,copy])).rows[0];
   for(const [sort,photo]of photos.entries())await c.query('INSERT INTO ar_review_media(review_id,image_data,width,height,sort) VALUES($1,$2,$3,$4,$5)',[row.id,photo.data,photo.width,photo.height,sort]);
   return{id:row.id};
  });
  const row=(await c.query('SELECT r.*,p.name product_name FROM ar_reviews r JOIN ar_products p ON p.id=r.product_id WHERE r.id=$1',[result.id])).rows[0];
  return reviewView(c,row,true);
 });
}
export async function getModeration(){return transaction(async c=>{const rows=(await c.query("SELECT r.*,p.name product_name FROM ar_reviews r JOIN ar_products p ON p.id=r.product_id ORDER BY (r.status='pending') DESC,r.created_at DESC LIMIT 200")).rows;const reviews:ReviewView[]=[];for(const row of rows)reviews.push(await reviewView(c,row,true,true));return{reviews};});}
export async function moderateReview(actor:{id:string},body:Record<string,unknown>):Promise<ReviewView>{
 const id=uuid(body.reviewId),status=body.status;
 if(status!=='approved'&&status!=='rejected')throw new StoreError('REVIEW_STATUS','Выберите публикацию или отклонение отзыва.');
 const note=typeof body.note==='string'&&body.note.trim()?multilineText(body.note,'Комментарий модератора',2,1000):'';
 return transaction(async c=>{
  await idempotent(c,`review-moderate:${actor.id}`,body.idempotencyKey,{id,status,note},async()=>{
   const row=(await c.query('SELECT id FROM ar_reviews WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!row)throw new StoreError('NOT_FOUND','Отзыв не найден.',404);
   await c.query('UPDATE ar_reviews SET status=$2,moderation_note=$3,moderated_by=$4,moderated_at=now() WHERE id=$1',[id,status,note,actor.id]);return{id};
  });
  const row=(await c.query('SELECT r.*,p.name product_name FROM ar_reviews r JOIN ar_products p ON p.id=r.product_id WHERE r.id=$1',[id])).rows[0];return reviewView(c,row,true,true);
 });
}
export async function getReviewPhoto(idInput:unknown,staffPreview=false){
 const id=uuid(idInput);
 return transaction(async c=>{
  const row=(await c.query(`SELECT m.image_data,m.mime FROM ar_review_media m JOIN ar_reviews r ON r.id=m.review_id JOIN ar_products p ON p.id=r.product_id WHERE m.id=$1 ${staffPreview?'':`AND r.status='approved' AND ${visibleProduct}`}`,[id])).rows[0];
  if(!row)throw new StoreError('NOT_FOUND','Фотография не найдена.',404);return{data:row.image_data as Buffer,mime:row.mime as string};
 });
}
