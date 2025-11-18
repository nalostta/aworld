#!/usr/bin/env python3
"""Test the new input-based networking model.

This test sends input commands (keypresses with timestamps) instead of positions
to verify the server correctly processes inputs and returns authoritative positions.
"""

import asyncio
import json
import time
import websockets


async def test_input_based_networking():
    """Test sending input commands to server"""
    ws_url = "ws://localhost:8000/ws"
    
    async with websockets.connect(ws_url) as websocket:
        # Join the game
        await websocket.send(json.dumps({
            "event": "player_join",
            "data": {"name": "InputTester", "color": "#00ff00"}
        }))
        
        # Wait for join confirmation
        await asyncio.sleep(0.1)
        
        print("Testing input-based networking...")
        sequence = 0
        positions_received = []
        
        # Test 1: Send forward movement input
        for i in range(10):
            sequence += 1
            timestamp = int(time.time() * 1000)
            
            # Simulate holding W key
            input_state = {
                "sequence": sequence,
                "timestamp": timestamp,
                "inputs": {
                    "forward": {
                        "pressed": True,
                        "timestamp": timestamp - 100,  # Pressed 100ms ago
                        "duration": 100
                    }
                },
                "cameraRotation": 0.0
            }
            
            await websocket.send(json.dumps({
                "event": "player_input",
                "data": input_state
            }))
            
            # Drain all messages (might get global_state_update too)
            try:
                while True:
                    response = await asyncio.wait_for(websocket.recv(), timeout=0.1)
                    msg = json.loads(response)
                    
                    if msg.get("event") == "server_position_update":
                        data = msg.get("data", {})
                        seq = data.get("sequence")
                        pos = data.get("position")
                        positions_received.append(pos)
                        print(f"✓ Sequence {seq}: Position {pos}")
                        break  # Got our response
                    
            except asyncio.TimeoutError:
                print(f"✗ Sequence {sequence}: No response from server")
            
            await asyncio.sleep(0.05)
        
        # Test 2: Send jump input
        sequence += 1
        timestamp = int(time.time() * 1000)
        
        jump_input = {
            "sequence": sequence,
            "timestamp": timestamp,
            "inputs": {
                "jump": {
                    "pressed": True,
                    "timestamp": timestamp,
                    "duration": 0
                }
            },
            "cameraRotation": 0.0
        }
        
        await websocket.send(json.dumps({
            "event": "player_input",
            "data": jump_input
        }))
        
        response = await asyncio.wait_for(websocket.recv(), timeout=0.5)
        msg = json.loads(response)
        
        if msg.get("event") == "server_position_update":
            pos = msg.get("data", {}).get("position")
            print(f"✓ Jump input: Y position = {pos.get('y', 0)}")
        
        # Verify movement
        if len(positions_received) >= 2:
            first_pos = positions_received[0]
            last_pos = positions_received[-1]
            
            # Calculate displacement
            dx = last_pos['x'] - first_pos['x']
            dz = last_pos['z'] - first_pos['z']
            displacement = (dx**2 + dz**2)**0.5
            
            print(f"\n=== Test Results ===")
            print(f"Positions received: {len(positions_received)}")
            print(f"First position: {first_pos}")
            print(f"Last position: {last_pos}")
            print(f"Displacement: {displacement:.2f} units")
            
            if displacement > 0.5:
                print("✅ SUCCESS: Player moved based on input commands")
            else:
                print("❌ FAILED: Player did not move")
        else:
            print("❌ FAILED: Not enough position updates received")


if __name__ == "__main__":
    asyncio.run(test_input_based_networking())
