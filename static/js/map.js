// Глобальные переменные для карты
var map = null;
var layerMap = {};
var currentBaseLayer = null;
var mbtilesLayers = {};
var kmlLayers = {};
var zoomDisplayElement = null;

// Инициализация карты
function initMap() {
    try {
        var defaultCenter = ol.proj.fromLonLat(APP_CONFIG.defaultCenter);
        var defaultZoom = APP_CONFIG.defaultZoom;

        map = new ol.Map({
            target: 'map',
            view: new ol.View({
                center: defaultCenter,
                zoom: defaultZoom,
                projection: 'EPSG:3857'
            }),
            loadTilesWhileAnimating: APP_CONFIG.ol.loadTilesWhileAnimating,
            loadTilesWhileInteracting: APP_CONFIG.ol.loadTilesWhileInteracting,
            pixelRatio: APP_CONFIG.ol.pixelRatio
        });

        log('Карта создана', 'success');

        // Загружаем сохраненное состояние
        loadMapState();
        // createZoomDisplay();

        // Сохраняем состояние при движении
        map.getView().on('change:center', saveMapState);
        map.getView().on('change:resolution', saveMapState, updateZoomDisplay());

        setTimeout(function() {
            updateZoomDisplay();
        }, 100);

        return true;
    } catch(e) {
        log('Ошибка создания карты: ' + e.message, 'error');
        return false;
    }
}

function createZoomDisplay() {
    // Проверяем, не существует ли уже элемент
    if (document.getElementById('zoom-display')) {
        zoomDisplayElement = document.getElementById('zoom-display');
        return;
    }
}

function updateZoomDisplay() {
    if (!map) return;

    var zoom = map.getView().getZoom();
    var menuZoom = getElement('menu-zoom');
    if (menuZoom) {
        menuZoom.textContent = zoom.toFixed(1);
    }
}

function getCurrentZoom() {
    if (!map) return 10;
    return map.getView().getZoom();
}

// Сохранение состояния карты
function saveMapState() {
    try {
        var view = map.getView();
        var state = {
            center: view.getCenter(),
            zoom: view.getZoom()
        };
        saveState(APP_CONFIG.mapStateKey, state);
    } catch(e) {
        // Игнорируем
    }
}

// Загрузка состояния карты
function loadMapState() {
    var state = loadState(APP_CONFIG.mapStateKey);
    if (state && state.center && state.zoom !== undefined) {
        if (state.zoom < 5 || state.zoom > 20) {
            log('⚠️ Сохраненный зум (' + state.zoom + ') вне допустимого диапазона, используем default', 'warning');
            var view = map.getView();
            view.setZoom(APP_CONFIG.defaultZoom || 13);
            return false;
        }

        var view = map.getView();
        view.setCenter(state.center);
        view.setZoom(state.zoom);

        setTimeout(function() {
            updateZoomDisplay();
        }, 200);
        log('Состояние карты загружено: зум=' + state.zoom, 'success');
        return true;
    }
        var view = map.getView();
    view.setZoom(APP_CONFIG.defaultZoom || 13);
    log('Установлен зум по умолчанию: 13', 'info');
    return false;
}

// Создание базовых слоев
function createBaseLayers() {
    try {
        var googleLayer = new ol.layer.Tile({
            source: new ol.source.XYZ({
                url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
                maxZoom: 20
            }),
            visible: true
        });

        var yandexLayer = new ol.layer.Tile({
            source: new ol.source.XYZ({
                url: 'https://core-renderer-tiles.maps.yandex.net/tiles?l=sat&x={x}&y={y}&z={z}',
                maxZoom: 19
            }),
            visible: false
        });

        map.addLayer(googleLayer);
        map.addLayer(yandexLayer);

        layerMap = {
            google: googleLayer,
            yandex: yandexLayer
        };
        currentBaseLayer = googleLayer;

        log('Базовые слои созданы', 'success');
        return true;
    } catch(e) {
        log('Ошибка создания слоёв: ' + e.message, 'error');
        return false;
    }
}

// Переключение базового слоя
function switchBaseLayer(key) {
    if (!layerMap[key]) return;

    for (var k in layerMap) {
        layerMap[k].setVisible(false);
    }
    layerMap[key].setVisible(true);
    currentBaseLayer = layerMap[key];

    log('Переключено на: ' + key, 'info');
}

// Обновление размера карты
function updateMapSize() {
    if (map) {
        setTimeout(function() {
            map.updateSize();
            log('Размер карты обновлён', 'success');
        }, 200);
    }
}

// Добавляем функцию для обновления стиля в реальном времени
function updateMarkerStyles() {
    // Периодически обновляем стили для плавного эффекта огня
    setInterval(function() {
        var features = markerLayer.getSource().getFeatures();
        var needsUpdate = false;

        features.forEach(function(feature) {
            if (feature.get('flashing')) {
                // Меняем интенсивность для эффекта огня
                var elapsed = Date.now() - feature.get('flashStart');
                var remaining = Math.max(0, 1 - elapsed / 300000);
                var currentIntensity = feature.get('intensity') || 0;

                // Пульсирующий эффект
                var pulse = Math.sin(Date.now() / 100) * 0.3 + 0.7;
                var newIntensity = remaining * pulse;

                feature.set('intensity', newIntensity);
                needsUpdate = true;
            }
        });

        if (needsUpdate) {
            markerLayer.getSource().changed();
        }
    }, 100);
}

window.updateZoomDisplay = updateZoomDisplay;
window.getCurrentZoom = getCurrentZoom;
window.createZoomDisplay = createZoomDisplay;