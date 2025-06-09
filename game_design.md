# 3D Multiplayer Game Design Document (Refactored)

## 1. Game Overview
A 3D multiplayer game where players can interact in a shared virtual environment. The game focuses on player interaction, exploration, and dynamic object manipulation.

## 2. Core Mechanics

### 2.1 Player Mechanics

#### 2.1.1 Player Texture
- Player-mesh is a rectangle with randomly assigned color and name label.
- Each browser session spawns a unique player-mesh.
- Users enter a name at session start via a text input. This name floats above the player and follows its position.

#### 2.1.2 Player Movement
- WASD keys for movement
- Q and E keys for camera rotation (anti-clockwise and clockwise)
- Space for jumping, Shift for sprinting, C for crouching
- Physics-based movement: gravity, smooth acceleration/deceleration
- Movement direction dynamically updates with camera rotation
- Prevent overlapping via capsule-to-capsule collision detection

#### 2.1.3 Player-Player Interaction
- Players can view each other in real-time
- Unique colors and identifiers for each player
- Server-authoritative model: movement and state validated server-side
- Latency handling via interpolation and client-side prediction

#### 2.1.4 Player Customization
- Players can customize their avatar appearance (e.g., select from preset models, accessories, or colors).
- Customization options are stored per session and broadcast to all clients.

### 2.2 Object Interaction
- Players can interact with objects in the world (pick up, move, place, or delete objects).
- Raycasting is used for object selection; actions are validated and synchronized via the server.
- Object ownership and manipulation rules are enforced to prevent conflicts.

### 2.3 Game Objectives & Progression
- The game supports objectives such as collecting items, reaching zones, or completing cooperative tasks.
- A scoring or achievement system tracks player progress.
- Win/lose conditions or open-ended sandbox modes can be configured.

### 2.4 User Interface (UI)
- HUD elements display player info, score, chat, and notifications.
- In-game chat and player list are accessible at all times.
- Optional minimap and objective tracker for navigation.

### 2.5 Audio/Visual Feedback
- Sound effects for actions (movement, interaction, events).
- Background music and ambient sounds enhance immersion.
- Visual feedback (particle effects, highlights) for important events.

### 2.6 Networking/Session Management
- Handles player disconnects/reconnects gracefully.
- Prevents duplicate player names; basic authentication for persistent identity.
- Session persistence for returning players.

### 2.7 Security/Anti-Cheat
- All game actions are validated server-side.
- Anti-cheat checks and rate limiting are enforced.
- Regular audits for suspicious behavior.

### 2.8 Performance/Scalability
- Optimized for large player counts using spatial partitioning.
- State updates are sent only to relevant clients to reduce bandwidth.

### 2.9 Accessibility & Platform Support
- Colorblind modes, key remapping, and readable fonts are available.
- UI is responsive and supports both desktop and mobile/touch controls.
- Accessibility settings can be adjusted in-game.

### 2.10 Environment
- 3D world with ground plane
  - Green color ground with semi-transparent square grid
- Grid system aids navigation
- Collision detection with ground and objects
- Object physics managed via bounding boxes or Cannon.js (future extension)

### 2.11 Camera Dynamics
- Camera follows player, attached per browser session
- Controlled using Q/E keys
- Maintains smooth relative position during rotation
- Camera affects forward direction vector for movement

### 2.12 Keyboard Dynamics
- Controls activated only after name entry and start button click
- WASD movement relative to camera
- Q/E for camera rotation
- Session-level keyboard control for multi-tab safety
- Debounced input events to prevent rapid fire issues
- The keyboard controls are bound to the active broswer session and thus the player-mesh of the active broswer session is controlled.

### 2.13 Game Start
- Initial screen includes name input field and "Start Game" button
- Pressing enter or clicking the button transitions to the game view

## 3. Technical Specifications

### 3.1 Frontend
- Three.js for 3D rendering
- Socket.IO for real-time bi-directional communication
- ES6+ JavaScript
- Responsive design for varied screen sizes
- `requestAnimationFrame` used for all animation/game loops

### 3.2 Backend
- Python FastAPI server (optionally upgrade to FastAPI for async handling)
- JSON-based communication
- Modular code with separation for auth, game logic, object handling

### 3.3 Data Structure

```javascript
// Player Object
{
    id: string,             // Server-assigned UUID
    position: { x, y, z },  // 3D position
    color: string,
    mesh: THREE.Mesh
}

// Custom Object
{
    id: string,             // Server-assigned UUID
    type: string,           // box | cylinder | sphere
    position: { x, y, z },
    dimensions: { width, height, depth },
    texture: string
}

```

### 3.4 Asset Management & Modular Components
- All 3D objects (trees, portals, buildings, etc.) are implemented as ES6 JavaScript classes/modules in `static/js/components/`.
- Each object class exposes:
  - A constructor accepting position, color, and other relevant options.
  - A `createMesh()` or equivalent method returning a `THREE.Group` or `THREE.Mesh`.
  - An `onInteract(player)` method for custom interaction logic.
- Assets (textures, models) are organized in the `static/textures/` and `static/models/` directories.
- A centralized `textureLoader.js` module provides efficient texture loading and caching for Three.js materials.

### 3.5 Scene Initialization & Game Loop
- The `Game` class initializes the Three.js scene, camera, renderer, and attaches them to the DOM.
- The main animation loop is driven by `requestAnimationFrame`, updating player positions, object states, and rendering the scene.
- On game start, the scene is populated with:
  - The ground plane and navigation grid.
  - Trees, portals, and buildings at randomized or predefined positions.
  - Player avatars and labels for each connected user.

