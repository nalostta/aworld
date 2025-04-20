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

        // Add ground with better texture
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

        // Add grid with better visibility
        const gridHelper = new THREE.GridHelper(100, 100, 0x000000, 0x222222);
        gridHelper.position.y = 0.01; // Slightly above ground to prevent z-fighting
        this.scene.add(gridHelper);

        // Add fog for depth
        this.scene.fog = new THREE.Fog(0xcccccc, 20, 100);
        this.scene.background = new THREE.Color(0xcccccc);

        // Set camera position
        this.camera.position.set(0, 5, 10);
        this.camera.lookAt(0, 0, 0);
    }

    setupSocketEvents() {
        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.updateActiveState();
        });

        this.socket.on('player_joined', (player) => {
            console.log('Player joined event received:', player);
            this.addPlayer(player);
            
            // Check if this is our player
            if (player.id) {
                console.log('Setting player ID:', player.id);
                this.playerId = player.id;
                
                // If we already have a player mesh, update it
                if (this.playerMesh) {
                    console.log('Player mesh already exists, updating ID');
                } else {
                    console.log('Player mesh does not exist yet');
                }
            }
        });

        this.socket.on('player_disconnected', (data) => {
            console.log('Player disconnected event received:', data);
            this.removePlayer(data.id);
        });

        this.socket.on('player_moved', (data) => {
            console.log('Player moved event received:', data);
            this.updatePlayerPosition(data.id, data.position);
        });

        this.socket.on('current_players', (players) => {
            console.log('Current players event received:', players);
            
            // Check if we're already in the players list
            const existingPlayer = players.find(p => p.id === this.playerId);
            if (existingPlayer) {
                console.log('Found existing player in current players list:', existingPlayer);
            }
            
            players.forEach(player => this.addPlayer(player));
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
    }

    setupUI() {
        const startScreen = document.getElementById('start-screen');
        const startButton = document.getElementById('start-button');
        const playerNameInput = document.getElementById('player-name');

        startButton.addEventListener('click', () => {
            this.playerName = playerNameInput.value.trim();
            if (this.playerName) {
                startScreen.style.display = 'none';
                document.getElementById('game-container').style.display = 'block';
                this.startGame();
            }
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
        // Create player body
        const bodyGeometry = new THREE.BoxGeometry(1, 2, 1);
        const bodyMaterial = new THREE.MeshStandardMaterial({ 
            color: color,
            roughness: 0.7,
            metalness: 0.3
        });
        const mesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.position.y = 1;

        // Add head (slightly smaller box on top)
        const headGeometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);
        const headMaterial = new THREE.MeshStandardMaterial({ 
            color: color,
            roughness: 0.7,
            metalness: 0.3
        });
        const head = new THREE.Mesh(headGeometry, headMaterial);
        head.position.y = 1.4;
        head.castShadow = true;
        head.receiveShadow = true;
        mesh.add(head);

        return mesh;
    }

    createPlayerLabel(name) {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 192;
        canvas.height = 40;
        // Draw background
        context.fillStyle = 'rgba(0, 0, 0, 0.5)';
        context.fillRect(0, 0, canvas.width, canvas.height);
        // Draw text (smaller font)
        context.font = 'bold 20px Arial';
        context.textAlign = 'center';
        context.fillStyle = 'white';
        context.fillText(name, canvas.width / 2, 28);
        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        const material = new THREE.SpriteMaterial({ 
            map: texture,
            transparent: true
        });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(2.2, 0.45, 1); // smaller label
        sprite.position.set(0, 2.2, 0.01); // just above head, centered
        return sprite;
    }

    addPlayer(playerData) {
        if (this.players.has(playerData.id)) return;

        console.log("Adding player:", playerData);

        const mesh = this.createPlayerMesh(playerData.color);
        const label = this.createPlayerLabel(playerData.name);
        mesh.add(label);

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

    showChatBubble(msg) {
        // Find the player mesh for the sender
        let playerObj = null;
        if (msg.id === this.playerId && this.playerMesh) {
            playerObj = { mesh: this.playerMesh, label: this.playerLabel };
        } else {
            playerObj = this.players.get(msg.id);
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

        if (this.playerMesh) {
            const movement = this.controls.update();
            this.playerMesh.position.x += movement.x;
            this.playerMesh.position.y = movement.y + 1;
            this.playerMesh.position.z += movement.z;

            const cameraOffset = new THREE.Vector3(0, 5, 10);
            cameraOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.controls.cameraRotation);
            this.camera.position.copy(this.playerMesh.position).add(cameraOffset);
            this.camera.lookAt(this.playerMesh.position);

            if (this.isActive) {
                this.socket.emit('player_move', {
                    position: {
                        x: this.playerMesh.position.x,
                        y: this.playerMesh.position.y - 1,
                        z: this.playerMesh.position.z
                    }
                });
            }
        } else {
            if (this.playerId) {
                const player = this.players.get(this.playerId);
                if (player && player.mesh) {
                    this.playerMesh = player.mesh;
                    this.playerLabel = player.label;
                }
            }
        }

        this.updatePlayerInfo();
        this.renderer.render(this.scene, this.camera);
    }
}

// Start the game when the page loads
window.addEventListener('load', () => {
    new Game();
}); 