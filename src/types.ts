import type * as THREE from 'three'
import type { Instance } from './core/Instance'

export type DirtyType = 'matrix' | 'color'

export interface BatcherSubscriber {
  markDirty(instance: Instance, type: DirtyType): void
  markShadowChange(instance: Instance): void
  removeInstance(instance: Instance): void
}

export interface BatcherOptions {
  overAllocation?: number
  initialCapacity?: number
  frustumCulling?: boolean
  customDepthMaterial?: THREE.Material
  customDistanceMaterial?: THREE.Material
}

export interface BatchGroup {
  key: string
  mesh: THREE.InstancedMesh
  instances: (Instance | null)[]
  indexMap: Map<Instance, number>
  dirtyIndices: Set<number>
  dirtyColors: Set<number>
  emptySlots: number[]
  frustumVisible: Set<number>
  hasDirty: boolean
  capacity: number
  count: number
}
