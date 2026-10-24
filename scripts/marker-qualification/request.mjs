import { enumerateQualification } from './authority.mjs';
const hash=/^[0-9a-f]{64}$/;
export function validateQualificationRequest(value) {
 const keys=['schema','runId','groupId','revision','imageDigest','sourceManifestSha256','sourceManifestPath','canaryReceiptSha256','canaryReceiptPath'];
 if(!value||typeof value!=='object'||Object.keys(value).some(k=>!keys.includes(k))||value.schema!==1||!/^task6-[a-z0-9-]{1,96}$/.test(value.runId??'')||!enumerateQualification().groups.some(g=>g.id===value.groupId)||!/^[0-9a-f]{40}$/.test(value.revision??'')||!/^sha256:[0-9a-f]{64}$/.test(value.imageDigest??'')||!hash.test(value.sourceManifestSha256??'')||value.sourceManifestPath!=='/tmp/marker-qualification-sources.json')throw Error('qualification_request');
 if(value.groupId!=='canary-000'&&(!hash.test(value.canaryReceiptSha256??'')||value.canaryReceiptPath!=='/tmp/marker-qualification-canary.json'))throw Error('qualification_request_canary');
 return {...value,directory:`/tmp/marker-qualification-${value.runId}-${value.groupId}`};
}
export function validateNativeTask(metadata,request) {
 if(!metadata||!/^arn:aws:ecs:us-east-1:079358094174:task\/[a-zA-Z0-9_-]+\/[0-9a-f]{32}$/.test(metadata.TaskARN??'')||metadata.Limits?.CPU!==8||metadata.Limits?.Memory!==16384||!Array.isArray(metadata.Containers)||metadata.Containers.length!==1||metadata.Containers[0].ImageID!==request.imageDigest)throw Error('qualification_native_identity');
 return {taskArn:metadata.TaskARN,cpu:8192,memoryMiB:16384,imageDigest:metadata.Containers[0].ImageID};
}
