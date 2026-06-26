// static/js/markers.js

var markerLayer = null;
var currentFeature = null;
var flashTimers = {}; // Хранилище таймеров для мигающих меток
var processedMarkerIds = new Set(); // Хранилище ID уже обработанных меток
var lastUpdateTime = null;
var updateInterval = null;

// ============================================
// СОЗДАНИЕ СЛОЯ МЕТОК
// ============================================

function createMarkerLayer() {
    markerLayer = new ol.layer.Vector({
        source: new ol.source.Vector(),
        style: function(feature) {
            var isFlashing = feature.get('flashing');
            var label = feature.get('label') || '';

            var style = new ol.style.Style({
                image: new ol.style.Circle({
                    radius: isFlashing ? 8 : 5,
                    fill: new ol.style.Fill({
                        color: isFlashing ? '#ff0000' : '#fde404'
                    }),
                    stroke: new ol.style.Stroke({
                        color: isFlashing ? '#ff4444' : '#ff6200',
                        width: isFlashing ? 3 : 2
                    })
                }),
                text: new ol.style.Text({
                    text: label,
                    font: '12px Arial',
                    fill: new ol.style.Fill({ color: '#000000' }),
                    stroke: new ol.style.Stroke({ color: '#ffffff', width: 3 }),
                    offsetY: -15,
                    textAlign: 'center'
                })
            });

            if (isFlashing) {
                var fireStyle = new ol.style.Style({
                    image: new ol.style.Circle({
                        radius: 16 + Math.random() * 4,
                        fill: new ol.style.Fill({
                            color: 'rgba(255, 68, 0, 0.3)'
                        }),
                        stroke: new ol.style.Stroke({
                            color: 'rgba(255, 200, 0, 0.6)',
                            width: 2
                        })
                    })
                });
                return [style, fireStyle];
            }

            return style;
        }
    });
    map.addLayer(markerLayer);
    log('Слой меток создан', 'success');
    updateMarkersCount();
}

// ============================================
// ГЛОБАЛЬНЫЕ ФУНКЦИИ ДЛЯ ДОСТУПА ИЗ ДРУГИХ МОДУЛЕЙ
// ============================================

window.getMarkerSK42 = async function(lat, lng) {
    try {
        var res = await fetch(API.convert, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: 'wgs84_to_sk42', lat: lat, lng: lng })
        });
        return await res.json();
    } catch(e) {
        log('Ошибка получения СК42: ' + e.message, 'error');
        return null;
    }
};

window.getMarkerElevation = async function(lat, lng) {
    try {
        var res = await fetch(API.elevation, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: lat, lng: lng })
        });
        var data = await res.json();
        if (data.elevation !== undefined) {
            return data.elevation;
        }
    } catch(e) {
        // Fallback
    }

    try {
        var url = 'https://api.open-elevation.com/api/v1/lookup?locations=' + lat + ',' + lng;
        var res = await fetch(url);
        var data = await res.json();
        if (data.results && data.results[0]) {
            return data.results[0].elevation;
        }
    } catch(e) {
        log('Ошибка получения высоты: ' + e.message, 'error');
    }
    return null;
};

// ============================================
// ДОБАВЛЕНИЕ МЕТКИ ИЗ ДАННЫХ (ДЛЯ WEBSOCKET)
// ============================================

function addMarkerFromData(markerData) {
    if (!markerData || !markerData.id) {
        console.warn('⚠️ Некорректные данные метки:', markerData);
        return;
    }

    console.log('📥 Добавление метки из данных:', markerData);

    var existing = markerLayer.getSource().getFeatures().find(function(f) {
        return f.getId() === markerData.id;
    });

    if (existing) {
        console.log('⏭️ Метка уже существует:', markerData.id);
        return;
    }

    var coords = ol.proj.fromLonLat([markerData.lng, markerData.lat]);

    var isFlashing = false;
    var flashStart = Date.now();

    if (markerData.created_at) {
        var createdAt = new Date(markerData.created_at).getTime();
        flashStart = createdAt;
        var now = Date.now();
        var age = now - createdAt;
        isFlashing = age < 300000;
    }

    var feature = new ol.Feature({
        geometry: new ol.geom.Point(coords),
        label: markerData.label || 'Без названия',
        id: markerData.id,
        lat: markerData.lat,
        lng: markerData.lng,
        flashing: isFlashing,
        flashStart: flashStart,
        created_at: markerData.created_at || null
    });
    feature.setId(markerData.id);
    markerLayer.getSource().addFeature(feature);

    if (isFlashing) {
        startFlashingEffect(feature);
        var remainingTime = 300000 - (Date.now() - flashStart);
        if (remainingTime > 0) {
            var timerId = setTimeout(function() {
                stopFlashingEffect(feature);
            }, remainingTime);
            flashTimers[markerData.id] = timerId;
        }
    }

    log('📥 Добавлена метка через WebSocket: ' + markerData.label, 'success');
}

