import {query,transaction} from './db.ts';
import {normalizeVideoUrl,type ContentSnapshot,type Article,type BlogCategory,type BlogTag} from '../lib/content.ts';
const uuidPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export async function getContent():Promise<ContentSnapshot>{
 return transaction(async client=>{
  const pageRows=(await client.query("SELECT * FROM ar_pages WHERE status='published' ORDER BY sort,title,id")).rows;
  const categoryRows=(await client.query("SELECT id,slug,name FROM ar_blog_categories WHERE status='published' ORDER BY sort,name,id")).rows as BlogCategory[];
  const articleRows=(await client.query("SELECT a.* FROM ar_articles a JOIN ar_blog_categories c ON c.id=a.category_id WHERE a.status='published' AND c.status='published' AND (a.published_at IS NULL OR a.published_at<=now()) ORDER BY a.published_at DESC NULLS LAST,a.created_at DESC,a.id")).rows;
  const links=(await client.query('SELECT article_id,tag_id FROM ar_article_tags WHERE article_id=ANY($1::uuid[])',[articleRows.map(a=>a.id)])).rows;
  const productLinks=(await client.query('SELECT article_id,product_id FROM ar_article_products WHERE article_id=ANY($1::uuid[])',[articleRows.map(a=>a.id)])).rows;
  const tags=(await client.query('SELECT id,slug,name FROM ar_blog_tags WHERE id=ANY($1::uuid[]) ORDER BY name,id',[[...new Set(links.map(t=>t.tag_id))]])).rows as BlogTag[];
  const slugs=(await client.query('SELECT entity_type,entity_id,slug FROM ar_content_slugs')).rows as ContentSnapshot['slugs'];
  const pages=pageRows.map(p=>({id:p.id,slug:p.slug,title:p.title,body:p.body,summary:p.summary,seoTitle:p.seo_title,metaDescription:p.meta_description,isLegal:p.is_legal,isDraftText:p.is_draft_text}));
  const articles:Article[]=articleRows.map(a=>{const video=normalizeVideoUrl(a.video_url);return{relatedProductIds:productLinks.filter(x=>x.article_id===a.id).map(x=>x.product_id),videoMetadata:{title:a.video_title??'',description:a.video_description??'',thumbnailUrl:a.video_thumbnail_id&&uuidPattern.test(a.video_thumbnail_id)?`/media/${a.video_thumbnail_id}`:null,uploadedAt:a.video_uploaded_at?new Date(a.video_uploaded_at).toISOString():null,durationSeconds:a.video_duration_seconds??null},id:a.id,slug:a.slug,title:a.title,excerpt:a.excerpt,body:a.body,category:categoryRows.find(c=>c.id===a.category_id)!,tags:tags.filter(t=>links.some(l=>l.article_id===a.id&&l.tag_id===t.id)),video,invalidVideo:Boolean(a.video_url&&!video),coverUrl:a.cover_file_id&&uuidPattern.test(a.cover_file_id)?`/media/${a.cover_file_id}`:null,seoTitle:a.seo_title,metaDescription:a.meta_description,isDemo:a.is_demo,publishedAt:a.published_at?new Date(a.published_at).toISOString():null};});
  return{pages,articles,categories:categoryRows,tags,slugs};
 });
}
export async function isPublishedArticleMedia(fileId:string){
 return Boolean((await query("SELECT 1 FROM ar_articles a JOIN ar_blog_categories c ON c.id=a.category_id WHERE (a.cover_file_id=$1 OR a.video_thumbnail_id=$1) AND a.status='published' AND c.status='published' AND (a.published_at IS NULL OR a.published_at<=now()) LIMIT 1",[fileId])).rowCount);
}
