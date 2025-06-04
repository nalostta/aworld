import { PlayerAvatar } from './components/PlayerAvatar.js';
import * as THREE from './three.js';
import { Portal } from './components/Portal.js';
import { Building } from './components/Building.js';
import { Tree } from './components/Tree.js';
import PlayerControls from './controls.js';
import { textureLoaderEngine } from './textureLoader.js';
import { loadExternalAssets } from './assetLoader.js';

// Helper: Discover models and their textures from the static/models/ directory
async function discoverModelsAndTextures() {
    // This assumes the server exposes a /static/models/ directory listing via fetchable JSON endpoints or similar.
    // If not, you may need to provide this list from the backend or generate it at build time.
    // For now, we'll hardcode the logic for available models, but this is the place to automate.
    // Example with a single model:
    return [
        {
            name: 'Porsche_911_Interior',
            textures: [
                'Discs_baseColor.jpeg', 'Discs_metallicRoughness.png', 'LOGO1_baseColor.jpeg', 'LOGO1_clearcoat.png',
                'LOGO1_metallicRoughness.png', 'LOGO1_normal.png', 'belts_metallicRoughness.png', 'belts_normal.png',
                'bl_pl_M_ext_metallicRoughness.png', 'bl_pl_M_int_metallicRoughness.png', 'body_main_metallicRoughness.png',
                'brakes_metallicRoughness.png', 'carbon_int_baseColor.jpeg', 'carbon_int_metallicRoughness.png',
                'dynamics_baseColor.jpeg', 'dynamics_metallicRoughness.png', 'dynamics_normal.png',
                'headlights_pattern_normal.png', 'headlights_plastic_ring_normal.png', 'hedlights_grid_normal.png',
                'invisible_all_metallicRoughness.png', 'leather_int_baseColor.jpeg', 'leather_int_metallicRoughness.png',
                'leather_perforated_metallicRoughness.png', 'leather_perforated_normal.png', 'leather_seam_metallicRoughness.png',
                'leather_seam_normal.png', 'number_plate1_baseColor.jpeg', 'pipes_chrom_metallicRoughness.png',
                'pl_leather_int_metallicRoughness.png', 'pl_leather_int_normal.png', 'red_light_main_emissive.jpeg',
                'reflectors_baseColor.jpeg', 'reflectors_normal.png', 'reisin_metallicRoughness.png',
                'rim_black_metallicRoughness.png', 'rim_chrome_metallicRoughness.png', 'rug_interior_baseColor.jpeg',
                'rug_interior_metallicRoughness.png', 'rug_interior_normal.png', 'tires_metallicRoughness.png',
                'tires_normal.png', 'upholstery_baseColor.jpeg', 'upholstery_metallicRoughness.png',
                'upholstery_normal.png', 'windows_dots_baseColor.png'
            ]
        }
    ];
}

class Game {
    constructor() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        console.log('[DEBUG] Game constructor: scene created', this.scene);

