#!/usr/bin/env python3
"""
Client-Server Physics Mismatch Debugging Tools
Specific approaches to fix the 67% reconciliation rate issue
"""

import json
import time
import asyncio
import websockets
from typing import Dict, List, Tuple

class PhysicsDebugger:
    """Debug client vs server physics discrepancies"""
    
    def __init__(self):
        # Server physics constants (must match server.py)
        self.SERVER_GRAVITY = 0.02
        self.SERVER_JUMP_VELOCITY = 0.25
        
        # Client physics constants (must match controls.js)
        self.CLIENT_GRAVITY = 0.02  # Need to verify this matches
        self.CLIENT_JUMP_FORCE = 0.25  # Need to verify this matches
        
        self.debug_log = []
    
    def simulate_server_physics(self, initial_pos: Dict, input_sequence: List[Dict]) -> List[Dict]:
        """Simulate exact server physics locally"""
        position = initial_pos.copy()
        vy = 0.0
        positions = []
        
        for inp in input_sequence:
            # Server physics logic (from server.py lines 154-171)
            new_x = position['x'] + inp['x']
            new_z = position['z'] + inp['z']
            
            # Handle jumping (server logic)
            if inp['y'] > 0 and position['y'] <= 0.01 and abs(vy) < 1e-5:
                vy = self.SERVER_JUMP_VELOCITY
            
            # Apply gravity
            vy -= self.SERVER_GRAVITY
            new_y = position['y'] + vy
            
            # Ground clamp
            if new_y <= 0:
                new_y = 0
                vy = 0
            
            position = {'x': new_x, 'y': new_y, 'z': new_z}
            positions.append({
                'position': position.copy(),
                'vy': vy,
                'input': inp
            })
        
        return positions
    
    def simulate_client_physics(self, initial_pos: Dict, input_sequence: List[Dict]) -> List[Dict]:
        """Simulate client physics as it should work"""
        position = initial_pos.copy()
        vy = 0.0
        is_grounded = True
        positions = []
        
        for inp in input_sequence:
            # Client physics logic (from controls.js)
            # Handle jumping
            if inp['y'] > 0 and is_grounded:
                vy = self.CLIENT_JUMP_FORCE
                is_grounded = False
            
            # Apply gravity
            if not is_grounded:
                vy -= self.CLIENT_GRAVITY
            
            # Apply movement
            new_x = position['x'] + inp['x']
            new_z = position['z'] + inp['z']
            new_y = position['y'] + vy
            
            # Ground check
            if new_y <= 0:
                new_y = 0
                vy = 0
                is_grounded = True
            else:
                is_grounded = False
            
            position = {'x': new_x, 'y': new_y, 'z': new_z}
            positions.append({
                'position': position.copy(),
                'vy': vy,
                'is_grounded': is_grounded,
                'input': inp
            })
        
        return positions
    
    def compare_physics_implementations(self, input_sequence: List[Dict]) -> Dict:
        """Compare server vs client physics step by step"""
        initial_pos = {'x': 0, 'y': 0, 'z': 0}
        
        server_sim = self.simulate_server_physics(initial_pos, input_sequence)
        client_sim = self.simulate_client_physics(initial_pos, input_sequence)
        
        differences = []
        max_error = 0
        
        for i, (server, client) in enumerate(zip(server_sim, client_sim)):
            error = {
                'step': i,
                'input': server['input'],
                'server_pos': server['position'],
                'client_pos': client['position'],
                'position_error': {
                    'x': abs(server['position']['x'] - client['position']['x']),
                    'y': abs(server['position']['y'] - client['position']['y']),
                    'z': abs(server['position']['z'] - client['position']['z'])
                },
                'total_error': (
                    (server['position']['x'] - client['position']['x'])**2 +
                    (server['position']['y'] - client['position']['y'])**2 +
                    (server['position']['z'] - client['position']['z'])**2
                )**0.5
            }
            
            differences.append(error)
            max_error = max(max_error, error['total_error'])
        
        return {
            'differences': differences,
            'max_error': max_error,
            'steps_with_error': [d for d in differences if d['total_error'] > 0.01],
            'reconciliations_needed': len([d for d in differences if d['total_error'] > 0.5])
        }

