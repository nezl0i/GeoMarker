import asyncio
import threading
from models import app, db, Marker, KMLLayer, HGTFile, MBTilesLayer
from telegram_bot import TelegramListener, parse_message_content
from flask import render_template, request, jsonify, send_file
from pyproj import Transformer
import os
import json
import sqlite3
import io
import re
from datetime import datetime
import xml.etree.ElementTree as ET
from config import TelegramSettings

settings = TelegramSettings()

# Получаем переменные из .env
DB_PATH = settings.DB_PATH
HGT_FOLDER = settings.HGT_FOLDER
KML_FOLDER = settings.KML_FOLDER
MBTILES_FOLDER = settings.MBTILES_FOLDER
UPLOAD_FOLDER = settings.UPLOAD_FOLDER

# ==================== TELEGRAM БОТ ====================

class TelegramBot:
    def __init__(self):
        self.listener = None


    def start(self):
        """Запускает Telegram бота в отдельном потоке"""
        try:
            # Создаем новый event loop для потока
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

            # Инициализируем слушателя
            self.listener = TelegramListener(app, db, Marker)

            # Запускаем
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

# ==================== СОЗДАНИЕ ТАБЛИЦ ====================
def init_db():

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


init_db()

# ==================== ЗАГРУЗКА HGT ФАЙЛОВ ====================
def load_hgt_files_from_folder():
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


