# AWorld Networking & Rubber-Banding Report

## 1. Overview

This report analyzes the current AWorld multiplayer implementation and explains why players experience **rubber banding** and perceived lag, especially in production. It is based on the current code in:

- `server.py`
- `static/js/game.js`
- `static/js/controls.js`

It also outlines realistic strategies to move toward a **smooth, perception-wise "lag-free"** multiplayer experience.

---

## 2. Current Architecture Summary

### 2.1 Server (`server.py`)

- Technology: FastAPI + WebSocket endpoint at `/ws`.
- State:
  - Global `players` dict keyed by WebSocket session ID (`sid`).
  - Each player has: `id`, `name`, `color`, `position {x,y,z}`, vertical velocity `vy`, and chat fields.
- Physics:
  - Server constants:
    - `SERVER_GRAVITY = 0.02`
    - `SERVER_JUMP_VELOCITY = 0.25`
  - On `player_move` event:
    - Reads client-provided `position`.
    - Detects jump from change in `y` and current `vy`/ground state.
    - Applies server-side gravity and ground clamp.
    - Writes back authoritative position.
  - Broadcasts **entire** player list every time via `broadcast_global_state()`.

### 2.2 Client (`static/js/game.js`)

- Renders the 3D scene via Three.js.
- Maintains a `Map` of players `{id -> {mesh, label, data}}`.
- Networking:
  - Uses native `WebSocket` to `/ws`.
  - Sends events:
    - `player_join` with `{name, color}`.
    - `player_move` with `{position}`.
    - `chat_message`.
    - `ping` for RTT measurement.
  - Receives events:
    - `global_state_update` with full `players` array.
    - `player_count_update`.
    - `ping` echo for RTT.

### 2.3 Movement & Controls (`static/js/controls.js` + `game.js`)

- Client controls:
  - WASD for movement, Space for jump, Shift/C for sprint/crouch.
  - `moveSpeed = 0.1`, `sprintMultiplier = 2`, `crouchMultiplier = 0.5`.
  - Vertical physics on client:
    - `jumpForce = 0.2`
    - `gravity = 0.01`
    - `verticalVelocity` updated each tick.
    - Ground check: `if ((y + verticalVelocity) <= 0) { verticalVelocity = 0; isGrounded = true; }`.

- In `Game.animate()`:
  - Every frame:
    - `movement = this.controls.update(this.playerMesh ? this.playerMesh.position.y : 0)`.
    - If movement non-zero and `playerMesh` exists:
      - Locally computes `newPos` = old position + movement.
      - **Immediately sets** `this.playerMesh.position` to `newPos`.
      - Sends `player_move` at up to ~20 fps (every 50ms) with the new position.
  - Camera follows `playerMesh` position directly.

- In `handleGlobalStateUpdate(players)`:
  - Ensures a mesh exists for every server player and removes missing ones.
  - For every player:
    - `obj.mesh.position.set(player.position.x, player.position.y + 1, player.position.z)`.
    - This applies to **local and remote** players.

---

## 3. Direct Causes of Rubber Banding

Below are the concrete code-level causes in this codebase.

### 3.1 Client-Server Physics Mismatch

**Where:**

- Server: `server.py`
  - `SERVER_GRAVITY = 0.02`
  - `SERVER_JUMP_VELOCITY = 0.25`
- Client: `static/js/controls.js`
  - `this.jumpForce = 0.2;`
  - `this.gravity = 0.01;`
  - Ground check: `if ((y + this.verticalVelocity) <= 0) ...`
- Server ground/physics logic in `player_move` handler:
  - Detect jump by comparing `pos['y']` to `current_y`.
  - Apply gravity and then ground clamp with `if new_y <= 0: ...`.

**Effect:**

- The client simulates **different jump height, gravity, and ground behavior** than the server.
- The client sends a predicted position based on its own physics.
- The server then rewrites that position using its own physics, producing a **systematic divergence**.
- Every `global_state_update` brings the local mesh back to the server’s position, creating visible "snaps" or rubber banding.

**Impact:**

- The faster the movement or more frequent the jumps, the bigger the discrepancy.
- Even on a low-latency connection, you will see:
  - Local jump feels one way on the client.
  - Server pushes you to a different arc/height/landing time.

---

### 3.2 Global State Overwrites Local Prediction Every Broadcast

**Where:**

- `Game.animate()` (client):
  - Local player movement is applied immediately:
    - `this.playerMesh.position.set(newPos.x, newPos.y, newPos.z);`
- `Game.handleGlobalStateUpdate(players)`:
  - For **all players**, including the local one:

```js
obj.mesh.position.set(player.position.x, player.position.y + 1, player.position.z);
```

**Effect:**

