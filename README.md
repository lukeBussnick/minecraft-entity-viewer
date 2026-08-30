# Minecraft Entity Viewer

Minecraft Entity Viewer is a local evidence renderer for AI coding agents that work on Blockbench and Minecraft Bedrock entity models.

It was built to solve a specific iteration problem: an agent such as Codex could edit model JSON and texture pixels, but source inspection alone could not show whether the resulting silhouette, proportions, cube placement, or UV work had actually improved. The viewer closes that gap with a repeatable loop:

**agent edits model or texture → viewer captures fixed evidence → agent inspects and compares → agent makes a bounded revision → repeat**

![Seven-view contact sheet of the included Copper Beetle demo](docs/images/sample-contact-sheet.png)

Blockbench remains the authoring environment. Minecraft remains the final runtime validator. This project supplies the fast intermediate visual evidence between them.

**Status:** usable v1.0 local tool. The parser, transforms, UV behavior, server boundary, command-line capture path, structured evidence, and capture comparison path are tested.

## Who it is for

AI coding agents such as Codex are the primary intended users. The deterministic command-line capture path is the core interface: it produces predictable image and JSON artifacts that an agent can inspect, retain, and compare without operating the GUI.

Humans can also use the browser viewer for interactive inspection and manual reference overlays. That interface is useful, but secondary to the agent capture loop. The viewer is not a replacement for Blockbench or Minecraft.

## What it renders

- Blockbench `.bbmodel` project files
- Minecraft Bedrock `.geo.json` files using `minecraft:geometry`
- PNG texture atlases, including a texture embedded in a `.bbmodel`
- fixed front, back, left, right, top, bottom, and perspective views
- orthographic cameras and automatic framing for the six directional views
- nearest-neighbor, unlit texture rendering and cutout transparency
- optional masks, lit clay renders, deterministic part-ID renders, and surface-boundary records
- a contact sheet, source hashes, warnings, camera settings, and an artifact index

## Setup

Requirements: Node.js 20+ and Microsoft Edge.

```powershell
npm.cmd ci
```

Dependencies are local to this folder. Normal viewing and capture do not upload models, textures, references, or results.

## Agent capture interface

Use a new output directory for every iteration. `--agent` enables the full evidence preset: beauty renders, masks, clay renders, part IDs, and surface boundaries. `--json` makes stdout a single machine-readable result.

```powershell
node scripts\capture.mjs `
  --model "C:\path\model.geo.json" `
  --texture "C:\path\texture.png" `
  --out "C:\project\diagnostics\iteration-01-baseline" `
  --agent `
  --json
```

For a `.bbmodel` with an embedded texture, omit `--texture`. If a file contains more than one geometry, select one explicitly by index or exact identifier:

```powershell
node scripts\capture.mjs --model "C:\path\model.bbmodel" --geometry "geometry.example" --out "C:\path\iteration-02" --agent --json
```

The capture command refuses to write into a non-empty output directory. This prevents an agent from silently mixing or overwriting iteration evidence. A successful JSON response identifies the output directory, manifest, source hashes, and warnings. Failures use a stable code, stage, and message; after output preparation, partial failures also write `capture-error.json`.

### Capture evidence

`capture-manifest.json` is the authoritative run record. It contains:

- model and texture names and SHA-256 hashes
- selected geometry, format, bone count, cube count, and texture dimensions
- requested views, evidence channels, and camera parameters
- structured warnings and runtime versions
- a sorted artifact index with byte counts and SHA-256 hashes
- an explicit list of claims supported by the viewer and claims that still require Minecraft

The image and diagnostic artifacts serve different reasoning tasks:

| Artifact | Agent use |
|---|---|
| `<view>.png` | texture placement, apparent form, and visible visual defects |
| `<view>.mask.png` | exact silhouette and occupancy comparison |
| `<view>.clay.png` | form and intersections without texture distraction |
| `<view>.parts.png` + `part-legend.json` | deterministic visible cube ownership |
| `<view>.surface-boundaries.json` | frontmost contour ownership, face, depth, world position, normal, and fixed camera data |
| `contact-sheet.png` | compact multi-view review |
| `render-info.json` | concise human-readable run metadata |

These outputs are evidence, not an automatic quality judgment. An agent must still relate a visible discrepancy to the intended design or reference.

### Compare two iterations

Capture comparison requires two completed capture directories with manifests. It computes exact beauty-pixel change and same-camera mask changes, then writes `comparison.json` and added/removed silhouette diff images.

```powershell
node scripts\compare-captures.mjs `
  --baseline "C:\project\diagnostics\iteration-01-baseline" `
  --candidate "C:\project\diagnostics\iteration-02-head-width" `
  --out "C:\project\diagnostics\compare-01-to-02" `
  --json
