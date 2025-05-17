// Modular PlayerAvatar component for AWorld
// This preserves the current cube-based avatar but allows for easy swap to a 3D model later
import * as THREE from '../three.js';

export class PlayerAvatar {
    constructor(position, color) {
        this.position = position || { x: 0, y: 0, z: 0 };
        this.color = color || 0x00ff00;
        this.mesh = null;
    }
    createMesh() {
        // Body
        const bodyGeometry = new THREE.BoxGeometry(1, 2, 1);
        const bodyMaterial = new THREE.MeshStandardMaterial({ color: this.color, roughness: 0.7, metalness: 0.3 });
        const mesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.position.set(this.position.x, this.position.y + 1, this.position.z);
        // Head
        const headGeometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);
        const headMaterial = new THREE.MeshStandardMaterial({ color: this.color, roughness: 0.7, metalness: 0.3 });
        const head = new THREE.Mesh(headGeometry, headMaterial);
        head.position.y = 1.4;
        head.castShadow = true;
        head.receiveShadow = true;
        mesh.add(head);
        this.mesh = mesh;
        return mesh;
    }
    getObject3D() {
        if (!this.mesh) this.createMesh();
        return this.mesh;
    }
}
