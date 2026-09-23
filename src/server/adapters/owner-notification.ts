import {requireTestEnvironment} from '../config.ts';
export interface OwnerNoticeInput {id:string;channel:'max'|'email';subject:string;body:string}
/** The live MAX/email providers are deliberately not wired in the local store. */
export async function sendLocalOwnerNotification(input:OwnerNoticeInput,fail=false){
 requireTestEnvironment();if(fail)throw new Error('Имитированный сбой доставки уведомления.');
 return{providerMessageId:`local:${input.channel}:${input.id}`};
}
