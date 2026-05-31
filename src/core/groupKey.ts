import * as THREE from 'three'

const PROPS_THAT_SPLIT_BATCH = [
  'type',
  'map', 'alphaMap', 'normalMap', 'roughnessMap', 'metalnessMap',
  'transparent', 'alphaTest', 'side', 'depthWrite', 'depthTest',
  'wireframe', 'flatShading',
  'blending', 'blendSrc', 'blendDst',
]

export function materialSignature(mat: THREE.Material): string {
  const parts: string[] = []
  for (const prop of PROPS_THAT_SPLIT_BATCH) {
    const val = (mat as unknown as Record<string, unknown>)[prop]
    if (val === undefined || val === null) {
      parts.push(`${prop}=_`)
    } else if (val instanceof THREE.Texture) {
      parts.push(`${prop}=tex:${val.uuid}`)
    } else {
      parts.push(`${prop}=${String(val)}`)
    }
  }
  return parts.join(';')
}

export function groupKey(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  castShadow: boolean,
  receiveShadow: boolean,
): string {
  const geoId = geometry.uuid ?? String(geometry.id)
  const matSig = materialSignature(material)
  const shadow = `${castShadow ? 1 : 0}${receiveShadow ? 1 : 0}`
  return `${geoId}|${matSig}|${shadow}`
}
