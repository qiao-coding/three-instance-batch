import * as THREE from 'three'
import { Instance, bumpFrameVersion } from './Instance'
import type { BatcherSubscriber, DirtyType, BatcherOptions, BatchGroup } from '../types'

function createInstancedMesh(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  capacity: number,
  depthMat?: THREE.Material,
  distanceMat?: THREE.Material,
): THREE.InstancedMesh {
  const im = new THREE.InstancedMesh(geo, mat, capacity)
  im.castShadow = false
  im.receiveShadow = false
  im.frustumCulled = false
  im.count = 0
  if (depthMat) im.customDepthMaterial = depthMat
  if (distanceMat) im.customDistanceMaterial = distanceMat
  im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
  const matrixArr = im.instanceMatrix.array as Float32Array
  for (let i = 0; i < capacity; i++) {
    const o = i * 16
    matrixArr[o] = 1; matrixArr[o + 5] = 1; matrixArr[o + 10] = 1; matrixArr[o + 15] = 1
  }
  return im
}

const ZERO_MATRIX = new THREE.Matrix4().identity().multiplyScalar(0)

export class InstanceBatcher extends THREE.Group implements BatcherSubscriber {
  private _groups: Map<string, BatchGroup> = new Map()
  private _meshToGroup: Map<THREE.Object3D, BatchGroup> = new Map()
  private _allInstances: Set<Instance> = new Set()
  private _instanceMeta: Map<Instance, { groupKey: string; idx: number }> = new Map()
  private _needsGroupRebuild: Set<Instance> = new Set()
  private _hasDirty: boolean = true // start dirty so first update() processes init
  private _opts: {
    overAllocation: number
    initialCapacity: number
    frustumCulling: boolean
    customDepthMaterial?: THREE.Material
    customDistanceMaterial?: THREE.Material
  }
  private _frustum = new THREE.Frustum()
  private _projScreenMatrix = new THREE.Matrix4()

  constructor(options: BatcherOptions = {}) {
    super()
    this._opts = {
      overAllocation: options.overAllocation ?? 0.2,
      initialCapacity: options.initialCapacity ?? 16,
      frustumCulling: options.frustumCulling ?? false,
      customDepthMaterial: options.customDepthMaterial,
      customDistanceMaterial: options.customDistanceMaterial,
    }
  }

  get count(): number { return this._allInstances.size }
  get groupCount(): number { return this._groups.size }
  get hasDirty(): boolean { return this._hasDirty || this._needsGroupRebuild.size > 0 }

  addInstance(instance: Instance | Instance[]): this {
    const list = Array.isArray(instance) ? instance : [instance]
    for (const inst of list) {
      if (this._allInstances.has(inst)) continue
      this._addToGroup(inst)
      inst._subscribe(this)
      this._allInstances.add(inst)
    }
    return this
  }

  removeInstance(instance: Instance | Instance[]): this {
    const list = Array.isArray(instance) ? instance : [instance]
    for (const inst of list) {
      if (!this._allInstances.has(inst)) continue
      this._removeFromGroup(inst)
      inst._unsubscribe(this)
      this._allInstances.delete(inst)
      this._needsGroupRebuild.delete(inst)
    }
    return this
  }

  has(instance: Instance): boolean {
    return this._allInstances.has(instance)
  }

  getInstanceFromIntersect(hit: { instanceId?: number; object: THREE.Object3D }): Instance | null {
    if (hit.instanceId === undefined) return null
    const group = this._meshToGroup.get(hit.object)
    if (group && hit.instanceId < group.instances.length) {
      return group.instances[hit.instanceId]
    }
    return null
  }

  getMatrixAt(instance: Instance, target: THREE.Matrix4): THREE.Matrix4 {
    const meta = this._instanceMeta.get(instance)
    if (!meta) return target.identity()
    const group = this._groups.get(meta.groupKey)
    if (!group) return target.identity()
    group.mesh.getMatrixAt(meta.idx, target)
    return target
  }

