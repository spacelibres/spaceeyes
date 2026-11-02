import { starfieldFile, starfieldFiles } from '../../../../lib/starfield-server';
export const runtime='nodejs';
export async function GET(request:Request,context:{params:Promise<{file:string}>}){
 const {file}=await context.params;
 const entry=starfieldFiles.find(e=>e.file===file);
 if(!entry)return Response.json({error:'Unknown starfield'},{status:404});
 try{const bytes=await starfieldFile(file,request.signal);return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'application/octet-stream','Content-Length':String(bytes.length),ETag:'"'+entry.sha256+'"','Cache-Control':'public, max-age=86400'}});}
 catch{return Response.json({error:'Starfield unavailable'},{status:502});}
}
