// textureLoader.js
// Centralized texture loading engine for AWorld
// Place textures in static/textures/ and use this loader to fetch them by name

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.module.js';

class TextureLoaderEngine {
    constructor(basePath = '/static/textures/') {
        this.basePath = basePath;
        this.cache = {};
        this.loader = new THREE.TextureLoader();
    }

    /**
     * Loads a texture by filename (e.g., 'bark.png').
     * Returns a THREE.Texture. Uses cache if already loaded.
     * @param {string} filename
     * @param {function} [onLoad] Optional callback for async loading
     */
    getTexture(filename, onLoad) {
        if (this.cache[filename]) {
            if (onLoad) onLoad(this.cache[filename]);
            return this.cache[filename];
        }
        const fullPath = this.basePath + filename;
        const texture = this.loader.load(fullPath, (tex) => {
            this.cache[filename] = tex;
            if (onLoad) onLoad(tex);
        });
        this.cache[filename] = texture;
        return texture;
    }
}

// Singleton instance
export const textureLoaderEngine = new TextureLoaderEngine();
