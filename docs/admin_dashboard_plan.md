# Admin Dashboard Implementation Plan

## Overview
Create a secure admin dashboard for monitoring, configuring, and managing the AWorld game server, with special focus on diagnosing lag and rubber-banding issues through player position recording.

---

## 1. Architecture & Security

### 1.1 Authentication System
- **Admin Token Authentication**: Environment variable-based admin token (`ADMIN_TOKEN`)
- **Session Management**: Secure session cookies with expiration
- **Access Control**: Middleware to protect all `/admin/*` routes
- **Login Page**: Simple authentication form at `/admin/login`

### 1.2 Technology Stack
- **Backend**: Extend existing FastAPI server with admin routes
- **Frontend**: Modern web dashboard using:
  - HTML5 + Tailwind CSS for styling
  - Chart.js for real-time graphs and visualizations
  - Socket.IO/WebSocket for live data streaming
  - Vanilla JavaScript (consistent with existing codebase)

### 1.3 Route Structure
```
/admin/login          - Authentication page
/admin/dashboard      - Main dashboard (protected)
/admin/api/*          - REST API endpoints for configuration
/admin/ws             - WebSocket for real-time monitoring
```

---

## 2. Core Features

### 2.1 Real-Time Monitoring Panel

#### Player Monitoring
- **Active Players List**
  - Player ID, username, connection time
  - Current position (X, Y, Z)
  - Ping/RTT to server
  - Last activity timestamp
  - Kick/ban controls

#### Server Metrics
- **Performance Metrics**
  - CPU usage (%)
  - Memory usage (MB)
  - Active WebSocket connections
  - Messages per second (in/out)
  - Average server processing time
  
- **Network Metrics**
  - Total bandwidth usage
  - Average RTT across all players
  - Packet loss rate
  - Message queue depth

#### Game State
- **World State**
  - Total players online
  - Players by region/location
  - Active game sessions
  - Server uptime

### 2.2 Position Recording System

#### Recording Configuration
- **Recording Controls**
  - Start/Stop recording button
  - Recording interval (default: 100ms, configurable 50ms-1000ms)
  - Auto-stop after duration (e.g., 5 minutes)
  - Target players: All, Specific player, or Sample (every Nth player)
  - Sampling modes switch based on server load (all players, round-robin subset, priority list)

#### Data Collection
- **Recorded Data Points**
  - Timestamp (milliseconds precision)
  - Player ID
  - Position (X, Y, Z)
  - Velocity (vX, vY, vZ) if available
  - Input state (keys pressed)
  - Server processing time for that update
  - Client-reported RTT

#### Storage Options
- **In-Memory Buffer**: Last N recordings (configurable, default 10,000 entries)
- **Back-Pressure Queue**: Bounded buffer that drops oldest/newest samples when full and surfaces a "recording throttled" alert
- **File Export**: 
  - JSON format for detailed analysis
  - CSV format for spreadsheet analysis
  - Automatic compression for large datasets

#### Visualization
- **Position Heatmap**: 2D top-down view showing player movement patterns
- **Timeline Playback**: Scrub through recorded positions over time
- **Player Trails**: Visual paths showing movement history
- **Anomaly Detection**: Highlight rubber-banding events (large position jumps)
- **Performance Overlays**: Indicate when samples were skipped due to server load or buffer limits

### 2.3 Configuration Management

#### Server Configuration
- **Physics Settings**
  - Gravity constant
  - Jump velocity
  - Terminal velocity
  - Movement speed multipliers
  
- **Network Settings**
  - Broadcast throttle rate
  - Position update frequency
  - Reconciliation threshold
  - Message compression settings

#### Game Rules
- **World Settings**
  - World boundaries
  - Spawn points
  - Collision detection toggle
  
- **Player Settings**
  - Max players
  - Default spawn position
  - Player timeout duration

#### Configuration Actions
- **Save/Load Presets**: Store configuration profiles
- **Apply Changes**: Hot-reload without server restart where possible
- **Reset to Defaults**: Restore factory settings
- **Export/Import**: JSON configuration files

### 2.4 Log Viewer

#### Real-Time Logs
- **Log Levels**: Debug, Info, Warning, Error, Critical
- **Filtering**: By level, player ID, time range, keyword search
- **Auto-scroll**: Toggle for live log streaming
- **Export**: Download logs as text file

