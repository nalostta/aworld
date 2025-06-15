# 1. server.py: line 0-19
- Flask initialization, configuration, and SocketIO setup.

# 2. server.py: line 36-43
- Flask route for updating wall display and emitting via SocketIO.

# 3. server.py: line 113-117
- Main entry point running the Flask-SocketIO server.

# 4. server.py: line 20-25
- prune_expired_chats: Handles chat expiry (I/O: mutates in-memory state, but not network).

# 5. server.py: line 27-29
- broadcast_global_state: Emits global state to all clients (network I/O).

# 6. server.py: line 32-33
- index: Renders the main HTML page (network I/O via render_template).

# 7. server.py: line 37-43
- update_wall_display: Receives POST, updates state, emits to clients (network I/O).

# 8. server.py: line 46-47
- handle_connect: Handles new SocketIO connection (network I/O).

# 9. server.py: line 50-59
- handle_disconnect: Handles SocketIO disconnect, emits events (network I/O).

# 10. server.py: line 62-83
- handle_player_join: Handles player join, emits events, updates state (network I/O).

# 11. server.py: line 86-103
- handle_player_move: Handles player movement, emits state (network I/O).

# 12. server.py: line 106-112
- handle_chat_message: Handles chat message, emits state (network I/O).

# 13. server.py: line 114-117
- Main entry point running the Flask-SocketIO server (network I/O).

# NOTE: All above snippets are related to network and I/O operations in server.py. No asyncio or custom HTTPS code is present.
