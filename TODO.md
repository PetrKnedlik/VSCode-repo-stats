# TODO
- [ ] Find the cause of ~0.5 s lag: in-panel clicks vs. repo scans; new since the upgrade?
- [x] Replace Vite with esbuild in webview-ui (fewer deps, clears most webview vulns)
- [x] Fix webview-ui vulns (`npm audit fix`), if Vite stays
- [ ] Remove unused `ts-node` (only the deleted benchmarks used it)
- [x] make analyze repository faster (better caching?)
- [x] Evolution data range (last year, last moth, last quarter, last X months)
- [ ] Evolution: compare 'day snapshots'

## Won't do
- @types/node 26: must match VS Code's Node runtime
- secretlint deprecation warning: comes from inside vsce, needs an upstream fix
