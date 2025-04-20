from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit
import uuid
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'default-secret-key')
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

# Store active players
players = {}

@app.route('/')
def index():
    return render_template('index.html')

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
    else:
        print(f"Client disconnected: sid={request.sid}, name=UNKNOWN")

@socketio.on('player_join')
def handle_player_join(data):
    player_id = str(uuid.uuid4())
    players[request.sid] = {
        'id': player_id,
        'name': data['name'],
        'color': data['color'],
        'position': {'x': 0, 'y': 0, 'z': 0}
    }
    emit('player_joined', players[request.sid], broadcast=True)
    emit('current_players', list(players.values()))

@socketio.on('player_move')
def handle_player_move(data):
    if request.sid in players:
        players[request.sid]['position'] = data['position']
        emit('player_moved', {
            'id': players[request.sid]['id'],
            'position': data['position']
        }, broadcast=True)

@socketio.on('chat_message')
def handle_chat_message(data):
    player = players.get(request.sid)
    if player:
        # Enforce 120 character limit
        text = data['text'][:120]
        message = {
            'id': player['id'],
            'name': player['name'],
            'color': player['color'],
            'text': text
        }
        emit('chat_message', message, broadcast=True)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    socketio.run(app, host='0.0.0.0', port=port, debug=False) 