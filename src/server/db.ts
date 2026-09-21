import pg from 'pg';
import type{PoolClient,QueryResultRow}from'pg';
import{appConfig}from'./config.ts';
let pool:pg.Pool|undefined;
export function getPool(){if(!pool){const c=appConfig();pool=new pg.Pool({host:c.host,port:c.port,database:c.database,user:'ar_app',password:c.password,max:10,connectionTimeoutMillis:5000,idleTimeoutMillis:30000});pool.on('error',()=>console.error('Store database connection failed'));}return pool;}
export async function query<T extends QueryResultRow=QueryResultRow>(text:string,values:unknown[]=[]){return getPool().query<T>(text,values);}
export async function transaction<T>(work:(client:PoolClient)=>Promise<T>,repeatable=true):Promise<T>{
 for(let attempt=0;;attempt++){
  const client=await getPool().connect();
  try{await client.query(repeatable?'BEGIN ISOLATION LEVEL REPEATABLE READ':'BEGIN');await client.query("SET LOCAL lock_timeout='5s'");const value=await work(client);await client.query('COMMIT');return value;}
  catch(error){await client.query('ROLLBACK');const code=(error as {code?:string}).code;if(attempt<3&&['40001','40P01'].includes(code??'')){await new Promise(r=>setTimeout(r,15*(attempt+1)));continue;}throw error;}
  finally{client.release();}
 }
}
