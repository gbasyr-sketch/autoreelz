import{deliverOwnerNotifications}from'./notifications.ts';
import{query,transaction}from'./db.ts';
import{expireDueOrders}from'./orders.ts';
import{requireLocalTest}from'./config.ts';
export async function workerTick(){
 requireLocalTest();const expired=await expireDueOrders();
 const mail=await transaction(async c=>{const rows=await c.query("SELECT id FROM ar_mail_outbox WHERE status='pending' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 100");for(const r of rows.rows)await c.query("UPDATE ar_mail_outbox SET status='delivered',delivered_at=now() WHERE id=$1 AND status='pending'",[r.id]);return rows.rowCount??0;});
 const notifications=await deliverOwnerNotifications();
 await query("INSERT INTO ar_worker_heartbeat(name,last_run_at,last_error) VALUES('commerce',now(),NULL) ON CONFLICT(name) DO UPDATE SET last_run_at=now(),last_error=NULL");
 return{expired,mail,notifications};
}
