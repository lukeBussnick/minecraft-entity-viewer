# AGENTS.md — Minecraft Entity Viewer

## Purpose

Use this repository as the local visual-inspection tool for Minecraft mob projects. The intended loop is: modify the source model in Blockbench, render it here, compare against the user's reference image, make a bounded revision, and repeat. Do not claim that a model matches the reference based only on source JSON inspection.

## Fast operating procedure

1. Read `README.md`, especially **Accuracy boundaries** and **View directions**.
2. Locate the mob's `.bbmodel` or Bedrock `.geo.json` and PNG atlas. Preserve the user's original files.
3. Create a new iteration folder inside that mob project's own diagnostics/captures area when one exists. Otherwise use this tool's ignored `captures/` folder.
4. Run:

   ```powershell
   npm.cmd run capture -- --model "ABSOLUTE_MODEL_PATH" --texture "ABSOLUTE_TEXTURE_PATH" --out "ABSOLUTE_OUTPUT_FOLDER"
   ```

   Omit `--texture` only when the `.bbmodel` embeds its texture.
5. Inspect `contact-sheet.png` and, when details matter, the individual PNGs. Compare like-for-like angles to the reference. State whether each observation is visible evidence, an inference, or still unverified in Minecraft.
6. Make one coherent model/texture revision at a time. Re-capture to a separately named iteration folder so before/after evidence remains available.
7. Validate the final candidate in Minecraft for animations, render controllers, Molang, entity scaling, materials, lighting, and gameplay attachment behavior. This viewer cannot prove those runtime outcomes.

## Fixed-view contract

- Front: camera on negative Z, looking positive Z.
- Back: camera on positive Z, looking negative Z.
- Left: camera on negative X, looking positive X.
- Right: camera on positive X, looking negative X.
- Top/Bottom: positive/negative Y.
- All six fixed directions are orthographic and automatically framed.
- Do not silently rename views to fit a model. If the authored forward axis is reversed, document that Back is the practical front for that project.

## Safe editing rules

- Do not overwrite or rename Blockbench model/texture identifiers unless the mob project requires it.
- Do not edit the original reference image.
- Preserve previous captures; use iteration names such as `iteration-01-baseline`, `iteration-02-head-width`.
- Treat the local mob repository as source of truth. This viewer should consume copies/paths, not become the model source of truth.
- Run `npm.cmd test` after changing parser, transforms, UV mapping, camera behavior, or capture automation.

## Known limits

The renderer covers static cube geometry, bone/group transforms, cube pivots/rotations, texture UVs, inflate, and transparent PNG pixels. It does not reproduce the full Bedrock render pipeline. Multiple texture atlases in one `.bbmodel` are not yet mapped per cube. Minecraft runtime testing is still required before declaring the mob complete.
