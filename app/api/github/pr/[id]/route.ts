import {identity,failure,getClientResource} from '@/lib/server';
import {privateJSON} from '@/lib/private-json';
import {decideProposal} from '@/lib/github-pr';
// The user approves or refuses a pull request Braand prepared; approval pushes exactly the reviewed changes.
export async function POST(request:Request,context:{params:Promise<{id:string}>}){try{
 const who=await identity(request,'write'),{id}=await context.params;
 await decideProposal(who,id,await privateJSON(request,4096));
 return Response.json(await getClientResource(who.tenant,id),{headers:{'Cache-Control':'private, no-store'}});
}catch(error){return failure(error);}}
