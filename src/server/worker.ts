import {yooClosingReceipts} from './yookassa-closing.ts';
import {mailWorker} from './mail.ts';
import {yooReceipts} from './yookassa-receipts.ts';
import{deliverOwnerNotifications}from'./notifications.ts';
import{query}from'./db.ts';
import{expireDueOrders}from'./orders.ts';
import{requireCommerceEnvironment,appConfig}from'./config.ts';
import{yooPayments}from'./yookassa-payments.ts';
import{yooRefunds}from'./yookassa-refunds.ts';
import{cdekShipmentTick}from'./cdek-shipment-worker.ts';
export async function workerTick(){
 requireCommerceEnvironment();const expired=await expireDueOrders();
 const mail=await mailWorker.tick();
 const notifications=appConfig().mode==='production'?0:await deliverOwnerNotifications();
 const reconciled=await yooPayments.reconcile();
 const refunds=await yooRefunds.reconcile();
 const receipts=await yooReceipts.reconcile();
 const cdek=await cdekShipmentTick();
 const closingReceipts=await yooClosingReceipts.reconcile();
 await query("INSERT INTO ar_worker_heartbeat(name,last_run_at,last_error) VALUES('commerce',now(),NULL) ON CONFLICT(name) DO UPDATE SET last_run_at=now(),last_error=NULL");
 return{closingReceipts,expired,mail,notifications,reconciled,refunds,receipts,cdek};
}
