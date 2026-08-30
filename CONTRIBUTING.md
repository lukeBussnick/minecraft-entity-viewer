# Contributing

Minecraft Entity Viewer is intentionally a small, agent-first visual evidence tool. Contributions should strengthen the edit → capture → inspect → revise loop without turning the project into a general-purpose editor, LLM framework, or Minecraft runtime emulator.

## Before opening a change

1. Install dependencies with `npm.cmd ci` on Windows (`npm ci` in other shells).
2. Run `npm.cmd test`.
3. If the change affects parsing, transforms, UVs, cameras, rendering, diagnostics, manifests, or capture automation, run the full `--agent` capture against `examples/copper-beetle/`.
4. Repeat that capture into a second new directory and use `scripts/compare-captures.mjs` when deterministic output should be unchanged.
5. Keep generated captures, private models, textures, references, and machine-specific paths out of the repository.

Changes to the capture contract should preserve predictable file names, structured warnings/errors, source hashes, no-clobber iteration directories, and the distinction between measured change and judged improvement.

When reporting a result, distinguish visible viewer evidence, inference, and Minecraft runtime evidence. This project cannot validate animations, render controllers, Molang, materials, entity scaling, in-game lighting, attachment behavior, or gameplay behavior.