# ==================== ПАРСИНГ KML ====================
def parse_kml_to_geojson(filepath):
    """Парсит KML файл и возвращает GeoJSON"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()

        if not content.strip():
            print("❌ KML файл пуст")
            return None

        try:
            tree = ET.parse(filepath)
            root = tree.getroot()
        except ET.ParseError as e:
            print(f"❌ Ошибка парсинга XML: {e}")
            content = content.replace('\ufeff', '').strip()
            try:
                root = ET.fromstring(content)
            except (Exception,):
                print("❌ Не удалось распарсить XML")
                return None

        ns = {'kml': 'http://www.opengis.net/kml/2.2'}
        placemarks = root.findall('.//kml:Placemark', ns)

        if not placemarks:
            placemarks = root.findall('.//Placemark')
            ns = {}

        if not placemarks:
            print("❌ Placemark не найдены в KML файле")
            return parse_kml_by_regex(content)

        features = []

        for placemark in placemarks:
            name_elem = placemark.find('name' if not ns else 'kml:name', ns)
            name = name_elem.text if name_elem is not None else 'Без названия'

            point = placemark.find('Point' if not ns else 'kml:Point', ns)
            line = placemark.find('LineString' if not ns else 'kml:LineString', ns)
            polygon = placemark.find('Polygon' if not ns else 'kml:Polygon', ns)
            multi_geom = placemark.find('MultiGeometry' if not ns else 'kml:MultiGeometry', ns)

            geometry = None
            geometry_type = None

            if multi_geom is not None:
                point = multi_geom.find('Point' if not ns else 'kml:Point', ns) or point
                line = multi_geom.find('LineString' if not ns else 'kml:LineString', ns) or line
                polygon = multi_geom.find('Polygon' if not ns else 'kml:Polygon', ns) or polygon

            if point is not None:
                coords_elem = point.find('coordinates' if not ns else 'kml:coordinates', ns)
                if coords_elem is not None and coords_elem.text:
                    coords_text = coords_elem.text.strip()
                    coords_parts = coords_text.split(',')
                    if len(coords_parts) >= 2:
                        try:
                            lng = float(coords_parts[0].strip())
                            lat = float(coords_parts[1].strip())
                            geometry = [lng, lat]
                            geometry_type = 'Point'
                        except ValueError:
                            pass

            elif line is not None:
                coords_elem = line.find('coordinates' if not ns else 'kml:coordinates', ns)
                if coords_elem is not None and coords_elem.text:
                    coords_text = coords_elem.text.strip()
                    points = []
                    for coord in coords_text.split():
                        parts = coord.split(',')
                        if len(parts) >= 2:
                            try:
                                points.append([float(parts[0].strip()), float(parts[1].strip())])
                            except ValueError:
                                continue
                    if points:
                        geometry = points
                        geometry_type = 'LineString'

            elif polygon is not None:
                outer = polygon.find('outerBoundaryIs' if not ns else 'kml:outerBoundaryIs', ns)
                if outer is not None:
                    ring = outer.find('LinearRing' if not ns else 'kml:LinearRing', ns)
                    if ring is not None:
                        coords_elem = ring.find('coordinates' if not ns else 'kml:coordinates', ns)
                        if coords_elem is not None and coords_elem.text:
                            coords_text = coords_elem.text.strip()
                            points = []
                            for coord in coords_text.split():
                                parts = coord.split(',')
                                if len(parts) >= 2:
                                    try:
                                        points.append([float(parts[0].strip()), float(parts[1].strip())])
                                    except ValueError:
                                        continue
                            if points:
                                geometry = [points]
                                geometry_type = 'Polygon'

            if geometry and geometry_type:
                feature = {
                    "type": "Feature",
                    "properties": {
                        "name": name,
                        "description": "KML слой"
                    },
                    "geometry": {
                        "type": geometry_type,
                        "coordinates": geometry
                    }
                }
                features.append(feature)

        print(f"📊 Всего объектов в KML: {len(features)}")

        if features:
            return {
                "type": "FeatureCollection",
                "features": features
            }
        else:
            return parse_kml_by_regex(content)

    except Exception as e:
        print(f"❌ Error parsing KML: {e}")
        return None


def parse_kml_by_regex(content):
    """Альтернативный парсинг KML через регулярные выражения"""
    print("🔍 Пробуем парсинг через регулярные выражения...")

    features = []

    placemark_pattern = r'<Placemark[^>]*>(.*?)</Placemark>'
    placemarks = re.findall(placemark_pattern, content, re.DOTALL)

    if not placemarks:
        placemark_pattern = r'<kml:Placemark[^>]*>(.*?)</kml:Placemark>'
        placemarks = re.findall(placemark_pattern, content, re.DOTALL)

    print(f"📄 Найдено Placemark блоков: {len(placemarks)}")

    for placemark_content in placemarks:
        name_match = re.search(r'<name>(.*?)</name>', placemark_content, re.DOTALL)
        name = name_match.group(1).strip() if name_match else 'Без названия'

        point_match = re.search(r'<Point[^>]*>.*?<coordinates>(.*?)</coordinates>.*?</Point>', placemark_content,
                                re.DOTALL)
        if point_match:
            coords_text = point_match.group(1).strip()
            coords_parts = coords_text.split(',')
            if len(coords_parts) >= 2:
                try:
                    lng = float(coords_parts[0].strip())
                    lat = float(coords_parts[1].strip())
                    geometry = [lng, lat]
                    geometry_type = 'Point'
                    features.append({
                        "type": "Feature",
                        "properties": {"name": name},
                        "geometry": {"type": geometry_type, "coordinates": geometry}
                    })
                    continue
                except ValueError:
                    pass

        line_match = re.search(r'<LineString[^>]*>.*?<coordinates>(.*?)</coordinates>.*?</LineString>',
                               placemark_content, re.DOTALL)
        if line_match:
            coords_text = line_match.group(1).strip()
            points = []
            for coord in coords_text.split():
                parts = coord.split(',')
                if len(parts) >= 2:
                    try:
                        points.append([float(parts[0].strip()), float(parts[1].strip())])
                    except ValueError:
                        continue
            if points:
                features.append({
                    "type": "Feature",
                    "properties": {"name": name},
                    "geometry": {"type": "LineString", "coordinates": points}
                })
                continue

        polygon_match = re.search(
            r'<Polygon[^>]*>.*?<LinearRing[^>]*>.*?<coordinates>(.*?)</coordinates>.*?</LinearRing>.*?</Polygon>',
            placemark_content, re.DOTALL)
        if polygon_match:
            coords_text = polygon_match.group(1).strip()
            points = []
            for coord in coords_text.split():
                parts = coord.split(',')
                if len(parts) >= 2:
                    try:
                        points.append([float(parts[0].strip()), float(parts[1].strip())])
                    except ValueError:
                        continue
            if points:
                features.append({
                    "type": "Feature",
                    "properties": {"name": name},
                    "geometry": {"type": "Polygon", "coordinates": [points]}
                })

    print(f"📊 Всего объектов найдено через regex: {len(features)}")

    if features:
        return {
            "type": "FeatureCollection",
            "features": features
        }

    return None


# ==================== ТРАНСФОРМЕРЫ КООРДИНАТ ====================
transformer_wgs84_to_sk42 = Transformer.from_crs("EPSG:4326", "EPSG:28406", always_xy=True)
transformer_sk42_to_wgs84 = Transformer.from_crs("EPSG:28406", "EPSG:4326", always_xy=True)


# ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
def secure_filename(filename):
    filename = re.sub(r'[^a-zA-Z0-9_.-]', '_', filename)
    return filename


def read_hgt_elevation(filepath, lat, lng):
    try:
        if not os.path.exists(filepath):
            return None

        file_size = os.path.getsize(filepath)

        if file_size == 1201 * 1201 * 2:
            size = 1201
        elif file_size == 3601 * 3601 * 2:
            size = 3601
        else:
            size = 1201

        filename = os.path.basename(filepath)
        match = re.match(r'([NS])(\d+)([EW])(\d+)', filename.replace('.hgt', ''))
        if not match:
            return None

        lat_dir, lat_val, lng_dir, lng_val = match.groups()
        base_lat = float(lat_val) * (1 if lat_dir == 'N' else -1)
        base_lng = float(lng_val) * (1 if lng_dir == 'E' else -1)

        lat_diff = lat - base_lat
        lng_diff = lng - base_lng

        if lat_diff < 0 or lat_diff > 1 or lng_diff < 0 or lng_diff > 1:
            return None

        row = int((1 - lat_diff) * (size - 1))
        col = int(lng_diff * (size - 1))

        if row >= size or col >= size:
            return None

        with open(filepath, 'rb') as f:
            f.seek((row * size + col) * 2)
            data = f.read(2)
            if data:
                elevation = int.from_bytes(data, byteorder='big', signed=True)
                if elevation == -32768:
                    return None
                return elevation

        return None

    except (Exception,):
        return None


# ==================== МАРШРУТЫ ====================
@app.route("/")
def index():
    return render_template("index.html")


# ---------- API для меток ----------
@app.route("/api/markers", methods=["GET"])
def get_markers():
    markers = Marker.query.all()
    return jsonify([m.to_dict() for m in markers])


@app.route("/api/markers", methods=["POST"])
def add_marker():
    data = request.get_json()
    lat = data.get("lat")
    lng = data.get("lng")
    label = data.get("label", "")

    if lat is None or lng is None:
        return jsonify({"error": "Missing lat/lng"}), 400

    marker = Marker(lat=lat, lng=lng, label=label, created_at=datetime.now())
    db.session.add(marker)
    db.session.commit()

    return jsonify(marker.to_dict()), 201


@app.route("/api/markers/<int:marker_id>", methods=["PUT"])
def update_marker(marker_id):
    data = request.get_json()
    label = data.get("label")

    marker = db.session.get(Marker, marker_id)  # Исправлено
    if not marker:
        return jsonify({"error": "Marker not found"}), 404

    if label is not None:
        marker.label = label
        db.session.commit()

    return jsonify(marker.to_dict()), 200


@app.route("/api/markers/<int:marker_id>", methods=["DELETE"])
def delete_marker(marker_id):
    marker = db.session.get(Marker, marker_id)  # Исправлено
    if not marker:
        return jsonify({"error": "Marker not found"}), 404

    db.session.delete(marker)
    db.session.commit()
    return jsonify({"message": "Deleted"}), 200


@app.route("/api/markers/clear", methods=["POST"])
def clear_markers():
    Marker.query.delete()
    db.session.commit()
    return jsonify({"message": "All markers cleared"}), 200


# ---------- API для конвертации ----------
@app.route("/api/convert", methods=["POST"])
def convert_coordinates():
    data = request.get_json()
    from_system = data.get("from")

    try:
        if from_system == "wgs84_to_sk42":
            lat = data.get("lat")
            lng = data.get("lng")

            if lat is None or lng is None:
                return jsonify({"error": "Missing lat/lng"}), 400

            y_sk42, x_sk42 = transformer_wgs84_to_sk42.transform(lng, lat)

            return jsonify({
                "x": round(x_sk42, 2),
                "y": round(y_sk42, 2),
                "lat": lat,
                "lng": lng
            })

        elif from_system == "sk42_to_wgs84":
            x = data.get("x")
            y = data.get("y")

            if x is None or y is None:
                return jsonify({"error": "Missing x/y"}), 400

            lng_wgs84, lat_wgs84 = transformer_sk42_to_wgs84.transform(y, x)

            return jsonify({
                "lat": round(lat_wgs84, 7),
                "lng": round(lng_wgs84, 7),
                "x": x,
                "y": y
            })

        else:
            return jsonify({"error": "Invalid from_system"}), 400

    except (Exception,) as e:
        return jsonify({"error": str(e)}), 500


# ---------- API для MBTiles ----------
@app.route("/api/mbtiles/upload", methods=["POST"])
def upload_mbtiles():
    try:
        if 'file' not in request.files:
            return jsonify({"error": "No file uploaded"}), 400

        file = request.files['file']
        if file.filename == '':
            return jsonify({"error": "No file selected"}), 400

        if not file.filename.endswith('.mbtiles'):
            return jsonify({"error": "File must be .mbtiles"}), 400

        filename = secure_filename(file.filename)
        filepath = os.path.join(MBTILES_FOLDER, filename)
        file.save(filepath)

        # Проверяем MBTiles
        try:
            conn = sqlite3.connect(filepath)
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='tiles'")
            if not cursor.fetchone():
                os.remove(filepath)
                return jsonify({"error": "Invalid MBTiles: table 'tiles' not found"}), 400

            cursor.execute("SELECT COUNT(*) FROM tiles")
            count = cursor.fetchone()[0]

            if count == 0:
                os.remove(filepath)
                return jsonify({"error": "MBTiles has no tiles"}), 400

            conn.close()
        except Exception as e:
            os.remove(filepath)
            return jsonify({"error": f"Invalid MBTiles: {str(e)}"}), 400

        name = request.form.get('name', filename.replace('.mbtiles', ''))

        layer = MBTilesLayer(
            name=name,
            filename=filename,
            filepath=filepath,
            visible=True
        )
        db.session.add(layer)
        db.session.commit()

        return jsonify({
            "id": layer.id,
            "name": layer.name,
            "filename": layer.filename,
            "tiles_count": count,
            "message": "MBTiles uploaded successfully"
        }), 201

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/mbtiles/layers", methods=["GET"])
def get_mbtiles_layers():
    layers = MBTilesLayer.query.all()
    return jsonify([l.to_dict() for l in layers])


@app.route("/api/mbtiles/layers/<int:layer_id>", methods=["DELETE"])
def delete_mbtiles_layer(layer_id):
    layer = db.session.get(MBTilesLayer, layer_id)  # Исправлено
    if not layer:
        return jsonify({"error": "Layer not found"}), 404

    try:
        if os.path.exists(layer.filepath):
            os.remove(layer.filepath)
    except:
        pass

    db.session.delete(layer)
    db.session.commit()
    return jsonify({"message": "Layer deleted"}), 200


@app.route("/api/mbtiles/layers/<int:layer_id>/toggle", methods=["POST"])
def toggle_mbtiles_layer(layer_id):
    layer = db.session.get(MBTilesLayer, layer_id)
    if not layer:
        return jsonify({"error": "Layer not found"}), 404

    layer.visible = not layer.visible
    db.session.commit()
    return jsonify({"visible": layer.visible}), 200


@app.route("/api/mbtiles/layers/<int:layer_id>/info", methods=["GET"])
def get_mbtiles_layer_info(layer_id):
    layer = db.session.get(MBTilesLayer, layer_id)
    if not layer:
        return jsonify({"error": "Layer not found"}), 404

    try:
        conn = sqlite3.connect(layer.filepath)
        cursor = conn.cursor()
        cursor.execute("SELECT DISTINCT zoom_level FROM tiles ORDER BY zoom_level")
        zoom_levels = [row[0] for row in cursor.fetchall()]
        cursor.execute("SELECT COUNT(*) FROM tiles")
        total_tiles = cursor.fetchone()[0]
        conn.close()

        return jsonify({
            "zoom_levels": zoom_levels,
            "total_tiles": total_tiles,
            "min_zoom": min(zoom_levels) if zoom_levels else None,
            "max_zoom": max(zoom_levels) if zoom_levels else None
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/mbtiles/tiles/<int:layer_id>/<int:z>/<int:x>/<int:y>")
def get_mbtiles_tile(layer_id, z, x, y):
    layer = db.session.get(MBTilesLayer, layer_id)  # Исправлено
    if not layer or not layer.visible:
        return jsonify({"error": "Layer not found or not visible"}), 404

    try:
        if not os.path.exists(layer.filepath):
            return jsonify({"error": "File not found"}), 404

        conn = sqlite3.connect(layer.filepath)
        cursor = conn.cursor()

        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='tiles'")
        if not cursor.fetchone():
            conn.close()
            return jsonify({"error": "Table 'tiles' not found"}), 404

        cursor.execute("PRAGMA table_info(tiles)")
        columns = [col[1] for col in cursor.fetchall()]

        zoom_col = 'zoom_level' if 'zoom_level' in columns else 'z' if 'z' in columns else None
        col_col = 'tile_column' if 'tile_column' in columns else 'x' if 'x' in columns else None
        row_col = 'tile_row' if 'tile_row' in columns else 'y' if 'y' in columns else None
        data_col = 'tile_data' if 'tile_data' in columns else 'data' if 'data' in columns else None

        if not all([zoom_col, col_col, row_col, data_col]):
            conn.close()
            return jsonify({"error": "Invalid tiles table structure"}), 404

        query = f"SELECT {data_col} FROM tiles WHERE {zoom_col}=? AND {col_col}=? AND {row_col}=?"
        cursor.execute(query, (z, x, y))
        tile = cursor.fetchone()

        if not tile:
            y_tms = (1 << z) - 1 - y
            cursor.execute(query, (z, x, y_tms))
            tile = cursor.fetchone()

        conn.close()

        if tile:
            return send_file(
                io.BytesIO(tile[0]),
                mimetype='image/png',
                as_attachment=False
            )
        else:
            return '', 204

    except Exception as e:
        print(f"❌ Ошибка получения тайла: {e}")
        return jsonify({"error": str(e)}), 500


# ---------- API для HGT ----------
@app.route("/api/hgt/upload", methods=["POST"])
def upload_hgt():
    try:
        if 'file' not in request.files:
            return jsonify({"error": "No file uploaded"}), 400

        file = request.files['file']
        if file.filename == '':
            return jsonify({"error": "No file selected"}), 400

        if not file.filename.endswith('.hgt'):
            return jsonify({"error": "File must be .hgt"}), 400

        filename = secure_filename(file.filename)
        filepath = os.path.join(HGT_FOLDER, filename)
        file.save(filepath)

        name = file.filename.replace('.hgt', '')
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
        db.session.commit()

        return jsonify(hgt_file.to_dict()), 201

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/hgt/files", methods=["GET"])
def get_hgt_files():
    files = HGTFile.query.all()
    return jsonify([f.to_dict() for f in files])


@app.route("/api/hgt/files/<int:file_id>", methods=["DELETE"])
def delete_hgt_file(file_id):
    hgt_file = db.session.get(HGTFile, file_id)  # Исправлено
    if not hgt_file:
        return jsonify({"error": "File not found"}), 404

    try:
        if os.path.exists(hgt_file.filepath):
            os.remove(hgt_file.filepath)
    except:
        pass

    db.session.delete(hgt_file)
    db.session.commit()
    return jsonify({"message": "File deleted"}), 200


@app.route("/api/hgt/elevation", methods=["POST"])
def get_hgt_elevation():
    data = request.get_json()
    lat = data.get("lat")
    lng = data.get("lng")

    if lat is None or lng is None:
        return jsonify({"error": "Missing coordinates"}), 400

    files = HGTFile.query.all()

    for hgt_file in files:
        if hgt_file.latitude is not None and hgt_file.longitude is not None:
            lat_diff = abs(lat - hgt_file.latitude)
            lng_diff = abs(lng - hgt_file.longitude)

            if lat_diff < 1 and lng_diff < 1:
                try:
                    elevation = read_hgt_elevation(hgt_file.filepath, lat, lng)
                    if elevation is not None:
                        return jsonify({
                            "elevation": elevation,
                            "source": hgt_file.name
                        })
                except Exception as e:
                    continue

    return jsonify({"error": "No HGT data available"}), 404


# ---------- API для KML ----------
@app.route("/api/kml/upload", methods=["POST"])
def upload_kml():
    try:
        if 'file' not in request.files:
            return jsonify({"error": "No file uploaded"}), 400

        file = request.files['file']
        if file.filename == '':
            return jsonify({"error": "No file selected"}), 400

        if not file.filename.endswith('.kml'):
            return jsonify({"error": "File must be .kml"}), 400

        filename = secure_filename(file.filename)
        filepath = os.path.join(KML_FOLDER, filename)
        file.save(filepath)

        print(f"📄 Сохранен KML файл: {filepath}")

        geojson = parse_kml_to_geojson(filepath)

        if geojson is None:
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()[:500]
                print(f"📄 Первые 500 символов файла:\n{content}")
            return jsonify({"error": "Failed to parse KML file"}), 400

        if len(geojson['features']) == 0:
            return jsonify({"error": "No objects found in KML file"}), 400

        name = request.form.get('name', filename.replace('.kml', ''))

        kml_layer = KMLLayer(
            name=name,
            filename=filename,
            filepath=filepath,
            visible=True
        )
        db.session.add(kml_layer)
        db.session.commit()

        print(f"✅ KML слой сохранен в БД: ID={kml_layer.id}, name={kml_layer.name}")

        geojson_path = filepath + '.geojson'
        with open(geojson_path, 'w', encoding='utf-8') as f:
            json.dump(geojson, f, ensure_ascii=False, indent=2)

        return jsonify({
            "id": kml_layer.id,
            "name": kml_layer.name,
            "filename": kml_layer.filename,
            "geojson": geojson,
            "message": "KML file uploaded successfully"
        }), 201

    except Exception as e:
        print(f"❌ Ошибка загрузки KML: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/kml/layers", methods=["GET"])
def get_kml_layers():
    layers = KMLLayer.query.all()
    return jsonify([l.to_dict() for l in layers])


@app.route("/api/kml/layers/<int:layer_id>", methods=["DELETE"])
def delete_kml_layer(layer_id):
    layer = db.session.get(KMLLayer, layer_id)
    if not layer:
        return jsonify({"error": "Layer not found"}), 404

    try:
        if os.path.exists(layer.filepath):
            os.remove(layer.filepath)
        geojson_path = layer.filepath + '.geojson'
        if os.path.exists(geojson_path):
            os.remove(geojson_path)
    except (Exception,):
        pass

    db.session.delete(layer)
    db.session.commit()
    return jsonify({"message": "Layer deleted"}), 200


@app.route("/api/kml/layers/<int:layer_id>/toggle", methods=["POST"])
def toggle_kml_layer(layer_id):
    layer = db.session.get(KMLLayer, layer_id)
    if not layer:
        return jsonify({"error": "Layer not found"}), 404

    layer.visible = not layer.visible
    db.session.commit()
    return jsonify({"visible": layer.visible}), 200


@app.route("/api/kml/layers/<int:layer_id>/geojson", methods=["GET"])
def get_kml_geojson(layer_id):
    layer = db.session.get(KMLLayer, layer_id)
    if not layer:
        return jsonify({"error": "Layer not found"}), 404

    geojson_path = layer.filepath + '.geojson'
    if not os.path.exists(geojson_path):
        return jsonify({"error": "GeoJSON not found"}), 404

    with open(geojson_path, 'r', encoding='utf-8') as f:
        geojson = json.load(f)

    return jsonify(geojson)


@app.route("/api/telegram/markers", methods=["POST"])
def add_telegram_marker():
    """Добавляет метку из Telegram сообщения"""
    data = request.get_json()

    try:
        x_val = data.get('x_value')
        y_val = data.get('y_value')
        agent = data.get('agent', 'Unknown')
        # message_text = data.get('message_text', '')
        message_date = data.get('message_date', datetime.now().isoformat())

        if not x_val or not y_val:
            return jsonify({"error": "Missing coordinates"}), 400

        # Конвертируем СК42 в WGS84
        x_float = float(x_val)
        y_float = float(y_val)
        lng, lat = transformer_sk42_to_wgs84.transform(x_float, y_float)

        # Формируем название метки
        label = f"{agent} | {message_date}"

        # Сохраняем в БД
        marker = Marker(
            lat=lat,
            lng=lng,
            label=label,
            created_at=datetime.now()
        )
        db.session.add(marker)
        db.session.commit()

        return jsonify(marker.to_dict()), 201

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/telegram/test", methods=["POST"])
def test_telegram_message():
    """Тестовый эндпоинт для имитации сообщения из Telegram"""
    data = request.get_json()
    text = data.get('text', '')
    message_date = data.get('date', datetime.now().isoformat())

    parsed = parse_message_content(text, message_date)

    if parsed:
        return jsonify(parsed), 200
    else:
        return jsonify({"error": "No data parsed"}), 400


# app.py - добавляем новый маршрут

@app.route("/api/markers/latest", methods=["GET"])
def get_latest_markers():
    """Возвращает метки, добавленные после указанного времени"""
    after = request.args.get('after')

    try:
        if after:
            # Парсим время из запроса
            after_time = datetime.fromisoformat(after.replace('Z', '+00:00'))
            markers = Marker.query.filter(Marker.created_at > after_time).order_by(Marker.created_at.desc()).all()
        else:
            markers = Marker.query.order_by(Marker.created_at.desc()).limit(10).all()

        return jsonify([m.to_dict() for m in markers])
    except Exception as e:
        print(f"❌ Ошибка получения последних меток: {e}")
        return jsonify([]), 200


@app.route("/api/markers/refresh", methods=["POST"])
def refresh_markers():
    """Принудительное обновление меток на фронтенде"""
    data = request.get_json()
    marker_id = data.get('marker_id')

    if marker_id:
        marker = db.session.get(Marker, marker_id)
        if marker:
            return jsonify({"status": "refreshed", "marker": marker.to_dict()}), 200

    return jsonify({"status": "ok"}), 200


# ==================== ЗАПУСК ====================
if __name__ == "__main__":

    print(f"📁 База данных: {DB_PATH}")
    print(f"📁 Загрузки: {UPLOAD_FOLDER}")
    print(f"📁 MBTiles: {MBTILES_FOLDER}")
    print(f"📁 HGT: {HGT_FOLDER}")
    print(f"📁 KML: {KML_FOLDER}")
    print("=" * 60)

    # Запускаем Telegram бота в отдельном потоке
    bot = TelegramBot()
    try:
        print("📡 Запуск Telegram бота...")
        telegram_thread = threading.Thread(target=bot.start, daemon=True)
        telegram_thread.start()
        print("✅ Telegram бот запущен")
    except (Exception,):
        print("⚠️ Telegram credentials not configured. Bot not started.")

    with app.app_context():
        load_hgt_files_from_folder()
        load_kml_layers_from_folder()

    PORT = 5000

    print("=" * 60)
    print(f"🌐 Откройте в браузере: http://127.0.0.1:{PORT}")
    print("=" * 60)
    app.run(debug=True, host="127.0.0.1", port=PORT, use_reloader=False)