### 3.6 Session & Controls Handling
- Keyboard controls are only active for the currently focused browser tab/session.
- Focus/blur and visibility change events are handled to enable/disable player controls.
- Mobile/touch controls are supported via a virtual joystick and jump button, detected at runtime.

### 3.7 Networking Events & Server Authority
- The frontend and backend communicate via the following Socket.IO events:
  - `player_join`, `player_move`, `chat_message`, `player_disconnected`, `global_state_update`, `wall_display_update`.
- The server maintains the authoritative state for all players and objects.
- All movement, interaction, and chat actions are validated on the server before being broadcast to clients.
- Player and object states are synchronized in real-time; only relevant state updates are sent to each client to optimize bandwidth.

### 3.8 User Interface Structure
- The UI consists of:
  - A start screen for name entry and game start.
  - A game container with player count, info panel, debug info, chat window, and in-game notifications.
- In-game chat messages are displayed as floating bubbles above player avatars for 15 seconds.
- All UI elements are responsive and adapt to desktop and mobile layouts.

### 3.9 Example Directory Structure
```
aworld/
├── static/
│   ├── js/
│   │   ├── components/
│   │   │   ├── PlayerAvatar.js
│   │   │   ├── Portal.js
│   │   │   ├── Tree.js
│   │   │   └── Building.js
│   │   ├── controls.js
│   │   ├── game.js
│   │   ├── textureLoader.js
│   │   └── mobile_controls.js
│   ├── textures/
│   └── models/
├── templates/
│   └── index.html
├── server.py
├── requirements.txt
└── game_design.md

```

### 3.10 Component Implementation Details

#### 3.10.1 Tree Component
- Trees are implemented as standalone components with cylindrical trunks and sphere foliage.
- Each tree has customizable position, trunk height, foliage radius, and colors.
- Trees are instantiated with randomized positions within a specified radius from the world center.
- A minimum distance check prevents trees from spawning too close to each other.
- Trees can have optional interaction behavior (e.g., dropping items, playing sound effects).

#### 3.10.2 Portal Component
- Portals serve as teleportation or transition points between different areas.
- Each portal has a position, color, and label (displayed to players).
- Portal visuals consist of a circular base and a particle effect or animated texture.
- Portals can be linked to specific coordinates or other portals.

#### 3.10.3 Wall Display Feature
- A shared display surface that all players can see.
- Content can be updated via API calls or administrative commands.
- Rendered using a Canvas texture mapped to a surface in the 3D environment.
- Used for announcements, instructions, or community content.

#### 3.10.4 Building Component
- Buildings are cuboid structures representing modular rooms or shops.
- Each building has customizable position and size, defined by width, height, depth.
- A front face can display a dynamic wall display canvas texture; other faces use neutral colors.
- Buildings cast and receive shadows; positioned with base at ground level.
- Future extensions include doors, interior spaces, and interactive signage.

#### 3.10.5 Chat System
- Players can send text messages via a chat form that emits the `chat_message` event.
- The server stores the latest message and an expiry timestamp per player and prunes expired messages every tick.
- Clients render chat messages as floating speech-bubble sprites above the player's head for 15 seconds.
- Messages are sanitized and truncated to 120 characters server-side to prevent abuse.

#### 3.10.6 Mobile Controls
- On touch devices (`window.isMobileDevice()`), the `MobileControls` module renders:
  - A virtual joystick for movement
  - A jump button
- Joystick provides continuous directional deltas; swipe gestures control camera rotation.
- Control callbacks mirror desktop inputs, ensuring identical game logic on all platforms.
- Mobile UI elements are hidden on desktop and vice versa.

### 3.11 Configuration & Environment Variables

- Server configuration is handled through environment variables:
  - `PORT`: Server port (default: 5001)
  - `SECRET_KEY`: Flask session security key
- Physics constants are defined at the server level:
  - `GRAVITY`: Downward acceleration (0.02 units/tick)
  - `JUMP_VELOCITY`: Initial upward velocity (0.25 units/tick)
  - `CHAT_EXPIRY_SECONDS`: Duration chat messages remain visible (15 seconds)

### 3.12 Error Handling & Fallbacks

- Socket connection errors trigger automatic reconnection attempts (max 5 retries).
- Disconnected players are gracefully removed from the scene with notifications.
- Invalid messages or actions are logged and rejected with appropriate error responses.
- Asset loading failures fall back to default colors/geometries.
- Server maintains authoritative state to recover from synchronization issues.

### 3.13 Initialization Process Flow

1. Server starts, initializes empty player dictionary and sets constants.
2. Client loads HTML/CSS/JS resources and establishes Socket.IO connection.
3. User enters name and clicks "Start Game":
   - Random color is generated and player_join event is emitted.
   - Server validates, creates player record, and broadcasts to all clients.
   - Local player mesh and camera are created.
   - All existing players are added to the scene.
4. Animation loop begins updating positions based on controls.
5. World objects (trees, portals, buildings) are instantiated with specific or randomized positions.
6. Player can now move, interact, and communicate with others.

### 3.14 Physics & Collision Implementation
- Players use capsule colliders (radius ≈ 0.5, height ≈ 2 units) for collision checks.
- Terrain collision: simple plane at y=0.
- Object collision: bounding boxes around trees, buildings, and other static meshes.
- Client performs speculative movement; server performs authoritative collision resolution.
- Gravity is applied each tick; jumping sets vertical velocity to `JUMP_VELOCITY` until landing.
- Future upgrades can integrate Cannon.js or Ammo.js for full physics simulation.
