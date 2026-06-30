// static/js/layers.js

// Загрузка MBTiles слоев
async function loadMbtilesLayers() {
    try {
        var res = await fetch(API.mbtiles + '/layers');
        var layers = await res.json();

        var list = getElement('layersList');
        if (!list) return;

        var oldItems = list.querySelectorAll('[data-layer-type="mbtiles"]');
        oldItems.forEach(function(item) { item.remove(); });

        layers.forEach(function(layer) {
            var div = createLayerListItem(layer, 'mbtiles', '🗺️', APP_CONFIG.colors.mbtiles);
            list.appendChild(div);

            if (layer.visible && !mbtilesLayers[layer.id]) {
                addMbtilesLayer(layer);
            } else if (layer.visible && mbtilesLayers[layer.id]) {
                mbtilesLayers[layer.id].setVisible(true);
            }
        });
        log('MBTiles слои загружены', 'success');
    } catch(e) {
        log('Ошибка загрузки MBTiles: ' + e.message, 'error');
    }
}

// Добавление MBTiles слоя
function addMbtilesLayer(layer) {
    if (mbtilesLayers[layer.id]) {
        mbtilesLayers[layer.id].setVisible(true);
        return;
    }

    var tileLayer = new ol.layer.Tile({
        source: new ol.source.XYZ({
            url: API.mbtiles + '/tiles/' + layer.id + '/{z}/{x}/{y}',
            projection: 'EPSG:3857'
        })
    });

    map.addLayer(tileLayer);
    mbtilesLayers[layer.id] = tileLayer;
    log('MBTiles слой "' + layer.name + '" добавлен', 'success');
}

// Удаление MBTiles слоя
function removeMbtilesLayer(layerId) {
    if (mbtilesLayers[layerId]) {
        map.removeLayer(mbtilesLayers[layerId]);
        delete mbtilesLayers[layerId];
        log('MBTiles слой удалён', 'info');
    }
}

// Загрузка KML слоев
async function loadKmlLayers() {
    try {
        var res = await fetch(API.kml + '/layers');
        var layers = await res.json();

        if (layers.length === 0) return;

        var list = getElement('layersList');
        if (!list) return;

        var oldItems = list.querySelectorAll('[data-layer-type="kml"]');
        oldItems.forEach(function(item) { item.remove(); });

        for (var i = 0; i < layers.length; i++) {
            var layer = layers[i];
            var div = createLayerListItem(layer, 'kml', '📄', APP_CONFIG.colors.kml);
            list.appendChild(div);

            if (layer.visible && !kmlLayers[layer.id]) {
                await addKmlLayer(layer);
            } else if (layer.visible && kmlLayers[layer.id]) {
                kmlLayers[layer.id].setVisible(true);
            }
        }
        log('KML слои загружены', 'success');
    } catch(e) {
        log('Ошибка загрузки KML: ' + e.message, 'error');
    }
}

