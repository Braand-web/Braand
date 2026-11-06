import {identity,failure} from '@/lib/server';
import {learningProgress} from '@/lib/learning-progress';
export async function GET(request:Request){try{const {tenant}=await identity(request);return Response.json(await learningProgress(tenant,8),{headers:{'Cache-Control':'private, no-store'}});}catch(error){return failure(error);}}
