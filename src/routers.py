import re
import os
import io
import json
import sqlite3
from flask import render_template, request, jsonify, send_file
from src.models import db, Marker, MBTilesLayer, HGTFile, KMLLayer
from src.telegram_bot import parse_message_content
from pyproj import Transformer
from lib.utils import secure_filename, read_hgt_elevation, parse_kml_to_geojson
from datetime import datetime, timezone, timedelta
from src.config import settings
from src.websocket import emit_new_marker

# Пути из настроек
DB_PATH = settings.DB_PATH
HGT_FOLDER = settings.HGT_FOLDER
KML_FOLDER = settings.KML_FOLDER
MBTILES_FOLDER = settings.MBTILES_FOLDER

MOSCOW_TZ = timezone(timedelta(hours=3))

# ==================== ТРАНСФОРМЕРЫ КООРДИНАТ ====================
transformer_wgs84_to_sk42 = Transformer.from_crs("EPSG:4326", "EPSG:28406", always_xy=True)
transformer_sk42_to_wgs84 = Transformer.from_crs("EPSG:28406", "EPSG:4326", always_xy=True)


# ==================== РЕГИСТРАЦИЯ РОУТЕРОВ ====================
def register_routes(app):
    """Регистрирует все маршруты в приложении"""

    # ---------- Главная страница ----------
    @app.route("/")
    def index():
        return render_template("pages/index.html")

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

        marker = Marker(lat=lat, lng=lng, label=label, created_at=datetime.now(timezone.utc))
        db.session.add(marker)
        db.session.commit()

        return jsonify(marker.to_dict()), 201

    @app.route("/api/markers/<int:marker_id>", methods=["PUT"])
    def update_marker(marker_id):
        data = request.get_json()
        label = data.get("label")

        marker = db.session.get(Marker, marker_id)
        if not marker:
            return jsonify({"error": "Marker not found"}), 404

        if label is not None:
            marker.label = label
            db.session.commit()

        return jsonify(marker.to_dict()), 200

    @app.route("/api/markers/<int:marker_id>", methods=["DELETE"])
    def delete_marker(marker_id):
        marker = db.session.get(Marker, marker_id)
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

    @app.route("/api/markers/latest", methods=["GET"])
    def get_latest_markers():
        """Возвращает метки, добавленные после указанного времени"""
        after = request.args.get('after')

        try:
            if after:
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
        data = request.get_json()
        marker_id = data.get('marker_id')

        if marker_id:
            marker = db.session.get(Marker, marker_id)
            if marker:
                # Отправляем через WebSocket
                emit_new_marker(marker.to_dict())
                return jsonify({"status": "refreshed", "marker": marker.to_dict()}), 200

        return jsonify({"status": "ok"}), 200

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
        layer = db.session.get(MBTilesLayer, layer_id)
        if not layer:
            return jsonify({"error": "Layer not found"}), 404

        try:
            if os.path.exists(layer.filepath):
                os.remove(layer.filepath)
        except (Exception,):
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
        layer = db.session.get(MBTilesLayer, layer_id)
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
        hgt_file = db.session.get(HGTFile, file_id)
        if not hgt_file:
            return jsonify({"error": "File not found"}), 404

        try:
            if os.path.exists(hgt_file.filepath):
                os.remove(hgt_file.filepath)
        except (Exception,):
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
                    except (Exception, ) as e:
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

    # ---------- API для Telegram ----------
    @app.route("/api/telegram/markers", methods=["POST"])
    def add_telegram_marker():
        """Добавляет метку из Telegram сообщения"""
        data = request.get_json()

        try:
            x_val = data.get('x_value')
            y_val = data.get('y_value')
            agent = data.get('agent', 'Unknown')
            message_date = data.get('message_date', datetime.now(timezone.utc).isoformat())

            if not x_val or not y_val:
                return jsonify({"error": "Missing coordinates"}), 400

            x_float = float(x_val)
            y_float = float(y_val)
            lng, lat = transformer_sk42_to_wgs84.transform(x_float, y_float)

            label = f"{agent} | {message_date}"

            marker = Marker(
                lat=lat,
                lng=lng,
                label=label,
                created_at=datetime.now(MOSCOW_TZ)
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
        message_date = data.get('date', datetime.now(timezone.utc).isoformat())

        parsed = parse_message_content(text, message_date)

        if parsed:
            return jsonify(parsed), 200
        else:
            return jsonify({"error": "No data parsed"}), 400

    print("✅ Все маршруты зарегистрированы")
