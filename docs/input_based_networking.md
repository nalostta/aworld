# Input-Based Networking Implementation

## Overview

Changed the game's networking model from **position-based** to **input-based** communication. The client now sends keypresses with timestamps and durations instead of calculated positions.

## Changes Made

### 1. Client-Side (`controls.js`)

**Added timestamp tracking:**
- `keyTimestamps`: Records when each key was first pressed
- `inputSequence`: Incremental counter for input ordering
- `getInputState()`: Returns complete input state with:
  - Sequence number
  - Timestamp
  - Active keys with their press timestamps and durations
  - Camera rotation

**Example input state:**
```javascript
{
  sequence: 42,
  timestamp: 1700000000000,
  inputs: {
    forward: { pressed: true, timestamp: 1699999995000, duration: 5000 },
    sprint: { pressed: true, timestamp: 1699999998000, duration: 2000 }
  },
  cameraRotation: 0.785
}
```

### 2. Client-Side (`game.js`)

**Changed event type:**
- From: `player_move` with `position` data
- To: `player_input` with input state data

**Benefits:**
- Server has full authority over physics calculations
- Client-side prediction remains for responsiveness
- Server can validate and correct client predictions
- Timestamps enable lag compensation

### 3. Server-Side (`server.py`)

**Added input processing:**
- `process_input()`: Calculates new position from input commands
  - Processes movement keys (W/A/S/D)
  - Applies sprint/crouch modifiers
  - Handles jumping with server authority
  - Applies gravity and ground clamping

**New event handler:**
- `player_input`: Processes input commands
  - Calculates authoritative position
  - Sends `server_position_update` back to client with sequence number
  - Broadcasts global state to all players

**Legacy support:**
- Kept `player_move` handler for backward compatibility
- Test scripts using direct positions still work

## Data Flow

```
Client                          Server
------                          ------
1. Keypress detected
2. Timestamp recorded
3. Local prediction applied
4. Input state sent ────────────> 5. Receive input
   (with sequence #)              6. Process input
                                  7. Calculate position
                                  8. Send authoritative
                      <────────── position (with sequence #)
9. Receive server position
10. Reconcile if needed
```

## Benefits

### 1. **Server Authority**
- Server has full control over physics
- Prevents cheating (speed hacks, teleportation)
- Consistent physics across all clients

### 2. **Lag Compensation**
- Timestamps enable server to rewind and replay
- Can validate inputs based on when they occurred
- Better handling of high-latency connections

### 3. **Debugging**
- Can log exact input sequences
- Easier to reproduce bugs
- Can analyze input timing patterns

### 4. **Reconciliation**
- Sequence numbers enable precise reconciliation
- Client can replay inputs after server correction
- Smoother experience on poor connections

## Next Steps (Optional Enhancements)

1. **Client-side reconciliation:**
   - Store input history by sequence number
   - On server correction, replay inputs from that sequence
   - Smooth interpolation between predicted and corrected positions

2. **Input buffering:**
   - Queue inputs on client during lag spikes
   - Send multiple inputs in one packet when reconnecting

3. **Lag compensation on server:**
   - Use timestamps to rewind game state
   - Process inputs as if they arrived on time
   - Better hit detection and collision handling

4. **Input compression:**
   - Send deltas instead of full state
   - Compress repeated inputs (e.g., "forward held for 500ms")

## Testing

The existing test scripts still work:
- `test_primary_player_with_bots.py`: Uses WebSocket directly
- `test_multiplayer_bench.py`: Can be updated to test input-based model

Server maintains backward compatibility with `player_move` events for testing.
