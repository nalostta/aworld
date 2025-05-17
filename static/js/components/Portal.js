// Modular Portal component for AWorld
// Represents an interactive portal or arcade cabinet
import * as THREE from '../three.js';

export class Portal {
    constructor(position, color, label) {
        this.position = position || { x: 0, y: 0, z: 0 };
        this.color = color || 0x3498db;
        this.label = label || 'Portal';
        this.mesh = null;
    }
    createMesh() {
        // Portal is now a larger, upright standing torus (ring)
        const geometry = new THREE.TorusGeometry(2, 0.3, 24, 96); // Bigger ring: radius 2, tube 0.3
        const material = new THREE.MeshStandardMaterial({ color: this.color, emissive: 0x3333ff, emissiveIntensity: 0.6 });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(this.position.x, this.position.y + 2.1, this.position.z); // Raise to match new size
        mesh.rotation.y = Math.PI / 2; // Rotate 90deg around Y axis to stand upright
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        // Label as a sprite
        const canvas = document.createElement('canvas');
        canvas.width = 128; canvas.height = 32;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#222';
        ctx.fillRect(0, 0, 128, 32);
        ctx.font = 'bold 20px Arial';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.label, 64, 16);
        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.scale.set(1.8, 0.45, 1); // Slightly larger label for bigger ring
        sprite.position.set(0, 2.4, 0); // above the ring
        mesh.add(sprite);

        this.mesh = mesh;
        return mesh;
    }
    getObject3D() {
        if (!this.mesh) this.createMesh();
        return this.mesh;
    }
}
