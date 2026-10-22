// Keep the bridge's CLI-shaped runner interface while using the Lambda runtime SDK.
const operations = {
  'register-task-definition': ['RegisterTaskDefinitionCommand', { '--cli-input-json': ['input', 'json'] }],
  'run-task': ['RunTaskCommand', {
    '--cluster': ['cluster'], '--task-definition': ['taskDefinition'],
    '--launch-type': ['launchType'], '--propagate-tags': ['propagateTags'],
    '--platform-version': ['platformVersion'], '--count': ['count', 'integer'],
    '--client-token': ['clientToken'], '--started-by': ['startedBy'],
    '--network-configuration': ['networkConfiguration', 'json'],
  }],
  'describe-tasks': ['DescribeTasksCommand', { '--cluster': ['cluster'], '--tasks': ['tasks', 'list'] }],
  'stop-task': ['StopTaskCommand', { '--cluster': ['cluster'], '--task': ['task'], '--reason': ['reason'] }],
  'deregister-task-definition': ['DeregisterTaskDefinitionCommand', { '--task-definition': ['taskDefinition'] }],
};

function parseRequest(args) {
  const operation = operations[args[1]];
  if (args[0] !== 'ecs' || !operation) throw Error('Unsupported ECS operation.');
  const [command, flags] = operation;
  const input = {};
  for (let index = 2; index < args.length; index++) {
    const flag = args[index];
    const mapping = flags[flag];
    if (!mapping) throw Error('Unsupported ECS argument.');
    const [key, type] = mapping;
    if (Object.hasOwn(input, key)) throw Error('Duplicate ECS argument.');
    const values = [];
    while (index + 1 < args.length && !args[index + 1].startsWith('--')) {
      values.push(args[++index]);
      if (type !== 'list') break;
    }
    if (!values.length || values.some(value => !value.trim())) throw Error('Missing ECS argument value.');
    let value = type === 'list' ? values : values[0];
    if (type === 'json') {
      try { value = JSON.parse(value); } catch { throw Error('Invalid ECS JSON argument.'); }
      if (value === null || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid ECS JSON argument.');
    }
    if (type === 'integer') {
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw Error('Invalid ECS integer argument.');
      value = Number(value);
    }
    input[key] = value;
  }
  return { command, input: command === 'RegisterTaskDefinitionCommand' ? input.input : input };
}

export function createEcsSdkRunner({ client, commands, timeoutMs = 15_000 }) {
  return async (_config, args) => {
    const { command, input } = parseRequest(args);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('ECS request timed out.')), timeoutMs);
    timeout.unref?.();
    try {
      return await client.send(new commands[command](input), { abortSignal: controller.signal });
    } catch {
      throw Error('ECS request failed or timed out.');
    } finally {
      clearTimeout(timeout);
    }
  };
}