class TimingSynchronizationDebugger:
    """Debug timing issues between input sending and physics"""
    
    async def test_timing_synchronization(self, ws_url: str) -> Dict:
        """Test for timing synchronization issues"""
        results = {
            'timing_drift': [],
            'sequence_gaps': [],
            'duplicate_sequences': [],
            'out_of_order_responses': []
        }
        
        async with websockets.connect(ws_url) as websocket:
            # Join first
            await websocket.send(json.dumps({
                "event": "player_join",
                "data": {"name": "TimingDebugBot", "color": "#ff0000"}
            }))
            
            # Wait for join confirmation
            await asyncio.sleep(1)
            
            # Send timestamped inputs
            sent_inputs = {}
            sequence = 0
            
            for i in range(50):
                sequence += 1
                send_time = time.perf_counter() * 1000  # Client timestamp
                server_expected_time = time.time() * 1000  # What server should see
                
                input_data = {
                    "event": "player_input",
                    "data": {
                        "input": {"x": 0.1, "y": 0, "z": 0},
                        "timestamp": server_expected_time,
                        "sequence": sequence,
                        "client_send_time": send_time  # Debug field
                    }
                }
                
                sent_inputs[sequence] = {
                    'client_send_time': send_time,
                    'server_timestamp': server_expected_time,
                    'input': input_data
                }
                
                await websocket.send(json.dumps(input_data))
                
                # Listen for response
                try:
                    response = await asyncio.wait_for(websocket.recv(), timeout=1.0)
                    receive_time = time.perf_counter() * 1000
                    
                    data = json.loads(response)
                    if data.get('event') == 'server_position_update':
                        resp_data = data['data']
                        resp_sequence = resp_data.get('sequence', 0)
                        resp_timestamp = resp_data.get('timestamp', 0)
                        
                        if resp_sequence in sent_inputs:
                            sent = sent_inputs[resp_sequence]
                            
                            # Calculate timing drift
                            timing_drift = resp_timestamp - sent['server_timestamp']
                            results['timing_drift'].append({
                                'sequence': resp_sequence,
                                'drift_ms': timing_drift,
                                'rtt_ms': receive_time - sent['client_send_time']
                            })
                        
                        # Check for out-of-order responses
                        if resp_sequence != sequence:
                            results['out_of_order_responses'].append({
                                'expected': sequence,
                                'received': resp_sequence
                            })
                
                except asyncio.TimeoutError:
                    results['sequence_gaps'].append(sequence)
                
                await asyncio.sleep(0.05)  # 20fps
        
        return results

def create_physics_test_cases() -> List[Dict]:
    """Generate test cases that expose common physics bugs"""
    return [
        # Test case 1: Simple horizontal movement
        [
            {"x": 0.1, "y": 0, "z": 0},
            {"x": 0.1, "y": 0, "z": 0},
            {"x": 0.1, "y": 0, "z": 0},
        ],
        
        # Test case 2: Jump sequence
        [
            {"x": 0, "y": 0, "z": 0},  # Grounded
            {"x": 0, "y": 0.2, "z": 0},  # Jump
            {"x": 0, "y": 0, "z": 0},  # Air (gravity should apply)
            {"x": 0, "y": 0, "z": 0},  # Still in air
            {"x": 0, "y": 0, "z": 0},  # Should land
        ],
        
        # Test case 3: Movement while jumping
        [
            {"x": 0.1, "y": 0.2, "z": 0.1},  # Jump + move
            {"x": 0.1, "y": 0, "z": 0.1},    # Continue movement in air
            {"x": 0.1, "y": 0, "z": 0.1},    # Still in air
        ],
        
        # Test case 4: Rapid direction changes
        [
            {"x": 0.1, "y": 0, "z": 0},
            {"x": -0.1, "y": 0, "z": 0},
            {"x": 0.1, "y": 0, "z": 0},
            {"x": -0.1, "y": 0, "z": 0},
        ],
        
        # Test case 5: No input (should stay in place)
        [
            {"x": 0, "y": 0, "z": 0},
            {"x": 0, "y": 0, "z": 0},
            {"x": 0, "y": 0, "z": 0},
        ]
    ]