        // Handle window resize
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });

        // Handle visibility change
        document.addEventListener('visibilitychange', () => this.handleVisibilityChange());

        // Handle focus/blur events
        window.addEventListener('focus', () => this.handleFocus());
        // Initialize controls with callbacks for jump/land effects
        this.controls = new PlayerControls();
        this.controls.onJump = () => {
            // You could add particle effects or sounds here
            console.log('Player jumped!');
            // Play jump sound if available
            if (typeof this.audioContext !== 'undefined' && this.jumpSound) {
                const source = this.audioContext.createBufferSource();
                source.buffer = this.jumpSound;
                source.connect(this.audioContext.destination);
                source.start(0);
            }
        };
        this.controls.onLand = () => {
            // You could add landing effects here
            console.log('Player landed!');
            // Play landing sound if available
            if (typeof this.audioContext !== 'undefined' && this.landSound) {
                const source = this.audioContext.createBufferSource();
                source.buffer = this.landSound;
                source.connect(this.audioContext.destination);
                source.start(0);
            }
        };
        this.controls.debug = false; // Disable debug output
        this.players = new Map();
        this.socket = io({
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            reconnectionAttempts: 5
        });
        this.playerName = '';
        this.playerId = null;
        this.playerMesh = null;
        this.playerLabel = null;
        this.isActive = true; // Default to active
        this.lastSentPos = null;

        // Add ambient light
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambientLight);

        // Add directional light for shadows
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(50, 50, 50);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        directionalLight.shadow.camera.near = 0.5;
        directionalLight.shadow.camera.far = 500;
        this.scene.add(directionalLight);

        // Dynamically discover and load all model textures at game start
        this.modelTextures = {}; // { modelName: { textureName: THREE.Texture } }
        this.modelTexturesReady = false;
        discoverModelsAndTextures().then((models) => {
            let loadedCount = 0;
            const total = models.length;
            if (total === 0) {
                this.modelTexturesReady = true;
                return;
            }
            models.forEach(model => {
                textureLoaderEngine.loadModelTextures(
                    model.name,
                    model.textures,
                    (textures) => {
                        this.modelTextures[model.name] = textures;
                        loadedCount++;
                        if (loadedCount === total) {
                            this.modelTexturesReady = true;
                            console.log('[DEBUG] All model textures loaded:', Object.keys(this.modelTextures));
                            // Once all model textures are loaded, load all assets from asset_registry.json
                            this.loadAllAssetsFromRegistry();
                        }
                    }
                );
            });
        });

        this.setupScene();
        this.setupSocketEvents();
        this.setupUI();
        this.animate();
    }

    /**
     * Loads all assets specified in asset_registry.json and spawns them in the scene.
     * Attaches physics and interaction data to each loaded object.
     */
    async loadAllAssetsFromRegistry() {
        // Adjust the path if your asset_registry.json is elsewhere
        const registryPath = '/static/models/asset_registry.json';
        try {
            await loadExternalAssets(this.scene, registryPath);
            console.log('[DEBUG] All assets from asset_registry.json loaded into the scene');
            // Debug: log scene children after loading
            if (this.scene && this.scene.children) {
                console.log('[DEBUG] Scene now contains', this.scene.children.length, 'objects. Types:', this.scene.children.map(obj => obj.type));
                this.scene.children.forEach((obj, idx) => {
                    console.log(`[DEBUG] Scene child[${idx}]:`, obj.name || obj.type, obj);
                });
            } else {
                console.warn('[DEBUG] Scene or scene.children is undefined after asset loading');
            }
        } catch (e) {
            console.error('[ERROR] Failed to load assets from registry:', e);
        }
    }

    

    handleFocus() {
        this.isActive = true;
        this.controls.handleFocus();
        this.updateActiveState();
        console.log("Game focused");
    }

    handleBlur() {
        this.isActive = false;
        this.controls.handleBlur();
        this.updateActiveState();
        console.log("Game blurred");
    }

    handleVisibilityChange() {
        const wasActive = this.isActive;
        this.isActive = !document.hidden && document.hasFocus();
        
        if (this.isActive !== wasActive) {
            if (this.isActive) {
                this.handleFocus();
            } else {
                this.handleBlur();
            }
        }
    }

    updateActiveState() {
        const debugInfo = document.getElementById('debug-info');
        if (!debugInfo) {
            // Avoid errors if debug-info is missing
            return;
        }
        if (this.isActive) {
            debugInfo.textContent = 'Session Active - Controls Enabled';
            debugInfo.style.backgroundColor = 'rgba(0, 128, 0, 0.7)';
        } else {
            debugInfo.textContent = 'Session Inactive - Controls Disabled';
            debugInfo.style.backgroundColor = 'rgba(128, 0, 0, 0.7)';
        }
    }


    setupScene() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        const gameContainer = document.getElementById('game-container');
        if (!gameContainer) {
            console.error('[ERROR] game-container element not found in DOM');
            return;
        }
        gameContainer.appendChild(this.renderer.domElement);

        // Add ground
        const groundGeometry = new THREE.PlaneGeometry(100, 100, 50, 50);
        // Dynamically use a model texture for ground if available (example: Porsche_911_Interior/rug_interior_baseColor.jpeg)
        let groundMaterial;
        let foundTexture = null;
        // Search all loaded model textures for a suitable ground texture
        if (this.modelTextures) {
            // (rest of function unchanged)
        }

        for (const modelName in this.modelTextures) {
            if (this.modelTextures[modelName]['rug_interior_baseColor.jpeg']) {
                foundTexture = this.modelTextures[modelName]['rug_interior_baseColor.jpeg'];
                break;
            }
        }
        // End of ground texture search

        if (foundTexture) {
            groundMaterial = new THREE.MeshStandardMaterial({ 
                map: foundTexture,
                roughness: 0.8,
                metalness: 0.2
            });
        } else {
            groundMaterial = new THREE.MeshStandardMaterial({ 
                color: 0x3a8c3a,
                roughness: 0.8,
                metalness: 0.2
            });
        }
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.scene.add(ground);

        // Add grid
        const gridHelper = new THREE.GridHelper(100, 100, 0x000000, 0x222222);
        this.scene.add(gridHelper);

        // --- Modular Building ---
        // Wall display uses a canvas texture as before
        const displayCanvas = document.createElement('canvas');
        displayCanvas.width = 512; displayCanvas.height = 256;
        const displayCtx = displayCanvas.getContext('2d');
        displayCtx.fillStyle = '#222';
        displayCtx.fillRect(0, 0, 512, 256);
        // Smaller, multi-line welcome text
        displayCtx.font = 'bold 24px Arial';
        displayCtx.fillStyle = '#fff';
        displayCtx.textAlign = 'center';
        displayCtx.textBaseline = 'middle';
        displayCtx.fillText('Welcome to', 256, 100);
        displayCtx.fillText('AWorld!', 256, 150);
        const displayTexture = new THREE.CanvasTexture(displayCanvas);
        this.displayCanvas = displayCanvas;
        this.displayCtx = displayCtx;
        this.displayTexture = displayTexture;
        // Modular cuboid building
        this.cuboid = { x: 0, y: 0, z: -8, width: 8, height: 5, depth: 4 };
        const building = new Building(
            { x: this.cuboid.x, y: this.cuboid.y, z: this.cuboid.z },
            { width: this.cuboid.width, height: this.cuboid.height, depth: this.cuboid.depth },
            displayTexture
        );
        this.cuboidMesh = building.getObject3D();
        this.scene.add(this.cuboidMesh);

        // --- Modular Portal Example ---
        this.portals = [];
        const portal1 = new Portal({ x: 6, y: 0, z: 6 }, 0xffa500, 'ringy');
        const portal2 = new Portal({ x: -6, y: 0, z: 6 }, 0x00bfff, 'housy');
        this.scene.add(portal1.getObject3D());
        this.scene.add(portal2.getObject3D());
        this.portals.push(portal1, portal2);

        // --- Add Tree in front of wall, farther than portals ---
        // Wall Z is -8, portals Z are 6, so place tree at Z=12
        this.tree = new Tree({ x: 0, y: 0, z: 12 });
        this.scene.add(this.tree.getObject3D());

        // --- Add 14 more trees with non-linear, spaced-out, randomized positions ---
        this.trees = [this.tree];
        let placedTrees = [ { x: 0, y: 0, z: 12 } ]; // Start with the manually placed tree
        let attempts = 0;
        for (let i = 0; i < 14; i++) {
            let valid = false;
            let x, z;
            while (!valid && attempts < 1000) {
                // Use a normal distribution for more natural spread
                let angle = Math.random() * Math.PI * 2;
                let radius = Math.abs((Math.random() + Math.random()) * 18); // More clustered, but can go farther
                x = Math.cos(angle) * radius + (Math.random() - 0.5) * 2; // Add jitter
                z = Math.sin(angle) * radius + (Math.random() - 0.5) * 2;
                // Ensure at least 4 units from all other trees
                valid = true;
                for (const t of placedTrees) {
                    let dx = x - t.x;
                    let dz = z - t.z;
                    if (Math.sqrt(dx*dx + dz*dz) < 4) {
                        valid = false;
                        break;
                    }
                }
                attempts++;
            }
            placedTrees.push({ x, y: 0, z });
            let trunkHeight = 3 + Math.random() * 6;
            let foliageRadius = 1 + Math.random();
            let tree = new Tree(
                { x, y: 0, z },
                { size: { trunkHeight, foliageRadius } }
            );
            this.scene.add(tree.getObject3D());
            this.trees.push(tree);
        }

        // Fog and camera
        this.scene.fog = new THREE.Fog(0xcccccc, 20, 100);
        this.scene.background = new THREE.Color(0xcccccc);
        this.camera.position.set(0, 5, 10);
        this.camera.lookAt(0, 0, 0);
    }

    // Helper to update the display wall with text or image
    updateWallDisplay(content) {
        const ctx = this.displayCtx;
        if (!ctx || !this.displayCanvas || !this.displayTexture) {
            console.warn('Display wall not ready');
            return;
        }
        ctx.clearRect(0, 0, this.displayCanvas.width, this.displayCanvas.height);
        if (typeof content === 'string') {
            ctx.fillStyle = '#222';
            ctx.fillRect(0, 0, this.displayCanvas.width, this.displayCanvas.height);
            ctx.font = 'bold 70px Arial';
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(content, this.displayCanvas.width/2, this.displayCanvas.height/2);
        } else if (content instanceof Image) {
            ctx.drawImage(content, 0, 0, this.displayCanvas.width, this.displayCanvas.height);
        } else {
            ctx.fillStyle = '#a00';
            ctx.font = 'bold 50px Arial';
            ctx.fillText('Invalid wall content', this.displayCanvas.width/2, this.displayCanvas.height/2);
            console.warn('Wall display received invalid content:', content);
        }
        this.displayTexture.needsUpdate = true;
    }

    setupSocketEvents() {
        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.updateActiveState();
        });

        this.socket.on('player_joined', (player) => {
            if (!player || !player.id || !player.name) {
                console.warn('Invalid player_joined:', player);
                return;
            }
            console.log('Player joined event received:', player);
            this.addPlayer(player);
        });

        // Receive the full list of current players (including after join)
        this.socket.on('current_players', (players) => {
            if (!Array.isArray(players)) {
                console.warn('Invalid current_players:', players);
                return;
            }
            console.log('Received current_players:', players);
            players.forEach(player => {
                if (player && player.id && player.name) {
                    this.addPlayer(player);
                } else {
                    console.warn('Invalid player in current_players:', player);
                }
            });
        });

        this.socket.on('global_state_update', (players) => {
            // Sync all sprites to global state
            const newIds = new Set(players.map(p => p.id));
            this.players.forEach((_, id) => {
                if (!newIds.has(id)) {
                    this.removePlayer(id);
                }
            });
            players.forEach(player => {
                // Add if missing
                if (!this.players.has(player.id)) {
                    this.addPlayer(player);
                }
                // Update position
                const obj = this.players.get(player.id);
                if (obj && obj.mesh) {
                    obj.mesh.position.set(player.position.x, player.position.y, player.position.z);
                    // Handle chat bubble
                    if (player.chat_message && player.chat_message.length > 0) {
                        this.showChatBubble({ id: player.id, text: player.chat_message });
                    } else if (obj.bubble) {
                        // Remove expired bubble
                        obj.mesh.remove(obj.bubble);
                        obj.bubble = null;
                    }
                }
            });
            this.updatePlayerCount(players.length);
        });

        this.socket.on('player_count_update', (data) => {
            this.updatePlayerCount(data.count);
        });

        this.socket.on('player_disconnected', (data) => {
            this.removePlayer(data.id);
        });

        // Add error handling
        this.socket.on('error', (error) => {
            console.error('Socket error:', error);
        });

        this.socket.on('disconnect', (reason) => {
            console.log('Disconnected from server:', reason);
        });

        this.socket.on('chat_message', (msg) => {
            this.showChatBubble(msg);
        });

        // Listen for wall display updates from server
        this.socket.on('wall_display_update', (data) => {
            if (data && typeof data.content === 'string') {
                this.updateWallDisplay(data.content);
            } else {
                console.warn('Invalid wall_display_update:', data);
            }
        });
    }

    setupUI() {
        const startScreen = document.getElementById('start-screen');
        const startButton = document.getElementById('start-button');
        const playerNameInput = document.getElementById('player-name');

        startButton.addEventListener('click', () => {
            this.playerName = playerNameInput.value.trim();
            if (!this.playerName || typeof this.playerName !== 'string' || this.playerName.trim().length === 0) {
                alert('Please enter a valid player name.');
                return;
            }
            startScreen.style.display = 'none';
            document.getElementById('game-container').style.display = 'block';
            this.startGame();
        });

        playerNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && playerNameInput.value.trim()) {
                startButton.click();
            }
        });

        // Add focus/blur handlers for the game container
        const gameContainer = document.getElementById('game-container');
        gameContainer.addEventListener('focus', () => this.handleVisibilityChange());
        gameContainer.addEventListener('blur', () => this.handleVisibilityChange());

        // Chat setup
        this.chatMessages = document.getElementById('chat-messages');
        this.chatForm = document.getElementById('chat-form');
        this.chatInput = document.getElementById('chat-input');
        this.chatInput.maxLength = 120;
        this.isChatFocused = false;
        this.chatInput.addEventListener('focus', () => {
            this.isChatFocused = true;
        });
        this.chatInput.addEventListener('blur', () => {
            this.isChatFocused = false;
        });
        this.chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const text = this.chatInput.value.trim();
            if (text.length > 0) {
                this.socket.emit('chat_message', { text });
                this.chatInput.value = '';
            }
        });
    }

    startGame() {
        console.log("Starting game with player name:", this.playerName);
        
        const color = '#' + Math.floor(Math.random()*16777215).toString(16);
        console.log("Generated player color:", color);
        
        // Clear any existing players
        this.players.forEach((player, id) => {
            this.removePlayer(id);
        });
        
        // Reset player mesh
        this.playerMesh = null;
        this.playerLabel = null;
        
        console.log("Emitting player_join event");
        this.socket.emit('player_join', {
            name: this.playerName,
            color: color
        });
        
        this.isActive = true;
        this.controls.isActive = true;
        this.updateActiveState();
        console.log("Game started, active state:", this.isActive);
        
        // Force focus on the game container
        const gameContainer = document.getElementById('game-container');
        if (gameContainer) {
            gameContainer.focus();
        }
    }

    createPlayerMesh(color) {
        // Use modular PlayerAvatar
        const avatar = new PlayerAvatar({ x: 0, y: 0, z: 0 }, color);
        return avatar.getObject3D();
    }

    createPlayerLabel(name) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.font = 'bold 32px Arial';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 4;
        ctx.strokeText(name, 128, 32);
        ctx.fillText(name, 128, 32);
        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(3, 0.75, 1);
        sprite.position.set(0, 2.2, 0); // Adjust height above player head
        return sprite;
    }

    addPlayer(playerData) {
        if (this.players.has(playerData.id)) return;

        console.log("Adding player:", playerData);

        const mesh = this.createPlayerMesh(playerData.color);
        const label = this.createPlayerLabel(playerData.name);
        mesh.add(label);

        // Set initial position to origin (center of world)
        let pos = { x: 0, y: 1, z: 0 };
        if (playerData.position && typeof playerData.position.x === 'number') {
            pos = {
                x: playerData.position.x,
                y: playerData.position.y + 1,
                z: playerData.position.z
            };
        }
        mesh.position.set(pos.x, pos.y, pos.z);

        this.scene.add(mesh);
        this.players.set(playerData.id, {
            mesh: mesh,
            label: label,
            data: playerData
        });

        // Check if this is our player (either by ID match or if we don't have a player mesh yet)
        if (playerData.id === this.playerId || (!this.playerMesh && this.playerName === playerData.name)) {
            console.log("Setting local player mesh:", mesh);
            this.playerMesh = mesh;
            this.playerLabel = label;
            this.playerId = playerData.id; // Ensure player ID is set
            
            // Log initial position
            console.log("Initial player position:", this.playerMesh.position);
            
            // Verify controls are working
            console.log("Controls active state:", this.controls.isActive);
            console.log("Controls keys state:", this.controls.keys);
            
            // Force update active state
            this.isActive = true;
            this.controls.isActive = true;
            this.updateActiveState();
        }
    }

    removePlayer(playerId) {
        const player = this.players.get(playerId);
        if (player) {
            this.scene.remove(player.mesh);
            this.players.delete(playerId);
        }
    }

    updatePlayerPosition(playerId, position) {
        const player = this.players.get(playerId);
        if (player) {
            player.mesh.position.set(position.x, position.y + 1, position.z);
        }
    }
    
    updatePlayerInfo() {
        // Update debug info
        if (this.debugInfo && this.playerMesh) {
            this.debugInfo.innerText = `Position: ${this.playerMesh.position.x.toFixed(2)}, ${this.playerMesh.position.y.toFixed(2)}, ${this.playerMesh.position.z.toFixed(2)}`;
        }
    }
    
    updatePlayerCount(count) {
        const countElem = document.getElementById('player-count');
        if (countElem) {
            countElem.textContent = `Players Online: ${count}`;
        }
    }
    
    /**
     * Enhanced collision detection system
     * Checks for collisions with all objects in the scene and returns collision flags
     * @param {number} x - New X position to check
     * @param {number} y - New Y position to check
     * @param {number} z - New Z position to check
     * @returns {object} - Collision flags for each axis and an 'any' flag
     */
    checkCollisions(x, y, z) {
        // Default: no collisions
        const result = { x: false, y: false, z: false, any: false };
        
        // Player collision parameters
        const playerRadius = 0.6;
        const playerHeight = 2.0;
        
        // Check cuboid collision if it exists
        if (this.cuboid) {
            const b = this.cuboid;
            const margin = playerRadius; // Use player radius as margin
            
            // Calculate cuboid boundaries
            const minX = b.x - b.width/2 - margin;
            const maxX = b.x + b.width/2 + margin;
            const minY = 0; // ground
            const maxY = b.y + b.height + margin;
            const minZ = b.z - b.depth/2 - margin;
            const maxZ = b.z + b.depth/2 + margin;
            
            // Detailed axis collision tests
            // We perform each axis test separately to know which axes are colliding
            
            // X-axis collision: Check if new X position with current Y,Z would collide
            if (x > minX && x < maxX && 
                y > minY && y < maxY && 
                this.playerMesh.position.z > minZ && this.playerMesh.position.z < maxZ) {
                result.x = true;
                result.any = true;
            }
            
            // Y-axis collision: Check if new Y with current X,Z would collide
            if (this.playerMesh.position.x > minX && this.playerMesh.position.x < maxX && 
                y > minY && y < maxY && 
                this.playerMesh.position.z > minZ && this.playerMesh.position.z < maxZ) {
                result.y = true;
                result.any = true;
            }
            
            // Z-axis collision: Check if new Z with current X,Y would collide
            if (this.playerMesh.position.x > minX && this.playerMesh.position.x < maxX && 
                y > minY && y < maxY && 
                z > minZ && z < maxZ) {
                result.z = true;
                result.any = true;
            }
        }
        
        // Check for collisions with trees, buildings, and other objects
        // For now, this is simplified - in a real system, you'd use spatial partitioning
        // to only check nearby objects
        
        // Example for checking tree collisions (assumes trees are in a 'trees' array)
        if (this.trees && Array.isArray(this.trees)) {
            this.trees.forEach(tree => {
                const treePos = tree.position;
                const treeRadius = tree.radius || 0.8; // Default trunk radius if not specified
                
                // Simple cylinder collision for tree trunks
                const dx = x - treePos.x;
                const dz = z - treePos.z;
                const distSquared = dx * dx + dz * dz;
                
                // If distance to tree center is less than combined radii, we have a collision
                const minDistance = playerRadius + treeRadius;
                
                if (distSquared < minDistance * minDistance) {
                    // Determine which axis has more collision
                    if (Math.abs(dx) > Math.abs(dz)) {
                        result.x = true;
                    } else {
                        result.z = true;
                    }
                    result.any = true;
                }
            });
        }
        
        // Ground collision - prevents falling through the ground
        if (y < playerHeight / 2) {
            result.y = true;
            result.any = true;
        }
        
        // Return the detailed collision result
        return result;
    }

    showChatBubble(msg) {
        // Always use the players map to get the correct player by ID
        let playerObj = this.players.get(msg.id);
        // If this is the local player and not found in map, fallback to local mesh/label
        if (!playerObj && msg.id === this.playerId && this.playerMesh) {
            playerObj = { mesh: this.playerMesh, label: this.playerLabel };
        }
        if (playerObj && playerObj.mesh) {
            // Remove existing bubble if present
            if (playerObj.bubble) {
                clearTimeout(playerObj.bubbleTimeout);
                playerObj.mesh.remove(playerObj.bubble);
            }
            // Create a canvas for the chat bubble
            const canvas = document.createElement('canvas');
            canvas.width = 512;
            canvas.height = 128;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            // Draw the bubble background
            ctx.fillStyle = 'rgba(0,0,0,0.85)';
            ctx.strokeStyle = msg.color || '#fff';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.roundRect(10, 10, 492, 108, 32);
            ctx.fill();
            ctx.stroke();
            // Draw the text (larger font)
            ctx.font = 'bold 40px Arial';
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(msg.text, 256, 64, 472);
            // Create a texture and sprite
            const texture = new THREE.CanvasTexture(canvas);
            const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
            const sprite = new THREE.Sprite(material);
            sprite.scale.set(3.3, 0.9, 1); // slightly larger bubble
            // Position: right and above head
            sprite.position.set(1.2, 2.8, 0); // right of head, above label
            playerObj.mesh.add(sprite);
            playerObj.bubble = sprite;
            // Remove bubble after 15 seconds
            playerObj.bubbleTimeout = setTimeout(() => {
                playerObj.mesh.remove(sprite);
                playerObj.bubble = null;
            }, 15000);
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        // Prevent movement if chat is focused
        if (this.isChatFocused) {
            this.updatePlayerInfo(); // Still update info for other players
            this.renderer.render(this.scene, this.camera);
            return;
        }

        // Local player movement and prediction
        if (this.playerMesh && this.playerId) {
            const currentPlayerY = this.playerMesh.position.y; // Current center Y
            const movement = this.controls.update(currentPlayerY); // Get movement vector (dx, dy, dz)

            const prevX = this.playerMesh.position.x;
            const prevY = currentPlayerY; // Current center Y
            const prevZ = this.playerMesh.position.z;

            // Predicted new center positions based on controls
            let predictedCenterX = prevX + movement.x;
            let predictedCenterY = prevY + movement.y; // movement.y is deltaY from controls
            let predictedCenterZ = prevZ + movement.z;

            // --- Perform local collision detection against scene objects ---
            const collisionInfo = this.checkCollisions(predictedCenterX, predictedCenterY, predictedCenterZ);

            // Apply collision responses
            if (collisionInfo.x) {
                predictedCenterX = prevX; // Stop X movement
            }
            if (collisionInfo.z) {
                predictedCenterZ = prevZ; // Stop Z movement
            }
            if (collisionInfo.y) {
                predictedCenterY = prevY; // Revert to previous Y center
                if (movement.y > 0) { // Was moving up into an obstacle
                    this.controls.verticalVelocity = 0;
                } else if (movement.y < 0) { // Was moving down into an obstacle (landing)
                    this.controls.verticalVelocity = 0;
                    this.controls.isGrounded = true; // Assume landed on the object
                    if (typeof this.controls.onLand === 'function') {
                        this.controls.onLand(); // Trigger landing effects/sounds
                    }
                }
            }
            
            // Enforce world boundaries (for player center)
            const worldSize = 50; // Half-size of the world
            const playerHalfWidth = 0.5; // Assuming player is 1 unit wide/deep, radius 0.5
            predictedCenterX = Math.max(-worldSize + playerHalfWidth, Math.min(worldSize - playerHalfWidth, predictedCenterX));
            predictedCenterZ = Math.max(-worldSize + playerHalfWidth, Math.min(worldSize - playerHalfWidth, predictedCenterZ));

            // --- Client-side prediction: Update local player mesh position immediately ---
            this.playerMesh.position.set(predictedCenterX, predictedCenterY, predictedCenterZ);

            // --- Send this predicted new center position to the server ---
            const newPosToServer = { x: predictedCenterX, y: predictedCenterY, z: predictedCenterZ };
            
            const positionChangeThreshold = 0.01;
            if (!this.lastSentPos ||
                Math.abs(newPosToServer.x - this.lastSentPos.x) > positionChangeThreshold ||
                Math.abs(newPosToServer.y - this.lastSentPos.y) > positionChangeThreshold ||
                Math.abs(newPosToServer.z - this.lastSentPos.z) > positionChangeThreshold) {
                this.socket.emit('player_move', { position: newPosToServer });
                this.lastSentPos = { ...newPosToServer };
            }
        }

        // Camera tracking for local player
        if (this.playerMesh) {
            const cameraDistance = 10;
            const cameraHeight = 5;
            const rot = this.controls.cameraRotation || 0;
            const offsetX = Math.sin(rot) * cameraDistance;
            const offsetZ = Math.cos(rot) * cameraDistance;
            this.camera.position.set(
                this.playerMesh.position.x + offsetX,
                this.playerMesh.position.y + cameraHeight,
                this.playerMesh.position.z + offsetZ
            );
            this.camera.lookAt(this.playerMesh.position);
        }

        this.updatePlayerInfo();
        this.renderer.render(this.scene, this.camera);
    }
}