// Добавление KML слоя
async function addKmlLayer(layerData) {
    try {
        if (kmlLayers[layerData.id]) {
            kmlLayers[layerData.id].setVisible(true);
            return;
        }

        var res = await fetch(API.kml + '/layers/' + layerData.id + '/geojson');
        if (!res.ok) {
            log('Ошибка получения GeoJSON: ' + res.status, 'error');
            return;
        }

        var geojson = await res.json();
        if (!geojson.features || geojson.features.length === 0) {
            log('Нет объектов в KML', 'warning');
            return;
        }

        var vectorSource = new ol.source.Vector();
        var features = new ol.format.GeoJSON().readFeatures(geojson, {
            featureProjection: 'EPSG:3857',
            dataProjection: 'EPSG:4326'
        });

        features.forEach(function(feature) {
            vectorSource.addFeature(feature);
        });

        var vectorLayer = new ol.layer.Vector({
            source: vectorSource,
            style: function(feature) {
                var geometryType = feature.getGeometry().getType();
                var color = APP_CONFIG.colors.kml;

                if (geometryType === 'Point') {
                    return new ol.style.Style({
                        image: new ol.style.Circle({
                            radius: 8,
                            fill: new ol.style.Fill({ color: color }),
                            stroke: new ol.style.Stroke({ color: '#ffffff', width: 2 })
                        }),
                        text: new ol.style.Text({
                            text: feature.get('name') || '',
                            font: '12px Arial',
                            fill: new ol.style.Fill({ color: '#00ff41' }),
                            stroke: new ol.style.Stroke({ color: '#000000', width: 3 }),
                            offsetY: -15
                        })
                    });
                } else if (geometryType === 'LineString') {
                    return new ol.style.Style({
                        stroke: new ol.style.Stroke({ color: color, width: 3 })
                    });
                } else if (geometryType === 'Polygon') {
                    return new ol.style.Style({
                        fill: new ol.style.Fill({ color: 'rgba(255, 170, 0, 0.2)' }),
                        stroke: new ol.style.Stroke({ color: color, width: 2 })
                    });
                }
                return null;
            }
        });

        map.addLayer(vectorLayer);
        kmlLayers[layerData.id] = vectorLayer;

        log('KML слой "' + layerData.name + '" добавлен', 'success');
        loadKmlLayers();
    } catch(e) {
        log('Ошибка добавления KML: ' + e.message, 'error');
    }
}

// Создание элемента списка слоя
function createLayerListItem(layer, type, icon, color) {
    var div = document.createElement('div');
    div.setAttribute('data-layer-type', type);
    div.className = 'layer-item layer-item-' + type;

    var label = document.createElement('span');
    label.className = 'layer-name';
    label.textContent = icon + ' ' + layer.name;

    var controls = document.createElement('div');
    controls.className = 'layer-controls';

    var visibilityBtn = document.createElement('button');
    visibilityBtn.className = 'visibility-btn';
    visibilityBtn.textContent = layer.visible ? '👁️' : '🚫';
    visibilityBtn.addEventListener('click', function() {
        toggleLayerVisibility(layer, type, visibilityBtn);
    });

    var deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.textContent = '🗑️';
    deleteBtn.addEventListener('click', function() {
        deleteLayer(layer, type, div);
    });

    controls.appendChild(visibilityBtn);
    controls.appendChild(deleteBtn);
    div.appendChild(label);
    div.appendChild(controls);

    return div;
}

// Переключение видимости слоя
async function toggleLayerVisibility(layer, type, btn) {
    try {
        var endpoint = type === 'mbtiles' ? API.mbtiles : API.kml;
        var res = await fetch(endpoint + '/layers/' + layer.id + '/toggle', {
            method: 'POST'
        });
        var data = await res.json();
        if (res.ok) {
            layer.visible = data.visible;
            btn.textContent = layer.visible ? '👁️' : '🚫';
            var layers = type === 'mbtiles' ? mbtilesLayers : kmlLayers;
            if (layers[layer.id]) {
                layers[layer.id].setVisible(layer.visible);
            }
        }
    } catch(e) {
        log('Ошибка переключения видимости: ' + e.message, 'error');
    }
}

// Удаление слоя
async function deleteLayer(layer, type, element) {
    if (!confirm('Удалить слой "' + layer.name + '"?')) return;

    try {
        var endpoint = type === 'mbtiles' ? API.mbtiles : API.kml;
        var res = await fetch(endpoint + '/layers/' + layer.id, { method: 'DELETE' });
        if (res.ok) {
            var layers = type === 'mbtiles' ? mbtilesLayers : kmlLayers;
            if (layers[layer.id]) {
                map.removeLayer(layers[layer.id]);
                delete layers[layer.id];
            }
            element.remove();
            log('Слой "' + layer.name + '" удален', 'success');
        }
    } catch(e) {
        log('Ошибка удаления слоя: ' + e.message, 'error');
    }
}