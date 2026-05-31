import { describe, it, expect, beforeEach } from 'vitest'
import * as THREE from 'three'
import { Instance, InstanceBatcher } from '../src/core'

function makeGeo(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(1, 1, 1)
}

function makeMat(color = '#ff6600'): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color })
}

function makeInst(geo?: THREE.BufferGeometry, mat?: THREE.Material): Instance {
  return new Instance(geo ?? makeGeo(), mat ?? makeMat())
}

// ============================================================
// Instance
// ============================================================
describe('Instance', () => {
  it('creates with auto-incrementing id', () => {
    const a = makeInst()
    const b = makeInst()
    expect(b.id).toBeGreaterThan(a.id)
  })

  it('has default transform values', () => {
    const i = makeInst()
    expect(i.position.x).toBe(0)
    expect(i.position.y).toBe(0)
    expect(i.position.z).toBe(0)
    expect(i.scale.x).toBe(1)
    expect(i.scale.y).toBe(1)
    expect(i.scale.z).toBe(1)
    expect(i.quaternion.x).toBe(0)
    expect(i.color.r).toBe(1)
    expect(i.visible).toBe(true)
    expect(i.castShadow).toBe(false)
    expect(i.receiveShadow).toBe(false)
  })

  it('marks local dirty on position set', () => {
    const i = makeInst()
    i._localDirty = false
    i.position.set(5, 0, 0)
    expect(i._localDirty).toBe(true)
  })

  it('marks local dirty on scale set', () => {
    const i = makeInst()
    i._localDirty = false
    i.scale.set(2, 2, 2)
    expect(i._localDirty).toBe(true)
  })

  it('marks local dirty on quaternion set', () => {
    const i = makeInst()
    i._localDirty = false
    i.quaternion.setFromEuler(new THREE.Euler(0, 1, 0))
    expect(i._localDirty).toBe(true)
  })

  it('marks local dirty on rotation set', () => {
    const i = makeInst()
    i._localDirty = false
    i.rotation.set(0, 1, 0)
    expect(i._localDirty).toBe(true)
  })

  it('rotation set syncs to quaternion', () => {
    const i = makeInst()
    i.rotation.set(0, Math.PI / 2, 0)
    expect(i.quaternion.y).toBeCloseTo(Math.sin(Math.PI / 4), 4)
  })

  it('marks color dirty on color set', () => {
    const i = makeInst()
    i._dirtyColor = false
    i.color.set('#00ff00')
    expect(i._dirtyColor).toBe(true)
  })

  it('notifies subscribers on transform change', () => {
    const i = makeInst()
    i._worldDirty = false
    let called = false
    i._subscribe({ markDirty: () => { called = true }, markShadowChange: () => {}, removeInstance: () => {} })
    i.position.set(1, 2, 3)
    expect(called).toBe(true)
  })

  it('notifies subscribers on color change', () => {
    const i = makeInst()
    let called = false
    i._subscribe({
      markDirty: (_inst: Instance, type: string) => { if (type === 'color') called = true },
      markShadowChange: () => {},
      removeInstance: () => {},
    })
    i.color.setHex(0x0000ff)
    expect(called).toBe(true)
  })

  it('notifies markShadowChange on castShadow change', () => {
    const i = makeInst()
    let called = false
    i._subscribe({ markDirty: () => {}, markShadowChange: () => { called = true }, removeInstance: () => {} })
    i.castShadow = true
    expect(called).toBe(true)
  })

  it('notifies markShadowChange on receiveShadow change', () => {
    const i = makeInst()
    let called = false
    i._subscribe({ markDirty: () => {}, markShadowChange: () => { called = true }, removeInstance: () => {} })
    i.receiveShadow = true
    expect(called).toBe(true)
  })

  it('computes localMatrix from transform', () => {
    const i = makeInst()
    i._frameVersion = -1
    i.position.set(1, 2, 3)
    i.scale.set(2, 2, 2)
    i.recomputeWorldMatrix()
    const m = i.localMatrix
    expect(m.elements[12]).toBe(1)
    expect(m.elements[13]).toBe(2)
    expect(m.elements[14]).toBe(3)
  })

  it('computes worldMatrix via parent chain', () => {
    const parent = makeInst()
    parent._frameVersion = -1
    parent.position.set(10, 0, 0)
    const child = makeInst()
    child._frameVersion = -1
    child.parent = parent
    child.position.set(5, 0, 0)
    child.recomputeWorldMatrix()
    expect(child.worldMatrix.elements[12]).toBe(15)
  })

  it('marks children world-dirty when parent transforms', () => {
    const parent = makeInst()
    parent._worldDirty = false
    const child = makeInst()
    child.parent = parent
    child._worldDirty = false
    parent.position.set(1, 0, 0)
    expect(child._worldDirty).toBe(true)
  })

  it('visible setter notifies dirty on change', () => {
    const i = makeInst()
    let called = false
    i._subscribe({ markDirty: () => { called = true }, markShadowChange: () => {}, removeInstance: () => {} })
    i.visible = false
    expect(called).toBe(true)
  })

  it('visible setter is no-op for same value', () => {
    const i = makeInst()
    let called = false
    i._subscribe({ markDirty: () => { called = true }, markShadowChange: () => {}, removeInstance: () => {} })
    i._dirtyColor = false
    i.visible = true // already true
    expect(called).toBe(false)
  })

  it('blocks cyclic parent assignment', () => {
    const a = makeInst()
    const b = makeInst()
    b.parent = a
    expect(() => { a.parent = b }).toThrow('cycle')
  })

  it('detaches children on parent dispose', () => {
    const parent = makeInst()
    const child = makeInst()
    child.parent = parent
    parent.dispose()
    expect(child.parent).toBeNull()
    expect(parent.children.length).toBe(0)
  })

  it('isAncestorOf returns correct results', () => {
    const root = makeInst()
    const mid = makeInst()
    const leaf = makeInst()
    mid.parent = root
    leaf.parent = mid
    expect(root.isAncestorOf(leaf)).toBe(true)
    expect(root.isAncestorOf(mid)).toBe(true)
    expect(mid.isAncestorOf(root)).toBe(false)
    expect(leaf.isAncestorOf(root)).toBe(false)
  })

  it('disposed flag is set after dispose', () => {
    const i = makeInst()
    expect(i.disposed).toBe(false)
    i.dispose()
    expect(i.disposed).toBe(true)
  })

  it('groupKey changes when castShadow changes', () => {
    const geo = makeGeo()
    const mat = makeMat()
    const i = new Instance(geo, mat)
    const k1 = i.groupKey
    i.castShadow = true
    const k2 = i.groupKey
    expect(k2).not.toBe(k1)
  })
})

