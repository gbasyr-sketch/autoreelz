import {query} from './db.ts';
import type {HomeReview} from '../lib/home.ts';
/** Only public approved text; no email, order identifier, notes or private media. */
export async function getHomeReviews():Promise<HomeReview[]>{
 const {rows}=await query(`SELECT r.id,r.author_name,r.body,r.created_at,p.name product_name,p.slug product_slug
 FROM ar_reviews r JOIN ar_products p ON p.id=r.product_id
 WHERE r.status='approved' AND p.status='published' AND NOT p.is_demo
 AND NOT EXISTS(WITH RECURSIVE parents AS (
   SELECT id,parent_id,status FROM ar_categories WHERE id=p.category_id
   UNION ALL SELECT c.id,c.parent_id,c.status FROM ar_categories c JOIN parents a ON c.id=a.parent_id
 ) SELECT 1 FROM parents WHERE status<>'published')
 ORDER BY r.created_at DESC,r.id DESC LIMIT 4`);
 return rows.map(r=>({id:r.id,authorName:r.author_name,body:r.body,productName:r.product_name,productSlug:r.product_slug,createdAt:new Date(r.created_at).toISOString(),isDemo:false}));
}
