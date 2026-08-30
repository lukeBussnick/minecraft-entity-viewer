# Third-party software

Minecraft Entity Viewer is licensed under the MIT License. Its npm dependencies remain under their own licenses and are installed separately by `npm ci`:

- `three` 0.179.1 — MIT License, copyright the three.js authors.
- `playwright-core` 1.62.1 — Apache License 2.0, with the notices included in the installed package.

The repository does not vendor either dependency. Their exact resolved versions and integrity hashes are recorded in `package-lock.json`.

The Copper Beetle example geometry, deterministic texture generator, generated texture, and contact-sheet screenshot were created specifically for this repository and are covered by the repository's MIT License.