window.addMarkerFromData = addMarkerFromData;

// ============================================
// ДОБАВЛЕНИЕ МЕТКИ (РУЧНОЕ)
// ============================================

async function addMarker(lat, lng, label) {
    console.log('📝 Добавление метки:', { lat, lng, label });

    try {
        var res = await fetch(API.markers, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat, lng, label })
        });
        var data = await res.json();

        if (res.ok) {
            console.log('✅ Метка создана на сервере:', data);

            var coords = ol.proj.fromLonLat([lng, lat]);

            var isFlashing = true;
            var flashStart = Date.now();

            var feature = new ol.Feature({
                geometry: new ol.geom.Point(coords),
                label: label,
                id: data.id,
                lat: lat,
                lng: lng,
                flashing: true,
                flashStart: Date.now(),
                created_at: data.created_at || new Date().toISOString()
            });
            feature.setId(data.id);
            markerLayer.getSource().addFeature(feature);

            startFlashingEffect(feature);

            var timerId = setTimeout(function() {
                stopFlashingEffect(feature);
            }, 300000);

            flashTimers[data.id] = timerId;

            log('🔥 Метка добавлена с эффектом огня: ' + label, 'success');

            updateMarkersCount();

            if (typeof loadAllMarkersList === 'function') {
                loadAllMarkersList();
            }

            return data;
        } else {
            console.error('❌ Ошибка сервера:', data);
        }
    } catch(e) {
        console.error('❌ Ошибка добавления метки:', e);
        log('Ошибка добавления метки: ' + e.message, 'error');
    }
}

// ============================================
// ЭФФЕКТ МИГАНИЯ
// ============================================

function startFlashingEffect(feature) {
    var id = feature.getId();
    var flashInterval = setInterval(function() {
        var features = markerLayer.getSource().getFeatures();
        var currentFeature = features.find(function(f) { return f.getId() === id; });

        if (!currentFeature) {
            clearInterval(flashInterval);
            return;
        }

        var isFlashing = currentFeature.get('flashing');
        if (isFlashing !== undefined) {
            currentFeature.set('flashing', !isFlashing);
        }
        markerLayer.getSource().changed();

        var elapsed = Date.now() - currentFeature.get('flashStart');
        var intensity = Math.max(0, 1 - elapsed / 300000);
        currentFeature.set('intensity', intensity);

    }, 200);

    feature.set('flashInterval', flashInterval);
}

function stopFlashingEffect(feature) {
    var id = feature.getId();

    var interval = feature.get('flashInterval');
    if (interval) {
        clearInterval(interval);
        feature.set('flashInterval', null);
    }

    feature.set('flashing', false);
    feature.set('intensity', 0);
    markerLayer.getSource().changed();

    if (flashTimers[id]) {
        delete flashTimers[id];
    }

    log('Метка перестала мигать: ' + feature.get('label'), 'info');
    updateMarkersCount();
}

function stopAllFlashing() {
    var features = markerLayer.getSource().getFeatures();
    features.forEach(function(feature) {
        if (feature.get('flashing')) {
            stopFlashingEffect(feature);
        }
    });
}

// ============================================
// ЗАГРУЗКА МЕТОК
// ============================================

async function loadMarkers() {
    try {
        var res = await fetch(API.markers);
        var markers = await res.json();
        markerLayer.getSource().clear();

        processedMarkerIds.clear();

        for (var key in flashTimers) {
            clearTimeout(flashTimers[key]);
            delete flashTimers[key];
        }

        markers.forEach(function(m) {
            var coords = ol.proj.fromLonLat([m.lng, m.lat]);
            processedMarkerIds.add(m.id);

            var isFlashing = false;
            var flashStart = Date.now();
            if (m.created_at) {
                var createdAt = new Date(m.created_at).getTime();
                flashStart = createdAt;
                var now = Date.now();
                var age = now - createdAt;
                isFlashing = age < 300000;
            }

            var feature = new ol.Feature({
                geometry: new ol.geom.Point(coords),
                label: m.label || 'Без названия',
                id: m.id,
                lat: m.lat,
                lng: m.lng,
                flashing: isFlashing,
                flashStart: flashStart,
                created_at: m.created_at || null
            });
            feature.setId(m.id);
            markerLayer.getSource().addFeature(feature);

            if (isFlashing && m.created_at) {
                var createdAt = new Date(m.created_at).getTime();
                var age = Date.now() - createdAt;
                var remainingTime = 300000 - age;

                if (remainingTime > 0) {
                    startFlashingEffect(feature);
                    var timerId = setTimeout(function() {
                        stopFlashingEffect(feature);
                    }, remainingTime);
                    flashTimers[m.id] = timerId;
                }
            }
        });

        log('Загружено ' + markers.length + ' меток', 'success');
        updateMarkersCount();
        return markers;
    } catch(e) {
        log('Ошибка загрузки меток: ' + e.message, 'error');
        return [];
    }
}