#### Event Types
- Player connections/disconnections
- Position updates
- Reconciliation events
- Error messages
- Performance warnings (high CPU, memory, etc.)

### 2.5 Analytics Dashboard

#### Performance Graphs (Last 1h/24h/7d)
- **Server Performance**
  - CPU usage over time
  - Memory usage over time
  - Message throughput (messages/sec)
  
- **Network Performance**
  - Average RTT over time
  - Packet loss rate
  - Bandwidth usage

#### Player Analytics
- **Engagement Metrics**
  - Concurrent players over time
  - Average session duration
  - Peak player times
  
- **Movement Analytics**
  - Most visited areas (heatmap)
  - Average player velocity
  - Jump frequency

#### Lag Analysis
- **Rubber-Banding Detection**
  - Reconciliation frequency per player
  - Average position error magnitude
  - Players with highest reconciliation rate
  
- **Correlation Analysis**
  - RTT vs reconciliation rate
  - Server load vs lag incidents
  - Time-of-day patterns

---

## 3. Implementation Phases

### Phase 1: Foundation (Day 1-2)
**Goal**: Basic dashboard with authentication

- [ ] Create admin authentication system
  - Environment variable for admin token
  - Login page with session management
  - Protected route middleware
  
- [ ] Build dashboard skeleton
  - HTML template with Tailwind CSS
  - Navigation structure
  - Responsive layout
  
- [ ] Implement basic monitoring
  - Active players list
  - Server metrics (CPU, memory)
  - Connection count

**Files to Create/Modify**:
- `server.py` - Add admin routes and authentication
- `static/admin/login.html` - Login page
- `static/admin/dashboard.html` - Main dashboard
- `static/admin/js/dashboard.js` - Dashboard logic
- `static/admin/css/admin.css` - Custom styles (if needed beyond Tailwind)
- `.env.example` - Document ADMIN_TOKEN variable

### Phase 2: Position Recording (Day 3-4)
**Goal**: Core recording functionality

- [ ] Implement recording system
  - In-memory circular buffer for position data
  - Start/stop recording controls
  - Configurable recording interval
  
- [ ] Add data export
  - JSON export endpoint
  - CSV export endpoint
  - Compression for large files
  
- [ ] Build visualization
  - 2D position heatmap
  - Timeline scrubber
  - Player trail renderer

**Files to Create/Modify**:
- `server.py` - Add recording endpoints and data structures
- `utils/position_recorder.py` - Recording logic class
- `static/admin/dashboard.html` - Add recording UI
- `static/admin/js/recorder.js` - Recording controls and visualization

### Phase 3: Configuration Management (Day 5-6)
**Goal**: Dynamic server configuration

- [ ] Build configuration UI
  - Form inputs for all settings
  - Validation and error handling
  - Save/load preset system
  
- [ ] Implement backend handlers
  - Configuration update endpoints
  - Hot-reload logic where possible
  - Configuration persistence (JSON file)
  
- [ ] Add configuration history
  - Track configuration changes
  - Rollback capability
  - Change audit log

**Files to Create/Modify**:
- `server.py` - Add configuration endpoints
- `utils/config_manager.py` - Configuration management class
- `config/server_config.json` - Persistent configuration
- `static/admin/dashboard.html` - Add configuration panel
- `static/admin/js/config.js` - Configuration UI logic

### Phase 4: Analytics & Visualization (Day 7-8)
**Goal**: Advanced monitoring and insights

- [ ] Implement real-time graphs
  - Chart.js integration
  - CPU/Memory/Network graphs
  - Player count over time
  
- [ ] Add analytics calculations
  - Rubber-banding detection algorithm
  - Performance correlation analysis
  - Anomaly detection
  
- [ ] Build log viewer
  - Real-time log streaming via WebSocket
  - Filtering and search
  - Export functionality

**Files to Create/Modify**:
- `server.py` - Add analytics endpoints and WebSocket streaming
- `utils/analytics.py` - Analytics calculation logic
- `static/admin/dashboard.html` - Add analytics panels
- `static/admin/js/analytics.js` - Charts and visualizations
- `static/admin/js/logs.js` - Log viewer logic

### Phase 5: Polish & Testing (Day 9-10)
**Goal**: Production-ready dashboard

- [ ] Security hardening
  - Rate limiting on admin endpoints
  - CSRF protection
  - Input sanitization
  
- [ ] Performance optimization
  - Efficient data structures for recording
  - WebSocket message batching
  - Client-side data caching
  
