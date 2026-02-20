# cwdeploy

This has nothing to do with deployments. It just happens to be what I use it for. `cwdeploy` matches your current directory (realpath) against a config file and runs the matching bash script in your current working directory.

Read more about my self-hosting here: https://nebezb.com/30gb-ram/

## Quick start

Create the config `~/.config/cwdeploy/config.json`
```json
{
  "routes": [
    {
      "name": "Example App",
      "path": "/absolute/path/to/your/app",
      "script": "./scripts/example-deploy.sh"
    }
  ]
}
```

Then cd to `/absolute/path/to/your/app` and run:

```
deno run --allow-read --allow-run --allow-env jsr:@nebez/cwdeploy@0.1.0
```

## Install

**Remote run** (preferred)

 If you choose to invoke it remotely, I recommend you pin the version for stability. I personally alias it. Deno will cache the script so you'll only download it the first time it's executed. 

```bash
alias cwdeploy=deno run --allow-read --allow-run --allow-env jsr:@nebez/cwdeploy@0.1.0

# or, through github

alias cwdeploy=deno run --allow-read --allow-run --allow-env https://raw.githubusercontent.com/nebez/cwdeploy/main/cwdeploy.ts
```

**Deno global install**

If you install it through deno you get versioning/upgrades built-in.

```bash
deno install -f -n cwdeploy --allow-read --allow-run --allow-env jsr:@nebez/cwdeploy
```

## Config

You can choose to pass a `--config` switch to `cwdeploy` when you invoke it or rely on default lookup.

The config file lookup order is:

1. `--config /path/to/config.json`
2. `CWDEPLOY_CONFIG=/path/to/config.json`
3. `$XDG_CONFIG_HOME/cwdeploy/config.json`
4. `$HOME/.config/cwdeploy/config.json`
