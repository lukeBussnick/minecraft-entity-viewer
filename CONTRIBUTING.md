# Contributing

Minecraft Entity Viewer is intentionally a small, local visual-inspection tool. Contributions should strengthen that workflow without turning it into a general-purpose model editor or Minecraft runtime emulator.

## Before opening a change

1. Install dependencies with `npm.cmd ci` on Windows (`npm ci` in other shells).
2. Run `npm.cmd test`.
3. If the change affects parsing, transforms, UV mapping, cameras, rendering, or capture automation, run a capture against the model and texture in `examples/copper-beetle/` and inspect the seven-view contact sheet.
4. Keep generated captures, private models, textures, reference images, and machine-specific paths out of the repository.

When reporting a visual result, distinguish viewer evidence from Minecraft runtime evidence. This project cannot validate animations, render controllers, Molang, materials, entity scaling, or in-game attachment behavior.
