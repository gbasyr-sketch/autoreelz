import type {PoolClient} from 'pg';
import {StoreError} from './errors.ts';
export async function requireUnpurgedProduct(c:PoolClient,id:string){
 if((await c.query('SELECT 1 FROM ar_product_purges WHERE product_id=$1',[id])).rowCount)throw new StoreError('PRODUCT_PURGED','Товар удалён окончательно. Восстановление недоступно.',410);
}