- [ ] Documentation
  - Admin user guide
  - API documentation
  - Configuration reference
  
- [ ] Testing
  - Unit tests for recording system
  - Integration tests for admin endpoints
  - Load testing with multiple admins

**Files to Create/Modify**:
- `docs/admin_dashboard_guide.md` - User documentation
- `unit_tests/test_admin_dashboard.py` - Test suite
- `server.py` - Security enhancements
- All admin files - Final polish and optimization

---

## 4. Technical Specifications

### 4.1 Position Recording Data Structure

```python
{
    "recording_id": "uuid-string",
    "start_time": "2024-01-01T00:00:00Z",
    "end_time": "2024-01-01T00:05:00Z",
    "interval_ms": 100,
    "entries": [
        {
            "timestamp": 1704067200000,
            "player_id": "player123",
            "position": {"x": 10.5, "y": 1.0, "z": -5.2},
            "velocity": {"x": 0.1, "y": 0.0, "z": -0.05},
            "input_state": {"w": true, "space": false},
            "server_processing_ms": 2.3,
            "client_rtt_ms": 45
        },
        // ... more entries
    ],
    "metadata": {
        "total_entries": 3000,
        "unique_players": 5,
        "recording_reason": "lag_investigation"
    }
}
```

### 4.2 WebSocket Message Format

```javascript
// Server -> Admin Dashboard
{
    "type": "server_metrics",
    "data": {
        "cpu_percent": 25.5,
        "memory_mb": 128.3,
        "active_connections": 12,
        "messages_per_sec": 240,
        "avg_processing_ms": 1.8
    },
    "timestamp": 1704067200000
}

// Admin Dashboard -> Server
{
    "type": "start_recording",
    "config": {
        "interval_ms": 100,
        "duration_sec": 300,
        "target_players": "all"
    }
}
```

### 4.3 API Endpoints

```
POST   /admin/api/auth/login          - Authenticate admin
POST   /admin/api/auth/logout         - End admin session

GET    /admin/api/players             - List all active players
POST   /admin/api/players/:id/kick    - Kick a player
POST   /admin/api/players/:id/ban     - Ban a player

GET    /admin/api/metrics             - Get current server metrics
GET    /admin/api/metrics/history     - Get historical metrics

POST   /admin/api/recording/start     - Start position recording
POST   /admin/api/recording/stop      - Stop position recording
GET    /admin/api/recording/status    - Get recording status
GET    /admin/api/recording/export    - Export recorded data

GET    /admin/api/config              - Get current configuration
PUT    /admin/api/config              - Update configuration
POST   /admin/api/config/reset        - Reset to defaults
GET    /admin/api/config/presets      - List saved presets
POST   /admin/api/config/presets      - Save current as preset

GET    /admin/api/logs                - Get recent logs (paginated)
WS     /admin/ws                      - WebSocket for real-time updates
```

---

## 5. Security Considerations

### Authentication
- Admin token stored in environment variable (never in code)
- Secure session cookies with HTTP-only flag
- Session timeout after 1 hour of inactivity
- Failed login attempt rate limiting

### Authorization
- All `/admin/*` routes require valid session
- API endpoints validate session on every request
- WebSocket connection requires authentication token

### Data Protection
- Sensitive data (player IPs) masked by default
- Recording data stored temporarily, auto-deleted after 24h
- Configuration changes logged with admin identifier
- No player passwords or sensitive info exposed

### Rate Limiting
- Admin API: 100 requests per minute per session
- Recording export: 5 requests per minute
- WebSocket messages: 10 messages per second
- Recording system: Enforce `MAX_RECORDING_QPS`, `MAX_ACTIVE_RECORDINGS`, and `MAX_BUFFER_ENTRIES`; skip frames when server tick exceeds threshold or CPU > 70%
- Export operations: Throttle large JSON/CSV streams to avoid blocking event loop; postpone heavy exports until recording stops

---

## 6. UI/UX Design Guidelines

### Layout
- **Sidebar Navigation**: Quick access to all sections
- **Top Bar**: Server status, admin user, logout
- **Main Content**: Dashboard panels with cards
- **Responsive**: Works on desktop and tablet (mobile optional)