```

Mask diff images use cyan for added silhouette, magenta for removed silhouette, and gray for unchanged silhouette. The report can tell an agent what pixels changed and by how much; it deliberately does not claim that the candidate is better.

### Capture selected views

Use a stable subset when only certain directions are relevant:

```powershell
node scripts\capture.mjs --model "C:\path\model.bbmodel" --views "perspective,front,left,right" --out "C:\path\shape-check-01" --agent --json
```

The contact sheet contains only the requested views. Keep the same view set and camera parameters when comparing iterations.

### Included example

The original Copper Beetle sample is a modest Bedrock-style mob with a split shell, head, eyes, antennae, mandibles, and six legs:

```powershell
node scripts\capture.mjs --model "examples\copper-beetle\copper-beetle.geo.json" --texture "examples\copper-beetle\copper-beetle.png" --out "captures\copper-beetle-agent-demo" --agent --json
```

Its geometry and deterministically generated atlas are project-owned and MIT-licensed. Generated capture folders are ignored by Git so local model evidence is not accidentally published.

## Human viewer (secondary interface)

Double-click `launch-viewer.bat`, or run `npm.cmd start`, then open [http://127.0.0.1:4173](http://127.0.0.1:4173).

The browser interface can open model, texture, and reference files; switch geometries and views; toggle grids, axes, and wireframe; orbit the perspective camera; and export the current view or a contact sheet. Its side-by-side and opacity-overlay reference modes are manual visual aids. Reference-image alignment and semantic correspondence are not currently automated by the capture CLI.

## View directions and coordinate assumptions

Bedrock geometry is converted with the same X-axis and rotation-sign adjustments Blockbench applies when importing it into its Three.js workspace. The displayed workspace uses X for left/right, Y for vertical, and Z for front/back.

| View | Camera position | Looking toward |
|---|---|---|
| Front | negative Z | positive Z |
| Back | positive Z | negative Z |
| Left | negative X | positive X |
| Right | positive X | negative X |
| Top | positive Y | negative Y |
| Bottom | negative Y | positive Y |

If a model's authored “front” is reversed, document that Back is its practical front and keep using the same labeled view across iterations.

## Accuracy boundaries

The viewer supports static cube geometry, bone/group transforms, cube pivots and rotations, texture UVs, inflate, transparent PNG pixels, silhouette, and visible part ownership.

It does not reproduce the complete Bedrock render pipeline. It cannot validate animations, render controllers, Molang expressions, entity scaling components, attachables, materials, emissive effects, in-game lighting, or gameplay behavior. Those claims require a fresh Minecraft runtime test.

If a `.bbmodel` declares several atlases, the selected texture is applied to every cube and the condition is reported as a warning. Typical single-atlas Bedrock entities are the primary target.

## Current design boundaries

- Reference comparison remains a human-guided GUI operation; the CLI has no general way to infer camera correspondence or intended semantic landmarks from an arbitrary image.
- Capture comparison measures exact visual change, not whether a design is closer to a target.
- The tool does not edit models, invoke an LLM, or emulate Minecraft.
- Each capture starts a short-lived headless browser. A persistent capture worker may reduce startup time in very large iteration campaigns, but is not currently warranted by the focused workflow.

## Verification

```powershell
npm.cmd test
node scripts\capture.mjs --model "examples\copper-beetle\copper-beetle.geo.json" --texture "examples\copper-beetle\copper-beetle.png" --out "captures\verification" --agent --json
```

For changes that affect capture evidence, repeat the same capture into another new directory and compare the artifact hashes or run `scripts\compare-captures.mjs`.

## Contributing

Small changes that strengthen the focused agent feedback loop are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for validation and evidence expectations.

## License and project names

Minecraft Entity Viewer is available under the [MIT License](LICENSE). Third-party npm dependencies remain under their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Minecraft is a trademark of Microsoft. Blockbench is a separate project. Minecraft Entity Viewer is an independent community tool and is not affiliated with or endorsed by Microsoft, Mojang Studios, or Blockbench.

## Repository map

- `AGENTS.md` — agent operating procedure and evidence boundaries
- `examples/copper-beetle/` — original demo geometry and texture
- `scripts/capture.mjs` — deterministic agent capture entry point
- `scripts/compare-captures.mjs` — iteration evidence comparison
- `src/model-builder.js` — Blockbench/Bedrock parsing, transforms, cuboids, and UVs
- `src/app.js` — renderer, cameras, diagnostics, and human viewer behavior
- `test/` — parser, renderer-contract, CLI, and evidence-metric tests
