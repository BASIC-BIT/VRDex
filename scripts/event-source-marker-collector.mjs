import { readFile,lstat } from 'node:fs/promises';
import { validateQualificationRequest } from './marker-qualification/request.mjs';
import { collectQualification } from './marker-qualification/collector.mjs';
setTimeout(()=>process.exit(124),600000);
try {
 if(process.argv.length!==4||process.argv[2]!=='--request'||process.argv[3]!=='/tmp/marker-qualification-request.json')throw Error('collector_arguments');
 const file=process.argv[3],s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size<1||s.size>8192)throw Error('collector_request');
 const request=validateQualificationRequest(JSON.parse(await readFile(file,'utf8'))),result=await collectQualification(request);
 process.stdout.write(JSON.stringify({groupId:result.groupId,workPassed:result.workPassed,terminalOwnUpload:result.terminalOwnUpload,capacityAccepted:false})+'\n',()=>process.exit(result.workPassed?0:1));
}catch{process.stderr.write('Marker qualification collection incomplete\n',()=>process.exit(1));}
