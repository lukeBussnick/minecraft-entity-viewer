# Examples

## Copper Beetle

`copper-beetle/copper-beetle.geo.json` is a small original Bedrock-style entity made for this repository. Its split shell, head, eyes, antennae, mandibles, and six legs give an agent recognizable structure to inspect across fixed views instead of a generic two-cube fixture.

The matching atlas is generated deterministically from project-owned color data:

```powershell
npm.cmd run demo:texture
```

Both source files and the generated PNG are covered by the repository's MIT License. The example is intended to demonstrate static geometry and texture rendering; it has not been tested as a complete in-game entity.

Run the full agent evidence capture with:

```powershell
node scripts\capture.mjs --model "examples\copper-beetle\copper-beetle.geo.json" --texture "examples\copper-beetle\copper-beetle.png" --out "captures\copper-beetle-agent-demo" --agent --json
```
