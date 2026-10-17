# Coding standards

Judgement calls for the reviewer. Biome, Ruff and shellcheck already enforce the mechanical rules in CI; these cover what a linter can't.

## Infra scripts (`infra/**/*.sh`)

- **Idempotent**: every step checks for the resource, creates it only if it's missing, and converges partial state. A run that died between "create secret" and "add version" must finish the job on the next run, not skip it because the secret exists.
- **Loud failures**: a failed API call stops the script with its error. REST calls use `curl --fail-with-body`, and long-running operations are checked for `.error` as well as `.done`. Outside an existence check (`if describe ... >/dev/null 2>&1`), any `|| true` or `2>/dev/null` needs a comment saying why the failure is safe to ignore.
- **Secrets through stdin**: tokens, API keys and secret values reach commands through stdin or a file (`--data-file=-`, `curl -H @-`), never as arguments, where `ps` would show them.
- **JSON through `jq`**: build request bodies with `jq -n --arg` and read responses with `jq`, never by interpolating strings or matching spacing with `grep`/`sed`.
- **Platform facts verified**: quota IDs, model IDs, currencies and limits come from the platform's API or docs, and the script or `infra/gcp/README.md` says where. Specs can be wrong about what Google offers.