  getColorAt(instance: Instance, target: THREE.Color): THREE.Color {
    const meta = this._instanceMeta.get(instance)
    if (!meta) return target.set(1, 1, 1)
    const group = this._groups.get(meta.groupKey)
    if (!group || !group.mesh.instanceColor) return target.set(1, 1, 1)
    group.mesh.getColorAt(meta.idx, target)
    return target
  }

  update(camera?: THREE.Camera): void {
    if (!this._hasDirty && this._needsGroupRebuild.size === 0) return

    bumpFrameVersion()

    if (this._needsGroupRebuild.size > 0) {
      for (const instance of this._needsGroupRebuild) {
        this._removeFromGroup(instance)
        this._addToGroup(instance)
      }
      this._needsGroupRebuild.clear()
    }

    if (this._opts.frustumCulling && camera) {
      this._updateFrustumCulling(camera)
    }

    for (const group of this._groups.values()) {
      if (group.hasDirty) this._processGroup(group)
    }

    this._hasDirty = false
  }

  disposeBatcher(): void {
    for (const instance of this._allInstances) {
      instance._unsubscribe(this)
    }
    for (const group of this._groups.values()) {
      group.mesh.dispose()
    }
    this._groups.clear()
    this._meshToGroup.clear()
    this._allInstances.clear()
    this._instanceMeta.clear()
    this._needsGroupRebuild.clear()
    this._hasDirty = false
    this.clear()
  }

  // BatcherSubscriber impl
  markDirty(instance: Instance, type: DirtyType): void {
    const meta = this._instanceMeta.get(instance)
    if (!meta) return
    const group = this._groups.get(meta.groupKey)
    if (!group) return
    this._hasDirty = true
    group.hasDirty = true
    if (type === 'matrix') group.dirtyIndices.add(meta.idx)
    if (type === 'color') group.dirtyColors.add(meta.idx)
  }

  markShadowChange(instance: Instance): void {
    if (this._allInstances.has(instance)) {
      this._hasDirty = true
      this._needsGroupRebuild.add(instance)
    }
  }

  // Internal
  private _addMeshToScene(mesh: THREE.Object3D): void { super.add(mesh) }
  private _removeMeshFromScene(mesh: THREE.Object3D): void { super.remove(mesh) }

  private _addToGroup(instance: Instance): void {
    const key = instance.groupKey
    let group = this._groups.get(key)
    if (!group) {
      const cap = this._opts.initialCapacity
      group = {
        key,
        mesh: null!,
        instances: new Array(cap).fill(null),
        indexMap: new Map(),
        dirtyIndices: new Set(),
        dirtyColors: new Set(),
        emptySlots: [],
        frustumVisible: new Set(),
        hasDirty: true,
        capacity: cap,
        count: 0,
      }
      const im = createInstancedMesh(instance.geometry, instance.material, cap, this._opts.customDepthMaterial, this._opts.customDistanceMaterial)
      im.castShadow = instance.castShadow
      im.receiveShadow = instance.receiveShadow
      group.mesh = im
      this._addMeshToScene(im)
      this._groups.set(key, group)
      this._meshToGroup.set(im, group)
    }

    if (group.count >= group.capacity) {
      this._growGroup(group)
    }

    let idx: number
    if (group.emptySlots.length > 0) {
      idx = group.emptySlots.pop()!
    } else {
      idx = group.count
    }

    group.instances[idx] = instance
    group.indexMap.set(instance, idx)
    this._instanceMeta.set(instance, { groupKey: key, idx })
    group.count++
    group.mesh.count = group.count
    this._hasDirty = true
    group.hasDirty = true
    group.dirtyIndices.add(idx)
    group.dirtyColors.add(idx)
  }

  private _removeFromGroup(instance: Instance): void {
    const key = instance.groupKey
    const group = this._groups.get(key)
    if (!group) return

    const idx = group.indexMap.get(instance)
    if (idx === undefined) return

    const lastIdx = group.count - 1

    if (idx === lastIdx) {
      group.instances[idx] = null
      group.count--
    } else {
      const lastInstance = group.instances[lastIdx]!
      group.instances[idx] = lastInstance
      group.instances[lastIdx] = null
      group.indexMap.set(lastInstance, idx)
      this._instanceMeta.set(lastInstance, { groupKey: key, idx })
      group.dirtyIndices.add(idx)
      group.count--
    }

    group.indexMap.delete(instance)
    this._instanceMeta.delete(instance)
    group.emptySlots.push(lastIdx)
    group.dirtyIndices.delete(idx)
    group.dirtyColors.delete(idx)
    group.mesh.count = group.count

    if (group.count === 0) {
      this._meshToGroup.delete(group.mesh)
      group.mesh.dispose()
      this._removeMeshFromScene(group.mesh)
      this._groups.delete(key)
    }
  }

