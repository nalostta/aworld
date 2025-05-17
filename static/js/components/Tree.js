// Modular Tree component for AWorld
// Example template for a new 3D object/resource
import * as THREE from '../three.js';

export class Tree {
    constructor(position, options = {}) {
        this.position = position || { x: 0, y: 0, z: 0 };
        this.color = options.color || 0x228B22; // foliage color
        this.trunkColor = options.trunkColor || 0x8B4513;
        this.size = options.size || { trunkHeight: 6, foliageRadius: 1.6 };
        this.mesh = null;
    }

    createMesh() {
        // Trunk
        const trunk = new THREE.Mesh(
            new THREE.CylinderGeometry(0.2, 0.2, this.size.trunkHeight),
            new THREE.MeshStandardMaterial({ color: this.trunkColor })
        );
        trunk.position.y = this.size.trunkHeight / 2;

        // Foliage
        const leaves = new THREE.Mesh(
            new THREE.SphereGeometry(this.size.foliageRadius, 46, 46),
            new THREE.MeshStandardMaterial({ color: this.color })
        );
        leaves.position.y = this.size.trunkHeight;

        // Group
        const group = new THREE.Group();
        group.add(trunk);
        group.add(leaves);
        group.position.set(this.position.x, this.position.y, this.position.z);
        this.mesh = group;
        return group;
    }

    getObject3D() {
        if (!this.mesh) this.createMesh();
        return this.mesh;
    }

    // Example interaction method (optional)
    onInteract(player) {
        // Custom logic when a player interacts with this tree
        // e.g., shake the tree, drop an item, etc.
        console.log('Tree interacted with by', player);
    }
}
