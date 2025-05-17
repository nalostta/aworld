// textureLoader.js
// Centralized texture loading engine for AWorld
// Place textures in static/textures/ and use this loader to fetch them by name

import * as THREE from './three.js';

class TextureLoaderEngine {
    constructor(basePath = '/static/textures/') {
        this.basePath = basePath;
        this.cache = {}; // global cache for all textures
        this.loader = new THREE.TextureLoader();
        this.modelTextureCache = {}; // { modelName: { textureName: THREE.Texture } }
        // Fallback texture: 1x1 magenta pixel
        const canvas = document.createElement('canvas');
        canvas.width = 1; canvas.height = 1;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ff00ff';
        ctx.fillRect(0, 0, 1, 1);
        this.fallbackTexture = new THREE.CanvasTexture(canvas);
    }


    /**
     * Loads a texture by filename from the global textures directory.
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
        const texture = this.loader.load(
            fullPath,
            (tex) => {
                this.cache[filename] = tex;
                if (onLoad) onLoad(tex);
            },
            undefined,
            (err) => {
                console.error(`[TextureLoader] Failed to load texture: ${fullPath}`, err);
                this.cache[filename] = this.fallbackTexture;
                if (onLoad) onLoad(this.fallbackTexture);
            }
        );
        this.cache[filename] = texture;
        return texture;
    }

    /**
     * Loads all textures from a specific model's textures folder.
     * @param {string} modelName - The folder name under /static/models/ (e.g., 'Porsche_911_Interior')
     * @param {Array<string>} textureFiles - List of texture filenames in the folder
     * @param {function} [onAllLoaded] - Optional callback when all textures are loaded
     */
    loadModelTextures(modelName, textureFiles, onAllLoaded) {
        if (!this.modelTextureCache[modelName]) {
            this.modelTextureCache[modelName] = {};
        }
        let loadedCount = 0;
        const total = textureFiles.length;
        if (total === 0 && onAllLoaded) onAllLoaded({});
        textureFiles.forEach(filename => {
            if (this.modelTextureCache[modelName][filename]) {
                loadedCount++;
                if (loadedCount === total && onAllLoaded) onAllLoaded(this.modelTextureCache[modelName]);
                return;
            }
            const fullPath = `/static/models/${modelName}/textures/` + filename;
            this.modelTextureCache[modelName][filename] = this.loader.load(
                fullPath,
                (tex) => {
                    this.modelTextureCache[modelName][filename] = tex;
                    loadedCount++;
                    if (loadedCount === total && onAllLoaded) onAllLoaded(this.modelTextureCache[modelName]);
                },
                undefined,
                (err) => {
                    console.error(`[TextureLoader] Failed to load model texture: ${fullPath}`, err);
                    this.modelTextureCache[modelName][filename] = this.fallbackTexture;
                    loadedCount++;
                    if (loadedCount === total && onAllLoaded) onAllLoaded(this.modelTextureCache[modelName]);
                }
            );
        });
    }

    /**
     * Get a texture for a given model and filename (if loaded).
     * @param {string} modelName
     * @param {string} filename
     * @returns {THREE.Texture|null}
     */
    getModelTexture(modelName, filename) {
        if (this.modelTextureCache[modelName] && this.modelTextureCache[modelName][filename]) {
            return this.modelTextureCache[modelName][filename];
        }
        return null;
    }
}


// Singleton instance
export const textureLoaderEngine = new TextureLoaderEngine();
