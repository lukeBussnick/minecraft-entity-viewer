# AGENTS.md — Minecraft Entity Viewer

## Purpose

This repository is an agent-first visual evidence renderer for Minecraft mob work. Use it when source JSON inspection is not enough to judge the model that Blockbench or Minecraft will render.

The intended loop is:

1. Make one bounded model or texture revision in the mob project's source of truth.
2. Capture deterministic visual and diagnostic evidence here.
3. Inspect the evidence, compare it with the prior iteration or reference, and identify a specific discrepancy.
4. Revise and repeat.
5. Validate the final candidate in Minecraft for runtime-only behavior.

Do not claim that a model matches a reference based only on source inspection, and do not treat viewer evidence as Minecraft runtime evidence.

## Fast operating procedure

1. Read `README.md`, especially **Agent capture interface**, **View directions**, and **Accuracy boundaries**.
2. Locate the mob's `.bbmodel` or Bedrock `.geo.json` and PNG atlas. Preserve the original files.
3. Create a uniquely named iteration folder inside the mob project's diagnostics/captures area when one exists. Otherwise use this repository's ignored `captures/` folder.
4. Run the full agent evidence preset:

   ```powershell
   node scripts\capture.mjs --model "ABSOLUTE_MODEL_PATH" --texture "ABSOLUTE_TEXTURE_PATH" --out "ABSOLUTE_NEW_OUTPUT_FOLDER" --agent --json
   ```

   Omit `--texture` only when the `.bbmodel` embeds its texture. Use `--geometry` when the input has more than one geometry.
5. Read stdout and `capture-manifest.json` first. Treat any structured warning as part of the evidence record.
6. Inspect `contact-sheet.png` and relevant individual beauty, mask, clay, parts, and surface-boundary artifacts. State whether each conclusion is visible evidence, an inference, or still unverified in Minecraft.
7. After another capture, compare like-for-like evidence:

   ```powershell
   node scripts\compare-captures.mjs --baseline "ABSOLUTE_BASELINE_CAPTURE" --candidate "ABSOLUTE_CANDIDATE_CAPTURE" --out "ABSOLUTE_NEW_COMPARISON_FOLDER" --json
   ```

8. Use comparison metrics to locate change, not to declare improvement without design or reference evidence.
9. Validate the final candidate in Minecraft for animations, render controllers, Molang, entity scaling, materials, lighting, and gameplay attachment behavior.

## Fixed-view contract

- Front: camera on negative Z, looking positive Z.
- Back: camera on positive Z, looking negative Z.
- Left: camera on negative X, looking positive X.
- Right: camera on positive X, looking negative X.
- Top/Bottom: positive/negative Y.
- All six fixed directions are orthographic and automatically framed.
- Do not silently rename views. If the authored forward axis is reversed, document that Back is the practical front for that project.
- Keep view sets and camera parameters equal for iteration comparisons.

## Evidence contract

- `capture-manifest.json` is the authoritative record of inputs, hashes, geometry selection, settings, warnings, runtime, artifacts, and proof boundaries.
- Beauty renders support visual inspection; masks support exact silhouette comparison; clay renders expose form; part renders and legends expose cube ownership; surface-boundary JSON exposes frontmost contour ownership and camera-space evidence.
- `comparison.json` reports pixel and silhouette change. It does not report semantic correctness or design quality.
- Manual reference overlay is available in the browser GUI, but arbitrary reference alignment is not automated.

## Safe editing rules

- Do not overwrite or rename model/texture identifiers unless the mob project requires it.
- Do not edit the original reference image.
- Never reuse a capture output directory. Use names such as `iteration-01-baseline` and `iteration-02-head-width`.
- Treat the mob repository as the model source of truth. This viewer consumes paths; it does not own the model.
- Run `npm.cmd test` after changing the parser, transforms, UV mapping, cameras, diagnostics, capture automation, manifests, or comparison logic.
- Preserve previous captures so before/after evidence remains auditable.

## Known limits

The renderer covers static cube geometry, transforms, UVs, inflate, transparency, silhouette, and visible part ownership. It does not reproduce the full Bedrock runtime. Multiple atlases are not mapped per cube. Reference semantics, animation behavior, materials, Molang, render controllers, and gameplay behavior require other evidence, including a fresh Minecraft test where applicable.
