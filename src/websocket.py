import asyncio
from flask_socketio import SocketIO, emit

socketio = SocketIO(cors_allowed_origins="*")

def init_socketio(app):
    socketio.init_app(app)

def emit_new_marker(marker_data):
    """Отправляет новую метку всем клиентам"""
    socketio.emit('new_marker', marker_data)