// ============================================
// УДАЛЕНИЕ МЕТОК
// ============================================

async function deleteMarker(id, feature) {
    try {
        console.log('🗑️ Удаление метки ID:', id);

        var res = await fetch(API.markers + '/' + id, { method: 'DELETE' });

        if (res.ok) {
            console.log('✅ Метка удалена на сервере');

            if (feature && feature.get('flashing')) {
                stopFlashingEffect(feature);
            }

            if (feature) {
                markerLayer.getSource().removeFeature(feature);
            }

            if (flashTimers[id]) {
                clearTimeout(flashTimers[id]);
                delete flashTimers[id];
            }

            log('Метка удалена', 'success');

            if (typeof updateMarkersCount === 'function') {
                updateMarkersCount();
            }

            return true;
        } else {
            console.error('❌ Ошибка удаления на сервере:', res.status);
            return false;
        }
    } catch(e) {
        console.error('❌ Ошибка удаления метки:', e);
        log('Ошибка удаления метки: ' + e.message, 'error');
        return false;
    }
}

async function clearAllMarkers() {
    try {
        stopAllFlashing();
        await fetch(API.markers + '/clear', { method: 'POST' });
        markerLayer.getSource().clear();
        log('Все метки удалены', 'success');

        if (typeof loadAllMarkersList === 'function') {
            loadAllMarkersList();
        }
        updateMarkersCount();
    } catch(e) {
        log('Ошибка очистки меток: ' + e.message, 'error');
    }
}

// ============================================
// ОБНОВЛЕНИЕ СЧЕТЧИКОВ
// ============================================

function updateMarkersCount() {
    console.log('🔄 Обновление счетчиков меток...');

    var features = markerLayer.getSource().getFeatures();
    var total = features.length;
    var newCount = 0;
    var oldCount = 0;

    var now = Date.now();

    features.forEach(function(feature) {
        var isFlashing = feature.get('flashing');
        var flashStart = feature.get('flashStart');
        if (flashStart) {
            var age = now - flashStart;
            if (age >= 300000 && isFlashing) {
                stopFlashingEffect(feature);
                isFlashing = false;
            }
        }

        if (isFlashing) {
            newCount++;
        } else {
            oldCount++;
        }
    });

    console.log('📊 Статистика: Всего=' + total + ', Новых=' + newCount + ', Старых=' + oldCount);

    var newEl = document.getElementById('newMarkersCount');
    var oldEl = document.getElementById('oldMarkersCount');
    var totalEl = document.getElementById('totalMarkersCount');

    if (newEl) {
        newEl.textContent = '(' + newCount + ')';
        if (newCount > 0) {
            newEl.style.color = '#ff4444';
            newEl.style.textShadow = '0 0 20px rgba(255,0,0,0.3)';
            newEl.style.animation = 'none';
            setTimeout(function() {
                newEl.style.animation = 'pulse 0.5s ease';
            }, 10);
        } else {
            newEl.style.color = 'rgba(0,255,65,0.3)';
            newEl.style.textShadow = 'none';
        }
    }

    if (oldEl) {
        oldEl.textContent = '(' + oldCount + ')';
    }

    if (totalEl) {
        totalEl.textContent = total;
    }
}

// CSS анимация
var style = document.createElement('style');
style.textContent = `
    @keyframes pulse {
        0% { transform: scale(1); }
        50% { transform: scale(1.3); color: #ff0000; }
        100% { transform: scale(1); }
    }
`;
document.head.appendChild(style);

// ============================================
// АВТОМАТИЧЕСКОЕ ОБНОВЛЕНИЕ МЕТОК
// ============================================

