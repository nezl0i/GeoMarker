// static/js/markers.js

var markerLayer = null;
var currentFeature = null;
var flashTimers = {}; // Хранилище таймеров для мигающих меток

// Создание слоя меток
function createMarkerLayer() {
    markerLayer = new ol.layer.Vector({
        source: new ol.source.Vector(),
        style: function(feature) {
            var isFlashing = feature.get('flashing');
            var label = feature.get('label') || '';

            // Базовый стиль
            var style = new ol.style.Style({
                image: new ol.style.Circle({
                    radius: isFlashing ? 8 : 5,
                    fill: new ol.style.Fill({
                        color: isFlashing ? '#ff0000' : '#800080'
                    }),
                    stroke: new ol.style.Stroke({
                        color: isFlashing ? '#ff4444' : '#9932CC',
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

            // Если метка мигает, добавляем эффект огня (пульсирующий круг)
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

// Получение координат метки в СК42 (глобальная функция)
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

// Получение высоты для метки (глобальная функция)
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
// ОСНОВНЫЕ ФУНКЦИИ РАБОТЫ С МЕТКАМИ
// ============================================

// Добавление метки с эффектом мигания
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

                        // ВАЖНО: новая метка всегда мигает
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

            log('Метка добавлена с эффектом огня: ' + label, 'success');

            // ЯВНО ОБНОВЛЯЕМ СЧЕТЧИКИ
            console.log('🔄 Обновляем счетчики после добавления метки...');
            updateMarkersCount();

            // Обновляем список меток в модальном окне
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

// Запуск эффекта мигания
function startFlashingEffect(feature) {
    var id = feature.getId();
    var flashInterval = setInterval(function() {
        // Проверяем, существует ли еще метка
        var features = markerLayer.getSource().getFeatures();
        var currentFeature = features.find(function(f) { return f.getId() === id; });

        if (!currentFeature) {
            clearInterval(flashInterval);
            return;
        }

        // Переключаем состояние мигания
        var isFlashing = currentFeature.get('flashing');
        if (isFlashing !== undefined) {
            currentFeature.set('flashing', !isFlashing);
        }
        // Обновляем стиль
        markerLayer.getSource().changed();

        // Добавляем случайный огненный эффект (изменение размера)
        var elapsed = Date.now() - currentFeature.get('flashStart');
        var intensity = Math.max(0, 1 - elapsed / 300000); // Уменьшается к концу
        currentFeature.set('intensity', intensity);

    }, 200); // Мигание каждые 200мс

    // Сохраняем интервал для остановки
    feature.set('flashInterval', flashInterval);
}

// Остановка эффекта мигания
// static/js/markers.js - исправленная функция startAutoUpdate

// Запуск автоматического обновления
function startAutoUpdate() {
    // Устанавливаем время последнего обновления
    lastUpdateTime = new Date().toISOString();

    // Загружаем существующие ID меток
    loadExistingMarkerIds();

    // Останавливаем старый интервал, если есть
    if (updateInterval) {
        clearInterval(updateInterval);
    }

    // Запускаем новый интервал (каждые 5 секунд)
    updateInterval = setInterval(function() {
        checkNewMarkers();
    }, 5000);

    console.log('🔄 Автообновление меток запущено (каждые 5 секунд)');
}

// Обновленная функция stopFlashingEffect - добавляем удаление из processedMarkerIds
function stopFlashingEffect(feature) {
    var id = feature.getId();

    // Останавливаем интервал мигания
    var interval = feature.get('flashInterval');
    if (interval) {
        clearInterval(interval);
        feature.set('flashInterval', null);
    }

    // Убираем флаг мигания
    feature.set('flashing', false);
    feature.set('intensity', 0);

    // Меняем цвет на черный
    markerLayer.getSource().changed();

    // Удаляем таймер из хранилища
    if (flashTimers[id]) {
        delete flashTimers[id];
    }

    log('Метка перестала мигать: ' + feature.get('label'), 'info');

    // Обновляем счетчики
    updateMarkersCount();
}

// Остановка мигания для всех меток (при удалении)
function stopAllFlashing() {
    var features = markerLayer.getSource().getFeatures();
    features.forEach(function(feature) {
        if (feature.get('flashing')) {
            stopFlashingEffect(feature);
        }
    });
}

// Загрузка меток с сервера
// static/js/markers.js - исправленная функция loadMarkers

// Загрузка меток с сервера
async function loadMarkers() {
    try {
        var res = await fetch(API.markers);
        var markers = await res.json();
        markerLayer.getSource().clear();

        // Очищаем хранилище ID
        processedMarkerIds.clear();

        // Очищаем старые таймеры
        for (var key in flashTimers) {
            clearTimeout(flashTimers[key]);
            delete flashTimers[key];
        }

        markers.forEach(function(m) {
            var coords = ol.proj.fromLonLat([m.lng, m.lat]);

            // Добавляем ID в обработанные
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

// Удаление метки
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


// Очистка всех меток
async function clearAllMarkers() {
    try {
        // Останавливаем все мигания
        stopAllFlashing();

        await fetch(API.markers + '/clear', { method: 'POST' });
        markerLayer.getSource().clear();
        log('Все метки удалены', 'success');

        // Обновляем список меток, если функция доступна
        if (typeof loadAllMarkersList === 'function') {
            loadAllMarkersList();
        }
        updateMarkersCount();
    } catch(e) {
        log('Ошибка очистки меток: ' + e.message, 'error');
    }
}

// ============================================
// ОБНОВЛЕНИЕ СЧЕТЧИКОВ МЕТОК
// ============================================

function updateMarkersCount() {
    console.log('🔄 Обновление счетчиков меток...');

    var features = markerLayer.getSource().getFeatures();
    var total = features.length;
    var newCount = 0;
    var oldCount = 0;

    features.forEach(function(feature) {
        var isFlashing = feature.get('flashing');
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
        console.log('✅ Обновлен newMarkersCount: ' + newEl.textContent);
    } else {
        console.warn('⚠️ Элемент newMarkersCount не найден');
    }

    if (oldEl) {
        oldEl.textContent = '(' + oldCount + ')';
        console.log('✅ Обновлен oldMarkersCount: ' + oldEl.textContent);
    } else {
        console.warn('⚠️ Элемент oldMarkersCount не найден');
    }

    if (totalEl) {
        totalEl.textContent = total;
        console.log('✅ Обновлен totalMarkersCount: ' + totalEl.textContent);
    } else {
        console.warn('⚠️ Элемент totalMarkersCount не найден');
    }
}

// Добавляем CSS анимацию для счетчика
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

var lastUpdateTime = null;
var updateInterval = null;

// Запуск автоматического обновления
function startAutoUpdate() {
    // Устанавливаем время последнего обновления
    lastUpdateTime = new Date().toISOString();

    // Загружаем существующие ID меток
    loadExistingMarkerIds();

    // Останавливаем старый интервал, если есть
    if (updateInterval) {
        clearInterval(updateInterval);
    }

    // Запускаем новый интервал (каждые 5 секунд)
    updateInterval = setInterval(function() {
        checkNewMarkers();
    }, 5000);

    console.log('🔄 Автообновление меток запущено (каждые 5 секунд)');
}

var processedMarkerIds = new Set();

// Проверка новых меток
// static/js/markers.js - исправленная функция checkNewMarkers

// Глобальная переменная для хранения ID уже обработанных меток
var processedMarkerIds = new Set();

// Проверка новых меток
async function checkNewMarkers() {
    if (!lastUpdateTime) {
        lastUpdateTime = new Date().toISOString();
        // Загружаем существующие ID меток при первом запуске
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
                // Проверяем, не обрабатывали ли уже эту метку
                if (processedMarkerIds.has(m.id)) {
                    console.log('⏭️ Метка уже обработана:', m.id);
                    return;
                }

                var coords = ol.proj.fromLonLat([m.lng, m.lat]);

                // Проверяем, не существует ли уже такая метка на карте
                var existing = markerLayer.getSource().getFeatures().find(function(f) {
                    return f.getId() === m.id;
                });

                if (!existing) {
                    // Добавляем метку
                    var isFlashing = false;
                    var flashStart = Date.now();

                    if (m.created_at) {
                        var createdAt = new Date(m.created_at).getTime();
                        flashStart = createdAt;
                        var now = Date.now();
                        var age = now - createdAt;
                        isFlashing = age < 300000; // Меньше 5 минут
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

                    // Добавляем ID в обработанные
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
                    // Метка уже есть на карте, просто добавляем ID в обработанные
                    processedMarkerIds.add(m.id);
                }
            });

            if (addedCount > 0) {
                // Обновляем счетчики
                if (typeof updateMarkersCount === 'function') {
                    updateMarkersCount();
                }

                // Обновляем список меток в модальном окне
                if (typeof loadAllMarkersList === 'function') {
                    loadAllMarkersList();
                }
            }

            // Обновляем время последнего запроса ТОЛЬКО если были новые метки
            if (addedCount > 0 || newMarkers.length > 0) {
                lastUpdateTime = new Date().toISOString();
            }
        }
    } catch(e) {
        console.error('Ошибка проверки новых меток:', e);
    }
}

// Загрузка существующих ID меток
async function loadExistingMarkerIds() {
    try {
        var res = await fetch(API.markers);
        var markers = await res.json();
        markers.forEach(function(m) {
            processedMarkerIds.add(m.id);
        });
        console.log('📥 Загружено ID существующих меток:', processedMarkerIds.size);
    } catch(e) {
        console.error('Ошибка загрузки ID меток:', e);
    }
}

// Обновленная функция updateMarkersCount
function updateMarkersCount() {
    console.log('🔄 Обновление счетчиков меток...');

    var features = markerLayer.getSource().getFeatures();
    var total = features.length;
    var newCount = 0;
    var oldCount = 0;

    var now = Date.now();

    features.forEach(function(feature) {
        var isFlashing = feature.get('flashing');
        // Дополнительная проверка по времени
        var flashStart = feature.get('flashStart');
        if (flashStart) {
            var age = now - flashStart;
            // Если метка старше 5 минут, но still flashing - исправляем
            if (age >= 300000 && isFlashing) {
                // Принудительно останавливаем мигание
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

// Остановка автоматического обновления
function stopAutoUpdate() {
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
        console.log('🔄 Автообновление меток остановлено');
    }
}

// Экспортируем функции глобально
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