# utils.py

import os
import re
import json
import xml.etree.ElementTree as ET


def secure_filename(filename):
    """Безопасное имя файла"""
    filename = re.sub(r'[^a-zA-Z0-9_.-]', '_', filename)
    return filename


def read_hgt_elevation(filepath, lat, lng):
    """Читает высоту из HGT файла"""
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