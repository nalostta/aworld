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

        // PERFORMANCE MONITORING
        this.performanceMetrics = {
            roundTripTimes: [],
            reconciliationCount: 0,
            totalInputsSent: 0,
            lastReconciliationTime: 0,
            averageRTT: 0,
            maxRTT: 0,
            serverProcessingTime: 0,
            networkLatency: 0,
            lastFrameTime: performance.now(),
            frameCount: 0,
            fps: 0
        };
        
        // Debug display element
        this.createDebugDisplay();

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
                case 'player_joined':
                    this.addPlayer(msg.data);
                    break;
                case 'current_players':
                    (msg.data || []).forEach(player => this.addPlayer(player));
                    break;
                case 'global_state_update':
                    // The backend sends {event: ..., players: [...]}
                    this.handleGlobalStateUpdate(msg.players);
                    break;
                case 'player_count_update':
                    // The backend sends {event: ..., count: ...} (not in data)
                    this.updatePlayerCount(msg.count);
                    break;
                case 'player_disconnected':
                    // The backend sends {event: ..., id: ..., name: ...}
                    this.removePlayer(msg.id);
                    break;
                case 'chat_message':
                    this.showChatBubble(msg.data);
                    break;
                case 'wall_display_update':
                    // The backend sends {event: ..., content: ...}
                    if (typeof msg.content === 'string') {
                        this.updateWallDisplay(msg.content);
                    }
                    break;
                case 'server_position_update':
                    // 🔧 FIX: Track sequence numbers to detect out-of-order responses
                    const sequence = msg.data.sequence;
                    if (this.lastReceivedSequence && sequence < this.lastReceivedSequence) {
                        console.warn(`⚠️  Out-of-order response: expected >= ${this.lastReceivedSequence}, got ${sequence}`);
                    }
                    this.lastReceivedSequence = Math.max(this.lastReceivedSequence || 0, sequence);
                    
                    this.reconcileServerPosition(msg.data.position, msg.data.timestamp, msg.data.sequence, msg.data.server_processing_time);
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

handleGlobalStateUpdate(players) {
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
            // For local player, only correct if server disagrees (authoritative snap)
            if (player.id === this.playerId) {
                const meshPos = obj.mesh.position;
                if (Math.abs(meshPos.x - player.position.x) > 0.05 ||
                    Math.abs(meshPos.y - (player.position.y + 1)) > 0.05 ||
                    Math.abs(meshPos.z - player.position.z) > 0.05) {
                    // Snap to server position if out of sync
                    obj.mesh.position.set(player.position.x, player.position.y + 1, player.position.z);
                }
            } else {
                // For all other players, always update
                obj.mesh.position.set(player.position.x, player.position.y + 1, player.position.z);
            }
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
}

