import { PlayerAvatar } from './components/PlayerAvatar.js';
import { Portal } from './components/Portal.js';
import { Building } from './components/Building.js';
import PlayerControls from './controls.js';

class Game {
    constructor() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.controls = new PlayerControls();
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

        this.setupScene();
        this.setupSocketEvents();
        this.setupUI();
        this.animate();

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
        document.getElementById('game-container').appendChild(this.renderer.domElement);

        // Add ground
        const groundGeometry = new THREE.PlaneGeometry(100, 100, 50, 50);
        const groundMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x3a8c3a,
            roughness: 0.8,
            metalness: 0.2
        });
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
                    obj.mesh.position.set(player.position.x, player.position.y + 1, player.position.z);
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

    animate() {
        requestAnimationFrame(() => this.animate());

        // Prevent movement if chat is focused
        if (this.isChatFocused) {
            this.updatePlayerInfo();
            this.renderer.render(this.scene, this.camera);
            return;
        }

        // Only send position if local player mesh exists
        if (this.playerMesh && this.playerId) {
            // Calculate movement using controls
            const movement = this.controls.update();
            // --- Cuboid collision detection ---
            let newX = this.playerMesh.position.x + movement.x;
            let newY = this.playerMesh.position.y - 1 + movement.y;
            let newZ = this.playerMesh.position.z + movement.z;
            // Cuboid AABB collision
            const b = this.cuboid;
            const margin = 0.6; // slightly larger than player radius
            const minX = b.x - b.width/2 - margin;
            const maxX = b.x + b.width/2 + margin;
            const minY = 0; // on ground
            const maxY = b.y + b.height/2 + margin;
            const minZ = b.z - b.depth/2 - margin;
            const maxZ = b.z + b.depth/2 + margin;
            // If next position would be inside cuboid, block movement
            if (
                newX > minX && newX < maxX &&
                newY > minY && newY < maxY &&
                newZ > minZ && newZ < maxZ
            ) {
                // Block movement: revert to current position
                newX = this.playerMesh.position.x;
                newY = this.playerMesh.position.y - 1;
                newZ = this.playerMesh.position.z;
            }
            const newPos = { x: newX, y: newY, z: newZ };
            // Only send if moved
            if (!this.lastSentPos ||
                Math.abs(newPos.x - this.lastSentPos.x) > 0.01 ||
                Math.abs(newPos.y - this.lastSentPos.y) > 0.01 ||
                Math.abs(newPos.z - this.lastSentPos.z) > 0.01) {
                this.socket.emit('player_move', { position: newPos });
                this.lastSentPos = { ...newPos };
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

        // Do NOT update playerMesh position here; update from global state only
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