### Color Scheme
- **Primary**: Blue (#3B82F6) - Actions, links
- **Success**: Green (#10B981) - Healthy status
- **Warning**: Yellow (#F59E0B) - Warnings
- **Danger**: Red (#EF4444) - Errors, critical
- **Neutral**: Gray (#6B7280) - Text, borders

### Components
- **Cards**: White background, subtle shadow, rounded corners
- **Buttons**: Clear labels, loading states, disabled states
- **Forms**: Inline validation, helpful error messages
- **Graphs**: Interactive, tooltips, zoom/pan
- **Tables**: Sortable, filterable, pagination

### Real-Time Updates
- **Smooth Transitions**: Animate value changes
- **Visual Feedback**: Flash on update, pulse on alert
- **Connection Status**: Indicator for WebSocket connection
- **Auto-Refresh**: Configurable refresh intervals

---

## 7. Success Metrics

### Functionality
- [ ] Admin can authenticate securely
- [ ] Dashboard displays real-time server metrics
- [ ] Position recording captures data at configured intervals
- [ ] Recorded data can be exported in multiple formats
- [ ] Configuration changes apply without server restart
- [ ] Rubber-banding events are detected and highlighted

### Performance
- [ ] Dashboard loads in < 2 seconds
- [ ] Real-time updates have < 100ms latency
- [ ] Recording system handles 50+ players at 100ms intervals
- [ ] No measurable impact on game server performance

### Usability
- [ ] Admin can diagnose lag issues within 5 minutes
- [ ] Configuration changes are intuitive and well-documented
- [ ] Visualizations clearly show problem areas
- [ ] Export data is ready for external analysis tools

---

## 8. Future Enhancements (Post-MVP)

### Advanced Features
- **Multi-Admin Support**: Role-based access control
- **Alerts & Notifications**: Email/SMS on critical events
- **Automated Actions**: Auto-kick laggy players, auto-scale resources
- **Historical Playback**: Replay entire game sessions
- **Machine Learning**: Predict lag before it happens
- **Mobile App**: Native iOS/Android admin app

### Integrations
- **Monitoring Tools**: Prometheus, Grafana integration
- **Cloud Services**: AWS CloudWatch, Google Cloud Monitoring
- **Chat Integration**: Discord/Slack notifications
- **Analytics Platforms**: Export to BigQuery, Elasticsearch

### Advanced Analytics
- **Player Behavior Analysis**: Detect cheating, unusual patterns
- **Performance Profiling**: Identify code bottlenecks
- **A/B Testing**: Compare different server configurations
- **Predictive Maintenance**: Forecast server issues

---

## 9. Development Environment Setup

### Prerequisites
- Python 3.9+
- FastAPI server running
- Modern web browser (Chrome, Firefox, Safari)

### Environment Variables
```bash
ADMIN_TOKEN=your-secure-random-token-here
ADMIN_SESSION_SECRET=another-secure-random-token
RECORDING_MAX_ENTRIES=10000
RECORDING_AUTO_DELETE_HOURS=24
```

### Dependencies to Add
```
# requirements.txt additions
python-multipart  # For form data
python-jose       # For JWT tokens (if using)
passlib          # For password hashing (if needed)
```

### Development Workflow
1. Create feature branch: `git checkout -b feature/admin-dashboard`
2. Implement phase incrementally
3. Test each feature thoroughly
4. Document as you go
5. Code review before merge
6. Deploy to staging first

---

## 10. Deployment Checklist

### Pre-Deployment
- [ ] Set strong ADMIN_TOKEN in production environment
- [ ] Configure HTTPS for admin routes
- [ ] Set up firewall rules (restrict admin access by IP if possible)
- [ ] Test authentication flow
- [ ] Verify recording system doesn't impact game performance
- [ ] Test with production-like player load

### Post-Deployment
- [ ] Monitor dashboard performance
- [ ] Check for memory leaks in recording system
- [ ] Verify WebSocket connections are stable
- [ ] Test configuration changes in production
- [ ] Document any production-specific settings

### Monitoring
- [ ] Set up alerts for admin authentication failures
- [ ] Monitor admin API response times
- [ ] Track recording system resource usage
- [ ] Log all configuration changes

---

## Conclusion

This admin dashboard will provide comprehensive tools to diagnose and resolve lag/rubber-banding issues through detailed position recording and real-time monitoring. The phased implementation approach ensures steady progress with testable milestones at each stage.

**Estimated Total Development Time**: 8-10 days for full implementation
**Priority**: Phase 1 (Foundation) + Phase 2 (Position Recording) for immediate lag diagnosis
