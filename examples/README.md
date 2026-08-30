# Examples

## Copper Beetle

`copper-beetle/copper-beetle.geo.json` is a small original Bedrock-style entity made for this repository. Its split shell, head, eyes, antennae, mandibles, and six legs make the fixed views easier to understand than a generic two-cube fixture.

The matching atlas is generated deterministically from project-owned color data:

```powershell
npm.cmd run demo:texture
```

Both source files and the generated PNG are covered by the repository's MIT License. The example is intended to demonstrate static geometry and texture rendering; it has not been tested as a complete in-game entity.
