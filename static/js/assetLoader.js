// assetLoader.js
// Loads external GLTF assets listed in asset_registry.json and spawns them in the scene
console.log('[DEBUG] Loaded assetLoader.js');
import * as THREE from './three.js';
console.log('[DEBUG] THREE imported:', typeof THREE);
import { GLTFLoader } from './loaders/GLTFLoader.js';
console.log('[DEBUG] GLTFLoader imported:', typeof GLTFLoader);

// The asset registry lives under the models directory. The original default
// path pointed to `/static/asset_registry.json`, which does not exist and
// results in a failed fetch.  Point to the correct location instead so assets
// load properly when the game starts.
export async function loadExternalAssets(scene, registryUrl = '/static/models/asset_registry.json') {
  console.log('[DEBUG] Starting to load external assets from registry:', registryUrl);
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
    console.error('[DEBUG] Error creating GLTFLoader:', e);
    return;
  }

  let totalAssets = 0, loadedAssets = 0, failedAssets = 0;
  if (!Array.isArray(registry)) {
    console.error('[DEBUG] Asset registry is not an array:', registry);
    return;
  }
  for (const asset of registry) {
    if (!asset.gltfPath) {
      console.warn('[DEBUG] Asset entry missing gltfPath:', asset);
      continue;
    }
    const spawn = asset.spawnPoints && asset.spawnPoints[0] ? asset.spawnPoints[0] : { x: 0, y: 0, z: 0 };
    console.log(`[DEBUG] Preparing to load asset: ${asset.name || asset.gltfPath}`);
    console.log('[DEBUG] Spawn point for asset:', spawn);
    loader.load(
      asset.gltfPath,
      (gltf) => {
        let obj = gltf.scene || (gltf.scenes && gltf.scenes[0]) || gltf;
        if (!obj) {
          failedAssets++;
          console.error(`[DEBUG] Loaded GLTF but no scene/object found for asset: ${asset.name || asset.gltfPath}`);
          return;
        }
        obj.position.set(spawn.x, spawn.y, spawn.z);
        if (asset.scale && typeof asset.scale.x === 'number' && typeof asset.scale.y === 'number' && typeof asset.scale.z === 'number') {
          obj.scale.set(asset.scale.x, asset.scale.y, asset.scale.z);
          console.log(`[DEBUG] Applied scale to asset '${asset.name || asset.gltfPath}':`, asset.scale);
        }
        console.log(`[DEBUG] Successfully loaded asset '${asset.name || asset.gltfPath}' from ${asset.gltfPath} at`, spawn);
        scene.add(obj);
        loadedAssets++;
        // Confirm object in scene
        if (!scene.children.includes(obj)) {
          console.error(`[DEBUG] Object for asset '${asset.name || asset.gltfPath}' was not added to scene!`);
        } else {
          console.log(`[DEBUG] Added asset '${asset.name}' to scene at`, spawn, 'Object:', obj);
        }
      },
      undefined,
      (err) => {
        failedAssets++;
        console.error(`[DEBUG] Error loading GLTF '${asset.name || asset.gltfPath}' from ${asset.gltfPath} at`, spawn, err);
      }
    );
    totalAssets++;
  }
  console.log(`[DEBUG] Asset loading summary: attempted=${totalAssets}, loaded=${loadedAssets}, failed=${failedAssets}`);
}
