// Tells the interface whether to show the « Administration » link.
import {identity,failure} from '@/lib/server';
import {isPlatformAdmin} from '@/lib/platform-admin';
export async function GET(request:Request){try{const who=await identity(request,'read');return Response.json({admin:await isPlatformAdmin(who.user.userId)},{headers:{'Cache-Control':'private, no-store'}});}catch(error){return failure(error);}}
