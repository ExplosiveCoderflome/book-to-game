# Deploy 同福客栈营业日 to GitHub Pages

Artifact ready: this folder (`index.html` = full offline playable package).

## Option A — new public repo + Pages (recommended)

```bash
cd /path/to/tongfu-pages   # or copy this folder from the agent box
gh auth login              # if needed
gh repo create tongfu-kezhan-play --public --source=. --remote=origin --push
gh api -X POST repos/ExplosiveCoderflome/tongfu-kezhan-play/pages \
  -f build_type=legacy -f source[branch]=main -f source[path]=/
```

Public URL (after Pages builds, ~1 min):
https://explosivecoderflome.github.io/tongfu-kezhan-play/

## Option B — under user site

```bash
# clone ExplosiveCoderflome.github.io, copy index.html to tongfu/index.html + .nojekyll,
# commit & push main
# URL: https://explosivecoderflome.github.io/tongfu/
```

Export provenance: revisionId `5c354c14-4b2d-4508-b634-63dfe9192540`, manifest.ai.mode=none.
