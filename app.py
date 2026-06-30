import asyncio
import threading
from src.models import app, db, Marker
from src.routers import register_routes
from src.telegram_bot import TelegramListener
from src.config import settings
import os
import re
import json
from src.websocket import socketio, init_socketio



DB_PATH = settings.DB_PATH
HGT_FOLDER = settings.HGT_FOLDER
KML_FOLDER = settings.KML_FOLDER
MBTILES_FOLDER = settings.MBTILES_FOLDER
UPLOAD_FOLDER = settings.UPLOAD_FOLDER

# ==================== ИНИЦИАЛИЗАЦИЯ WEBSOCKET ====================
init_socketio(app)  # Перенесено сюда, до использования socketio


# ==================== TELEGRAM БОТ ====================
class TelegramBot:
    def __init__(self):
        self.listener = None

    def start(self):
        """Запускает Telegram бота в отдельном потоке"""
        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

            self.listener = TelegramListener(app, db, Marker)
            loop.run_until_complete(self.listener.start())
            loop.run_forever()

        except Exception as e:
            print(f"❌ Ошибка запуска Telegram бота: {e}")

    def stop(self):
        """Останавливает Telegram бота"""
        if self.listener:
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    loop.run_until_complete(self.listener.stop())
            except (Exception,):
                pass


# ==================== ИНИЦИАЛИЗАЦИЯ БД ====================
def init_db():
    import sqlite3
    if os.path.exists(DB_PATH):
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(marker)")
        columns = [col[1] for col in cursor.fetchall()]
        conn.close()

        if 'created_at' not in columns:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute("ALTER TABLE marker ADD COLUMN created_at DATETIME")
            conn.commit()
            conn.close()

    with app.app_context():
        db.create_all()


# ==================== ЗАГРУЗКА HGT ФАЙЛОВ ====================
def load_hgt_files_from_folder():
    from src.models import HGTFile

    hgt_files = [f for f in os.listdir(HGT_FOLDER) if f.lower().endswith('.hgt')]

    if not hgt_files:
        print("ℹ️ HGT файлы не найдены в папке")
        return

    print(f"📁 Найдено {len(hgt_files)} HGT файлов")

    for filename in hgt_files:
        existing = HGTFile.query.filter_by(filename=filename).first()
        if existing:
            continue

        filepath = os.path.join(HGT_FOLDER, filename)
        name = filename.replace('.hgt', '')
        lat = None
        lng = None

        match = re.match(r'([NS])(\d+)([EW])(\d+)', name)
        if match:
            lat_dir, lat_val, lng_dir, lng_val = match.groups()
            lat = float(lat_val) * (1 if lat_dir == 'N' else -1)
            lng = float(lng_val) * (1 if lng_dir == 'E' else -1)

        hgt_file = HGTFile(
            name=name,
            filename=filename,
            filepath=filepath,
            latitude=lat,
            longitude=lng
        )
        db.session.add(hgt_file)
        print(f"   ✅ Загружен: {filename} ({lat}, {lng})")

    db.session.commit()
    print(f"✅ Загружено HGT файлов в БД: {len(hgt_files)}")


# ==================== ЗАГРУЗКА KML ФАЙЛОВ ====================
def load_kml_layers_from_folder():
    from src.models import KMLLayer
    from lib.utils import parse_kml_to_geojson

    kml_files = [f for f in os.listdir(KML_FOLDER) if f.lower().endswith('.kml')]

    if not kml_files:
        print("ℹ️ KML файлы не найдены в папке")
        return

    print(f"📁 Найдено {len(kml_files)} KML файлов")

    for filename in kml_files:
        existing = KMLLayer.query.filter_by(filename=filename).first()
        if existing:
            continue

        filepath = os.path.join(KML_FOLDER, filename)
        name = filename.replace('.kml', '')

        geojson = parse_kml_to_geojson(filepath)
        if geojson and len(geojson['features']) > 0:
            kml_layer = KMLLayer(
                name=name,
                filename=filename,
                filepath=filepath,
                visible=True
            )
            db.session.add(kml_layer)

            geojson_path = filepath + '.geojson'
            with open(geojson_path, 'w', encoding='utf-8') as f:
                json.dump(geojson, f, ensure_ascii=False, indent=2)

            print(f"   ✅ Загружен KML: {filename}")
        else:
            print(f"   ⚠️ Не удалось распарсить KML: {filename}")

    db.session.commit()
    print(f"✅ Загружено KML слоев в БД: {len(kml_files)}")

register_routes(app)
# ==================== ЗАПУСК ====================
if __name__ == "__main__":

    init_db()

    PORT = 5055

    print(f"📁 База данных: {DB_PATH}")
    print(f"📁 Загрузки: {UPLOAD_FOLDER}")
    print(f"📁 MBTiles: {MBTILES_FOLDER}")
    print(f"📁 HGT: {HGT_FOLDER}")
    print(f"📁 KML: {KML_FOLDER}")
    print("=" * 60)

    # Запуск Telegram бота
    bot = TelegramBot()

    try:
        print("📡 Запуск Telegram бота...")
        telegram_thread = threading.Thread(target=bot.start, daemon=True)
        telegram_thread.start()
        print("✅ Telegram бот запущен")
    except (Exception,):
        print("⚠️ Telegram credentials not configured. Bot not started.")

    # Загрузка данных
    with app.app_context():
        load_hgt_files_from_folder()
        load_kml_layers_from_folder()

    print("=" * 60)
    print(f"🌐 Откройте в браузере: http://127.0.0.1:{PORT}")
    print("=" * 60)

    socketio.run(app, debug=True, host="127.0.0.1", port=PORT, use_reloader=False, allow_unsafe_werkzeug=True)
