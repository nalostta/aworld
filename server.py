from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit
import uuid
import os
import time

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'default-secret-key')
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

# Store active players with position, vertical velocity, and chat info
players = {}

# --- Wall Display State ---
wall_display_content = 'Welcome to AWorld!'

CHAT_EXPIRY_SECONDS = 15
GRAVITY = 0.025  # units per tick (synced with client controls.js)
JUMP_VELOCITY = 0.45  # units per jump (synced with client controls.js jumpForce)

def prune_expired_chats():
    now = time.time()
    for p in players.values():
        if 'chat_expiry' in p and p['chat_expiry'] and p['chat_expiry'] < now:
            p['chat_message'] = ''
            p['chat_expiry'] = None

def broadcast_global_state():
    prune_expired_chats()
    emit('global_state_update', list(players.values()), broadcast=True)

@app.route('/')
def index():
    return render_template('index.html')

# API to update wall display (admin or server-side only)
@app.route('/api/wall_display', methods=['POST'])
def update_wall_display():
    global wall_display_content
    data = request.get_json()
    content = data.get('content', '')
    wall_display_content = content
    socketio.emit('wall_display_update', {'content': content}, broadcast=True)
    return {'status': 'ok'}

@socketio.on('connect')
def handle_connect():
    print(f'Client connected: sid={request.sid}')

@socketio.on('disconnect')
def handle_disconnect():
    player = players.get(request.sid)
    if player:
        print(f"Client disconnected: sid={request.sid}, name={player['name']}")
        del players[request.sid]
        emit('player_disconnected', {'id': request.sid, 'name': player['name']}, broadcast=True)
        emit('player_count_update', {'count': len(players)}, broadcast=True)
        broadcast_global_state()
    else:
        print(f"Client disconnected: sid={request.sid}, name=UNKNOWN")

@socketio.on('player_join')
def handle_player_join(data):
    name = data.get('name', '').strip() if data.get('name') else ''
    color = data.get('color', '').strip() if data.get('color') else ''
    if not name or not color:
        print('Rejected player_join: missing name or color', data)
        emit('join_error', {'error': 'Missing name or color'}, room=request.sid)
        return
    player_id = str(uuid.uuid4())
    players[request.sid] = {
        'id': player_id,
        'name': name,
        'color': color,
        'position': {'x': 0, 'y': 0, 'z': 0},
        'vy': 0.0,
        'chat_message': '',
        'chat_expiry': None
    }
    emit('player_joined', players[request.sid], broadcast=True)
    emit('player_count_update', {'count': len(players)}, broadcast=True)
    emit('current_players', list(players.values()), room=request.sid)
    emit('wall_display_update', {'content': wall_display_content}, room=request.sid)
    broadcast_global_state()

@socketio.on('player_move')
def handle_player_move(data):
    if request.sid in players:
        client_pos = data['position']  # Client's proposed new center position
        player = players[request.sid]    # Server's current player state

        server_current_y_center = player['position']['y']
        server_ground_y_center = 1.0  # Player center Y when feet are at Y=0

        # Check if server considers player grounded
        is_server_grounded = abs(server_current_y_center - server_ground_y_center) < 0.05

        # Detect jump initiation from client's proposed Y position
        # If client wants to be significantly higher and server thought it was grounded, apply jump velocity.
        # Client's jumpForce is now synced with server's JUMP_VELOCITY.
        if client_pos['y'] > server_current_y_center + (JUMP_VELOCITY * 0.3) and is_server_grounded:
            player['vy'] = JUMP_VELOCITY
        
        # Apply gravity to server's vertical velocity
        player['vy'] -= GRAVITY

        # Calculate server's new Y position (center) based on its own physics
        new_server_y_center = server_current_y_center + player['vy']

        # Clamp to ground (player's center should be at server_ground_y_center)
        if new_server_y_center < server_ground_y_center:
            new_server_y_center = server_ground_y_center
            player['vy'] = 0  # Stop falling / reset velocity on ground

        # Update player state: use client's X/Z, but server's authoritative Y and vy
        player['position']['x'] = client_pos['x']
        player['position']['y'] = new_server_y_center
        player['position']['z'] = client_pos['z']
        # player['vy'] is already updated and part of the player state implicitly

        broadcast_global_state()

@socketio.on('chat_message')
def handle_chat_message(data):
    player = players.get(request.sid)
    if player:
        text = data['text'][:120]
        player['chat_message'] = text
        player['chat_expiry'] = time.time() + CHAT_EXPIRY_SECONDS
        broadcast_global_state()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    print(f"\nGame server running! Enter the game at: http://localhost:{port}/\n")
    socketio.run(app, host='0.0.0.0', port=port, debug=False)