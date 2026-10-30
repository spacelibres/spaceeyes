import { galaxyService } from '../../../../lib/galaxy-server.ts';
export const runtime='nodejs';
export async function GET(request:Request,context:{params:Promise<{file:string}>}){
  const {file}=await context.params;
  if(!['milkyway.webp','milkyway-preview.webp'].includes(file))return Response.json({error:'Unknown deep-space resource'},{status:404});
  try{const asset=await galaxyService.get(file,request.signal);return new Response(new Uint8Array(asset.bytes),{headers:{'Content-Type':'image/webp',ETag:`"${asset.sha256}"`,'Cache-Control':'public, max-age=3600'}});}
  catch{return Response.json({error:'Galaxy unavailable'},{status:502});}
}
