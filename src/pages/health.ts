import type{APIRoute}from'astro';
import{query}from'../server/db';
export const GET:APIRoute=async()=>{try{await query('SELECT 1');return Response.json({ok:true});}catch{return Response.json({ok:false},{status:503});}};
