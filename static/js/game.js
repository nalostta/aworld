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

        // Performance and network monitoring
        this.packetsSent = 0;
        this.packetsReceived = 0;
        this.rtts = [];
        this.averageRTT = 0;
        this.lastPingTime = 0;
        this.networkQuality = 'good'; // good, fair, poor
        this.frameCount = 0;
        this.lastFrameTime = 0;
        this.fps = 0;

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
        window.addEventListener('blur', () => this.handleBlur());

        this.controls = new PlayerControls();
        this.players = new Map();
        this.ws = null;
this.wsReconnectAttempts = 0;
this.maxReconnectAttempts = 5;
this.connectWebSocket();
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
        // Remote player interpolation state
        this.remoteSnapshots = new Map(); // id -> [{ t, x, y, z }]
        this.interpolationDelayMs = 100; // render remote players ~100ms in the past
        this.maxSnapshotsPerPlayer = 20;
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
        // Socket events now handled by WebSocket setup in connectWebSocket
        this.setupUI();
        this.loadPhysicsConfig();
        this.animate();
        this.startNetworkHealthMonitoring();
    }

    async loadPhysicsConfig() {
        try {
            const response = await fetch('/physics');
            if (!response.ok) {
                console.warn('[Physics] Failed to fetch physics config, using defaults');
                return;
            }
            const config = await response.json();
            console.log('[Physics] Loaded physics config from server:', config);
            if (this.controls && typeof this.controls.setPhysicsConfig === 'function') {
                this.controls.setPhysicsConfig(config);
            }
        } catch (e) {
            console.error('[Physics] Error fetching physics config:', e);
        }
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

    connectWebSocket() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${wsProtocol}://${window.location.host}/ws`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
        console.log('[WebSocket] Connected to server');
        this.wsReconnectAttempts = 0;
        this.updateActiveState();
        // Optionally send a handshake or ready event here
    };

    this.ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            console.log('[WebSocket] Received message:', msg);
            if (!msg.event) {
                console.warn('[WebSocket] Received message without event field:', msg);
                return;
            }
            switch (msg.event) {
                case 'global_state_update':
                    // The backend sends {event: ..., players: [...]}
                    this.handleGlobalStateUpdate(msg.players);
                    break;
                case 'current_players':
                    if (Array.isArray(msg.players)) {
                        this.handleGlobalStateUpdate(msg.players);
                    }
                    break;
                case 'player_count_update':
                    // The backend sends {event: ..., count: ...} (not in data)
                    this.updatePlayerCount(msg.count);
                    break;
                case 'ping':
                    // The backend sends {event: ..., timestamp: ...}
                    const rtt = Date.now() - msg.data.timestamp;
                    this.updateRTT(rtt);
                    break;
                default:
                    console.warn('[WebSocket] Unknown event:', msg.event, msg);
            }
        } catch (e) {
            console.error('[WebSocket] Error parsing message:', event.data, e);
        }
    };

    this.ws.onerror = (err) => {
        console.error('[WebSocket] Error:', err);
    };

    this.ws.onclose = (e) => {
        console.warn('[WebSocket] Disconnected from server', e.reason);
        if (this.wsReconnectAttempts < this.maxReconnectAttempts) {
            setTimeout(() => {
                this.wsReconnectAttempts++;
                this.connectWebSocket();
            }, 1000 * this.wsReconnectAttempts);
        } else {
            alert('Unable to reconnect to server. Please refresh the page.');
        }
    };
}

