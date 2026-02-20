#!/usr/bin/env -S deno run --allow-read --allow-run --allow-env

import { dirname, isAbsolute, resolve } from "node:path";

type RouteConfig = {
  name?: string;
  path: string;
  script: string;
};

type ConfigFile = {
  routes: RouteConfig[];
};

type ResolvedRoute = {
  name: string;
  canonicalPath: string;
  scriptPath: string;
};

type ListedRoute = {
  name: string;
  path: string;
  script: string;
  invalid: boolean;
};

type RouteResolution = {
  routes: ResolvedRoute[];
  listedRoutes: ListedRoute[];
};

type ParsedArgs = {
  autoYes: boolean;
  configOverride?: string;
};

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
};

function colorize(text: string, color: keyof typeof COLORS): string {
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

function boldGreen(text: string): string {
  return `${COLORS.green}${COLORS.bold}${text}${COLORS.reset}`;
}

function boldRed(text: string): string {
  return `${COLORS.red}${COLORS.bold}${text}${COLORS.reset}`;
}

function expandHomePath(inputPath: string): string {
  if (!inputPath.startsWith("~")) return inputPath;

  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
  if (!home) {
    throw new Error(
      "Unable to expand '~' because HOME/USERPROFILE is not set.",
    );
  }

  if (inputPath === "~") return home;
  if (inputPath.startsWith("~/") || inputPath.startsWith("~\\")) {
    return resolve(home, inputPath.slice(2));
  }

  return inputPath;
}

function resolveMaybeRelativePath(configDir: string, rawPath: string): string {
  const withHome = expandHomePath(rawPath);
  return isAbsolute(withHome) ? withHome : resolve(configDir, withHome);
}

function resolveUserPath(rawPath: string): string {
  const expanded = expandHomePath(rawPath);
  return isAbsolute(expanded) ? expanded : resolve(Deno.cwd(), expanded);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

function parseArgs(args: string[]): ParsedArgs {
  let autoYes = false;
  let configOverride: string | undefined;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "-y" || arg === "--yes") {
      autoYes = true;
      continue;
    }

    if (arg === "--config") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Missing value for --config.");
      }
      configOverride = value;
      index++;
      continue;
    }

    if (arg.startsWith("--config=")) {
      const value = arg.slice("--config=".length);
      if (!value) {
        throw new Error("Missing value for --config.");
      }
      configOverride = value;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { autoYes, configOverride };
}

async function resolveConfigPath(parsedArgs: ParsedArgs): Promise<string> {
  if (parsedArgs.configOverride) {
    const configPath = resolveUserPath(parsedArgs.configOverride);
    if (!(await pathExists(configPath))) {
      throw new Error(`Config not found: ${configPath}`);
    }
    return configPath;
  }

  const envConfigPath = Deno.env.get("CWDEPLOY_CONFIG");
  if (envConfigPath) {
    const configPath = resolveUserPath(envConfigPath);
    if (!(await pathExists(configPath))) {
      throw new Error(
        `Config not found: ${configPath}`,
      );
    }
    return configPath;
  }

  const xdgConfigHome = Deno.env.get("XDG_CONFIG_HOME");
  const homeDir = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
  const checkedPaths: string[] = [];

  if (xdgConfigHome) {
    const xdgConfigPath = resolve(xdgConfigHome, "cwdeploy", "config.json");
    checkedPaths.push(xdgConfigPath);
    if (await pathExists(xdgConfigPath)) return xdgConfigPath;
  }

  if (homeDir) {
    const homeConfigPath = resolve(
      homeDir,
      ".config",
      "cwdeploy",
      "config.json",
    );
    checkedPaths.push(homeConfigPath);
    if (await pathExists(homeConfigPath)) return homeConfigPath;
  }

  if (checkedPaths.length === 0) {
    throw new Error(
      "Config not found: both XDG_CONFIG_HOME and HOME/USERPROFILE are unset, and no --config or CWDEPLOY_CONFIG was provided.",
    );
  }

  throw new Error(`Config not found. Checked:\n- ${checkedPaths.join("\n- ")}`);
}

