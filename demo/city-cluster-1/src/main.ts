import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import Stats from 'three/examples/jsm/libs/stats.module.js'
import { Instance, InstanceBatcher } from 'three-instance-batch'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

// ── Stats panel ──
const statsPanel = new Stats()
statsPanel.showPanel(0)
document.body.appendChild(statsPanel.dom)
statsPanel.dom.style.cssText = 'position:fixed;top:0;left:0;z-index:20;'

// ── Info overlay ──
const infoEl = document.createElement('div')
Object.assign(infoEl.style, {
  position: 'fixed', top: '16px', right: '16px', zIndex: '10',
  color: '#888', fontFamily: 'monospace', fontSize: '12px',
  lineHeight: '1.5', background: 'rgba(0,0,0,0.5)',
  padding: '8px 12px', borderRadius: '4px',
  contain: 'layout style paint', whiteSpace: 'pre',
} as Partial<CSSStyleDeclaration>)
document.body.appendChild(infoEl)

// ── Scene ──
const scene = new THREE.Scene()
scene.background = new THREE.Color('#87ceeb')

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.5, 400)
camera.position.set(50, 45, 60)
camera.lookAt(0, 0, 0)

const renderer = new THREE.WebGLRenderer()
renderer.setSize(innerWidth, innerHeight)
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
renderer.shadowMap.enabled = true
document.body.appendChild(renderer.domElement)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.08
controls.minDistance = 10
controls.maxDistance = 200
controls.maxPolarAngle = Math.PI / 2.1
controls.target.set(0, 0, 0)

scene.add(new THREE.AmbientLight('#b1c5d4', 0.9))
const sun = new THREE.DirectionalLight('#fffbe6', 3.5)
sun.position.set(60, 70, 40); sun.castShadow = true
sun.shadow.mapSize.set(1024, 1024)
sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 300
sun.shadow.camera.left = -80; sun.shadow.camera.right = 80
sun.shadow.camera.top = 80; sun.shadow.camera.bottom = -80
sun.shadow.bias = -0.0004
scene.add(sun)

const ground = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.MeshStandardMaterial({ color: '#4a7c59', roughness: 0.9 }))
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true
scene.add(ground)

function addRoad(x: number, z: number, w: number, d: number) {
  const r = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: '#4a4a4a', roughness: 0.95 }))
  r.rotation.x = -Math.PI / 2; r.position.set(x, 0.03, z); r.receiveShadow = true
  scene.add(r)
}
for (const [x, z, w, d] of [[0,0,9,140],[0,0,140,9],[-28,0,5,140],[28,0,5,140],[0,-28,140,5],[0,28,140,5]]) addRoad(x,z,w,d)

const batcher = new InstanceBatcher({ initialCapacity: 64, overAllocation: 0.3, frustumCulling: true })
scene.add(batcher)

const MODEL_NAMES = ['building-a','building-b','building-c','building-d','building-e','building-f','building-g','building-h','building-i','building-j','building-k','building-l','building-m','building-n']

function rand(min: number, max: number) { return Math.random() * (max - min) + min }

// ── Road avoidance ──
const ROAD_MARGIN = 1.5
const ROAD_STRIPS: [number, number, number][] = [
  [-4.5 - ROAD_MARGIN, 4.5 + ROAD_MARGIN, 0],
  [-4.5 - ROAD_MARGIN, 4.5 + ROAD_MARGIN, 1],
  [-30.5 - ROAD_MARGIN, -25.5 + ROAD_MARGIN, 0],
  [25.5 - ROAD_MARGIN, 30.5 + ROAD_MARGIN, 0],
  [-30.5 - ROAD_MARGIN, -25.5 + ROAD_MARGIN, 1],
  [25.5 - ROAD_MARGIN, 30.5 + ROAD_MARGIN, 1],
]
function isOnRoad(x: number, z: number): boolean {
  for (const [lo, hi, axis] of ROAD_STRIPS) {
    if (axis === 0 && x >= lo && x <= hi) return true
    if (axis === 1 && z >= lo && z <= hi) return true
  }
  return false
}
function tryPlace(xLo: number, xHi: number, zLo: number, zHi: number, maxAttempts = 200): [number, number] | null {
  for (let a = 0; a < maxAttempts; a++) {
    const px = rand(xLo, xHi), pz = rand(zLo, zHi)
    if (!isOnRoad(px, pz)) return [px, pz]
  }
  return null
}

