#!/usr/bin/env python3
"""
Enhanced Performance Diagnostics for AWorld Game
Comprehensive testing suite to identify lag sources and performance bottlenecks
"""

import requests
import time
import statistics
import asyncio
import websockets
import json
import psutil
import matplotlib.pyplot as plt
import numpy as np
from typing import List, Dict, Tuple
from dataclasses import dataclass
from datetime import datetime
import os

@dataclass
class PerformanceMetrics:
    """Container for performance measurement data"""
    rtt_times: List[float]
    server_processing_times: List[float]
    network_latencies: List[float]
    cpu_usage: List[float]
    memory_usage: List[float]
    timestamps: List[float]
    reconciliation_events: int = 0
    dropped_messages: int = 0
    connection_drops: int = 0

class PerformanceTester:
    def __init__(self, test_duration: int = 30):
        self.test_duration = test_duration
        self.client_metrics = PerformanceMetrics([], [], [], [], [], [])
        
    def test_http_performance(self, url: str, num_tests: int = 20) -> Dict:
        """Enhanced HTTP latency testing with statistical analysis"""
        latencies = []
        failed_requests = 0
        
        print(f"🔄 Testing HTTP performance to {url} ({num_tests} requests)...")
        
        for i in range(num_tests):
            try:
                start = time.perf_counter()
                response = requests.get(f"{url}/health", timeout=10)
                end = time.perf_counter()
                
                if response.status_code == 200:
                    latency_ms = (end - start) * 1000
                    latencies.append(latency_ms)
                    print(f"  📊 Request {i+1}: {latency_ms:.1f}ms")
                else:
                    failed_requests += 1
                    print(f"  ❌ Request {i+1}: HTTP {response.status_code}")
                    
            except Exception as e:
                failed_requests += 1
                print(f"  ❌ Request {i+1}: {str(e)[:50]}...")
        
        if latencies:
            # Advanced statistical analysis
            p95 = np.percentile(latencies, 95)
            p99 = np.percentile(latencies, 99)
            
            return {
                "avg_latency_ms": statistics.mean(latencies),
                "median_latency_ms": statistics.median(latencies),
                "max_latency_ms": max(latencies),
                "min_latency_ms": min(latencies),
                "p95_latency_ms": p95,
                "p99_latency_ms": p99,
                "std_dev_ms": statistics.stdev(latencies) if len(latencies) > 1 else 0,
                "success_rate": len(latencies) / num_tests,
                "failed_requests": failed_requests,
                "jitter_ms": max(latencies) - min(latencies) if latencies else 0
            }
        else:
            return {"error": f"All {num_tests} requests failed"}

    def analyze_server_health(self, url: str) -> Dict:
        """Get comprehensive server performance metrics"""
        try:
            start_time = time.perf_counter()
            response = requests.get(f"{url}/health", timeout=10)
            response_time = (time.perf_counter() - start_time) * 1000
            
            if response.status_code == 200:
                data = response.json()
                data["response_time_ms"] = response_time
                return data
            else:
                return {"error": f"HTTP {response.status_code}", "response_time_ms": response_time}
        except Exception as e:
            return {"error": str(e)}

    async def test_websocket_comprehensive(self, ws_url: str) -> Dict:
        """Comprehensive WebSocket performance testing"""
        results = {
            "connection_successful": False,
            "round_trip_times": [],
            "server_processing_times": [],
            "network_latencies": [],
            "reconciliation_accuracy": [],
            "message_types_received": {},
            "disconnections": 0,
            "messages_sent": 0,
            "messages_received": 0,
            "position_updates_received": 0,
            "jitter_analysis": {},
            "connection_stability": {}
        }
        
        reconnection_attempts = 0
        max_reconnections = 3
        
        while reconnection_attempts <= max_reconnections:
            try:
                print(f"🔗 Connecting to WebSocket {ws_url}...")
                
                async with websockets.connect(ws_url, timeout=15) as websocket:
                    results["connection_successful"] = True
                    print(f"✅ WebSocket connected successfully")
                    
                    # Join as diagnostic player
                    join_message = {
                        "event": "player_join",
                        "data": {
                            "name": f"PerfBot_{int(time.time())}",
                            "color": "#00ff00"
                        }
                    }
                    await websocket.send(json.dumps(join_message))
                    
                    # Wait for join confirmation and initial messages
                    initial_messages = []
                    for _ in range(5):
                        try:
                            msg = await asyncio.wait_for(websocket.recv(), timeout=2.0)
                            initial_messages.append(json.loads(msg))
                        except (asyncio.TimeoutError, json.JSONDecodeError):
                            break
                    
                    print(f"📥 Received {len(initial_messages)} initial messages")
                    
                    # Performance testing loop
                    start_time = time.time()
                    sequence = 0
                    last_position = {"x": 0, "y": 0, "z": 0}
                    position_predictions = {}
                    
                    while time.time() - start_time < self.test_duration:
                        try:
                            # Send movement input
                            sequence += 1
                            send_time = time.perf_counter()
                            
                            # Simulate realistic movement
                            movement = {
                                "x": np.sin(sequence * 0.1) * 0.1,  # Smooth movement pattern
                                "y": 0.2 if sequence % 10 == 0 else 0,  # Occasional jump
                                "z": np.cos(sequence * 0.1) * 0.1
                            }
                            
                            # Predict position (client-side prediction simulation)
                            predicted_pos = {
                                "x": last_position["x"] + movement["x"],
                                "y": last_position["y"] + movement["y"],
                                "z": last_position["z"] + movement["z"]
                            }
                            position_predictions[sequence] = {
                                "predicted": predicted_pos,
                                "timestamp": send_time
                            }
                            
                            test_message = {
                                "event": "player_input",
                                "data": {
                                    "input": movement,
                                    "timestamp": send_time * 1000,
                                    "sequence": sequence
                                }
                            }
                            
                            await websocket.send(json.dumps(test_message))
                            results["messages_sent"] += 1
                            
                            # Listen for responses
                            try:
                                response = await asyncio.wait_for(websocket.recv(), timeout=1.5)
                                receive_time = time.perf_counter()
                                
                                try:
                                    response_data = json.loads(response)
                                    event_type = response_data.get('event', 'unknown')
                                    
                                    # Count message types
                                    results["message_types_received"][event_type] = results["message_types_received"].get(event_type, 0) + 1
                                    results["messages_received"] += 1
                                    
                                    if event_type == 'server_position_update':
                                        # Calculate performance metrics
                                        rtt = (receive_time - send_time) * 1000
                                        server_processing = response_data.get('data', {}).get('server_processing_time', 0)
                                        network_latency = (rtt - server_processing) / 2
                                        
                                        results["round_trip_times"].append(rtt)
                                        results["server_processing_times"].append(server_processing)
                                        results["network_latencies"].append(network_latency)
                                        results["position_updates_received"] += 1
                                        
                                        # Check prediction accuracy
                                        server_pos = response_data.get('data', {}).get('position', {})
                                        seq = response_data.get('data', {}).get('sequence', 0)
                                        
                                        if seq in position_predictions:
                                            predicted = position_predictions[seq]["predicted"]
                                            error = np.sqrt(
                                                (server_pos.get('x', 0) - predicted['x'])**2 +
                                                (server_pos.get('z', 0) - predicted['z'])**2
                                            )
                                            results["reconciliation_accuracy"].append(error)
                                            
                                            if error > 0.5:  # Reconciliation threshold
                                                print(f"🔄 Reconciliation needed: {error:.2f} units error")
                                        
                                        last_position = server_pos
                                        print(f"  📊 Input {sequence}: RTT={rtt:.1f}ms, Server={server_processing:.1f}ms, Net={network_latency:.1f}ms")
                                    
                                    elif event_type in ['global_state_update', 'player_count_update']:
                                        print(f"  ℹ️  Input {sequence}: Got {event_type}")
                                    
                                except json.JSONDecodeError:
                                    print(f"  ⚠️  Input {sequence}: Invalid JSON response")
                                
                            except asyncio.TimeoutError:
                                print(f"  ⏱️  Input {sequence}: Response timeout")
                            
                            # Wait before next input (simulate realistic input frequency)
                            await asyncio.sleep(0.05)  # 20fps input rate
                            
                        except websockets.exceptions.ConnectionClosed:
                            results["disconnections"] += 1
                            print(f"🔌 WebSocket disconnected during test")
                            break
                
                break  # Successful test completion
                
            except Exception as e:
                reconnection_attempts += 1
                print(f"❌ WebSocket test attempt {reconnection_attempts} failed: {e}")
                if reconnection_attempts <= max_reconnections:
                    print(f"🔄 Retrying in 2 seconds...")
                    await asyncio.sleep(2)
                else:
                    return {"error": f"Failed after {max_reconnections} attempts: {str(e)}"}
        
        # Calculate advanced metrics
        if results["round_trip_times"]:
            rtts = results["round_trip_times"]
            results["avg_rtt_ms"] = statistics.mean(rtts)
            results["median_rtt_ms"] = statistics.median(rtts)
            results["max_rtt_ms"] = max(rtts)
            results["min_rtt_ms"] = min(rtts)
            results["rtt_p95"] = np.percentile(rtts, 95)
            results["rtt_p99"] = np.percentile(rtts, 99)
            results["rtt_jitter"] = statistics.stdev(rtts) if len(rtts) > 1 else 0
            
            # Jitter analysis
            results["jitter_analysis"] = {
                "low_jitter_samples": len([r for r in rtts if abs(r - results["avg_rtt_ms"]) < 10]),
                "high_jitter_samples": len([r for r in rtts if abs(r - results["avg_rtt_ms"]) > 50]),
                "jitter_percentage": (results["rtt_jitter"] / results["avg_rtt_ms"] * 100) if results["avg_rtt_ms"] > 0 else 0
            }
        
        if results["reconciliation_accuracy"]:
            accuracies = results["reconciliation_accuracy"]
            results["prediction_accuracy"] = {
                "avg_error": statistics.mean(accuracies),
                "max_error": max(accuracies),
                "reconciliations_needed": len([a for a in accuracies if a > 0.5]),
                "accuracy_percentage": len([a for a in accuracies if a <= 0.1]) / len(accuracies) * 100
            }
        
        # Connection stability
        total_expected = results["messages_sent"]
        actual_responses = results["position_updates_received"]
        results["connection_stability"] = {
            "message_success_rate": (actual_responses / total_expected * 100) if total_expected > 0 else 0,
            "avg_response_rate": (results["messages_received"] / total_expected * 100) if total_expected > 0 else 0,
            "disconnection_rate": results["disconnections"]
        }
        
        return results

    def generate_performance_report(self, test_results: Dict) -> str:
        """Generate comprehensive performance analysis report"""
        report = []
        report.append("🔍 COMPREHENSIVE PERFORMANCE ANALYSIS")
        report.append("=" * 60)
        
        for environment, data in test_results.items():
            report.append(f"\n📊 {environment.upper()}")
            report.append("-" * 40)
            
            # HTTP Analysis
            if "http_performance" in data and "error" not in data["http_performance"]:
                http = data["http_performance"]
                report.append(f"🌐 HTTP Performance:")
                report.append(f"  • Average: {http['avg_latency_ms']:.1f}ms")
                report.append(f"  • P95: {http['p95_latency_ms']:.1f}ms")
                report.append(f"  • P99: {http['p99_latency_ms']:.1f}ms")
                report.append(f"  • Jitter: {http['jitter_ms']:.1f}ms")
                report.append(f"  • Success Rate: {http['success_rate']*100:.1f}%")
                
                # Analysis
                if http['avg_latency_ms'] > 200:
                    report.append("  ⚠️  HIGH LATENCY - Network/infrastructure issue")
                elif http['jitter_ms'] > 100:
                    report.append("  ⚠️  HIGH JITTER - Unstable network")
                else:
                    report.append("  ✅ HTTP performance is acceptable")
            
            # Server Health Analysis
            if "server_health" in data and "error" not in data["server_health"]:
                health = data["server_health"]
                if "server_metrics" in health:
                    metrics = health["server_metrics"]
                    report.append(f"\n🖥️  Server Health:")
                    report.append(f"  • Processing Time: {metrics['average_processing_time_ms']:.2f}ms")
                    report.append(f"  • CPU Usage: {metrics['current_cpu_percent']:.1f}%")
                    report.append(f"  • Memory Usage: {metrics['current_memory_percent']:.1f}%")
                    report.append(f"  • Inputs/sec: {metrics['inputs_per_second']:.1f}")
                    
                    # Analysis
                    issues = []
                    if metrics['average_processing_time_ms'] > 10:
                        issues.append("High processing time")
                    if metrics['current_cpu_percent'] > 80:
                        issues.append("High CPU usage")
                    if metrics['current_memory_percent'] > 85:
                        issues.append("High memory usage")
                    
                    if issues:
                        report.append(f"  ⚠️  Issues: {', '.join(issues)}")
                    else:
                        report.append("  ✅ Server performance is good")
            
            # WebSocket Analysis
            if "websocket_performance" in data and "error" not in data["websocket_performance"]:
                ws = data["websocket_performance"]
                
                if "avg_rtt_ms" in ws:
                    report.append(f"\n🔗 WebSocket Performance:")
                    report.append(f"  • Average RTT: {ws['avg_rtt_ms']:.1f}ms")
                    report.append(f"  • P95 RTT: {ws['rtt_p95']:.1f}ms")
                    report.append(f"  • Jitter: {ws['rtt_jitter']:.1f}ms")
                    report.append(f"  • Message Success: {ws['connection_stability']['message_success_rate']:.1f}%")
                    
                    if "prediction_accuracy" in ws:
                        acc = ws["prediction_accuracy"]
                        report.append(f"\n🎯 Prediction Accuracy:")
                        report.append(f"  • Average Error: {acc['avg_error']:.3f} units")
                        report.append(f"  • Accuracy: {acc['accuracy_percentage']:.1f}%")
                        report.append(f"  • Reconciliations: {acc['reconciliations_needed']}")
                    
                    # Analysis
                    issues = []
                    if ws['avg_rtt_ms'] > 150:
                        issues.append("High latency")
                    if ws['rtt_jitter'] > 50:
                        issues.append("High jitter")
                    if ws['connection_stability']['message_success_rate'] < 90:
                        issues.append("Message loss")
                    
                    if issues:
                        report.append(f"  ⚠️  Issues: {', '.join(issues)}")
                    else:
                        report.append("  ✅ WebSocket performance is excellent")
        
        # Recommendations
        report.append(f"\n🎯 RECOMMENDATIONS")
        report.append("=" * 60)
        
        # Compare environments if multiple available
        environments = list(test_results.keys())
        if len(environments) >= 2:
            local_env = next((env for env in environments if "local" in env.lower()), None)
            prod_env = next((env for env in environments if "production" in env.lower() or "heroku" in env.lower()), None)
            
            if local_env and prod_env:
                try:
                    local_rtt = test_results[local_env]["websocket_performance"]["avg_rtt_ms"]
                    prod_rtt = test_results[prod_env]["websocket_performance"]["avg_rtt_ms"]
                    
                    if prod_rtt > local_rtt * 3:
                        report.append("1. 🔴 INFRASTRUCTURE: Production significantly slower - upgrade hosting")
                    elif prod_rtt > local_rtt * 1.8:
                        report.append("1. 🟡 NETWORK: Some production latency - consider CDN/edge servers")
                    else:
                        report.append("1. ✅ INFRASTRUCTURE: Latency difference is reasonable")
                except KeyError:
                    pass
        
        report.append("2. 🔧 OPTIMIZATION SUGGESTIONS:")
        report.append("   • Monitor reconciliation frequency - should be <5% of inputs")
        report.append("   • Consider adaptive input frequency based on RTT")
        report.append("   • Implement client-side lag compensation for high-latency users")
        report.append("   • Add network quality detection and adaptation")
        
        report.append("\n3. 📊 MONITORING SETUP:")
        report.append("   • Set up automated performance testing")
        report.append("   • Monitor P95/P99 latencies, not just averages")
        report.append("   • Track prediction accuracy over time")
        report.append("   • Alert on jitter spikes >100ms")
        
        return "\n".join(report)

    def run_comprehensive_test(self):
        """Run the complete performance diagnostic suite"""
        print("🚀 Starting Comprehensive AWorld Performance Analysis")
        print("=" * 70)
        
        # Test configurations
        test_configs = [
            {
                "name": "Local Development",
                "http_url": "http://0.0.0.0:8000",
                "ws_url": "ws://0.0.0.0:8000/ws"
            },
            {
                "name": "Production Environment", 
                "http_url": "https://aworld.nalostta.studio",
                "ws_url": "wss://aworld.nalostta.studio/ws"
            }
        ]
        
        results = {}
        
        for config in test_configs:
            print(f"\n🔬 Testing {config['name']}")
            print("-" * 50)
            
            env_results = {}
            
            # HTTP Performance Test
            env_results["http_performance"] = self.test_http_performance(config["http_url"])
            
            # Server Health Check
            env_results["server_health"] = self.analyze_server_health(config["http_url"])
            
            # Comprehensive WebSocket Test
            try:
                env_results["websocket_performance"] = asyncio.run(
                    self.test_websocket_comprehensive(config["ws_url"])
                )
            except Exception as e:
                env_results["websocket_performance"] = {"error": str(e)}
            
            results[config["name"]] = env_results
        
        # Generate and display report
        report = self.generate_performance_report(results)
        print(f"\n{report}")
        
        # Save detailed results
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        # 📁 Save logs in organized logs folder
        logs_dir = os.path.join(os.path.dirname(__file__), "logs")
        os.makedirs(logs_dir, exist_ok=True)
        filename = os.path.join(logs_dir, f"performance_test_{timestamp}.json")
        
        with open(filename, 'w') as f:
            json.dump(results, f, indent=2, default=str)
        
        print(f"\n💾 Detailed results saved to: {filename}")
        
        return results

def main():
    """Main entry point for performance testing"""
    import argparse
    
    parser = argparse.ArgumentParser(description="AWorld Performance Diagnostics")
    parser.add_argument("--duration", type=int, default=20, help="Test duration in seconds")
    parser.add_argument("--local-only", action="store_true", help="Test local environment only")
    parser.add_argument("--production-only", action="store_true", help="Test production only")
    
    args = parser.parse_args()
    
    tester = PerformanceTester(test_duration=args.duration)
    results = tester.run_comprehensive_test()
    
    return results

if __name__ == "__main__":
    main()
