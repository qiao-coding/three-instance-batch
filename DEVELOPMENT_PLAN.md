# three-instance-batch 开发计划

## 目的
将 1.md 中的 Instance + InstanceBatcher 设计落地为可执行的开发步骤，按 Phase 拆分，每个 Phase 包含具体任务、输入/输出、验收标准。

## 使用场景
- 开发者开始编码前，了解当前 Phase 的完整上下文
- Code review 时对照验收标准检查
- Phase 完成后评估是否进入下一阶段

## 限制条件
- 运行环境：Three.js r152+（需要 `InstancedMesh.instanceColor` 支持）
- 语言：TypeScript
- 构建工具：Vite（库模式）
- 包名：`three-instance-batch`

---

## Phase 0：项目脚手架

### 目的
搭建 TypeScript + Vite 库开发环境，确保能编译、能测试、能跑 demo。

### 任务
1. 初始化项目：`package.json`、`tsconfig.json`、`vite.config.ts`
2. 安装依赖：`three`（peerDependency）、`typescript`、`vite`、`vitest`
3. 目录结构：
   ```
   three-instance-batch/
   ├── src/
   │   ├── core/
   │   │   ├── Instance.ts
   │   │   ├── InstanceBatcher.ts
   │   │   └── groupKey.ts
   │   ├── utils/
   │   │   └── fnv1a64.ts
   │   └── index.ts
   ├── demo/
   │   ├── index.html
   │   └── main.ts
   ├── tests/
   │   └── ...
   ├── 1.md                  # 设计文档
   ├── DEVELOPMENT_PLAN.md   # 本文件
   └── README.md
   ```
4. Demo 页面：一个带 OrbitControls 的 Three.js 场景，用于手动测试
5. 跑通 `npm run dev` 和 `npm run build`

### 验收标准
- [ ] `npm run build` 产出 ES Module
- [ ] `npm run dev` 打开浏览器能看到 Three.js 场景
- [ ] 项目能 `import { Instance, InstanceBatcher } from 'three-instance-batch'`

---

## Phase 1：Instance 核心 + Batcher 分组 + Dirty + Swap-Remove + 颜色 + 阈值退化

### 目的
实现最核心的渲染链路：创建 Instance → add 到 Batcher → 分组 → 写入 InstancedMesh → 渲染。

### 任务

#### 1.1 groupKey 工具函数 (`src/core/groupKey.ts`)
- **输入**：`THREE.BufferGeometry` + `THREE.Material` + `castShadow` + `receiveShadow`
- **输出**：`"igk_" + 16-char-hex` 字符串
- 实现 `fnv1a64Hex()`（BigInt FNV-1a 64-bit）
- 实现 `materialSignature()`：提取材质的 type、map ID、side、transparent、depthWrite、wireframe 等
- **颜色不在签名中**
- 单元测试：同 geo+mat → 同 key；不同 mat → 不同 key；颜色不同 → 同 key

#### 1.2 Instance 类 (`src/core/Instance.ts`)
- 属性：
  - `geometry: BufferGeometry`（readonly）
  - `material: Material`（readonly）
  - `position: Vector3`
  - `quaternion: Quaternion`（主存储）
  - `rotation: Euler`（getter/setter，自动同步 quaternion）
  - `scale: Vector3`
  - `color: Color`
  - `visible: boolean`
  - `castShadow: boolean`
  - `receiveShadow: boolean`
  - `localMatrix: Matrix4`（readonly）
  - `worldMatrix: Matrix4`（readonly）
  - `groupKey: string`（readonly，从 geo/mat/shadow 推导）
  - `parent: Instance | null`
  - `children: Instance[]`（readonly）
- Dirty 标记机制：
  - `_dirtyMatrix: boolean`
  - `_dirtyColor: boolean`
  - `_dirtyShadow: boolean`
  - 每个 setter 触发对应 dirty 标志
  - `_subscribers: Set<InstanceBatcher>`（通知机制）
- `dispose()`：从所有 Batcher 取消订阅 + 断层级 + 清数据
- 单元测试：position 修改 → dirtyMatrix=true；color 修改 → dirtyColor=true；parent 链正确

#### 1.3 BatchGroup 内部结构
- 属性：`key`、`mesh`（InstancedMesh | Mesh）、`instances[]`、`indexMap`、`dirtyIndices`、`dirtyColors`、`capacity`、`count`
- 方法：
  - `addInstance(instance): number` → 返回分配的 index
  - `removeInstance(instance)` → swap-remove
  - `grow(newCapacity)` → 重建 InstancedMesh + 复制 buffer
- 初始容量：`initialCapacity`（默认 16）
- 预分配：`capacity = ceil(count * 1.2)`
- 扩容触发：`count + 1 > capacity` → `capacity *= 2`
- 单元测试：add 返回递增 index；remove 后 index 正确 swap；扩容后数据完整

