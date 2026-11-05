import {identity,failure} from '@/lib/server';
import * as feedback from '@/lib/feedback';
type Ctx={params:Promise<{id:string}>};
export async function GET(request:Request,context:Ctx){try{return await feedback.feedbackAttachment(await identity(request),(await context.params).id);}catch(error){return failure(error);}}
