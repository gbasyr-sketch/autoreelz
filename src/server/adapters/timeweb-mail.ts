import {createTransport,type SMTPTransportOptions,type SendMailOptions} from 'nodemailer';
import {MAIL_SENDER,smtpPassword,mailRecipientAllowed} from '../mail-policy.ts';
import {StoreError,email} from '../errors.ts';
export interface SmtpMessage {recipient:string;subject:string;body:string;message_id:string;created_at:string|Date}
export class MailSendError extends Error {
 readonly state:'retry'|'failed'|'uncertain';readonly code:string;
 constructor(state:'retry'|'failed'|'uncertain',code:string){super(code);this.state=state;this.code=code;}
}
export function mailError(error:unknown):MailSendError {
 if(error instanceof MailSendError)return error;
 const e=error as {code?:unknown;command?:unknown;responseCode?:unknown;timeoutType?:unknown};
 const code=String(e?.code??''),command=String(e?.command??'');
 if(error instanceof StoreError&&error.code==='SMTP_SETUP')return new MailSendError('failed','SMTP_SETUP_REQUIRED');
 if(code==='EAUTH')return new MailSendError('failed','SMTP_AUTH_FAILED');
 if(typeof e?.responseCode==='number'&&e.responseCode>=400&&e.responseCode<600)return new MailSendError(e.responseCode<500?'retry':'failed',e.responseCode<500?'SMTP_TEMPORARY_REJECTION':'SMTP_REJECTED');
 if(code==='EDNS'||['CONNECT_TIMEOUT','GREETING_TIMEOUT','UPGRADE_TIMEOUT'].includes(String(e?.timeoutType))||['EHLO','HELO','STARTTLS','MAIL FROM','RCPT TO'].includes(command)||command.startsWith('AUTH '))return new MailSendError('retry','SMTP_CONNECTION_FAILED');
 // A lost DATA acknowledgement may already have accepted the message. No automatic resend.
 return new MailSendError('uncertain','SMTP_OUTCOME_UNKNOWN');
}
export function timewebOptions(password:string):SMTPTransportOptions {
 return{host:'smtp.timeweb.ru',port:465,secure:true,name:'autoreelz.ru',auth:{user:MAIL_SENDER,pass:password},tls:{servername:'smtp.timeweb.ru',rejectUnauthorized:true,minVersion:'TLSv1.2'},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000,dnsTimeout:10000,logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true};
}
export function timewebMessage(input:SmtpMessage):SendMailOptions {
 const to=email(input.recipient);
 if(!mailRecipientAllowed(to))throw new MailSendError('failed','MAIL_RECIPIENT_BLOCKED');
 if(!input.subject||input.subject.length>200||/[\r\n\0]/.test(input.subject)||!input.body||Buffer.byteLength(input.body)>65536||!/^<ar-[a-f0-9-]{36}@autoreelz\.ru>$/.test(input.message_id))throw new MailSendError('failed','MAIL_INVALID_MESSAGE');
 const date=new Date(input.created_at);if(!Number.isFinite(date.getTime()))throw new MailSendError('failed','MAIL_INVALID_MESSAGE');
 return{from:{name:'AUTO REELZ',address:MAIL_SENDER},replyTo:MAIL_SENDER,to:{address:to,name:''},envelope:{from:MAIL_SENDER,to:[to]},subject:input.subject,text:input.body,messageId:input.message_id,date,disableFileAccess:true,disableUrlAccess:true};
}
interface MailTransport {verify():Promise<unknown>;sendMail(options:SendMailOptions):Promise<{accepted:unknown[];rejected:unknown[]}>;close():void}
export function createTimewebMail(makeTransport:(options:SMTPTransportOptions)=>MailTransport=options=>createTransport(options)){
 const transport=makeTransport(timewebOptions(smtpPassword()));
 return{
  async verify(){try{await transport.verify();return{authenticated:true,host:'smtp.timeweb.ru',port:465,sender:MAIL_SENDER};}catch{throw new StoreError('SMTP_VERIFY_FAILED','Не удалось подтвердить SMTP-доступ.',503);}finally{transport.close();}},
  async send(input:SmtpMessage){try{const result=await transport.sendMail(timewebMessage(input));if(result.accepted.length!==1||result.rejected.length)throw new MailSendError('uncertain','SMTP_OUTCOME_UNKNOWN');return{accepted:true};}catch(e){throw mailError(e);}finally{transport.close();}}
 };
}