#### 1.4 InstanceBatcher 类 (`src/core/InstanceBatcher.ts`)
- extends `THREE.Group`
- 构造选项：`threshold`、`overAllocation`、`initialCapacity`、`frustumCulling`
- 核心方法：
  - `add(instance)`: 计算 groupKey → 查找/创建 BatchGroup → 分配 index → 订阅 dirty
  - `addMany(instances)`: 批量 add
  - `remove(instance)`: swap-remove → 取消订阅
  - `removeMany(instances)`
  - `has(instance): boolean`
  - `get count(): number`
  - `dispose()`: 遍历所有 group，dispose mesh，清空
- `update(camera?)`: 对外暴露的每帧更新入口
  - 消费 dirtyIndices → 写 worldMatrix 到 buffer
  - 消费 dirtyColors → 写 instanceColor
  - 更新 `needsUpdate`
- 阈值退化：`group.count <= threshold` → 创建 Mesh 替代 InstancedMesh

#### 1.5 Demo 场景
- 创建 500 棵树（不同位置、随机颜色），通过 Batcher 渲染
- 点击按钮随机修改部分树的颜色 → 验证 dirty color 追踪
- 点击按钮移除部分树 → 验证 swap-remove
- 性能对比：同样 500 棵树，普通 Mesh vs InstanceBatcher 的 FPS

### 验收标准
- [ ] 500 个不同颜色的 Instance 正确渲染到 InstancedMesh
- [ ] 修改 instance.color 后，画面正确更新
- [ ] 修改 instance.position 后，画面正确更新
- [ ] batcher.remove() 后 draw call 不变，画面正确
- [ ] groupKey 相同 → 共享 InstancedMesh（验证 draw call 数量）
- [ ] 阈值退化：count=1 时使用普通 Mesh
- [ ] 扩容：超过初始容量时自动扩容且数据不丢失
- [ ] 单元测试全部通过

---

## Phase 2：阴影分组 + 换组逻辑

### 目的
支持逐实例 `castShadow` / `receiveShadow`，运行时自动换组。

### 任务

#### 2.1 groupKey 扩展
- 在已有 groupKey 中加入 shadow 标志位（Phase 1 已预留接口，Phase 2 打通）

#### 2.2 换组流程
- `instance.castShadow = true` 触发 `_dirtyShadow = true`
- `Batcher.update()` 中检测 `needsGroupRebuild`：
  - 从旧 BatchGroup swap-remove
  - 计算新 groupKey
  - add 到新 BatchGroup
  - 同步 worldMatrix 到新槽位
- 边界：换组时 instance 不在任何 Batcher → 仅更新 groupKey 缓存，等下次 add

#### 2.3 Demo 场景
- 场景中有 4 组不同阴影配置的立方体
- 点击立方体切换 castShadow → 验证自动换组 + 阴影正确
- 验证：同 geo+同 mat+不同 shadow → 两个独立 InstancedMesh

### 验收标准
- [ ] 切换 castShadow 后，instance 自动进入正确的阴影分组
- [ ] 同一个物体切换阴影 → 旧组减少 1，新组增加 1
- [ ] 阴影在场景中正确渲染

---

## Phase 3：层级（parent/child + worldMatrix 链）

### 目的
支持 Instance 父子层级变换继承。

### 任务

#### 3.1 Instance 层级扩展
- `parent` setter：
  - 检查循环引用
  - 从旧 parent 移除
  - 加入新 parent.children
  - 标记自身 worldMatrix 脏
- `isAncestorOf(other): boolean`
- `_localDirty` → `recomputeLocalMatrix()`：compose(position, quaternion, scale)

#### 3.2 Batcher.update() 扩展
- 新增 **World Matrix Pass**（在 dirty 消费之前）：
  ```
  for (instance of dirtyInstances, 层级拓扑排序):
    if (_localDirty) recomputeLocalMatrix()
    if (parent) worldMatrix = parent.worldMatrix * localMatrix
    else        worldMatrix = localMatrix
    通知所有 Batcher 该 instance 的 dirtyIndices
  ```
- `_frameVersion` 防同一帧重复计算
- 脏标记向下传播：父 dirty → 遍历所有子孙 → 全部标记 worldMatrix 脏

#### 3.3 dispose/remove 与层级交互
- `instance.dispose()`：断开 parent 和 children 链接
- `batcher.remove()`：不碰层级，只移除该 Batcher 中的槽位
- 子 Instance 在下帧自动以 `parent=null` 重新计算 worldMatrix

#### 3.4 Demo 场景
- 太阳系模型：太阳（父）→ 地球（子）→ 月球（孙）
- 旋转太阳 → 地球和月球自动跟随
- dispose 地球 → 月球自动变根节点

