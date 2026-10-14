// Moscow dates, without depending on the server/browser timezone.
// RF five-day calendar, PP RF 24.09.2025 No.1466. Unknown years require a manual date.
const holidays2026=new Set(['01-01','01-02','01-03','01-04','01-05','01-06','01-07','01-08','01-09','02-23','03-09','05-01','05-11','06-12','11-04','12-31']);
export const PAYMENT_WINDOW_MS=30*60_000;
export function moscowDate(at:Date|number=new Date()):string{
 const date=new Date(at);if(!Number.isFinite(date.getTime()))throw new RangeError('Invalid time');
 return new Date(date.getTime()+3*3600_000).toISOString().slice(0,10);
}
export function validDate(value:unknown):value is string{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const time=Date.parse(value+'T00:00:00Z');return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value;
}
export function addWorkingDays(start:string,count:number):string|null{
 if(!validDate(start)||!Number.isSafeInteger(count)||count<0||count>370)return null;
 const date=new Date(start+'T00:00:00Z');
 if(date.getUTCFullYear()!==2026)return null;
 while(count>0){date.setUTCDate(date.getUTCDate()+1);if(date.getUTCFullYear()!==2026)return null;const day=date.toISOString().slice(0,10);if(![0,6].includes(date.getUTCDay())&&!holidays2026.has(day.slice(5)))count--;}
 return date.toISOString().slice(0,10);
}
export function automaticDeliveryDeadline(latestPaymentAt:number,carrierWorkingDays:number):string|null{
 if(!Number.isSafeInteger(carrierWorkingDays)||carrierWorkingDays<0||carrierWorkingDays>120)return null;
 return addWorkingDays(moscowDate(latestPaymentAt),3+carrierWorkingDays);
}
export function displayDeliveryDate(value:string):string{
 return validDate(value)?new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z')):value;
}
