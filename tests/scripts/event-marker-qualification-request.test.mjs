import test from 'node:test';
import assert from 'node:assert/strict';
import { validateQualificationRequest,validateNativeTask } from '../../scripts/marker-qualification/request.mjs';
const request={schema:1,runId:'task6-marker-test',groupId:'canary-000',revision:'a'.repeat(40),imageDigest:'sha256:'+'b'.repeat(64),sourceManifestSha256:'c'.repeat(64),sourceManifestPath:'/tmp/marker-qualification-sources.json'};
test('qualification request fixes group namespace image and native8CPU16GiB allocation',()=>{
 const value=validateQualificationRequest(request);assert.equal(value.directory,'/tmp/marker-qualification-task6-marker-test-canary-000');
 const metadata={TaskARN:'arn:aws:ecs:us-east-1:079358094174:task/fixture/'+'a'.repeat(32),Limits:{CPU:8,Memory:16384},Containers:[{ImageID:request.imageDigest}]};
 assert.equal(validateNativeTask(metadata,value).cpu,8192);
 for(const mutation of [x=>x.Limits.CPU=4,x=>x.Limits.Memory=8192,x=>x.Containers[0].ImageID='sha256:'+'f'.repeat(64),x=>x.Containers.push(x.Containers[0])]){const x=structuredClone(metadata);mutation(x);assert.throws(()=>validateNativeTask(x,value),/qualification_native_identity/);}
 for(const mutation of [x=>x.groupId='mass-999',x=>x.runId='../outside',x=>x.imageDigest='latest',x=>x.extra=true,x=>x.sourceManifestPath='/etc/passwd']){const x=structuredClone(request);mutation(x);assert.throws(()=>validateQualificationRequest(x),/qualification_request/);}
});
