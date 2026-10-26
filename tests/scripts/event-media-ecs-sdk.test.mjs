import assert from 'node:assert/strict';
import test from 'node:test';

import * as sdk from '../../scripts/event-media-ecs-sdk.mjs';
const operations = ['RegisterTaskDefinition', 'RunTask', 'DescribeTasks', 'StopTask', 'DeregisterTaskDefinition'];
const commands = Object.fromEntries(operations.map(name => [`${name}Command`, class {
  constructor(input) { this.input = input; this.operation = name; }
}]));
const config = { region: 'us-east-1' };
function runner(send = async command => command.input, options = {}) {
  assert.equal(typeof sdk.createEcsSdkRunner, 'function', 'SDK runner must exist');
  return sdk.createEcsSdkRunner({ client: { send }, commands, ...options });
}

const definition = { family: 'worker-session', tags: [{ key: 'ManagedBy', value: 'event-media-ecs-bridge' }], containerDefinitions: [{ name: 'worker', secrets: [{ name: 'TOKEN', valueFrom: 'secret-arn' }] }] };
const network = { awsvpcConfiguration: { subnets: ['subnet-a', 'subnet-b'], securityGroups: ['sg-worker'], assignPublicIp: 'ENABLED' } };
for (const [operation, args, expected] of [
  ['RegisterTaskDefinition', ['register-task-definition', '--cli-input-json', JSON.stringify(definition)], definition],
  ['RunTask', ['run-task', '--cluster', 'cluster', '--task-definition', 'definition:1', '--launch-type', 'FARGATE', '--propagate-tags', 'TASK_DEFINITION', '--platform-version', 'LATEST', '--count', '1', '--client-token', 'fenced-dispatch-id', '--started-by', 'invocation-session', '--network-configuration', JSON.stringify(network)], { cluster: 'cluster', taskDefinition: 'definition:1', launchType: 'FARGATE', propagateTags: 'TASK_DEFINITION', platformVersion: 'LATEST', count: 1, clientToken: 'fenced-dispatch-id', startedBy: 'invocation-session', networkConfiguration: network }],
  ['DescribeTasks', ['describe-tasks', '--cluster', 'cluster', '--tasks', 'task-a', 'task-b', 'task-c'], { cluster: 'cluster', tasks: ['task-a', 'task-b', 'task-c'] }],
  ['StopTask', ['stop-task', '--cluster', 'cluster', '--task', 'task-a', '--reason', 'VRDex event media stop reconciliation.'], { cluster: 'cluster', task: 'task-a', reason: 'VRDex event media stop reconciliation.' }],
  ['DeregisterTaskDefinition', ['deregister-task-definition', '--task-definition', 'definition:1'], { taskDefinition: 'definition:1' }],
]) test(`${operation} preserves the CLI payload and SDK response`, async () => {
  const response = { tasks: [{ taskArn: 'task-a' }], failures: [] };
  const run = runner(async (command, options) => {
    assert.equal(command.operation, operation);
    assert.deepEqual(command.input, expected);
    assert.ok(options.abortSignal instanceof AbortSignal);
    assert.equal(options.abortSignal.aborted, false);
    return response;
  });
  assert.equal(await run(config, ['ecs', ...args]), response);
});

test('rejects unsupported operations, flags, duplicate flags and malformed values before sending', async () => {
  let sends = 0;
  const run = runner(async () => { sends++; });
  for (const args of [
    ['s3', 'run-task'], ['ecs', 'list-tasks'],
    ['ecs', 'run-task', '--made-up', 'secret-value'],
    ['ecs', 'stop-task', '--task'],
    ['ecs', 'stop-task', '--task', 'a', '--task', 'b'],
    ['ecs', 'run-task', '--count', '1.5'],
    ['ecs', 'run-task', '--network-configuration', 'not-json'],
    ['ecs', 'describe-tasks', '--tasks'],
  ]) await assert.rejects(run(config, args), error => {
    assert.doesNotMatch(error.message, /secret-value|not-json/);
    return true;
  });
  assert.equal(sends, 0);
});

test('default SDK timeout aborts a hung request at exactly fifteen seconds', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const run = runner(async (_command, options) => {
    signal = options.abortSignal;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  const pending = assert.rejects(run(config, ['ecs', 'describe-tasks', '--cluster', 'cluster', '--tasks', 'task']), /timed out|abort/i);
  t.mock.timers.tick(14999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  assert.equal(signal.aborted, true);
  await pending;
});

test('SDK errors become generic errors without provider contents', async () => {
  const run = runner(async () => { throw Error('https://private-source.test TOKEN=private-token'); });
  await assert.rejects(run(config, ['ecs', 'describe-tasks', '--tasks', 'task']), error => {
    assert.doesNotMatch(error.message, /private-source|private-token/);
    return true;
  });
});
