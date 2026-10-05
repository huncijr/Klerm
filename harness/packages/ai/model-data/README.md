# Public build-time model catalog baseline

`baseline.tar.gz` contains only the generated public provider/model metadata and
its validation manifest, not credentials, provider authentication or user state.
`baseline.sha256` pins the archive bytes. The existing model-data validator checks
the restored files against this source revision before a build proceeds.

`npm run hydrate:model-data` restores this baseline offline when model data is
missing. This makes fresh Windows/macOS CI and Docker builds reproducible even
when upstream catalogs drop providers. Existing valid local data is retained.

To deliberately refresh, from `harness`:

```bash
npm run generate:models
npm run snapshot:model-data
npm run check:model-data
```

Review the generated source changes, public catalog and snapshot together and
commit them as one update. `npm run refresh:model-data` retains the previous
live-API data-only hydration command; it can fail if an expected provider is
missing, and is not used by reproducible builds.