function parseConfig(text: string, configPath: string): ConfigFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${configPath}: ${(error as Error).message}`,
    );
  }

  if (!parsed || typeof parsed !== "object" || !("routes" in parsed)) {
    throw new Error(
      `Config ${configPath} must be an object with a 'routes' array.`,
    );
  }

  const routes = (parsed as { routes: unknown }).routes;
  if (!Array.isArray(routes)) {
    throw new Error(
      `Config ${configPath} has invalid 'routes'; expected an array.`,
    );
  }

  for (const [index, route] of routes.entries()) {
    if (!route || typeof route !== "object") {
      throw new Error(`Config route #${index} is invalid; expected an object.`);
    }

    const typedRoute = route as {
      path?: unknown;
      script?: unknown;
      name?: unknown;
    };
    if (typeof typedRoute.path !== "string" || typedRoute.path.length === 0) {
      throw new Error(
        `Config route #${index} must include a non-empty string 'path'.`,
      );
    }
    if (
      typeof typedRoute.script !== "string" || typedRoute.script.length === 0
    ) {
      throw new Error(
        `Config route #${index} must include a non-empty string 'script'.`,
      );
    }
    if (
      typedRoute.name !== undefined &&
      (typeof typedRoute.name !== "string" || typedRoute.name.length === 0)
    ) {
      throw new Error(
        `Config route #${index} has invalid 'name'; expected a non-empty string.`,
      );
    }
  }

  return parsed as ConfigFile;
}

async function resolveRoutes(
  configPath: string,
  config: ConfigFile,
): Promise<RouteResolution> {
  const configDir = dirname(configPath);
  const resolved: ResolvedRoute[] = [];
  const listedRoutes: ListedRoute[] = [];

  for (const route of config.routes) {
    const name = route.name ?? route.path;
    let appPath = route.path;
    let scriptPath = route.script;

    try {
      appPath = resolveMaybeRelativePath(configDir, route.path);
      scriptPath = resolveMaybeRelativePath(configDir, route.script);
      const canonicalPath = await Deno.realPath(appPath);

      resolved.push({
        name,
        canonicalPath,
        scriptPath,
      });
      listedRoutes.push({
        name,
        path: canonicalPath,
        script: scriptPath,
        invalid: false,
      });
    } catch (error) {
      listedRoutes.push({
        name,
        path: appPath,
        script: scriptPath,
        invalid: true,
      });
    }
  }

  return { routes: resolved, listedRoutes };
}

async function readSingleKeypress(): Promise<string> {
  const buffer = new Uint8Array(8);
  Deno.stdin.setRaw(true, { cbreak: true });
  try {
    const bytesRead = await Deno.stdin.read(buffer);
    if (!bytesRead) return "";
    return new TextDecoder().decode(buffer.subarray(0, bytesRead));
  } finally {
    Deno.stdin.setRaw(false);
  }
}

async function askToContinue(): Promise<boolean> {
  if (!Deno.stdin.isTerminal()) return true;

  console.log(colorize("Press [Enter] to deploy or [q] to cancel.", "yellow"));
  const key = await readSingleKeypress();
  if (key === "q" || key === "Q" || key === "\u0003") return false;
  return key === "\r" || key === "\n";
}

async function runDeployment(scriptPath: string): Promise<number> {
  const scriptRealPath = await Deno.realPath(scriptPath);
  const child = new Deno.Command("bash", {
    args: [scriptRealPath],
    cwd: Deno.cwd(),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  const status = await child.status;
  return status.code;
}

async function main(): Promise<void> {
  const parsedArgs = parseArgs(Deno.args);
  const configPath = await resolveConfigPath(parsedArgs);
  const autoYes = parsedArgs.autoYes;
  const currentPath = await Deno.realPath(Deno.cwd());

  const configText = await Deno.readTextFile(configPath);
  const config = parseConfig(configText, configPath);
  const { routes, listedRoutes } = await resolveRoutes(configPath, config);
  const match = routes.find((route) => route.canonicalPath === currentPath);

  console.log(
    `${colorize("↯ cwdeploy", "green")} ${
      colorize("running in", "gray")
    } ${currentPath}`,
  );
  console.log("");

  if (!match) {
    console.log(colorize("No deploy route matched this directory.", "red"));
    console.log("");
    console.log(`Configured routes (loaded ${colorize(configPath, "gray")}):`);
    if (listedRoutes.length === 0) {
      console.log("- (none)");
    }
    for (const route of listedRoutes) {
      const invalidTag = route.invalid ? ` ${boldRed("(invalid)")}` : "";
      console.log(`- ${route.name}${invalidTag}`);
      console.log(`  path: ${route.path}`);
      console.log(`  script: ${route.script}`);
    }
    Deno.exit(2);
  }

  const labels = {
    matched: "Matched",
    script: "Script",
  };
  const labelWidth = Math.max(labels.matched.length, labels.script.length);
  console.log(
    `${labels.matched.padStart(labelWidth)}: ${boldGreen(match.name)}`,
  );
  console.log(`${labels.script.padStart(labelWidth)}: ${match.scriptPath}`);
  console.log("");

  if (!autoYes) {
    const shouldRun = await askToContinue();
    if (!shouldRun) {
      console.log(colorize("Cancelled.", "yellow"));
      Deno.exit(0);
    }
  }

  const code = await runDeployment(match.scriptPath);
  Deno.exit(code);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(colorize(`Error: ${message}`, "red"));
    Deno.exit(1);
  }
}
