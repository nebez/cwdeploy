import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_DIR = dirname(THIS_FILE);
const DEPLOY_SCRIPT = join(REPO_DIR, "cwdeploy.ts");
const decoder = new TextDecoder();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function stripAnsi(input: string): string {
  return input.replace(/\x1b\[[0-9;]*m/g, "");
}

async function writeFile(path: string, content: string): Promise<void> {
  await Deno.writeTextFile(path, content);
}

async function runDeploy(options: {
  cwd: string;
  configPath?: string;
  env?: Record<string, string>;
  args?: string[];
}): Promise<{ code: number; stdout: string; stderr: string; output: string }> {
  const env: Record<string, string> = {
    ...(options.env ?? {}),
  };
  if (options.configPath) {
    env.CWDEPLOY_CONFIG = options.configPath;
  }

  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-run",
      "--allow-env",
      DEPLOY_SCRIPT,
      ...(options.args ?? []),
    ],
    cwd: options.cwd,
    env,
    stdout: "piped",
    stderr: "piped",
  });

  const result = await command.output();
  const stdout = decoder.decode(result.stdout);
  const stderr = decoder.decode(result.stderr);
  return {
    code: result.code,
    stdout,
    stderr,
    output: `${stdout}${stderr}`,
  };
}

Deno.test("no match prints all configured routes and marks invalid ones", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "deploy-test-no-match-" });
  try {
    const appDir = join(tempDir, "app");
    const runDir = join(tempDir, "run");
    const scriptsDir = join(tempDir, "scripts");
    await Deno.mkdir(appDir, { recursive: true });
    await Deno.mkdir(runDir, { recursive: true });
    await Deno.mkdir(scriptsDir, { recursive: true });

    const deployScript = join(scriptsDir, "deploy.sh");
    await writeFile(
      deployScript,
      "#!/usr/bin/env bash\nset -euo pipefail\necho SHOULD_NOT_RUN\n",
    );

    const configPath = join(tempDir, "test_routes.json");
    const missingPath = join(tempDir, "missing");
    await writeFile(
      configPath,
      JSON.stringify(
        {
          routes: [
            { name: "Valid App", path: appDir, script: deployScript },
            { name: "Bad App", path: missingPath, script: deployScript },
          ],
        },
        null,
        2,
      ),
    );

    const result = await runDeploy({
      cwd: runDir,
      args: ["--config", configPath, "-y"],
    });
    const output = stripAnsi(result.output);

    assert(result.code === 2, `expected exit code 2, got ${result.code}`);
    assert(
      output.includes("No deploy route matched this directory."),
      "missing no-match message",
    );
    assert(output.includes("- Valid App"), "missing valid route listing");
    assert(
      output.includes("- Bad App (invalid)"),
      "missing invalid route marker",
    );
    assert(
      !output.includes("SHOULD_NOT_RUN"),
      "deploy script should not run on no match",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("exact match runs deployment script in current working directory", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "deploy-test-match-" });
  try {
    const appDir = join(tempDir, "app");
    const scriptsDir = join(tempDir, "scripts");
    await Deno.mkdir(appDir, { recursive: true });
    await Deno.mkdir(scriptsDir, { recursive: true });

    const deployScript = join(scriptsDir, "deploy.sh");
    await writeFile(
      deployScript,
      "#!/usr/bin/env bash\nset -euo pipefail\necho SCRIPT_PWD=$PWD\n",
    );

    const configPath = join(tempDir, "test_routes.json");
    await writeFile(
      configPath,
      JSON.stringify(
        {
          routes: [{ name: "App", path: appDir, script: deployScript }],
        },
        null,
        2,
      ),
    );

    const result = await runDeploy({
      cwd: appDir,
      args: ["--config", configPath, "-y"],
    });
    const output = stripAnsi(result.output);
    const expectedCwdRealPath = await Deno.realPath(appDir);
    const scriptPwdLine = output.split("\n").find((line) =>
      line.startsWith("SCRIPT_PWD=")
    );
    const expectedScriptLine = ` Script: ${deployScript}`;

    assert(result.code === 0, `expected exit code 0, got ${result.code}`);
    assert(output.includes("↯ cwdeploy"), "missing deploy header line");
    assert(
      !output.includes("↯ deploy\n"),
      "unexpected secondary deploy banner",
    );
    assert(output.includes("Matched: App"), "missing matched route line");
    assert(output.includes(expectedScriptLine), "missing aligned script line");
    assert(scriptPwdLine, "missing SCRIPT_PWD output from deployment script");
    const scriptPwd = scriptPwdLine.slice("SCRIPT_PWD=".length);
    const scriptPwdRealPath = await Deno.realPath(scriptPwd);
    assert(
      scriptPwdRealPath === expectedCwdRealPath,
      `script did not inherit caller cwd (expected ${expectedCwdRealPath}, got ${scriptPwdRealPath})`,
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("symlink cwd matches route by realpath", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "deploy-test-symlink-" });
  try {
    const realAppDir = join(tempDir, "real-app");
    const linkAppDir = join(tempDir, "link-app");
    const scriptsDir = join(tempDir, "scripts");
    await Deno.mkdir(realAppDir, { recursive: true });
    await Deno.mkdir(scriptsDir, { recursive: true });
    await Deno.symlink(realAppDir, linkAppDir, { type: "dir" });

    const deployScript = join(scriptsDir, "deploy.sh");
    await writeFile(
      deployScript,
      "#!/usr/bin/env bash\nset -euo pipefail\necho SYMLINK_TEST_OK\n",
    );

    const configPath = join(tempDir, "test_routes.json");
    await writeFile(
      configPath,
      JSON.stringify(
        {
          routes: [{
            name: "Real App",
            path: realAppDir,
            script: deployScript,
          }],
        },
        null,
        2,
      ),
    );

    const result = await runDeploy({
      cwd: linkAppDir,
      args: ["--config", configPath, "-y"],
    });
    const output = stripAnsi(result.output);
    const realCwd = await Deno.realPath(linkAppDir);

    assert(result.code === 0, `expected exit code 0, got ${result.code}`);
    assert(
      output.includes("Matched: Real App"),
      "expected symlink cwd to match route by realpath",
    );
    assert(
      output.includes(`running in ${realCwd}`),
      "header should print canonical path",
    );
    assert(
      output.includes("SYMLINK_TEST_OK"),
      "expected deploy script to execute",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("invalid config exits with error", async () => {
  const tempDir = await Deno.makeTempDir({
    prefix: "deploy-test-invalid-config-",
  });
  try {
    const configPath = join(tempDir, "test_routes.json");
    await writeFile(configPath, "{}\n");

    const result = await runDeploy({
      cwd: tempDir,
      args: ["--config", configPath, "-y"],
    });
    const output = stripAnsi(result.output);

    assert(result.code === 1, `expected exit code 1, got ${result.code}`);
    assert(
      output.includes("must be an object with a 'routes' array."),
      "expected parse/validation error message",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("uses CWDEPLOY_CONFIG when set", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "deploy-test-env-config-" });
  try {
    const appDir = join(tempDir, "app");
    const scriptsDir = join(tempDir, "scripts");
    const runDir = join(tempDir, "run");
    await Deno.mkdir(appDir, { recursive: true });
    await Deno.mkdir(scriptsDir, { recursive: true });
    await Deno.mkdir(runDir, { recursive: true });

    const deployScript = join(scriptsDir, "deploy.sh");
    await writeFile(
      deployScript,
      "#!/usr/bin/env bash\nset -euo pipefail\necho ENV_CONFIG_OK\n",
    );

    const configPath = join(tempDir, "config.json");
    await writeFile(
      configPath,
      JSON.stringify(
        {
          routes: [{ name: "Env App", path: runDir, script: deployScript }],
        },
        null,
        2,
      ),
    );

    const result = await runDeploy({
      cwd: runDir,
      args: ["-y"],
      env: {
        CWDEPLOY_CONFIG: configPath,
      },
    });
    const output = stripAnsi(result.output);

    assert(result.code === 0, `expected exit code 0, got ${result.code}`);
    assert(output.includes("Matched: Env App"), "expected env config match");
    assert(output.includes("ENV_CONFIG_OK"), "expected deploy script to run");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("loads default config from XDG_CONFIG_HOME first", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "deploy-test-xdg-config-" });
  try {
    const xdgDir = join(tempDir, "xdg");
    const homeDir = join(tempDir, "home");
    const runDir = join(tempDir, "run");
    const scriptsDir = join(tempDir, "scripts");
    const appDir = join(tempDir, "app");
    await Deno.mkdir(runDir, { recursive: true });
    await Deno.mkdir(scriptsDir, { recursive: true });
    await Deno.mkdir(appDir, { recursive: true });

    const deployScript = join(scriptsDir, "deploy.sh");
    await writeFile(
      deployScript,
      "#!/usr/bin/env bash\nset -euo pipefail\necho SHOULD_NOT_RUN\n",
    );

    const xdgConfigPath = join(xdgDir, "cwdeploy", "config.json");
    await Deno.mkdir(dirname(xdgConfigPath), { recursive: true });
    await writeFile(
      xdgConfigPath,
      JSON.stringify(
        {
          routes: [{ name: "XDG App", path: appDir, script: deployScript }],
        },
        null,
        2,
      ),
    );

    const result = await runDeploy({
      cwd: runDir,
      args: ["-y"],
      env: {
        XDG_CONFIG_HOME: xdgDir,
        HOME: homeDir,
        CWDEPLOY_CONFIG: "",
      },
    });
    const output = stripAnsi(result.output);

    assert(result.code === 2, `expected exit code 2, got ${result.code}`);
    assert(
      output.includes(`Configured routes (loaded ${xdgConfigPath}):`),
      "expected xdg config path",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("falls back to HOME config when XDG config does not exist", async () => {
  const tempDir = await Deno.makeTempDir({
    prefix: "deploy-test-home-config-",
  });
  try {
    const xdgDir = join(tempDir, "xdg");
    const homeDir = join(tempDir, "home");
    const homeConfigPath = join(homeDir, ".config", "cwdeploy", "config.json");
    const runDir = join(tempDir, "run");
    const appDir = join(tempDir, "app");
    const scriptsDir = join(tempDir, "scripts");
    await Deno.mkdir(runDir, { recursive: true });
    await Deno.mkdir(appDir, { recursive: true });
    await Deno.mkdir(scriptsDir, { recursive: true });
    await Deno.mkdir(dirname(homeConfigPath), { recursive: true });

    const deployScript = join(scriptsDir, "deploy.sh");
    await writeFile(
      deployScript,
      "#!/usr/bin/env bash\nset -euo pipefail\necho SHOULD_NOT_RUN\n",
    );
    await writeFile(
      homeConfigPath,
      JSON.stringify(
        {
          routes: [{ name: "HOME App", path: appDir, script: deployScript }],
        },
        null,
        2,
      ),
    );

    const result = await runDeploy({
      cwd: runDir,
      args: ["-y"],
      env: {
        XDG_CONFIG_HOME: xdgDir,
        HOME: homeDir,
        CWDEPLOY_CONFIG: "",
      },
    });
    const output = stripAnsi(result.output);

    assert(result.code === 2, `expected exit code 2, got ${result.code}`);
    assert(
      output.includes(`Configured routes (loaded ${homeConfigPath}):`),
      "expected HOME fallback config path",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("errors when no config exists in XDG or HOME and no overrides are set", async () => {
  const tempDir = await Deno.makeTempDir({
    prefix: "deploy-test-no-default-config-",
  });
  try {
    const xdgDir = join(tempDir, "xdg");
    const homeDir = join(tempDir, "home");
    await Deno.mkdir(xdgDir, { recursive: true });
    await Deno.mkdir(homeDir, { recursive: true });

    const result = await runDeploy({
      cwd: tempDir,
      args: ["-y"],
      env: {
        XDG_CONFIG_HOME: xdgDir,
        HOME: homeDir,
        CWDEPLOY_CONFIG: "",
      },
    });
    const output = stripAnsi(result.output);

    const xdgConfigPath = join(xdgDir, "cwdeploy", "config.json");
    const homeConfigPath = join(homeDir, ".config", "cwdeploy", "config.json");

    assert(result.code === 1, `expected exit code 1, got ${result.code}`);
    assert(
      output.includes("No config found. Checked:"),
      "expected missing config error",
    );
    assert(output.includes(xdgConfigPath), "expected XDG path in error");
    assert(output.includes(homeConfigPath), "expected HOME path in error");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
