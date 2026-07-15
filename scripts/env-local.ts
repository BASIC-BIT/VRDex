import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type LoadRepoEnvLocalOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  fileName?: string;
  override?: boolean;
};

type LoadRepoEnvLocalResult = {
  keys: string[];
  loaded: boolean;
  path: string;
};

function envFlagDisabled(value: string | undefined) {
  return /^(0|false|no)$/i.test(value?.trim() ?? "");
}

function parseValue(rawValue: string) {
  const trimmed = rawValue.trim();

  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed
      .slice(1, -1)
      .replaceAll("\\n", "\n")
      .replaceAll('\\"', '"')
      .replaceAll("\\\\", "\\");
  }

  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function parseLine(line: string) {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith("#")) {
    return undefined;
  }

  const normalized = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trimStart() : trimmed;
  const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(normalized);

  if (match === null) {
    return undefined;
  }

  return {
    key: match[1],
    value: parseValue(match[2] ?? ""),
  };
}

export function loadRepoEnvLocal(options: LoadRepoEnvLocalOptions = {}): LoadRepoEnvLocalResult {
  const env = options.env ?? process.env;
  const envPath = path.join(options.cwd ?? process.cwd(), options.fileName ?? ".env.local");

  if (envFlagDisabled(env.VRDEX_LOAD_ENV_LOCAL)) {
    return {
      keys: [],
      loaded: false,
      path: envPath,
    };
  }

  if (!existsSync(envPath)) {
    return {
      keys: [],
      loaded: false,
      path: envPath,
    };
  }

  const keys: string[] = [];
  const contents = readFileSync(envPath, "utf8");

  for (const line of contents.split(/\r?\n/)) {
    const parsed = parseLine(line);

    if (parsed === undefined) {
      continue;
    }

    if (options.override !== true && Object.hasOwn(env, parsed.key)) {
      continue;
    }

    env[parsed.key] = parsed.value;
    keys.push(parsed.key);
  }

  return {
    keys,
    loaded: true,
    path: envPath,
  };
}