animate() {
    requestAnimationFrame(() => this.animate());
    if (!this.isActive) return;

    // Get movement from controls
    const movement = this.controls.update(
        this.playerMesh ? this.playerMesh.position.y - 1 : 0 // convert from mesh Y to logical Y
    );
    if (this.playerMesh && (movement.x !== 0 || movement.y !== 0 || movement.z !== 0)) {
        // Current logical position (center height)
        const currentLogicalY = this.playerMesh.position.y - 1;

        const groundLevel = (this.controls && typeof this.controls.groundLevel === 'number')
            ? this.controls.groundLevel
            : 0;

        // Calculate new logical position in logical coordinates
        const newLogicalPos = {
            x: this.playerMesh.position.x + movement.x,
            y: Math.max(groundLevel, currentLogicalY + movement.y),
            z: this.playerMesh.position.z + movement.z
        };

        // Update local mesh position immediately for responsiveness (mesh Y = logical Y + 1)
        this.playerMesh.position.set(
            newLogicalPos.x,
            newLogicalPos.y + 1,
            newLogicalPos.z
        );

        // Send logical position directly to server at reduced frequency
        if (!this.lastInputSent || Date.now() - this.lastInputSent > 50) { // 20 times per second
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.packetsSent++;
                this.ws.send(JSON.stringify({ 
                    event: 'player_move', 
                    data: { 
                        position: newLogicalPos
                    } 
                }));
            }
            this.lastInputSent = Date.now();
        }
    }

    // Interpolate remote players each frame
    const now = performance.now();
    const renderTime = now - this.interpolationDelayMs;
    this.players.forEach((obj, id) => {
        // Skip local player (already handled above)
        if (!obj || !obj.mesh || id === this.playerId) return;

        const snapshots = this.remoteSnapshots.get(id);
        if (!snapshots || snapshots.length === 0) return;

        // Find two snapshots around renderTime
        let older = null;
        let newer = null;
        for (let i = 0; i < snapshots.length; i++) {
            const s = snapshots[i];
            if (s.t <= renderTime) {
                older = s;
            } else {
                newer = s;
                break;
            }
        }

        if (!older && !newer) {
            return;
        }

        let interpX, interpY, interpZ;
        if (older && newer) {
            const span = newer.t - older.t;
            const alpha = span > 0 ? (renderTime - older.t) / span : 0;
            const clampedAlpha = Math.max(0, Math.min(1, alpha));
            interpX = older.x + (newer.x - older.x) * clampedAlpha;
            interpY = older.y + (newer.y - older.y) * clampedAlpha;
            interpZ = older.z + (newer.z - older.z) * clampedAlpha;
        } else if (older) {
            // Only older snapshot, just use it
            interpX = older.x;
            interpY = older.y;
            interpZ = older.z;
        } else {
            // Only newer snapshot
            interpX = newer.x;
            interpY = newer.y;
            interpZ = newer.z;
        }

        obj.mesh.position.set(interpX, interpY + 1, interpZ);
    });

    // Camera tracking and rotation for local player
    if (this.playerMesh) {
        // Camera offset (distance and height from player)
        const cameraDistance = 10;
        const cameraHeight = 5;
        const rot = this.controls.cameraRotation || 0;
        // Spherical coordinates
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
    this.updatePerformanceInfo();
    this.renderer.render(this.scene, this.camera);
}

