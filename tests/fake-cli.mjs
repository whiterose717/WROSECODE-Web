#!/usr/bin/env node
const args=process.argv.slice(2);
if(args[0]==='providers'){console.log('anthropic: ready\nopenai-compat: ready\nAPI_KEY=DO_NOT_EXPOSE\npassword: MORE_SECRET');process.exit(0)}
if(args[0]==='ctf'){
  console.log('CTF inspecting authorized local artifact');
  console.log('Candidate flag{fixture_only_unverified} detected in artifact');
  setTimeout(()=>{console.log('Final evidence preserved, independent verification unavailable');process.exit(0)},180);
}else{
  console.log(JSON.stringify({type:'text',text:'WROSECODE fake CLI: task execution started'}));
  console.log(JSON.stringify({type:'result',text:`Args:${JSON.stringify(args)}`}));
  setTimeout(()=>{console.log(JSON.stringify({type:'result',text:'Test execution finished'}));process.exit(0)},args.includes('slow')?1100:160);
}