### 验收标准
- [ ] 父移动 → 子跟随
- [ ] 孙节点的 worldMatrix = grandParent × parent × child
- [ ] 循环引用检测正确抛出错误
- [ ] dispose 父节点 → 子节点 parent=null，继续存在
- [ ] 10k 个带层级的 instance，层级更新不超过 2ms

---

## Phase 4：视锥体剔除

### 目的
万级 instance 场景下，CPU 端剔除屏幕外物体，减少无效 GPU 顶点处理。

### 任务

#### 4.1 剔除逻辑
- 在 `Batcher.update()` 中 World Matrix Pass 之后执行
- 构建 `THREE.Frustum`（从 camera.projectionMatrix × camera.matrixWorldInverse）
- 遍历所有 group，对每个 instance：
  - 取 `geometry.boundingSphere` 经 `worldMatrix` 变换
  - `frustum.intersectsSphere(sphere)`
  - 记录到 `group.frustumVisible`

#### 4.2 优化策略
- Phase 4 使用方案 A（标记但不改变 buffer）：
  - 可见性结果仅记录在 `frustumVisible` 中
  - GPU buffer 写入不受影响（确保可见性切换时无闪烁）
- 后续 Phase 可升级为方案 B（仅上传可见 instance 的 matrix）

#### 4.3 Demo 场景
- 10k 棵树分布在 2000×2000 的区域内
- 旋转相机，FPS 对比剔除开/关
- 可视化：不同颜色标记屏幕内/外的 instance

### 验收标准
- [ ] frustumVisible 正确标记屏幕内物体
- [ ] 包围球变换正确（考虑层级 worldMatrix）
- [ ] 剔除计算在 2ms 内完成（10k instance）
- [ ] 相机快速旋转时无闪烁或错位

---

## Phase 5：多 Batcher 共享 Instance

### 目的
同一个 Instance 可以加入多个 Batcher，各自独立渲染。

### 任务

#### 5.1 通知机制改造
- `Instance._subscribers: Set<InstanceBatcher>` → 支持多个 Batcher
- `batcher.add(instance)` → `instance._subscribe(this)`
- `batcher.remove(instance)` → `instance._unsubscribe(this)`
- dirty 通知遍历所有 subscriber
- `instance.dispose()` → 遍历所有 subscriber，逐一 remove

#### 5.2 多视口场景
- 同一场景数据，两个不同视角的 Batcher（如俯视图 + 侧视图）
- 修改 instance → 两个视口同时更新

### 验收标准
- [ ] 同一 Instance 加入两个 Batcher，修改 position 后两个都更新
- [ ] dispose Instance 后，两个 Batcher 都正确 remove
- [ ] 两个 Batcher 的 InstancedMesh 完全独立（不同的 buffer）

---

## Phase 6：Raycast 集成

### 目的
支持 `Raycaster.intersectObject(batcher)` → 精确到 Instance。

### 任务

#### 6.1 Instance 查找
- `batcher.getInstanceFromIntersect(hit): Instance`
- Three.js Raycaster 对 InstancedMesh 返回 `instanceId`
- 通过 `BatchGroup.indexMap` 反查 Instance（注意：indexMap 存的是 `Instance → idx`，需要反向索引或遍历）

#### 6.2 Demo 场景
- 500 个彩色方块，点击变色
- 验证：点击物体 → 获取对应 Instance → 修改 color

### 验收标准
- [ ] 点击 InstancedMesh 能正确返回对应的 Instance
- [ ] swap-remove 后 raycast 仍然正确（index 映射有效）

---

## 技术风险与缓解

| 风险 | 影响 Phase | 缓解措施 |
|---|---|---|
| `BigInt` 兼容性（FNV-1a 依赖 BigInt） | Phase 1 | 检测浏览器支持，必要时 fallback 到 32-bit 版本 |
| `instanceColor` API 在旧版 Three.js 不可用 | Phase 1 | 文档声明最低 Three.js r152，运行时检测并警告 |
| 层级 + swap-remove 的 index 映射出错 | Phase 3 | 大量单元测试覆盖边角情况，swap-remove 后验证 indexMap 一致性 |
| 扩容时重建 InstancedMesh 产生一帧闪烁 | Phase 1 | 扩容后立即写入所有 matrix（不只是 dirty），确保数据完整再替换 |
| 视锥体剔除 + 层级更新的双重开销 | Phase 4 | 共享 worldMatrix 计算结果，剔除在 Matrix Pass 之后复用 |

---

## 实施顺序图

```
Phase 0 (脚手架)
  ↓
Phase 1 (核心链路) ← 最关键的里程碑
  ↓
├→ Phase 2 (阴影)      ┐
├→ Phase 3 (层级)      ├→ 可并行开发
├→ Phase 5 (多Batcher) ┘
  ↓
Phase 4 (剔除) ← 依赖 Phase 3 的 worldMatrix
  ↓
Phase 6 (Raycast)
```

---

## 更新日志
- 2026-05-28 - 初始版本，基于 1.md 设计文档
