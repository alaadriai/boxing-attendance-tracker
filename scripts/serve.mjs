import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.md':'text/plain'};
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost'),filename=path.resolve(root,'.'+decodeURIComponent(url.pathname));
    if(filename!==path.resolve(root)&&!filename.startsWith(path.resolve(root)+path.sep)){res.writeHead(403).end();return;}
    const info=await stat(filename),file=info.isDirectory()?path.join(filename,'index.html'):filename;
    const body=await readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(body);
  }catch{res.writeHead(404).end('Not found');}
});
server.listen(Number(process.env.PORT||4173),'127.0.0.1',()=>console.log(`ARETE Boxing: http://127.0.0.1:${server.address().port}`));