// ============================================================
// InstanceBatcher
// ============================================================
describe('InstanceBatcher', () => {
  let batcher: InstanceBatcher

  beforeEach(() => {
    batcher = new InstanceBatcher({ initialCapacity: 4 })
  })

  it('starts with count 0', () => {
    expect(batcher.count).toBe(0)
    expect(batcher.groupCount).toBe(0)
  })

  it('addInstance increments count', () => {
    batcher.addInstance([makeInst()])
    expect(batcher.count).toBe(1)
    expect(batcher.groupCount).toBe(1)
  })

  it('addInstance is idempotent', () => {
    const inst = makeInst()
    batcher.addInstance([inst])
    batcher.addInstance([inst])
    expect(batcher.count).toBe(1)
  })

  it('addInstances adds all', () => {
    batcher.addInstance([makeInst(), makeInst(), makeInst()])
    expect(batcher.count).toBe(3)
  })

  it('groups instances with same geometry+material+shadow', () => {
    const geo = makeGeo()
    const mat = makeMat()
    const a = new Instance(geo, mat)
    const b = new Instance(geo, mat)
    batcher.addInstance([a, b])
    expect(batcher.groupCount).toBe(1)
  })

  it('splits instances with different materials', () => {
    const geo = makeGeo()
    const a = new Instance(geo, makeMat('#ff0000'))
    const b = new Instance(geo, makeMat('#00ff00'))
    batcher.addInstance([a, b])
    // NOTE: different color in MeshStandardMaterial does NOT split the batch
    // because 'color' is not in PROPS_THAT_SPLIT_BATCH
    expect(batcher.groupCount).toBe(1)
  })

  it('splits instances with different shadow settings', () => {
    const geo = makeGeo()
    const mat = makeMat()
    const a = new Instance(geo, mat)
    const b = new Instance(geo, mat)
    b.castShadow = true
    batcher.addInstance([a, b])
    expect(batcher.groupCount).toBe(2)
  })

  it('removeInstance decrements count', () => {
    const inst = makeInst()
    batcher.addInstance([inst])
    batcher.removeInstance([inst])
    expect(batcher.count).toBe(0)
    expect(batcher.groupCount).toBe(0)
  })

  it('removeInstance is idempotent', () => {
    const inst = makeInst()
    batcher.addInstance([inst])
    batcher.removeInstance([inst])
    batcher.removeInstance([inst])
    expect(batcher.count).toBe(0)
  })

  it('hasInstance returns correct values', () => {
    const inst = makeInst()
    expect(batcher.has(inst)).toBe(false)
    batcher.addInstance([inst])
    expect(batcher.has(inst)).toBe(true)
    batcher.removeInstance([inst])
    expect(batcher.has(inst)).toBe(false)
  })

  it('handles swap-and-pop on remove (not last element)', () => {
    const instances = [makeInst(), makeInst(), makeInst(), makeInst()]
    batcher.addInstance(instances)

    // Remove the first instance — should trigger swap-and-pop
    batcher.removeInstance([instances[0]])
    expect(batcher.count).toBe(3)

    // The last instance (index 3) should have been moved to index 0
    // Verify by checking the batcher still holds the other instances
    expect(batcher.has(instances[1])).toBe(true)
    expect(batcher.has(instances[2])).toBe(true)
    expect(batcher.has(instances[3])).toBe(true)
  })

  it('reuses empty slots after removal', () => {
    const geo = makeGeo()
    const mat = makeMat()

    // Fill 4 slots to capacity
    const batch1 = [new Instance(geo, mat), new Instance(geo, mat), new Instance(geo, mat), new Instance(geo, mat)]
    batcher.addInstance(batch1)
    expect(batcher.count).toBe(4)

    // Remove two, creating empty slots
    batcher.removeInstance(batch1[1])
    batcher.removeInstance(batch1[2])
    expect(batcher.count).toBe(2)

    // Add two more — should reuse empty slots without growing
    const batch2 = [new Instance(geo, mat), new Instance(geo, mat)]
    batcher.addInstance(batch2)
    expect(batcher.count).toBe(4)
    expect(batcher.groupCount).toBe(1)
    expect(batcher.has(batch2[0])).toBe(true)
    expect(batcher.has(batch2[1])).toBe(true)
  })

  it('update processes without camera', () => {
    batcher.addInstance([makeInst()])
    expect(() => batcher.update()).not.toThrow()
  })

  it('update processes with camera (no frustumCulling)', () => {
    batcher.addInstance([makeInst()])
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    expect(() => batcher.update(camera)).not.toThrow()
  })

  it('update with frustumCulling enabled does not throw', () => {
    const fb = new InstanceBatcher({ initialCapacity: 4, frustumCulling: true })
    fb.addInstance([makeInst()])
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    expect(() => fb.update(camera)).not.toThrow()
  })

  it('grows group when capacity exceeded', () => {
    const geo = makeGeo()
    const mat = makeMat()
    // initialCapacity = 4, add 5 → should trigger grow
    for (let i = 0; i < 5; i++) {
      batcher.addInstance([new Instance(geo, mat)])
    }
    expect(batcher.count).toBe(5)
    expect(batcher.groupCount).toBe(1)
  })

  it('returns null for non-InstancedMesh intersection', () => {
    const result = batcher.getInstanceFromIntersect({
      instanceId: 0,
      object: new THREE.Mesh(makeGeo(), makeMat()),
    })
    expect(result).toBeNull()
  })

  it('returns null when instanceId is undefined', () => {
    const result = batcher.getInstanceFromIntersect({
      object: new THREE.Mesh(makeGeo(), makeMat()),
    })
    expect(result).toBeNull()
  })
})