  private _processGroup(group: BatchGroup): void {
    const im = group.mesh
    const matrixBuffer = im.instanceMatrix.array as Float32Array

    for (const idx of group.dirtyIndices) {
      const inst = group.instances[idx]
      if (inst) {
        inst.recomputeWorldMatrix()
        if (inst.visible) {
          inst.worldMatrix.toArray(matrixBuffer, idx * 16)
        } else {
          ZERO_MATRIX.toArray(matrixBuffer, idx * 16)
        }
      }
    }

    if (group.dirtyIndices.size > 0) {
      im.instanceMatrix.needsUpdate = true
      group.dirtyIndices.clear()
    }
    group.hasDirty = false

    if (group.dirtyColors.size > 0 && im.instanceColor) {
      const colorArr = im.instanceColor.array as Float32Array
      for (const idx of group.dirtyColors) {
        const inst = group.instances[idx]
        if (inst) {
          const c = inst.color
          colorArr[idx * 3] = c.r
          colorArr[idx * 3 + 1] = c.g
          colorArr[idx * 3 + 2] = c.b
        }
      }
      im.instanceColor.needsUpdate = true
      group.dirtyColors.clear()
    }

    im.computeBoundingSphere()
    im.computeBoundingBox()
  }

  private _tempVec = new THREE.Vector3()
  private _tempSphere = new THREE.Sphere()

  private _updateFrustumCulling(camera: THREE.Camera): void {
    this._projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this._frustum.setFromProjectionMatrix(this._projScreenMatrix)

    for (const group of this._groups.values()) {
      const geo = group.mesh.geometry
      if (!geo.boundingSphere) geo.computeBoundingSphere()
      const base = geo.boundingSphere!

      group.frustumVisible.clear()
      for (let i = 0; i < group.count; i++) {
        const inst = group.instances[i]
        if (!inst) continue

        inst.recomputeWorldMatrix()
        const s = inst.scale
        this._tempVec.copy(base.center).applyMatrix4(inst.worldMatrix)
        this._tempSphere.set(this._tempVec, base.radius * Math.max(s.x, s.y, s.z))

        if (this._frustum.intersectsSphere(this._tempSphere)) {
          group.frustumVisible.add(i)
        }
      }
    }
  }

  private _growGroup(group: BatchGroup): void {
    const newCapacity = group.capacity + Math.max(1, Math.ceil(group.capacity * this._opts.overAllocation))
    const oldMesh = group.mesh
    const newMesh = createInstancedMesh(
      oldMesh.geometry,
      oldMesh.material as THREE.Material,
      newCapacity,
      this._opts.customDepthMaterial,
      this._opts.customDistanceMaterial,
    )
    newMesh.castShadow = oldMesh.castShadow
    newMesh.receiveShadow = oldMesh.receiveShadow

    const oldBuf = oldMesh.instanceMatrix.array as Float32Array
    const newBuf = newMesh.instanceMatrix.array as Float32Array
    newBuf.set(oldBuf.subarray(0, group.count * 16))

    if (oldMesh.instanceColor && newMesh.instanceColor) {
      const oldColor = oldMesh.instanceColor.array as Float32Array
      const newColor = newMesh.instanceColor.array as Float32Array
      newColor.set(oldColor.subarray(0, group.count * 3))
    }

    newMesh.count = group.count

    this._meshToGroup.delete(oldMesh)
    this._removeMeshFromScene(oldMesh)
    oldMesh.dispose()
    this._addMeshToScene(newMesh)
    this._meshToGroup.set(newMesh, group)

    group.mesh = newMesh
    group.capacity = newCapacity
    group.instances.length = newCapacity
  }
}