// --- Mobile Controls Integration ---
if (window.isMobileDevice && window.isMobileDevice()) {
    let mobileControls = null;
    let lastMove = { x: 0, y: 0 };
    let swipeStartX = null;
    let swipeActive = false;
    // Wait for DOMContentLoaded to ensure UI is ready
    window.addEventListener('DOMContentLoaded', () => {
        mobileControls = new window.MobileControls(
            (dx, dy) => {
                // Map joystick to WASD-style movement
                if (window.game && window.game.controls) {
                    // Use a lower threshold for responsiveness
                    window.game.controls.keys.forward = dy < -0.1;
                    window.game.controls.keys.backward = dy > 0.1;
                    window.game.controls.keys.left = dx < -0.1;
                    window.game.controls.keys.right = dx > 0.1;
                    // Set moveSpeed higher for mobile
                    window.game.controls.moveSpeed = 0.18;
                }
            },
            () => {
                if (window.game && window.game.controls) {
                    window.game.controls.keys.jump = true;
                    setTimeout(() => { window.game.controls.keys.jump = false; }, 200);
                }
            }
        );
        mobileControls.show();

        // --- Camera swipe gesture ---
        const gameContainer = document.getElementById('game-container');
        if (gameContainer) {
            gameContainer.addEventListener('touchstart', (e) => {
                // Only start swipe if not on joystick or jump button
                if (e.target.classList.contains('mobile-joystick') || e.target.classList.contains('mobile-joystick-knob') || e.target.classList.contains('mobile-jump-btn')) return;
                if (e.touches.length === 1) {
                    swipeStartX = e.touches[0].clientX;
                    swipeActive = true;
                }
            }, { passive: false });
            gameContainer.addEventListener('touchmove', (e) => {
                if (!swipeActive || swipeStartX === null) return;
                const dx = e.touches[0].clientX - swipeStartX;
                if (Math.abs(dx) > 40) { // threshold for swipe
                    if (window.game && window.game.controls) {
                        const direction = dx > 0 ? 1 : -1;
                        window.game.controls.rotateCamera(direction);
                    }
                    swipeActive = false;
                    swipeStartX = null;
                }
            }, { passive: false });
            gameContainer.addEventListener('touchend', () => {
                swipeActive = false;
                swipeStartX = null;
            });
        }
    });
}

// Expose the Game instance globally for mobile controls
window.game = null;
const origGame = Game;
window.addEventListener('load', () => {
    window.game = new origGame();
});