updatePerformanceInfo() {
    const now = Date.now();
    this.frameCount++;
    if (this.lastFrameTime) {
        const elapsed = now - this.lastFrameTime;
        this.fps = 1000 / elapsed;
    }
    this.lastFrameTime = now;
    const debugInfo = document.getElementById('debug-info');
    if (debugInfo) {
        debugInfo.textContent = `FPS: ${this.fps.toFixed(2)} | Packets Sent: ${this.packetsSent} | Packets Received: ${this.packetsReceived} | RTT: ${this.averageRTT.toFixed(1)}ms`;
    }
}

    updateRTT(rtt) {
        // Store last 10 RTT measurements for averaging
        this.rtts.push(rtt);
        if (this.rtts.length > 10) {
            this.rtts.shift();
        }
        
        // Calculate moving average RTT
        this.averageRTT = this.rtts.reduce((sum, r) => sum + r, 0) / this.rtts.length;
        
        // Assess network quality based on RTT and jitter
        const jitter = this.calculateJitter();
        if (this.averageRTT > 150 || jitter > 50) {
            this.networkQuality = 'poor';
        } else if (this.averageRTT > 80 || jitter > 25) {
            this.networkQuality = 'fair';
        } else {
            this.networkQuality = 'good';
        }
    }

    calculateJitter() {
        if (this.rtts.length < 2) return 0;
        
        let jitterSum = 0;
        for (let i = 1; i < this.rtts.length; i++) {
            jitterSum += Math.abs(this.rtts[i] - this.rtts[i-1]);
        }
        
        return jitterSum / (this.rtts.length - 1);
    }

    startNetworkHealthMonitoring() {
        setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                // Send ping to measure RTT
                const pingTime = Date.now();
                this.lastPingTime = pingTime;
                this.ws.send(JSON.stringify({ 
                    event: 'ping', 
                    data: { timestamp: pingTime } 
                }));
            }
        }, 2000); // Ping every 2 seconds
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
        if (gameContainer) {
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
                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
    this.ws.send(JSON.stringify({ event: 'chat_message', data: { text } }));
}
                    this.chatInput.value = '';
                }
            });
        }
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
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
    this.ws.send(JSON.stringify({ event: 'player_join', data: { name: this.playerName, color } }));
} else {
    console.warn('[WebSocket] Not connected, cannot send player_join');
}
        
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
        if (!playerData || !playerData.id || !playerData.name) {
            console.error('[addPlayer] Missing player id or name:', playerData);
            return;
        }
        if (this.players.has(playerData.id)) {
            const existing = this.players.get(playerData.id);
            if (existing) {
                existing.data = playerData;
                if (!this.playerId && this.playerName && playerData.name === this.playerName) {
                    this.playerId = playerData.id;
                }
                if (this.playerId === playerData.id && !this.playerMesh) {
                    this.playerMesh = existing.mesh;
                    this.playerLabel = existing.label;
                }
            }
            return;
        }

        console.log("[addPlayer] Adding player:", playerData);

        const mesh = this.createPlayerMesh(playerData.color);
        const label = this.createPlayerLabel(playerData.name);
        mesh.add(label);
        if (!mesh) {
            console.error('[addPlayer] Mesh creation failed for player:', playerData);
        } else {
            console.log('[addPlayer] Mesh created:', mesh);
        }

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
        if (!this.playerId && this.playerName === playerData.name) {
            this.playerId = playerData.id;
        }

        if (playerData.id === this.playerId && this.playerMesh !== mesh) {
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
        const playerInfo = document.getElementById('player-info');
        if (this.playerMesh) {
            const pos = this.playerMesh.position;
            playerInfo.textContent = `Position: X: ${pos.x.toFixed(2)} Y: ${(pos.y - 1).toFixed(2)} Z: ${pos.z.toFixed(2)}`;
        }
    }

    updatePlayerCount(count) {
        const countElem = document.getElementById('player-count');
        if (countElem) {
            countElem.textContent = `Players Online: ${count}`;
        }
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

    handleGlobalStateUpdate(players) {
        // Sync all sprites to global state
        const newIds = new Set(players.map(p => p.id));
        this.players.forEach((_, id) => {
            if (!newIds.has(id)) {
                if (id === this.playerId) {
                    return;
                }
                this.removePlayer(id);
                this.remoteSnapshots.delete(id);
            }
        });
        
        players.forEach(player => {
            if (!this.playerId && this.playerName && player.name === this.playerName) {
                this.playerId = player.id;
            }
            // Add if missing
            if (!this.players.has(player.id)) {
                this.addPlayer(player);
            }
            // Update position
            const obj = this.players.get(player.id);
            if (obj && obj.mesh) {
                obj.data = player;
                const serverX = player.position.x;
                const serverY = player.position.y + 1; // mesh Y = logical Y + 1
                const serverZ = player.position.z;

                // Soft correction for local player, interpolation for others
                if (player.id === this.playerId && this.playerMesh === obj.mesh) {
                    // Distance between current mesh position and server position
                    const dx = serverX - obj.mesh.position.x;
                    const dy = serverY - obj.mesh.position.y;
                    const dz = serverZ - obj.mesh.position.z;
                    const distSq = dx * dx + dy * dy + dz * dz;

                    // Thresholds (tunable): only correct if error is noticeable
                    const positionErrorThreshold = 0.1; // ~0.3 units distance squared
                    const snapErrorThreshold = 4.0; // large error -> immediate snap (2 units)

                    if (distSq > snapErrorThreshold) {
                        // Large desync: snap directly
                        obj.mesh.position.set(serverX, serverY, serverZ);
                    } else if (distSq > positionErrorThreshold) {
                        // Small/medium desync: interpolate toward server
                        const correctionFactor = 0.2; // 0..1, how aggressively to pull toward server
                        obj.mesh.position.set(
                            obj.mesh.position.x + dx * correctionFactor,
                            obj.mesh.position.y + dy * correctionFactor,
                            obj.mesh.position.z + dz * correctionFactor
                        );
                    }
                    // If server says we're effectively on the ground, snap exactly to ground to avoid micro vertical drift
                    const logicalYFromServer = player.position.y;
                    const localGround = (this.controls && typeof this.controls.groundLevel === 'number')
                        ? this.controls.groundLevel
                        : 0;
                    if (Math.abs(logicalYFromServer - localGround) < 0.01) {
                        obj.mesh.position.y = localGround + 1;
                        if (this.controls) {
                            this.controls.verticalVelocity = 0;
                            this.controls.isGrounded = true;
                        }
                    }
                    // If below threshold, keep purely predicted position
                } else {
                    // Remote players: record snapshots for interpolation
                    const now = performance.now();
                    let snapshots = this.remoteSnapshots.get(player.id);
                    if (!snapshots) {
                        snapshots = [];
                        this.remoteSnapshots.set(player.id, snapshots);
                    }
                    snapshots.push({ t: now, x: serverX, y: player.position.y, z: serverZ });
                    // Keep snapshot buffer bounded
                    if (snapshots.length > this.maxSnapshotsPerPlayer) {
                        snapshots.splice(0, snapshots.length - this.maxSnapshotsPerPlayer);
                    }
                }
                
                // Handle chat bubbles
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
    }

    // --- Mobile Controls Integration ---
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