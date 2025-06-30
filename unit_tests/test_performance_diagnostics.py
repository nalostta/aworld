#!/usr/bin/env python3
"""
Comprehensive Performance Diagnostics for AWorld Game
Tests client-server communication, prediction accuracy, and identifies bottlenecks.
"""

import asyncio
import websockets
import json
import time
import statistics
import requests
from typing import List, Dict, Tuple

class PerformanceDiagnostics:
    def __init__(self, server_url: str = "localhost:8000"):
        self.server_url = server_url
        self.ws_url = f"ws://{server_url}/ws"
        self.http_url = f"http://{server_url}"
        
        # Metrics
        self.rtts: List[float] = []
        self.reconciliations = 0
        self.total_inputs = 0
        self.prediction_errors: List[float] = []
        self.server_processing_times: List[float] = []
        self.messages_sent = 0
        self.messages_received = 0
        
        # Test results
        self.results = {}
        
    async def run_diagnostics(self):
        """Run comprehensive performance diagnostics"""
        print("🔧 AWorld Performance Diagnostics Suite")
        print("=" * 50)
        
        # 1. Server Health Check
        await self.test_server_health()
        
        # 2. Network Latency Test
        await self.test_network_latency()
        
        # 3. WebSocket Connection Test
        await self.test_websocket_connection()
        
        # 4. Client-Server Prediction Accuracy Test
        await self.test_prediction_accuracy()
        
        # 5. Load Test (simulate multiple players)
        await self.test_server_load()
        
        # 6. Generate Report
        self.generate_report()
        
    async def test_server_health(self):
        """Test server health endpoint"""
        print("\n📊 Testing Server Health...")
        try:
            response = requests.get(f"{self.http_url}/health", timeout=5)
            if response.status_code == 200:
                health_data = response.json()
                print(f"✅ Server Status: {health_data['status']}")
                print(f"   Uptime: {health_data['uptime_seconds']:.1f}s")
                print(f"   Memory Usage: {health_data['memory_usage_mb']:.1f}MB")
                print(f"   CPU Usage: {health_data['cpu_percent']:.1f}%")
                self.results['server_health'] = health_data
            else:
                print(f"❌ Server health check failed: {response.status_code}")
        except Exception as e:
            print(f"❌ Server health check error: {e}")
            
    async def test_network_latency(self):
        """Test raw network latency to server"""
        print("\n🌐 Testing Network Latency...")
        latencies = []
        
        for i in range(10):
            start_time = time.time()
            try:
                response = requests.get(f"{self.http_url}/health", timeout=2)
                if response.status_code == 200:
                    latency = (time.time() - start_time) * 1000
                    latencies.append(latency)
            except:
                pass
                
        if latencies:
            avg_latency = statistics.mean(latencies)
            p95_latency = statistics.quantiles(latencies, n=20)[18] if len(latencies) >= 5 else avg_latency
            print(f"✅ Average Latency: {avg_latency:.1f}ms")
            print(f"   P95 Latency: {p95_latency:.1f}ms")
            print(f"   Jitter: {statistics.stdev(latencies):.1f}ms")
            self.results['network_latency'] = {
                'avg': avg_latency,
                'p95': p95_latency,
                'jitter': statistics.stdev(latencies)
            }
        else:
            print("❌ Network latency test failed")
            
    async def test_websocket_connection(self):
        """Test WebSocket connection and RTT"""
        print("\n🔌 Testing WebSocket Connection...")
        
        try:
            async with websockets.connect(self.ws_url) as websocket:
                # Send ping messages and measure RTT
                for i in range(20):
                    start_time = time.time() * 1000
                    ping_msg = {
                        "event": "ping",
                        "data": {"timestamp": start_time}
                    }
                    await websocket.send(json.dumps(ping_msg))
                    
                    # Wait for response
                    try:
                        response = await asyncio.wait_for(websocket.recv(), timeout=2.0)
                        msg = json.loads(response)
                        if msg.get('event') == 'ping':
                            rtt = time.time() * 1000 - start_time
                            self.rtts.append(rtt)
                    except asyncio.TimeoutError:
                        print(f"⚠️  Ping {i+1} timed out")
                        
                    await asyncio.sleep(0.1)
                    
            if self.rtts:
                avg_rtt = statistics.mean(self.rtts)
                p95_rtt = statistics.quantiles(self.rtts, n=20)[18] if len(self.rtts) >= 5 else avg_rtt
                print(f"✅ WebSocket RTT: {avg_rtt:.1f}ms (P95: {p95_rtt:.1f}ms)")
                self.results['websocket_rtt'] = {'avg': avg_rtt, 'p95': p95_rtt}
            else:
                print("❌ WebSocket RTT test failed")
                
        except Exception as e:
            print(f"❌ WebSocket connection error: {e}")
            
    async def test_prediction_accuracy(self):
        """Test client-server prediction accuracy"""
        print("\n🎯 Testing Prediction Accuracy...")
        
        try:
            async with websockets.connect(self.ws_url) as websocket:
                # Join game
                join_msg = {
                    "event": "join_game",
                    "data": {"player_name": "TestBot"}
                }
                await websocket.send(json.dumps(join_msg))
                
                # Wait for join confirmation
                await asyncio.sleep(0.5)
                
                # Simulate player movement and track prediction accuracy
                position = {"x": 0, "y": 0, "z": 0}
                
                for i in range(50):
                    # Send movement input
                    movement = {"x": 0.1, "y": 0, "z": 0.1}
                    
                    # Client-side prediction
                    predicted_pos = {
                        "x": position["x"] + movement["x"],
                        "y": max(0, position["y"] + movement["y"]),
                        "z": position["z"] + movement["z"]
                    }
                    
                    input_msg = {
                        "event": "player_input",
                        "data": {
                            "input": movement,
                            "timestamp": time.time() * 1000,
                            "sequence": i
                        }
                    }
                    
                    start_time = time.time()
                    await websocket.send(json.dumps(input_msg))
                    self.messages_sent += 1
                    self.total_inputs += 1
                    
                    # Wait for server response
                    try:
                        while True:
                            response = await asyncio.wait_for(websocket.recv(), timeout=1.0)
                            msg = json.loads(response)
                            self.messages_received += 1
                            
                            if (msg.get('event') == 'server_position_update' or 
                                msg.get('event') == 'global_state_update'):
                                
                                processing_time = (time.time() - start_time) * 1000
                                self.server_processing_times.append(processing_time)
                                
                                # Check prediction accuracy
                                if msg.get('event') == 'server_position_update':
                                    server_pos = msg['data']['position']
                                    error = ((predicted_pos['x'] - server_pos['x'])**2 + 
                                            (predicted_pos['y'] - server_pos['y'])**2 + 
                                            (predicted_pos['z'] - server_pos['z'])**2)**0.5
                                    
                                    self.prediction_errors.append(error)
                                    
                                    if error > 0.3:  # Dynamic threshold
                                        self.reconciliations += 1
                                    
                                    position = server_pos
                                    
                                elif msg.get('event') == 'global_state_update':
                                    # Find our player in global state
                                    for player in msg.get('players', []):
                                        if player.get('name') == 'TestBot':
                                            server_pos = player['position']
                                            error = ((predicted_pos['x'] - server_pos['x'])**2 + 
                                                    (predicted_pos['y'] - server_pos['y'])**2 + 
                                                    (predicted_pos['z'] - server_pos['z'])**2)**0.5
                                            
                                            self.prediction_errors.append(error)
                                            
                                            if error > 0.3:
                                                self.reconciliations += 1
                                            
                                            position = server_pos
                                            break
                                break
                                
                    except asyncio.TimeoutError:
                        print(f"⚠️  Input {i+1} response timed out")
                        
                    await asyncio.sleep(0.05)  # 20fps input rate
                    
        except Exception as e:
            print(f"❌ Prediction accuracy test error: {e}")
            
        # Calculate results
        if self.prediction_errors:
            avg_error = statistics.mean(self.prediction_errors)
            reconciliation_rate = (self.reconciliations / self.total_inputs) * 100
            prediction_accuracy = max(0, 100 - (avg_error * 100))
            
            print(f"📈 Prediction Results:")
            print(f"   Average Error: {avg_error:.3f} units")
            print(f"   Reconciliation Rate: {reconciliation_rate:.1f}%")
            print(f"   Prediction Accuracy: {prediction_accuracy:.1f}%")
            print(f"   Total Inputs: {self.total_inputs}")
            print(f"   Reconciliations: {self.reconciliations}")
            
            self.results['prediction'] = {
                'avg_error': avg_error,
                'reconciliation_rate': reconciliation_rate,
                'prediction_accuracy': prediction_accuracy,
                'total_inputs': self.total_inputs,
                'reconciliations': self.reconciliations
            }
            
        if self.server_processing_times:
            avg_processing = statistics.mean(self.server_processing_times)
            p95_processing = statistics.quantiles(self.server_processing_times, n=20)[18] if len(self.server_processing_times) >= 5 else avg_processing
            print(f"⚡ Server Processing:")
            print(f"   Average: {avg_processing:.1f}ms")
            print(f"   P95: {p95_processing:.1f}ms")
            
    async def test_server_load(self):
        """Test server performance under load"""
        print("\n🚀 Testing Server Load (5 concurrent players)...")
        
        async def simulate_player(player_id: int):
            try:
                async with websockets.connect(self.ws_url) as websocket:
                    # Join game
                    join_msg = {
                        "event": "join_game", 
                        "data": {"player_name": f"Player{player_id}"}
                    }
                    await websocket.send(json.dumps(join_msg))
                    
                    # Send inputs for 10 seconds
                    for i in range(200):  # 20fps for 10 seconds
                        input_msg = {
                            "event": "player_input",
                            "data": {
                                "input": {"x": 0.1, "y": 0, "z": 0.1},
                                "timestamp": time.time() * 1000,
                                "sequence": i
                            }
                        }
                        await websocket.send(json.dumps(input_msg))
                        await asyncio.sleep(0.05)
                        
            except Exception as e:
                print(f"Player {player_id} error: {e}")
                
        start_time = time.time()
        await asyncio.gather(*[simulate_player(i) for i in range(5)])
        load_test_duration = time.time() - start_time
        
        print(f"✅ Load test completed in {load_test_duration:.1f}s")
        
        # Check server health after load test
        try:
            response = requests.get(f"{self.http_url}/health", timeout=5)
            if response.status_code == 200:
                health_data = response.json()
                print(f"📊 Post-load Server Health:")
                print(f"   Memory Usage: {health_data['memory_usage_mb']:.1f}MB")
                print(f"   CPU Usage: {health_data['cpu_percent']:.1f}%")
                self.results['load_test'] = health_data
        except Exception as e:
            print(f"⚠️  Post-load health check failed: {e}")
            
    def generate_report(self):
        """Generate final performance report with recommendations"""
        print("\n" + "="*50)
        print("📋 PERFORMANCE DIAGNOSTIC REPORT")
        print("="*50)
        
        # Overall Assessment
        issues = []
        recommendations = []
        
        # Network Quality Assessment
        if 'network_latency' in self.results:
            latency = self.results['network_latency']['avg']
            if latency > 100:
                issues.append(f"High network latency: {latency:.1f}ms")
                recommendations.append("Consider server location closer to users")
            else:
                print(f"✅ Network latency: EXCELLENT ({latency:.1f}ms)")
                
        # WebSocket Performance
        if 'websocket_rtt' in self.results:
            rtt = self.results['websocket_rtt']['avg']
            if rtt > 150:
                issues.append(f"High WebSocket RTT: {rtt:.1f}ms")
            else:
                print(f"✅ WebSocket RTT: GOOD ({rtt:.1f}ms)")
                
        # Prediction Accuracy
        if 'prediction' in self.results:
            pred = self.results['prediction']
            reconciliation_rate = pred['reconciliation_rate']
            avg_error = pred['avg_error']
            
            if reconciliation_rate > 10:
                issues.append(f"High reconciliation rate: {reconciliation_rate:.1f}%")
                recommendations.append("Review client-server physics synchronization")
            else:
                print(f"✅ Reconciliation rate: EXCELLENT ({reconciliation_rate:.1f}%)")
                
            if avg_error > 0.5:
                issues.append(f"High prediction error: {avg_error:.3f} units")
                recommendations.append("Improve client-side prediction algorithm")
            else:
                print(f"✅ Prediction accuracy: GOOD ({avg_error:.3f} unit error)")
                
        # Server Health
        if 'server_health' in self.results:
            health = self.results['server_health']
            memory = health['memory_usage_mb']
            cpu = health['cpu_percent']
            
            if memory > 500:
                issues.append(f"High memory usage: {memory:.1f}MB")
                recommendations.append("Investigate memory leaks")
            else:
                print(f"✅ Memory usage: GOOD ({memory:.1f}MB)")
                
            if cpu > 80:
                issues.append(f"High CPU usage: {cpu:.1f}%")
                recommendations.append("Optimize server processing")
            else:
                print(f"✅ CPU usage: GOOD ({cpu:.1f}%)")
                
        # Summary
        if not issues:
            print("\n🎉 OVERALL ASSESSMENT: EXCELLENT")
            print("All performance metrics are within optimal ranges!")
        else:
            print(f"\n⚠️  OVERALL ASSESSMENT: {len(issues)} ISSUES FOUND")
            print("\n🔍 Issues Identified:")
            for issue in issues:
                print(f"   • {issue}")
                
            print("\n💡 Recommendations:")
            for rec in recommendations:
                print(f"   • {rec}")
                
        print("\n" + "="*50)

async def main():
    diagnostics = PerformanceDiagnostics()
    await diagnostics.run_diagnostics()

if __name__ == "__main__":
    asyncio.run(main())