animate() {
    requestAnimationFrame(() => this.animate());

    if (!this.isActive) return;

    // Update controls and get movement vector
    const movement = this.controls.update(this.playerMesh ? this.playerMesh.position.y : 0);

    // CLIENT-SIDE PREDICTION: Update local player position immediately
    if (this.playerMesh && (movement.x !== 0 || movement.y !== 0 || movement.z !== 0)) {
        // Apply movement locally for immediate response
        const newPos = {
            x: this.playerMesh.position.x + movement.x,
            y: Math.max(0, this.playerMesh.position.y + movement.y), // Ground clamp
            z: this.playerMesh.position.z + movement.z
        };
        
        // Update local position immediately
        this.playerMesh.position.set(newPos.x, newPos.y, newPos.z);
        
        // Store this prediction with a timestamp for later reconciliation
        const timestamp = Date.now();
        this.clientPredictions = this.clientPredictions || [];
        this.clientPredictions.push({
            timestamp,
            position: { ...newPos },
            input: { ...movement }
        });
        
        // Limit prediction history (keep last 60 frames at 60fps = 1 second)
        if (this.clientPredictions.length > 60) {
            this.clientPredictions.shift();
        }
        
        // Send input to server (not position) - reduced frequency
        if (!this.lastInputSent || Date.now() - this.lastInputSent > 50) { // 20 times per second
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                // Track RTT for performance monitoring
                const inputTimestamp = performance.now();
                this.pendingInputs = this.pendingInputs || new Map();
                this.pendingInputs.set(timestamp, inputTimestamp);
                
                this.ws.send(JSON.stringify({ 
                    event: 'player_input', 
                    data: { 
                        input: movement,
                        timestamp: timestamp,
                        sequence: this.inputSequence = (this.inputSequence || 0) + 1
                    } 
                }));
                
                this.performanceMetrics.totalInputsSent++;
            }
            this.lastInputSent = Date.now();
        }
    }

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
    this.renderer.render(this.scene, this.camera);
    this.updatePerformanceMetrics();
}

    // SERVER RECONCILIATION: Handle authoritative position updates from server
    reconcileServerPosition(serverPosition, serverTimestamp, serverSequence, serverProcessingTime) {
        if (!this.playerMesh || !this.clientPredictions) return;
        
        // Find the prediction that matches this server update
        const predictionIndex = this.clientPredictions.findIndex(p => 
            Math.abs(p.timestamp - serverTimestamp) < 100 // 100ms tolerance
        );
        
        if (predictionIndex === -1) {
            // No matching prediction found, accept server position
            this.playerMesh.position.set(serverPosition.x, serverPosition.y, serverPosition.z);
            return;
        }
        
        // Check if our prediction was significantly wrong
        const prediction = this.clientPredictions[predictionIndex];
        const positionError = Math.sqrt(
            Math.pow(prediction.position.x - serverPosition.x, 2) +
            Math.pow(prediction.position.y - serverPosition.y, 2) +
            Math.pow(prediction.position.z - serverPosition.z, 2)
        );
        
        // 🔧 FIX: More lenient reconciliation threshold to account for physics differences
        const dynamicThreshold = Math.max(0.1, (Math.abs(prediction.input.x) + Math.abs(prediction.input.z)) * 5);
        const reconciliationThreshold = dynamicThreshold;
        
        if (positionError > reconciliationThreshold) { // Was 0.5 unit tolerance
            console.log(`🔄 Reconciling position error: ${positionError.toFixed(3)} > ${reconciliationThreshold.toFixed(3)}`);
            this.performanceMetrics.reconciliationCount++;
            this.performanceMetrics.lastReconciliationTime = performance.now();
            
            // Set to server position
            this.playerMesh.position.set(serverPosition.x, serverPosition.y, serverPosition.z);
            
            // Re-apply all inputs that happened after the server timestamp
            const replayPredictions = this.clientPredictions.slice(predictionIndex + 1);
            for (const replayPrediction of replayPredictions) {
                const newPos = {
                    x: this.playerMesh.position.x + replayPrediction.input.x,
                    y: Math.max(0, this.playerMesh.position.y + replayPrediction.input.y),
                    z: this.playerMesh.position.z + replayPrediction.input.z
                };
                this.playerMesh.position.set(newPos.x, newPos.y, newPos.z);
            }
        }
        
        // Clean up old predictions
        this.clientPredictions = this.clientPredictions.slice(predictionIndex + 1);
        
        // Update RTT metrics
        const inputTimestamp = this.pendingInputs.get(serverTimestamp);
        if (inputTimestamp) {
            const totalRTT = performance.now() - inputTimestamp;
            const networkLatency = (totalRTT - serverProcessingTime) / 2; // Estimate one-way latency
            
            this.performanceMetrics.roundTripTimes.push(totalRTT);
            this.performanceMetrics.serverProcessingTime = serverProcessingTime;
            this.performanceMetrics.networkLatency = networkLatency;
            
            // Keep only last 50 RTT samples
            if (this.performanceMetrics.roundTripTimes.length > 50) {
                this.performanceMetrics.roundTripTimes.shift();
            }
            
            this.pendingInputs.delete(serverTimestamp);
        }
    }

    createDebugDisplay() {
        // Create debug overlay
        const debugDiv = document.createElement('div');
        debugDiv.id = 'debug-overlay';
        debugDiv.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            background: rgba(0,0,0,0.8);
            color: #00ff00;
            padding: 10px;
            font-family: monospace;
            font-size: 12px;
            border-radius: 5px;
            z-index: 1000;
            min-width: 250px;
        `;
        document.body.appendChild(debugDiv);
        this.debugDisplay = debugDiv;
        document.addEventListener('keydown', (e) => {
            if (e.key === 'p') {
                if (this.debugDisplay.style.display === 'none') {
                    this.debugDisplay.style.display = 'block';
                } else {
                    this.debugDisplay.style.display = 'none';
                }
            }
        });
    }

    updatePerformanceMetrics() {
        const now = performance.now();
        
        // Calculate FPS
        this.performanceMetrics.frameCount++;
        if (now - this.performanceMetrics.lastFrameTime >= 1000) {
            this.performanceMetrics.fps = this.performanceMetrics.frameCount;
            this.performanceMetrics.frameCount = 0;
            this.performanceMetrics.lastFrameTime = now;
        }
        
        // Calculate average RTT
        if (this.performanceMetrics.roundTripTimes.length > 0) {
            const sum = this.performanceMetrics.roundTripTimes.reduce((a, b) => a + b, 0);
            this.performanceMetrics.averageRTT = sum / this.performanceMetrics.roundTripTimes.length;
            this.performanceMetrics.maxRTT = Math.max(...this.performanceMetrics.roundTripTimes);
        }
        
        // Update debug display
        if (this.debugDisplay) {
            this.debugDisplay.innerHTML = `
                <div><strong>PERFORMANCE METRICS</strong></div>
                <div>FPS: ${this.performanceMetrics.fps}</div>
                <div>Avg RTT: ${this.performanceMetrics.averageRTT.toFixed(1)}ms</div>
                <div>Max RTT: ${this.performanceMetrics.maxRTT.toFixed(1)}ms</div>
                <div>Network Latency: ${this.performanceMetrics.networkLatency.toFixed(1)}ms</div>
                <div>Server Processing: ${this.performanceMetrics.serverProcessingTime.toFixed(1)}ms</div>
                <div>Reconciliations: ${this.performanceMetrics.reconciliationCount}</div>
                <div>Inputs Sent: ${this.performanceMetrics.totalInputsSent}</div>
                <div>Predictions: ${this.clientPredictions ? this.clientPredictions.length : 0}</div>
                <div><strong>Connection Status:</strong></div>
                <div>WebSocket: ${this.ws ? this.ws.readyState === 1 ? 'OPEN' : 'CLOSED' : 'NULL'}</div>
                <div><strong>Press 'P' to toggle this display</strong></div>
            `;
        }
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
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
    this.ws.send(JSON.stringify({ event: 'chat_message', data: { text } }));
}
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
        if (this.players.has(playerData.id)) return;

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