function loadExistingMarkerIds() {
    try {
        var res = fetch(API.markers)
            .then(function(response) { return response.json(); })
            .then(function(markers) {
                markers.forEach(function(m) {
                    processedMarkerIds.add(m.id);
                });
                console.log('📥 Загружено ID существующих меток:', processedMarkerIds.size);
            })
            .catch(function(e) {
                console.error('Ошибка загрузки ID меток:', e);
            });
    } catch(e) {
        console.error('Ошибка загрузки ID меток:', e);
    }
}

// static/js/markers.js

function startAutoUpdate() {
    // Проверяем, активен ли WebSocket
    if (typeof wsConnected !== 'undefined' && wsConnected) {
        console.log('⏭️ WebSocket активен, polling не запускается');
        return;
    }

    lastUpdateTime = new Date().toISOString();
    loadExistingMarkerIds();

    if (updateInterval) {
        clearInterval(updateInterval);
    }

    // Увеличенный интервал для резервного polling
    updateInterval = setInterval(function() {
        checkNewMarkers();
    }, 15000);  // 15 секунд

    console.log('🔄 Резервный polling запущен (каждые 15 секунд)');
}

function stopAutoUpdate() {
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
        console.log('🔄 Автообновление меток остановлено');
    }
}


async function checkNewMarkers() {
    if (!lastUpdateTime) {
        lastUpdateTime = new Date().toISOString();
        loadExistingMarkerIds();
        return;
    }

    try {
        var url = API.markers + '/latest?after=' + encodeURIComponent(lastUpdateTime);
        var res = await fetch(url);
        var newMarkers = await res.json();

        if (newMarkers && newMarkers.length > 0) {
            console.log('📥 Найдено новых меток (по времени):', newMarkers.length);

            var addedCount = 0;
            newMarkers.forEach(function(m) {
                if (processedMarkerIds.has(m.id)) {
                    console.log('⏭️ Метка уже обработана:', m.id);
                    return;
                }

                var coords = ol.proj.fromLonLat([m.lng, m.lat]);
                var existing = markerLayer.getSource().getFeatures().find(function(f) {
                    return f.getId() === m.id;
                });

                if (!existing) {
                    var isFlashing = false;
                    var flashStart = Date.now();

                    if (m.created_at) {
                        var createdAt = new Date(m.created_at).getTime();
                        flashStart = createdAt;
                        var now = Date.now();
                        var age = now - createdAt;
                        isFlashing = age < 300000;
                        console.log('📥 Возраст метки:', age, 'ms, мигает:', isFlashing);
                    }

                    var feature = new ol.Feature({
                        geometry: new ol.geom.Point(coords),
                        label: m.label || 'Без названия',
                        id: m.id,
                        lat: m.lat,
                        lng: m.lng,
                        flashing: isFlashing,
                        flashStart: flashStart,
                        created_at: m.created_at || null
                    });
                    feature.setId(m.id);
                    markerLayer.getSource().addFeature(feature);

                    processedMarkerIds.add(m.id);
                    addedCount++;

                    if (isFlashing) {
                        console.log('🔥 Запускаем мигание для метки:', m.label);
                        startFlashingEffect(feature);

                        var remainingTime = 300000 - (Date.now() - flashStart);
                        if (remainingTime > 0) {
                            var timerId = setTimeout(function() {
                                stopFlashingEffect(feature);
                            }, remainingTime);
                            flashTimers[m.id] = timerId;
                        }
                    }

                    log('🔥 Автоматически добавлена новая метка: ' + m.label, 'success');
                } else {
                    processedMarkerIds.add(m.id);
                }
            });

            if (addedCount > 0) {
                if (typeof updateMarkersCount === 'function') {
                    updateMarkersCount();
                }
                if (typeof loadAllMarkersList === 'function') {
                    loadAllMarkersList();
                }
            }

            if (addedCount > 0 || newMarkers.length > 0) {
                lastUpdateTime = new Date().toISOString();
            }
        }
    } catch(e) {
        console.error('Ошибка проверки новых меток:', e);
    }
}

// ============================================
// ЭКСПОРТ В ГЛОБАЛЬНУЮ ОБЛАСТЬ
// ============================================

window.deleteMarker = deleteMarker;
window.addMarker = addMarker;
window.clearAllMarkers = clearAllMarkers;
window.updateMarkersCount = updateMarkersCount;
window.loadMarkers = loadMarkers;
window.createMarkerLayer = createMarkerLayer;
window.stopFlashingEffect = stopFlashingEffect;
window.startFlashingEffect = startFlashingEffect;
window.startAutoUpdate = startAutoUpdate;
window.stopAutoUpdate = stopAutoUpdate;
window.checkNewMarkers = checkNewMarkers;
window.addMarkerFromData = addMarkerFromData;