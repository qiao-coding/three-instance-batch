import * as THREE from 'three'
import { groupKey } from './groupKey'
import type { DirtyType, BatcherSubscriber } from '../types'

let instanceIdCounter = 0

let globalFrameVersion = 0
export function bumpFrameVersion(): number { return ++globalFrameVersion }
export function getFrameVersion(): number { return globalFrameVersion }

// Lightweight method wrapping — shared onChange, no per-axis property overhead
function wrapMethod<T extends object>(obj: T, method: string, onChange: () => void): void {
  const orig = (obj as Record<string, unknown>)[method] as Function | undefined
  if (typeof orig !== 'function') return
  ;(obj as Record<string, unknown>)[method] = function (this: unknown, ...args: unknown[]) {
    const r = orig.apply(this, args)
    onChange()
    return r
  }
}

const VEC3_KEYS = ['set', 'copy', 'setScalar', 'setX', 'setY', 'setZ', 'setComponent'] as const
const EULER_KEYS = ['set', 'setX', 'setY', 'setZ', 'copy', 'setFromVector3', 'setFromQuaternion'] as const
const QUAT_KEYS = ['set', 'copy', 'identity', 'setFromEuler', 'setFromAxisAngle', 'setFromRotationMatrix', 'multiply', 'premultiply'] as const
const COLOR_KEYS = ['set', 'setScalar', 'setHex', 'setRGB', 'setHSL', 'copy'] as const

export class Instance {
  readonly id: number
  readonly geometry: THREE.BufferGeometry
  readonly material: THREE.Material

  readonly position: THREE.Vector3
  readonly scale: THREE.Vector3
  readonly quaternion: THREE.Quaternion
  readonly rotation: THREE.Euler
  readonly color: THREE.Color

  readonly localMatrix: THREE.Matrix4
  readonly worldMatrix: THREE.Matrix4

  private _visible: boolean = true
  private _castShadow: boolean = false
  private _receiveShadow: boolean = false

  private _parent: Instance | null = null
  readonly children: Instance[] = []

  _localDirty: boolean = true
  _worldDirty: boolean = true
  _dirtyColor: boolean = true
  _dirtyShadow: boolean = false

  _frameVersion: number = 0
  private _disposed: boolean = false

  readonly _subscribers: Set<BatcherSubscriber> = new Set()

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material) {
    this.id = ++instanceIdCounter
    this.geometry = geometry
    this.material = material

    this.position = new THREE.Vector3()
    this.quaternion = new THREE.Quaternion()
    this.rotation = new THREE.Euler()
    this.scale = new THREE.Vector3(1, 1, 1)
    this.color = new THREE.Color(1, 1, 1)

    this.localMatrix = new THREE.Matrix4()
    this.worldMatrix = new THREE.Matrix4()

    const onTransform = () => { this._localDirty = true; this._markWorldDirty() }
    const onRotation = () => { this.quaternion.setFromEuler(this.rotation); onTransform() }
    const onColor = () => { this._dirtyColor = true; this._notifyDirty('color') }

    for (const k of VEC3_KEYS) wrapMethod(this.position, k, onTransform)
    for (const k of VEC3_KEYS) wrapMethod(this.scale, k, onTransform)
    for (const k of EULER_KEYS) wrapMethod(this.rotation, k, onRotation)
    for (const k of QUAT_KEYS) wrapMethod(this.quaternion, k, onTransform)
    for (const k of COLOR_KEYS) wrapMethod(this.color, k, onColor)
  }

  get visible(): boolean { return this._visible }
  set visible(v: boolean) {
    if (this._visible === v) return
    this._visible = v
    this._notifyDirty('matrix')
  }

  get castShadow(): boolean { return this._castShadow }
  set castShadow(v: boolean) {
    if (this._castShadow === v) return
    this._castShadow = v
    this._dirtyShadow = true
    this._notifyShadowChange()
  }

  get receiveShadow(): boolean { return this._receiveShadow }
  set receiveShadow(v: boolean) {
    if (this._receiveShadow === v) return
    this._receiveShadow = v
    this._dirtyShadow = true
    this._notifyShadowChange()
  }

  get groupKey(): string {
    return groupKey(this.geometry, this.material, this._castShadow, this._receiveShadow)
  }

  get parent(): Instance | null { return this._parent }
  set parent(p: Instance | null) {
    if (p === this._parent) return
    if (p && this._wouldCreateCycle(p)) {
      throw new Error('Instance: setting parent would create a cycle')
    }
    if (this._parent) {
      const idx = this._parent.children.indexOf(this)
      if (idx !== -1) this._parent.children.splice(idx, 1)
    }
    this._parent = p
    if (p) {
      p.children.push(this)
    }
    this._markWorldDirty()
  }

  isAncestorOf(other: Instance): boolean {
    let cur: Instance | null = other.parent
    while (cur) {
      if (cur === this) return true
      cur = cur.parent
    }
    return false
  }

  get disposed(): boolean { return this._disposed }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true

    if (this._parent) {
      const idx = this._parent.children.indexOf(this)
      if (idx !== -1) this._parent.children.splice(idx, 1)
      this._parent = null
    }
    for (const child of this.children) {
      child._parent = null
      child._markWorldDirty()
    }
    this.children.length = 0

    const subs = [...this._subscribers]
    this._subscribers.clear()
    for (const sub of subs) {
      sub.removeInstance(this)
    }
  }

  recomputeLocalMatrix(): void {
    if (!this._localDirty) return
    this.localMatrix.compose(this.position, this.quaternion, this.scale)
    this._localDirty = false
    this._markWorldDirty()
  }

  recomputeWorldMatrix(): void {
    const fv = getFrameVersion()
    if (this._frameVersion === fv) return
    this._frameVersion = fv

    if (this._parent) {
      this._parent.recomputeWorldMatrix()
      this.recomputeLocalMatrix()
      this.worldMatrix.multiplyMatrices(this._parent.worldMatrix, this.localMatrix)
    } else {
      this.recomputeLocalMatrix()
      this.worldMatrix.copy(this.localMatrix)
    }
    this._worldDirty = false
  }

  _subscribe(sub: BatcherSubscriber): void { this._subscribers.add(sub) }
  _unsubscribe(sub: BatcherSubscriber): void { this._subscribers.delete(sub) }

  _markWorldDirty(): void {
    if (this._worldDirty) return
    this._worldDirty = true
    this._notifyDirty('matrix')
    for (const child of this.children) {
      child._markWorldDirty()
    }
  }

  _markDirtyForBatcher(batcher: BatcherSubscriber): void {
    batcher.markDirty(this, 'matrix')
    batcher.markDirty(this, 'color')
  }

  private _notifyDirty(type: DirtyType): void {
    for (const sub of this._subscribers) {
      sub.markDirty(this, type)
    }
  }

  private _notifyShadowChange(): void {
    for (const sub of this._subscribers) {
      sub.markShadowChange(this)
    }
  }

  private _wouldCreateCycle(p: Instance): boolean {
    return this.isAncestorOf(p) || p === this
  }
}
