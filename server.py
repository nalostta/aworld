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
GRAVITY = 0.02  # units per tick
JUMP_VELOCITY = 0.25  # units per jump

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
        pos = data['position']
        player = players[request.sid]
        # Detect jump: if y > ground and vy == 0, treat as jump
        if pos['y'] > 0.01 and player['position']['y'] <= 0.01 and abs(player['vy']) < 1e-5:
            player['vy'] = JUMP_VELOCITY
        # Apply gravity
        player['vy'] -= GRAVITY
        # Update y position
        new_y = player['position']['y'] + player['vy']
        # Clamp to ground
        if new_y <= 0:
            new_y = 0
            player['vy'] = 0
        # Update position
        player['position'] = {'x': pos['x'], 'y': new_y, 'z': pos['z']}
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