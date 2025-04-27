// Modular Cuboid Building component for AWorld
// This preserves the current cuboid building logic
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.module.js';

export class Building {
    constructor(position, size, wallDisplayTexture) {
        this.position = position || { x: 0, y: 0, z: 0 };
        this.size = size || { width: 8, height: 5, depth: 4 };
        this.wallDisplayTexture = wallDisplayTexture || null;
        this.mesh = null;
    }
    createMesh() {
        const { width, height, depth } = this.size;
        const geometry = new THREE.BoxGeometry(width, height, depth);
        // Materials: front is display, others are gray
        const materials = [
            new THREE.MeshStandardMaterial({ color: 0x888888 }), // right
            new THREE.MeshStandardMaterial({ color: 0x888888 }), // left
            new THREE.MeshStandardMaterial({ color: 0xaaaaaa }), // top
            new THREE.MeshStandardMaterial({ color: 0x666666 }), // bottom
            this.wallDisplayTexture ? new THREE.MeshStandardMaterial({ map: this.wallDisplayTexture }) : new THREE.MeshStandardMaterial({ color: 0xffffff }), // front
            new THREE.MeshStandardMaterial({ color: 0x888888 })  // back
        ];
        const mesh = new THREE.Mesh(geometry, materials);
        mesh.position.set(this.position.x, this.position.y + height / 2, this.position.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.mesh = mesh;
        return mesh;
    }
    getObject3D() {
        if (!this.mesh) this.createMesh();
        return this.mesh;
    }
}
