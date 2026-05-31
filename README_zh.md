# three-instance-batch

Three.js 的 `InstancedMesh` 管理层。处理脏追踪、分组合批和动态增删 — 你不用管。

## 安装

```bash
npm install three-instance-batch
```

## 快速开始

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
  inst.position.setX(Math.sin(Date.now() * 0.001) * 5
  batcher.update(camera)
  renderer.render(scene, camera)
  requestAnimationFrame(animate)
}
```

没有 `setMatrixAt`，没有 `needsUpdate`。改属性，调 `update()`，完事。

## 多实例使用

```ts
const count = 500
const instances: Instance[] = []

for (let i = 0; i < count; i++) {
  const inst = new Instance(geo, mat)
  const angle = (i / count) * Math.PI * 2
  inst.position.set(Math.cos(angle) * 10, 0, Math.sin(angle) * 10)
  inst.color.setHSL(i / count, 0.8, 0.5)
  instances.push(inst)
}
batcher.addInstance(instances)

function animate() {
  for (let i = 0; i < instances.length; i++) {
    instances[i].rotation.set(0, Date.now() * 0.001 + i * 0.1, 0)
    instances[i].color.setHSL((Date.now() * 0.0001 + i * 0.002) % 1, 0.8, 0.5)
  }
  batcher.update(camera)
  renderer.render(scene, camera)
  requestAnimationFrame(animate)
}
```

## 工作原理

`Instance` 在构造时包装了 `Vector3`、`Euler`、`Quaternion`、`Color` 的 setter 方法。通过 setter 的任何修改 — `position.set()`、`rotation.set()`、`quaternion.setFromEuler()`、`color.setHSL()` 等 — 自动将实例标记为脏。注意：直接属性赋值（`position.x = 5`）**不会**被追踪，请使用 `setX()` 或 `set()`。

实例通过**分组键**归入 `InstancedMesh` 对象，分组键由几何体 UUID、材质属性和阴影标志生成。共享同一键的实例共享一次 Draw Call。

## 多几何体和材质

Batcher 自动处理混合类型：

```ts
const meshes = [
  new Instance(boxGeo, redMat),
  new Instance(sphereGeo, blueMat),
  new Instance(boxGeo, redMat),   // 相同键 → 同一个 InstancedMesh
]
batcher.addInstance(meshes)
```

复用同一个 geometry 和 material 对象即可共享分组。

## 阴影变更触发迁移

`castShadow` 和 `receiveShadow` 是分组键的一部分。运行时修改它们会导致实例在下一次 `update()` 时自动迁移到正确的分组。

```ts
inst.castShadow = true  // 下次 update 时迁移到投射阴影的分组
```

## 父子层级

Instance 支持父子嵌套。子级的世界矩阵通过父级变换链计算。

```ts
const parent = new Instance(geo, mat)
const child = new Instance(geo, mat)
child.parent = parent  // child 跟随 parent 的变换

parent.position.set(0, 5, 0)
batcher.update()  // child 的世界矩阵自动重算
```

循环引用在运行时会检测并拒绝。销毁父级会断开所有子级但不会销毁它们。

## 射线检测

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

| 成员 | 类型 | 备注 |
|---|---|---|
| `id` | `number` | 自增，只读 |
| `geometry` | `BufferGeometry` | 只读 |
| `material` | `Material` | 只读 |
| `position` | `Vector3` | 自动追踪 |
| `scale` | `Vector3` | 默认 `(1,1,1)`，自动追踪 |
| `rotation` | `Euler` | 自动追踪，变更时同步到 `quaternion` |
| `quaternion` | `Quaternion` | 自动追踪 |
| `color` | `Color` | 默认白色，自动追踪 |
| `visible` | `boolean` | 隐藏实例写入零矩阵 |
| `castShadow` | `boolean` | 修改触发分组迁移 |
| `receiveShadow` | `boolean` | 修改触发分组迁移 |
| `parent` | `Instance \| null` | setter 校验循环引用 |
| `children` | `Instance[]` | 只读数组 |
| `disposed` | `boolean` | 只读 |
| `groupKey` | `string` | 由几何体、材质、阴影标志生成 |
| `localMatrix` | `Matrix4` | 只读，由变换分量计算 |
| `worldMatrix` | `Matrix4` | 只读，local × 祖先链 |
| `isAncestorOf(other)` | `boolean` | |
| `dispose()` | `void` | 断开父级、断开子级、取消所有 batcher 订阅 |

> **注意：** 只有方法调用（`.set()`、`.setX()`、`.copy()` 等）被追踪。属性赋值（`position.x = 5`）绕过包装器。单分量更新请使用 `setX()` / `setY()` / `setZ()`。

### `InstanceBatcher`

继承 `THREE.Group`。加入场景，每帧调用 `update()`。

```ts
new InstanceBatcher(options?: BatcherOptions)
```

| 成员 | 类型 | 备注 |
|---|---|---|
| `count` | `number` | 管理的实例总数 |
| `groupCount` | `number` | 内部 `InstancedMesh` 分组数 |
| `hasDirty` | `boolean` | 是否有数据需要刷新到 GPU |
| `addInstance(inst \| inst[])` | `this` | 重复项被忽略 |
| `removeInstance(inst \| inst[])` | `this` | 不存在的实例被忽略 |
| `has(inst)` | `boolean` | |
| `getMatrixAt(inst, target)` | `Matrix4` | 从 GPU buffer 回读 |
| `getColorAt(inst, target)` | `Color` | 从 GPU buffer 回读 |
| `getInstanceFromIntersect(hit)` | `Instance \| null` | 从射线命中结果解析实例 |
| `update(camera?)` | `void` | 刷新脏矩阵和颜色；传入相机启用视锥剔除 |
| `disposeBatcher()` | `void` | 销毁所有内部 mesh 并清除所有订阅 |

### `BatcherOptions`

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `initialCapacity` | `number` | `16` | 每个 `InstancedMesh` 分组的初始容量 |
| `overAllocation` | `number` | `0.2` | 分组扩容时的额外比例（0.2 = 20%） |
| `frustumCulling` | `boolean` | `false` | 跳过视锥体外的实例 |
| `customDepthMaterial` | `Material` | — | 阴影 pass 的自定义深度材质 |
| `customDistanceMaterial` | `Material` | — | 阴影 pass 的自定义距离材质 |

## 内存开销

| 开销项 | 每千实例 |
|---|---|
| 35 个 setter 闭包 | ~1.1 MB |
| Three.js 变换对象 | ~0.8 MB |
| GPU buffer（matrix 64B + color 12B） | ~76 KB |
| **合计** | **~2.0 MB / 千** |

大规模场景下真正的瓶颈是 GPU Draw Call 和顶点吞吐量，而非 JS 层的脏追踪。

## 已知局限

- 视锥剔除收集逐实例可见性，但尚未在渲染 pass 中跳过被剔除的实例。

## 参与开发

```bash
git clone https://github.com/qiao-coding/three-instance-batch.git
cd three-instance-batch
npm install
npm run test:run    # 56 条测试
npm run dev         # 启动 demo：localhost:5173
npm run build       # 构建到 dist/
```

欢迎 PR。大改动前请先提 issue 讨论。

## License

MIT
