// One purchase path for every pricing screen: a quote, then the hosted payment
// page when it is available. Otherwise the caller shows the quote to confirm.
import {api,post} from "./client-api";

export type CheckoutInput={kind:"subscription";plan:string;cycle:"period"|"annual"}|{kind:"upgrade";plan:string}|Record<string,unknown>;
export type CheckoutQuote={id:string;eligible:boolean;[key:string]:unknown};
export type CheckoutOrder={id:string;status:string;checkoutUrl?:string;[key:string]:unknown};
export type CheckoutResult=
 |{step:"redirect";url:string}
 |{step:"order";order:CheckoutOrder}
 |{step:"confirm";quote:CheckoutQuote;idempotencyKey:string};

export async function startCheckout(input:CheckoutInput,checkoutMode?:"hosted"|"invoiced"):Promise<CheckoutResult>{
 const quote=await api<CheckoutQuote>("/api/billing/quotes",post(input));
 const idempotencyKey=crypto.randomUUID();
 if(checkoutMode==="hosted"&&quote.eligible)return orderResult(await payQuote(quote.id,idempotencyKey));
 return {step:"confirm",quote,idempotencyKey};
}

export function payQuote(quoteId:string,idempotencyKey:string){
 return api<CheckoutOrder>("/api/billing/checkout",post({quoteId,idempotencyKey}));
}

export function orderResult(order:CheckoutOrder):CheckoutResult{
 return order.checkoutUrl&&order.status==="pending"?{step:"redirect",url:order.checkoutUrl}:{step:"order",order};
}