async def comprehensive_physics_debug():
    """Run comprehensive physics debugging"""
    print("🔬 PHYSICS MISMATCH DEBUGGING")
    print("=" * 50)
    
    debugger = PhysicsDebugger()
    test_cases = create_physics_test_cases()
    
    total_errors = 0
    total_reconciliations = 0
    
    for i, test_case in enumerate(test_cases):
        print(f"\n📊 Test Case {i+1}: {len(test_case)} inputs")
        result = debugger.compare_physics_implementations(test_case)
        
        print(f"  Max Error: {result['max_error']:.3f} units")
        print(f"  Reconciliations Needed: {result['reconciliations_needed']}")
        
        if result['steps_with_error']:
            print(f"  ⚠️  Steps with errors: {len(result['steps_with_error'])}")
            for step in result['steps_with_error'][:3]:  # Show first 3
                print(f"    Step {step['step']}: {step['total_error']:.3f} unit error")
        
        total_errors += len(result['steps_with_error'])
        total_reconciliations += result['reconciliations_needed']
    
    print(f"\n📈 SUMMARY")
    print(f"  Total steps with errors: {total_errors}")
    print(f"  Total reconciliations needed: {total_reconciliations}")
    
    # Test timing synchronization
    print(f"\n⏱️  TIMING SYNCHRONIZATION TEST")
    timing_debugger = TimingSynchronizationDebugger()
    try:
        timing_results = await timing_debugger.test_timing_synchronization("ws://0.0.0.0:8000/ws")
        
        if timing_results['timing_drift']:
            avg_drift = sum(t['drift_ms'] for t in timing_results['timing_drift']) / len(timing_results['timing_drift'])
            max_drift = max(t['drift_ms'] for t in timing_results['timing_drift'])
            print(f"  Average timing drift: {avg_drift:.1f}ms")
            print(f"  Max timing drift: {max_drift:.1f}ms")
        
        if timing_results['sequence_gaps']:
            print(f"  ⚠️  Sequence gaps: {len(timing_results['sequence_gaps'])}")
        
        if timing_results['out_of_order_responses']:
            print(f"  ⚠️  Out-of-order responses: {len(timing_results['out_of_order_responses'])}")
    
    except Exception as e:
        print(f"  ❌ Timing test failed: {e}")

def generate_fix_recommendations():
    """Generate specific fix recommendations"""
    return """
🔧 SPECIFIC FIX APPROACHES
========================

1. 🎯 PHYSICS CONSTANT MISMATCH
   Problem: Client and server may have different gravity/jump values
   
   Fix: Create shared physics constants
   ```javascript
   // In game.js - add at top
   const PHYSICS = {
       GRAVITY: 0.02,        // Must match server.py line 20
       JUMP_VELOCITY: 0.25   // Must match server.py line 21
   };
   ```

2. ⏱️ TIMING SYNCHRONIZATION ISSUES
   Problem: Client sends inputs too frequently vs server processing
   
   Fix A: Synchronize physics tick rates
   ```javascript
   // In game.js - change input frequency
   if (Date.now() - this.lastInputSent > 50) {  // 20fps = 50ms
       this.sendInput(movement);
       this.lastInputSent = Date.now();
   }
   ```
   
   Fix B: Add server timestamp synchronization
   ```javascript
   // Add to WebSocket message handling
   this.serverTimeOffset = serverTimestamp - Date.now();
   ```

3. 🔄 PHYSICS ORDER MISMATCH
   Problem: Client applies gravity differently than server
   
   Current Client (controls.js):
   1. Handle jump
   2. Apply gravity
   3. Apply movement
   4. Ground check
   
   Server (server.py):
   1. Apply movement
   2. Handle jump
   3. Apply gravity
   4. Ground check
   
   Fix: Match the exact order in client

4. 🎚️ RECONCILIATION THRESHOLD
   Problem: 0.5 unit threshold too strict for physics differences
   
   Fix: Dynamic threshold based on movement speed
   ```javascript
   const dynamicThreshold = Math.max(0.1, movement.speed * 0.1);
   if (positionError > dynamicThreshold) {
       this.reconcilePosition(serverPos);
   }
   ```

5. 🔍 GROUND DETECTION MISMATCH
   Problem: Client vs server ground detection logic differs
   
   Server: `if new_y <= 0`
   Client: `if (y + this.verticalVelocity) <= 0`
   
   Fix: Use identical ground detection logic

IMPLEMENTATION PRIORITY:
1. Fix physics constants (immediate impact)
2. Match physics order (high impact)
3. Adjust reconciliation threshold (quick win)
4. Add timing synchronization (long-term)
5. Add real-time physics comparison debug overlay
"""

if __name__ == "__main__":
    print("🚀 Running Physics Debug Analysis...")
    asyncio.run(comprehensive_physics_debug())
    print(generate_fix_recommendations())
