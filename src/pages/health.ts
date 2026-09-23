import type{APIRoute}from'astro';
import{query}from'../server/db';
import{releaseInfo}from'../server/release';
export const GET:APIRoute=async()=>{try{await query('SELECT 1');return Response.json({ok:true,...releaseInfo()});}catch{return Response.json({ok:false,...releaseInfo()},{status:503});}};