- The local player is effectively under two conflicting controllers:
  - **Predictive controller** in `animate()` that moves instantly according to controls.
  - **Authoritative controller** that snaps the mesh to the server’s position for each `global_state_update`.
- When network latency/jitter exists:
  - You move locally.
  - Some milliseconds later, server state arrives with a slightly different position.
  - The mesh is reset to that position → visible jitter / rubber band.

**Impact:**

- The higher the RTT, the more the local position diverges before correction.
- Because broadcasts send the **full state** frequently, corrections are constant.

---

### 3.3 No Reconciliation or Input Sequencing

**Where:**

- Client sends `player_move` events with raw positions:

```js
this.ws.send(JSON.stringify({ 
    event: 'player_move', 
    data: { position: newPos } 
}));
```

- Server simply uses the position and its own physics; no notion of:
  - Input sequence number.
  - Timestamp per input.
  - Replaying unprocessed inputs after correction.

**Effect:**

- When the server response is slightly delayed or packets are reordered:
  - Client has no way to know *which* input the server’s state corresponds to.
  - Client simply accepts the server position as truth and snaps directly, without smoothing.

**Impact:**

- You get **visible corrections** even for minor desyncs.
- Corrections can appear as the classic rubber-banding: move forward, then snap backward or sideways.

---

### 3.4 No Interpolation for Remote Players

**Where:**

- `handleGlobalStateUpdate(players)` directly sets positions for remote meshes as well:

```js
obj.mesh.position.set(player.position.x, player.position.y + 1, player.position.z);
```

- There is no buffering of historical snapshots or interpolation.

**Effect:**

- Remote players are rendered exactly at the last received server position.
- If packets arrive with variable delays (jitter), remote movement appears:
  - Jerky.
  - Sometimes temporarily frozen.
  - With small snaps when a late update arrives.

**Impact:**

- Even on good networks, you rarely get perfectly uniform packet timing.
- This makes remote players visibly stutter, which players often lump under "lag" / rubber banding.

---

### 3.5 Broadcast Strategy: Full-State Broadcast on Every Movement

**Where:**

- `server.py` → in `player_move` and `chat_message` handling:

```py
await broadcast_global_state()
```

- `broadcast_global_state()` sends **all** players every time any player moves or chats.

**Effect:**

- For N players, each movement from any player yields a full-state broadcast.
- Under load or higher player counts:
  - Server sends many JSON messages.
  - Network can get congested; some updates delayed or grouped.
  - Client receives bursts of state, then gaps.

**Impact:**

- Combined with direct position setting (no interpolation), this bursty update pattern exaggerates rubber banding.

---

## 4. Is a Seamless / Lag-Free Experience Feasible?

### 4.1 Physically Zero-Lag? No

- You cannot remove network latency, especially in a global, consumer-ISP environment.
- RTT, jitter, and occasional packet loss are unavoidable.

### 4.2 Perceptually Seamless for Most Players? Yes

Given your tech stack and current architecture, a **perceptually smooth** experience is highly feasible if you:

1. Align client/server physics exactly.
2. Introduce a proper client-side prediction + reconciliation system for the local player.
3. Use interpolation (and limited extrapolation) for remote players.
4. Structure networking to be tolerant of jitter and packet loss.

Many commercial games with stricter requirements than AWorld use these exact techniques successfully.

---

## 5. Recommended Strategies and Changes

This section lays out a practical roadmap from the current code to a smoother multiplayer experience.

### 5.1 Align Client and Server Physics

**Goal:** The same input sequence on client and server produces nearly identical movement trajectories.

**Actions:**

- Make gravity and jump constants identical:
  - In `controls.js`:
    - `this.jumpForce` → set to `0.25` (match `SERVER_JUMP_VELOCITY`).
    - `this.gravity` → set to `0.02` (match `SERVER_GRAVITY`).
- Align ground detection and vertical update logic:
  - Use the same ground level definition (`y=0` vs `y=1` for avatar center) on both sides.
  - Ensure the ground check uses the same formula (either both check `newY <= 0` or both check `(y + vy) <= 0`, but identically).

**Result:**

- With identical physics, client-side prediction will rarely drift far from the server, making corrections small and infrequent.

---

### 5.2 Introduce Proper Client-Side Prediction + Server Reconciliation

**Current behavior:**

- The client already updates the local mesh instantly and sends positions.
- The server rewrites them and broadcasts back full state.
- The client overwrites the local mesh with server state → conflict.

**Target behavior:**

1. **Send inputs, not positions:**
   - Move to an `event: 'player_input'` model with:
     - Input sequence ID.
     - Pressed keys / movement vector.
     - Timestamp.
   - Server runs its own physics using these inputs.

