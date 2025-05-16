// assetLoader.js
// Loads external GLTF assets listed in asset_registry.json and spawns them in the scene
console.log('[DEBUG] Loaded assetLoader.js');
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.module.js';
console.log('[DEBUG] THREE imported:', typeof THREE);
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/jsm/loaders/GLTFLoader.js';
console.log('[DEBUG] GLTFLoader imported:', typeof GLTFLoader);

export async function loadExternalAssets(scene, registryUrl = '/static/asset_registry.json') {
  let registry;
  try {
    const res = await fetch(registryUrl);
    if (!res.ok) throw new Error(`Failed to fetch asset registry: ${res.status}`);
    registry = await res.json();
    console.log('[DEBUG] Asset registry loaded:', registry);
  } catch (e) {
    console.error('Asset registry loading error:', e);
    return;
  }

  let loader;
  try {
    loader = new GLTFLoader();
    console.log('[DEBUG] GLTFLoader instance created');
  } catch (e) {
    console.error('[DEBUG] Failed to instantiate GLTFLoader:', e);
    return;
  }

  for (const asset of registry) {
    for (const spawn of asset.spawnPoints) {
      loader.load(
        asset.gltfPath,
        (gltf) => {
          const obj = gltf.scene.clone();
          obj.position.set(spawn.x, spawn.y, spawn.z);
          // Physics and interaction logic can be attached here
          // Example: obj.userData.physics = asset.physics;
          console.log(`[DEBUG] Loaded asset ${asset.gltfPath} at`, spawn);
          scene.add(obj);
          console.log(`Loaded asset '${asset.name}' at`, spawn);
        },
        undefined,
        (err) => {
          console.error(`[DEBUG] Error loading GLTF ${asset.gltfPath}:`, err);
        }
      );
    }
  }
}
