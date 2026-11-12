// Every state decision gets a new cache. Never reuse a stale positive/negative read.
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
function query(root,args,runner=spawnSync,{env=process.env,userconfig,npmCli}={}) {
 if(!(args[0]==='view'||args[0]==='whoami'||args[0]==='stage'&&['list','view'].includes(args[1])||args[0]==='trust'&&args[1]==='list'||args[0]==='access'&&args[1]==='list'&&args[2]==='packages')) throw new Error('Only read-only npm status queries are allowed');
 fs.mkdirSync(path.join(root,'.tmp'),{recursive:true});
 const cache=fs.mkdtempSync(path.join(root,'.tmp','npm-query-'));
 const parameters=[...args,'--json','--registry=https://registry.npmjs.org','--cache',cache,'--prefer-online','--offline=false',...(userconfig?['--userconfig',path.resolve(userconfig)]:[])];
 try {
  const result=runner(npmCli?process.execPath:'npm',npmCli?[path.resolve(npmCli),...parameters]:parameters,{encoding:'utf8',timeout:45000,maxBuffer:2*1024*1024,env});
  return {...result,checkedAt:new Date().toISOString(),freshCache:true};
 } finally {fs.rmSync(cache,{recursive:true,force:true});}
}
module.exports={query};
