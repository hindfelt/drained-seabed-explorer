import * as THREE from 'three';
import { createTerrainMaterial, applyTerrainColors } from '../materials/terrainMaterial.js';

/**
 * Builds the displaced, vertex-colored terrain mesh from a heightmap.
 * @param {import('../data/heightmap.js').Heightmap} heightmap
 * @returns {THREE.Mesh}
 */
export function createTerrain(heightmap) {
  const geometry = new THREE.PlaneGeometry(
    heightmap.size,
    heightmap.size,
    heightmap.resolution,
    heightmap.resolution
  );
  // Lay the plane flat into the XZ plane (normal +Y) before displacing.
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    position.setY(i, heightmap.getHeightAt(x, z));
  }
  position.needsUpdate = true;

  geometry.computeVertexNormals();
  applyTerrainColors(geometry, heightmap);

  const material = createTerrainMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'terrain';
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  return mesh;
}
