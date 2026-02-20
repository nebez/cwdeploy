# cwdeploy

This has nothing to do with deployments. It just happens to be what I use it for. `cwdeploy` matches your current directory (realpath) against a config file and runs the matching bash script in your current working directory.

Read more about my self-hosting here: https://nebezb.com/30gb-ram/

## Quick start

Make sure you have `deno` installed.

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

```sh
deno run --allow-read --allow-run --allow-env jsr:@nebez/cwdeploy@0.2.0
```

## Install

**Remote run** (preferred)

This is how I prefer to run it. Deno will cache the script so you'll only download it the first time it's executed.

Setup an alias for it somewhere in your environment (I use [home-manager](https://github.com/nebez/home/blob/92198cfa008ffd9fc06effece11b49e8aa43148b/.config/home-manager/home.nix#L52)) and I recommend you pin a version for stability.

```sh
alias cwdeploy=deno run --allow-read --allow-run --allow-env jsr:@nebez/cwdeploy@0.2.0

# or through github

alias cwdeploy=deno run --allow-read --allow-run --allow-env https://raw.githubusercontent.com/nebez/cwdeploy/refs/heads/main/cwdeploy.ts
```

**Deno global install**

If you install it through deno you get versioning/upgrades built-in. I haven't tested this.

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