const GROUND_HALF = 68

async function initCity() {
  const loader = new GLTFLoader()
  const results = await Promise.allSettled(
    MODEL_NAMES.map(name => loader.loadAsync(`/models/${name}.glb`))
  )
  const modelTypes: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') {
      // Extract the largest mesh from each GLB
      const meshes: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = []
      r.value.scene.traverse((c: THREE.Object3D) => {
        if (c instanceof THREE.Mesh && c.geometry) {
          meshes.push({ geometry: c.geometry, material: c.material as THREE.Material })
        }
      })
      meshes.sort((a, b) =>
        (b.geometry.getAttribute('position')?.count ?? 0) -
        (a.geometry.getAttribute('position')?.count ?? 0))
      if (meshes.length > 0) modelTypes.push(meshes[0])
    } else {
      console.warn('Model load rejected:', r.reason)
    }
  }
  if (modelTypes.length === 0) {
    infoEl.textContent = 'ERROR: All models failed to load.'
    return
  }

  const allInstances: Instance[] = []
  const roadX = [-42, -28, -4.5, 4.5, 28, 42]
  const roadZ = [-42, -28, -4.5, 4.5, 28, 42]

  // Block-based buildings
  for (let ri = 0; ri < roadX.length - 1; ri++) {
    for (let rj = 0; rj < roadZ.length - 1; rj++) {
      const margin = 2.0
      const x0 = roadX[ri] + margin, x1 = roadX[ri + 1] - margin
      const z0 = roadZ[rj] + margin, z1 = roadZ[rj + 1] - margin
      if (x1 <= x0 || z1 <= z0) continue
      const area = (x1 - x0) * (z1 - z0)
      const buildingCount = Math.max(3, Math.floor(area / 12) + Math.floor(Math.random() * 5))

      for (let i = 0; i < buildingCount; i++) {
        const pos = tryPlace(x0 + 1.5, x1 - 1.5, z0 + 1.5, z1 - 1.5)
        if (!pos) continue
        const t = modelTypes[Math.floor(Math.random() * modelTypes.length)]
        const inst = new Instance(t.geometry, t.material)
        inst.position.set(pos[0], 0, pos[1])
        inst.quaternion.setFromEuler(new THREE.Euler(0, rand(0, Math.PI * 2), 0))
        inst.scale.setScalar(rand(0.85, 1.2))
        inst.castShadow = false; inst.receiveShadow = true
        allInstances.push(inst)
      }
    }
  }

  // Roadside trees
  const treeGeo = new THREE.ConeGeometry(0.25, 2.5, 6, 2)
  treeGeo.translate(0, 1.25, 0); treeGeo.computeBoundingSphere()
  const treeMat = new THREE.MeshStandardMaterial({ color: '#3a6b35', roughness: 0.7 })
  for (const edge of [-4.5, 4.5, -28, 28]) {
    const isX = Math.abs(edge) < 10
    const sign = Math.sign(edge)
    for (let t = -65; t <= 65; t += 2.5) {
      if (Math.abs(t) < 5) continue
      const roadOffset = sign * rand(1.5, 3.5)
      const jitter = rand(-0.5, 0.5)
      const tree = new Instance(treeGeo, treeMat)
      isX ? tree.position.set(edge + roadOffset, 0, t + jitter)
          : tree.position.set(t + jitter, 0, edge + roadOffset)
      tree.scale.setScalar(rand(0.7, 1.3)); tree.castShadow = true
      allInstances.push(tree)
    }
  }

  // Scatter objects (grass, bush, rock)
  const grassGeo = new THREE.ConeGeometry(0.15, 0.6, 4, 2)
  grassGeo.translate(0, 0.3, 0); grassGeo.computeBoundingSphere()
  const grassMat = new THREE.MeshStandardMaterial({ color: '#4d8c36', roughness: 0.8 })

  const bushGeo = new THREE.SphereGeometry(0.4, 5, 3)
  bushGeo.scale(1, 0.6, 1); bushGeo.translate(0, 0.2, 0); bushGeo.computeBoundingSphere()
  const bushMat = new THREE.MeshStandardMaterial({ color: '#2d5a1e', roughness: 0.85 })

  const rockGeo = new THREE.IcosahedronGeometry(0.25, 0)
  rockGeo.translate(0, 0.1, 0); rockGeo.computeBoundingSphere()
  const rockMat = new THREE.MeshStandardMaterial({ color: '#8b7355', roughness: 0.6 })

  const scatterTypes: [THREE.BufferGeometry, THREE.Material, number, boolean][] = [
    [grassGeo, grassMat, 500, false],
    [bushGeo,  bushMat,  300, false],
    [rockGeo,  rockMat,  200, false],
  ]
  for (const [geo, mat, count, castShadow] of scatterTypes) {
    for (let i = 0; i < count; i++) {
      const pos = tryPlace(-GROUND_HALF, GROUND_HALF, -GROUND_HALF, GROUND_HALF)
      if (!pos) continue
      const inst = new Instance(geo, mat)
      inst.position.set(pos[0], 0, pos[1])
      inst.quaternion.setFromEuler(new THREE.Euler(0, rand(0, Math.PI * 2), 0))
      inst.scale.setScalar(rand(0.7, 1.4))
      inst.castShadow = castShadow
      inst.receiveShadow = true
      allInstances.push(inst)
    }
  }

  // Scatter buildings on grass
  for (let i = 0; i < 500; i++) {
    const pos = tryPlace(-GROUND_HALF, GROUND_HALF, -GROUND_HALF, GROUND_HALF)
    if (!pos) continue
    const t = modelTypes[Math.floor(Math.random() * modelTypes.length)]
    const inst = new Instance(t.geometry, t.material)
    inst.position.set(pos[0], 0, pos[1])
    inst.quaternion.setFromEuler(new THREE.Euler(0, rand(0, Math.PI * 2), 0))
    inst.scale.setScalar(rand(0.7, 1.3))
    inst.castShadow = false; inst.receiveShadow = true
    allInstances.push(inst)
  }

  batcher.addInstance(allInstances)
  batcher.update(camera)
  renderer.render(scene, camera)
}

