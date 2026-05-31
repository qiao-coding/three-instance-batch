# three-instance-batch

`InstancedMesh` management layer for Three.js. Handles dirty tracking, group batching, and dynamic add/remove — so you don't have to.

## Installation

```bash
npm install three-instance-batch
```

## Quick Start

```ts
import * as THREE from 'three'
import { Instance, InstanceBatcher } from 'three-instance-batch'

const batcher = new InstanceBatcher()
scene.add(batcher)

const geo = new THREE.BoxGeometry(1, 1, 1)
const mat = new THREE.MeshStandardMaterial({ color: '#ff6b6b' })

const inst = new Instance(geo, mat)
inst.position.set(3, 0, 0)
inst.color.set('#00ffcc')
inst.castShadow = true

batcher.addInstance(inst)

function animate() {
  inst.position.x = Math.sin(Date.now() * 0.001) * 5
  batcher.update(camera)
  renderer.render(scene, camera)
  requestAnimationFrame(animate)
}
```

No `setMatrixAt`. No `needsUpdate`. Just change properties and call `update()`.

## How It Works

`Instance` wraps `Vector3`, `Quaternion`, and `Color` setter methods at construction time. Any mutation — `position.set()`, `quaternion.setFromEuler()`, `color.setHSL()`, etc. — automatically marks that instance dirty. On `batcher.update()`, only the changed matrix rows and color rows are written to the GPU buffer.

Instances are grouped into `InstancedMesh` objects by a **group key** derived from geometry UUID, material properties, and shadow flags. Instances sharing the same key share one draw call.

## Multiple Geometries and Materials

The batcher handles mixed types automatically:

```ts
const meshes = [
  new Instance(boxGeo, redMat),
  new Instance(sphereGeo, blueMat),
  new Instance(boxGeo, redMat),   // same key as first → same InstancedMesh
]
batcher.addInstance(meshes)
```

Reusing the same geometry and material object is enough to share a batch.

## Shadow Changes Trigger Remigration

`castShadow` and `receiveShadow` are part of the group key. Changing them at runtime causes the instance to be moved to the correct group automatically on the next `update()`.

```ts
inst.castShadow = true  // migrates to the shadow-casting group on next update()
```

## Parent-Child Hierarchy

Instances support parent-child nesting. A child's world matrix is computed from its parent's transform chain.

```ts
const parent = new Instance(geo, mat)
const child = new Instance(geo, mat)
child.parent = parent  // child follows parent's transform

parent.position.set(0, 5, 0)
batcher.update()  // child world matrix recalculated automatically
```

Circular references are detected and rejected at runtime. Disposing a parent detaches all children but does not dispose them.

## Raycasting

```ts
const raycaster = new THREE.Raycaster()
raycaster.setFromCamera(mouse, camera)
const hits = raycaster.intersectObjects(batcher.children)

for (const hit of hits) {
  const inst = batcher.getInstanceFromIntersect(hit)
  if (inst) console.log('hit', inst.id)
}
```

## API

### `Instance`

```ts
new Instance(geometry: BufferGeometry, material: Material)
```

| Member | Type | Notes |
|---|---|---|
| `id` | `number` | Auto-incremented, readonly |
| `geometry` | `BufferGeometry` | Readonly |
| `material` | `Material` | Readonly |
| `position` | `Vector3` | Auto-tracked |
| `scale` | `Vector3` | Default `(1,1,1)`, auto-tracked |
| `quaternion` | `Quaternion` | Auto-tracked |
| `color` | `Color` | Default white, auto-tracked |
| `visible` | `boolean` | Hidden instances write a zero matrix |
| `castShadow` | `boolean` | Change triggers group remigration |
| `receiveShadow` | `boolean` | Change triggers group remigration |
| `parent` | `Instance \| null` | Setter validates against cycles |
| `children` | `Instance[]` | Readonly array |
| `disposed` | `boolean` | Readonly |
| `groupKey` | `string` | Derived from geometry, material, shadow flags |
| `localMatrix` | `Matrix4` | Readonly, computed from transform components |
| `worldMatrix` | `Matrix4` | Readonly, local × ancestor chain |
| `isAncestorOf(other)` | `boolean` | |
| `dispose()` | `void` | Detaches from parent, detaches children, unsubscribes from all batchers |

> **Note:** `rotation` (Euler) mutates are tracked and auto-sync to `quaternion`.

### `InstanceBatcher`

Extends `THREE.Group`. Add it to the scene and call `update()` every frame.

```ts
new InstanceBatcher(options?: BatcherOptions)
```

| Member | Type | Notes |
|---|---|---|
| `count` | `number` | Total managed instances |
| `groupCount` | `number` | Number of internal `InstancedMesh` groups |
| `hasDirty` | `boolean` | Whether any data needs flushing to GPU |
| `addInstance(inst \| inst[])` | `this` | Duplicates are ignored |
| `removeInstance(inst \| inst[])` | `this` | Missing instances are ignored |
| `has(inst)` | `boolean` | |
| `getMatrixAt(inst, target)` | `Matrix4` | Reads back from GPU buffer |
| `getColorAt(inst, target)` | `Color` | Reads back from GPU buffer |
| `getInstanceFromIntersect(hit)` | `Instance \| null` | Resolves a raycaster hit to an instance |
| `update(camera?)` | `void` | Flushes dirty matrices and colors; pass camera to enable frustum culling |
| `disposeBatcher()` | `void` | Disposes all internal meshes and clears all subscriptions |

### `BatcherOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `initialCapacity` | `number` | `16` | Initial slot count per `InstancedMesh` group |
| `overAllocation` | `number` | `0.2` | Extra capacity fraction when a group grows (0.2 = 20%) |
| `frustumCulling` | `boolean` | `false` | Skip instances outside the camera frustum |
| `customDepthMaterial` | `Material` | — | Custom depth material for shadow passes |
| `customDistanceMaterial` | `Material` | — | Custom distance material for shadow passes |

## Memory Overhead

| Overhead | Per 1,000 instances |
|---|---|
| 35 wrapped setter closures | ~1.1 MB |
| Three.js transform objects | ~0.8 MB |
| GPU buffer (matrix 64B + color 12B) | ~76 KB |
| **Total** | **~2.0 MB / 1k** |

The real bottleneck at scale is GPU draw calls and vertex throughput, not JS-side dirty tracking.

## Known Limitations

- Frustum culling is JS-side only; it does not write zero matrices for culled instances.

## License

MIT