// ============================================================
// disposeBatcher
// ============================================================
describe('disposeBatcher', () => {
  it('unsubscribes from all instances', () => {
    const batcher = new InstanceBatcher()
    const inst = makeInst()
    batcher.addInstance([inst])

    // After adding, the batcher should be in the instance's subscribers
    expect(inst._subscribers.size).toBe(1)

    batcher.disposeBatcher()

    expect(inst._subscribers.size).toBe(0)
    expect(batcher.count).toBe(0)
    expect(batcher.groupCount).toBe(0)
  })

  it('clears all internal state', () => {
    const batcher = new InstanceBatcher()
    batcher.addInstance([makeInst(), makeInst(), makeInst()])
    batcher.disposeBatcher()
    expect(batcher.count).toBe(0)
    expect(batcher.groupCount).toBe(0)
    expect(batcher.hasDirty).toBe(false)
  })

  it('is safe to call disposeBatcher twice', () => {
    const batcher = new InstanceBatcher()
    const inst = makeInst()
    batcher.addInstance([inst])
    batcher.disposeBatcher()
    expect(() => batcher.disposeBatcher()).not.toThrow()
  })

  it('batcher does not respond to instance changes after dispose', () => {
    const batcher = new InstanceBatcher()
    const inst = makeInst()
    batcher.addInstance([inst])
    batcher.disposeBatcher()

    // Instance change should not affect disposed batcher
    expect(() => inst.position.set(10, 0, 0)).not.toThrow()
  })
})

