# AWorld Performance Testing Suite

## Overview

This directory contains comprehensive performance testing tools for the AWorld multiplayer game to identify lag sources and optimize performance.

## Files

- `test_performance_diagnostics.py` - Main performance testing suite
- `README.md` - This documentation

## Usage

### Basic Test
```bash
cd unit_tests
python test_performance_diagnostics.py
```

### Advanced Options
```bash
# Test for 60 seconds
python test_performance_diagnostics.py --duration 60

# Test only local environment
python test_performance_diagnostics.py --local-only

# Test only production environment  
python test_performance_diagnostics.py --production-only
```

## What It Tests

### 🌐 HTTP Performance
- Average, P95, P99 latencies
- Success rates and failed requests
- Network jitter analysis
- Response time consistency

### 🖥️ Server Health
- CPU and memory usage
- Input processing times
- Throughput metrics
- Server-side bottlenecks

### 🔗 WebSocket Performance  
- Round-trip times (RTT)
- Network latency vs server processing
- Message success rates
- Connection stability

### 🎯 Game-Specific Metrics
- **Client-side prediction accuracy**
- **Reconciliation frequency**
- **Input-to-response timing**
- **Position update consistency**

### 📊 Advanced Analysis
- **Jitter analysis** (network stability)
- **P95/P99 percentiles** (tail latency)
- **Prediction error tracking**
- **Message type distribution**

## Interpreting Results

### ✅ Good Performance Indicators
- RTT < 100ms average
- Jitter < 20ms
- Prediction accuracy > 95%
- Message success rate > 95%
- Server processing < 5ms

### ⚠️ Warning Signs
- RTT 100-200ms (acceptable but monitor)
- Jitter 20-50ms (some instability)
- Reconciliation rate > 10%
- CPU usage > 70%

### 🔴 Critical Issues
- RTT > 200ms (poor user experience)
- Jitter > 50ms (very unstable)
- Message loss > 10%
- Frequent disconnections
- Server processing > 20ms

## Architecture vs Infrastructure Issues

| Symptom | Architecture Issue | Infrastructure Issue |
|---------|-------------------|---------------------|
| High RTT | ❌ | ✅ Network/hosting |
| High server processing time | ✅ Code efficiency | ✅ CPU overload |
| High reconciliation rate | ✅ Prediction tuning | ❌ |
| Message loss | ❌ | ✅ Connection quality |
| High jitter | ❌ | ✅ Network instability |

## Output Files

Tests generate detailed JSON reports:
- `performance_test_YYYYMMDD_HHMMSS.json` - Complete test results
- Console output with analysis and recommendations

## Folder Structure

```
unit_tests/
├── README.md                           # This documentation
├── test_performance_diagnostics.py     # Main diagnostic tool
├── debug_prediction_mismatch.py        # Physics debugging utility
└── logs/                              # Test results and logs
    ├── performance_test_YYYYMMDD_HHMMSS.json
    └── ... (historical test results)
```

Test results are automatically saved to `unit_tests/logs/` with timestamps for easy tracking and comparison over time.

## Dependencies

Install required packages:
```bash
pip install matplotlib numpy websockets psutil
```

## Troubleshooting

### Common Issues

1. **WebSocket connection fails**
   - Ensure server is running: `uvicorn server:app --host 0.0.0.0 --port 8000`
   - Check firewall settings
   - Verify WebSocket endpoint `/ws`

2. **HTTP 404 errors**
   - Server may not have `/health` endpoint
   - Check server logs for errors
   - Verify URL configuration

3. **Import errors**
   - Install missing dependencies: `pip install -r requirements.txt`
   - Check Python version compatibility

### Server Requirements

The test requires your server to:
- Respond to `GET /health` with JSON metrics
- Accept WebSocket connections on `/ws`
- Handle `player_join` and `player_input` events
- Send `server_position_update` responses

## Integration with CI/CD

Add to your deployment pipeline:
```bash
# Performance regression testing
python unit_tests/test_performance_diagnostics.py --duration 30 --production-only
```

Set up alerts for:
- P95 RTT > 150ms
- Prediction accuracy < 90%
- Server processing > 10ms
- Connection success rate < 95%