// ── Info panel (incremental span update) ──
const STAT_KEYS = ['instances', 'groups', 'sep', 'drawCalls', 'triangles', 'points', 'lines', 'geometries', 'textures'] as const
type StatKey = (typeof STAT_KEYS)[number]
const spansMap = new Map<StatKey, HTMLSpanElement>()
const lastVals = new Map<StatKey, string>()

for (const key of STAT_KEYS) {
  const span = document.createElement('span')
  if (key === 'sep') span.textContent = '── GPU ──'
  span.style.display = 'block'
  infoEl.appendChild(span)
  spansMap.set(key, span)
}
function setStat(key: StatKey, value: string): void {
  if (lastVals.get(key) === value) return
  lastVals.set(key, value)
  spansMap.get(key)!.textContent = value
}

let lastInfoUpdate = 0
const INFO_INTERVAL = 2000

function updateInfoPanel(): void {
  const { calls, triangles, points, lines } = renderer.info.render
  setStat('instances', `Instances : ${batcher.count}`)
  setStat('groups',    `Groups    : ${batcher.groupCount}`)
  setStat('drawCalls', `DrawCalls : ${calls}`)
  setStat('triangles', `Triangles : ${triangles.toLocaleString()}`)
  setStat('points',    `Points    : ${points}`)
  setStat('lines',     `Lines     : ${lines}`)
  setStat('geometries',`Geometries: ${renderer.info.memory.geometries}`)
  setStat('textures',  `Textures  : ${renderer.info.memory.textures}`)
}

// ── Continuous render loop ──
function animate(): void {
  requestAnimationFrame(animate)
  controls.update()
  statsPanel.begin()
  batcher.update(camera)
  renderer.render(scene, camera)
  statsPanel.end()

  const now = performance.now()
  if (now - lastInfoUpdate > INFO_INTERVAL) {
    lastInfoUpdate = now
    updateInfoPanel()
  }
}
animate()
initCity()