2. **Local prediction:**
   - Client maintains a list of unacknowledged inputs.
   - For each frame:
     - Apply new inputs locally.
     - Send them to the server.

3. **Reconciliation:**
   - Server sends back periodic state updates:
     - `position`, `velocity`, and the `lastProcessedInputId`.
   - Client:
     - Sets its internal state to the server’s authoritative state at that input ID.
     - Replays all stored inputs with ID > `lastProcessedInputId`.
   - If physics is in sync, corrections will be minimal.

4. **Apply server updates to local player carefully:**
   - Do **not** blindly set the local mesh position on every broadcast.
   - Instead, adjust the internal predicted state and allow smooth correction (see 5.3).

This is a more significant refactor but is the most robust solution for responsive local movement.

---

### 5.3 Interpolate Remote Players

**Current behavior:**

- Remote players are rendered directly at the latest server position with no smoothing.

**Recommended approach:**

- Maintain a small buffer of snapshots per remote player (e.g., 100–150ms of history).
- Render remote players **slightly in the past** by interpolating between two snapshots.
- Pseudocode concept:

```js
// For each remote player keep a list of {timestamp, position}

// On each server update:
remotePlayer.snapshots.push({ t: serverTime, pos: serverPosition });

// In render loop:
const renderTime = now - INTERPOLATION_DELAY; // e.g. 100ms
const [older, newer] = findSnapshotsAround(renderTime);

if (older && newer) {
  const alpha = (renderTime - older.t) / (newer.t - older.t);
  const interpPos = lerp(older.pos, newer.pos, alpha);
  mesh.position.copy(interpPos);
}
```

**Benefits:**

- Smooths out jitter and uneven packet arrivals.
- Remote movement appears continuous and fluid, even with moderate network issues.

---

### 5.4 Improve Broadcast Strategy

**Current behavior:**

- `broadcast_global_state()` sends the full player list on every `player_move` and `chat_message`.

**Recommendations:**

- Decouple server tick from input arrival:
  - Run a server simulation loop at a fixed tick rate (e.g., 20 ticks/sec).
  - Apply all queued inputs each tick.
  - Broadcast snapshots at a controlled rate (10–20 updates/sec).

- Use delta or partial updates:
  - Only send changed players.
  - Optionally compress or batch updates.

**Result:**

- More predictable network traffic.
- Less bursty behavior, fewer stalls, and smoother interpolation on the client.

---

### 5.5 Dynamic Tuning Based on RTT and Jitter

You already track RTT and jitter in `game.js` (`updateRTT`, `calculateJitter`). Use these metrics to:

- Adjust the interpolation buffer:
  - Larger buffer for poor networks (e.g., 150–200ms).
  - Smaller buffer for good networks (e.g., 60–100ms).
- Adjust reconciliation thresholds:
  - Only snap/correct when client prediction differs from server by more than a threshold.
  - Threshold can scale with speed and RTT.

This allows the game to adapt to different network qualities.

---

## 6. Practical Phased Plan

To make progress without a massive rewrite, you can phase changes:

### Phase 1 – Fix Immediate Physics Mismatches

- Align gravity and jump constants.
- Align ground detection logic.
- Keep the rest of the architecture as-is.
- This alone should reduce the magnitude of corrections and rubber banding.

### Phase 2 – Soften Server Corrections

- For the **local player**:
  - Stop overwriting the mesh position directly on each `global_state_update`.
  - Instead, smoothly interpolate toward the server position when the discrepancy exceeds a small threshold (e.g., 0.1–0.2 units).

### Phase 3 – Add Remote Player Interpolation

- Introduce per-remote-player snapshot buffers and interpolation.
- Test under real network conditions.

### Phase 4 – Full Prediction + Reconciliation

- Switch to input-based communication with sequence IDs.
- Implement proper server reconciliation for the local player.
- Optimize broadcast tick rate and deltas.

---

## 7. Conclusion

- **Direct causes of rubber banding in the current code:**
  - Client and server use **different physics constants and ground logic**, causing systematic prediction error.
  - Local player is updated both by **prediction** and by **authoritative overwrites**, with no reconciliation.
  - Remote players are rendered without interpolation, so network jitter shows up as movement jitter.
  - Server broadcasts full state on every movement, causing bursty update patterns.

- **Feasibility of a near "lag-free" experience:**
  - While actual network latency cannot be removed, it can be **hidden and smoothed**.
  - With aligned physics, client-side prediction + reconciliation, interpolation for remote players, and a saner broadcast model, AWorld can achieve a smooth, responsive multiplayer experience for the vast majority of players.

This report should serve as a reference for prioritizing netcode improvements and understanding the precise sources of rubber banding in the current implementation.