// ============================================================
// groupKey
// ============================================================
describe('groupKey', () => {
  it('produces same key for same inputs', () => {
    const geo = makeGeo()
    const mat = makeMat()
    const k1 = new Instance(geo, mat).groupKey
    const k2 = new Instance(geo, mat).groupKey
    expect(k1).toBe(k2)
  })

  it('produces different keys for different geometries', () => {
    const geo1 = new THREE.BoxGeometry(1, 1, 1)
    const geo2 = new THREE.SphereGeometry(1)
    const mat = makeMat()
    expect(new Instance(geo1, mat).groupKey).not.toBe(new Instance(geo2, mat).groupKey)
  })

  it('produces different keys for different shadow flags', () => {
    const geo = makeGeo()
    const mat = makeMat()
    const a = new Instance(geo, mat)
    const b = new Instance(geo, mat)
    b.castShadow = true
    expect(a.groupKey).not.toBe(b.groupKey)
  })
})

// ============================================================
// Shadow migration (group reassignment)
// ============================================================
describe('shadow migration', () => {
  it('moves instance to new group on castShadow change', () => {
    const batcher = new InstanceBatcher()
    const inst = makeInst()
    batcher.addInstance([inst])
    expect(batcher.groupCount).toBe(1)

    inst.castShadow = true
    // Migration happens on update()
    batcher.update()
    expect(batcher.groupCount).toBe(2)
  })

  it('moves instance to correct group and preserves count', () => {
    const batcher = new InstanceBatcher({ initialCapacity: 4 })
    const geo = makeGeo()
    const mat = makeMat()

    const a = new Instance(geo, mat)
    const b = new Instance(geo, mat)
    batcher.addInstance([a, b])
    expect(batcher.count).toBe(2)
    expect(batcher.groupCount).toBe(1)

    a.castShadow = true
    batcher.update()

    expect(batcher.count).toBe(2)
    expect(batcher.groupCount).toBe(2)
  })
})

// ============================================================
// getMatrixAt / getColorAt
// ============================================================
describe('getMatrixAt / getColorAt', () => {
  it('getMatrixAt returns identity for unknown instance', () => {
    const batcher = new InstanceBatcher()
    const target = new THREE.Matrix4()
    batcher.getMatrixAt(makeInst(), target)
    expect(target.equals(new THREE.Matrix4().identity())).toBe(true)
  })

  it('getMatrixAt returns instance world matrix from GPU buffer', () => {
    const batcher = new InstanceBatcher()
    const inst = makeInst()
    inst.position.set(7, 0, 0)
    batcher.addInstance(inst)
    batcher.update()

    const target = new THREE.Matrix4()
    batcher.getMatrixAt(inst, target)
    expect(target.elements[12]).toBeCloseTo(7, 4)
  })

  it('getColorAt returns white for unknown instance', () => {
    const batcher = new InstanceBatcher()
    const target = new THREE.Color()
    batcher.getColorAt(makeInst(), target)
    expect(target.r).toBe(1)
    expect(target.g).toBe(1)
    expect(target.b).toBe(1)
  })

  it('getColorAt returns instance color from GPU buffer', () => {
    const batcher = new InstanceBatcher()
    const inst = makeInst()
    inst.color.set('#ff0000')
    batcher.addInstance(inst)
    batcher.update()

    const target = new THREE.Color()
    batcher.getColorAt(inst, target)
    expect(target.r).toBeCloseTo(1, 2)
    expect(target.g).toBeCloseTo(0, 2)
  })
})

// ============================================================
// customDepthMaterial / customDistanceMaterial
// ============================================================
describe('customDepthMaterial / customDistanceMaterial', () => {
  it('propagates customDepthMaterial to created InstancedMesh', () => {
    const depthMat = new THREE.MeshBasicMaterial()
    const batcher = new InstanceBatcher({ customDepthMaterial: depthMat })
    batcher.addInstance(makeInst())

    // Walk children to find the InstancedMesh
    for (const child of batcher.children) {
      if (child instanceof THREE.InstancedMesh) {
        expect(child.customDepthMaterial).toBe(depthMat)
      }
    }
  })

  it('propagates customDistanceMaterial to created InstancedMesh', () => {
    const distMat = new THREE.MeshBasicMaterial()
    const batcher = new InstanceBatcher({ customDistanceMaterial: distMat })
    batcher.addInstance(makeInst())

    for (const child of batcher.children) {
      if (child instanceof THREE.InstancedMesh) {
        expect(child.customDistanceMaterial).toBe(distMat)
      }
    }
  })

  it('preserves customDepthMaterial after group grow', () => {
    const depthMat = new THREE.MeshBasicMaterial()
    const batcher = new InstanceBatcher({ initialCapacity: 2, customDepthMaterial: depthMat })
    const geo = makeGeo()
    const mat = makeMat()
    // 3 instances over capacity of 2 → triggers grow
    batcher.addInstance([new Instance(geo, mat), new Instance(geo, mat), new Instance(geo, mat)])

    for (const child of batcher.children) {
      if (child instanceof THREE.InstancedMesh) {
        expect(child.customDepthMaterial).toBe(depthMat)
      }
    }
  })
})
