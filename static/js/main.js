// static/js/main.js

// Хакерский ASCII арт
console.log('%c' +
    '  ██╗  ██╗ █████╗  ██████╗██╗  ██╗███████╗██████╗     ███╗   ███╗ ██████╗ ██████╗ ███████╗\n' +
    '  ██║  ██║██╔══██╗██╔════╝██║ ██╔╝██╔════╝██╔══██╗    ████╗ ████║██╔═══██╗██╔══██╗██╔════╝\n' +
    '  ███████║███████║██║     █████╔╝ █████╗  ██████╔╝    ██╔████╔██║██║   ██║██║  ██║█████╗  \n' +
    '  ██╔══██║██╔══██║██║     ██╔═██╗ ██╔══╝  ██╔══██╗    ██║╚██╔╝██║██║   ██║██║  ██║██╔══╝  \n' +
    '  ██║  ██║██║  ██║╚██████╗██║  ██╗███████╗██║  ██║    ██║ ╚═╝ ██║╚██████╔╝██████╔╝███████╗\n' +
    '  ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝    ╚═╝     ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝\n' +
    '                                                                                             \n' +
    '  ═══════════════════════════════════════════════════════════════════════\n' +
    '  ██  SYSTEM INITIALIZED  ██  STATUS: ONLINE  ██  VERSION: 2.0  ██\n' +
    '  ═══════════════════════════════════════════════════════════════════════',
    'color: #00ff41; font-family: monospace; font-size: 10px;'
);

// Ждем загрузки DOM
document.addEventListener('DOMContentLoaded', function() {
    log('DOM загружен', 'success');

    // Проверяем OpenLayers
    if (typeof ol === 'undefined') {
        log('OpenLayers не загружен!', 'error');
        document.getElementById('map').innerHTML = '<div style="text-align:center;padding-top:100px;font-size:24px;color:#ff4444;">Ошибка: OpenLayers не загружен</div>';
        return;
    }
    log('OpenLayers загружен', 'success');

    // 1. Инициализация карты
    if (!initMap()) return;

    // 2. Создание базовых слоев
    createBaseLayers();

    // 3. Создание слоя меток
    createMarkerLayer();

    // 4. Инициализация UI
    initUI();

    // 5. Инициализация поиска
    initSearch();

    // 6. Загрузка данных
    loadMarkers();
    loadMbtilesLayers();
    loadKmlLayers();
    loadHgtFiles();

    // 7. Обновление размера карты
    updateMapSize();

    // Обработчики событий для карты
    map.on('dblclick', function(e) {
        var coord = e.coordinate;
        var lonLat = ol.proj.toLonLat(coord);
        var labelInput = getElement('labelInput');
        var label = labelInput ? labelInput.value.trim() : 'Без названия';
        if (!label) label = 'Без названия';
        addMarker(lonLat[1], lonLat[0], label);
    });

    map.on('click', function(e) {
        var feature = map.forEachFeatureAtPixel(e.pixel, function(f) {
            return f;
        });
        if (feature && feature.getId()) {
            openMarkerModal(feature);
        }
    });

    // 9. Обновление координат
    map.getView().on('change:center', updateInfo);
    map.getView().on('change:resolution', updateInfo);
    setTimeout(updateInfo, 500);

    // ============================================
    // ЗАПУСК АВТОМАТИЧЕСКОГО ОБНОВЛЕНИЯ
    // ============================================

    // Запускаем автообновление после загрузки
    setTimeout(function() {
        if (typeof startAutoUpdate === 'function') {
            startAutoUpdate();
            console.log('✅ Автообновление меток активировано');
        }
    }, 3000);

    log('Приложение загружено!', 'success');
    log('📌 Добавление меток: кнопка "➕ Добавить" или двойной клик по карте', 'info');
    log('🗑️ Удаление меток: клик по метке или через список', 'info');
    log('📍 В СК42: X - широта (север), Y - долгота (восток)', 'info');
    log('💾 Состояние карты (центр и зум) сохраняется автоматически', 'info');

    updateMarkerStyles();

    console.log('✅ Приложение загружено!');
    console.log('📌 Добавление меток: кнопка "➕ Добавить" или двойной клик по карте');
    console.log('🔥 Новые метки мигают красным в течение 5 минут');
    console.log('⚫ После 5 минут метки становятся черными');

    // Запускаем обновление счетчиков
    setTimeout(function() {
        if (typeof updateMarkersCount === 'function') {
            updateMarkersCount();
        }
    }, 1000);
});

// Обновление информации о координатах
function updateInfo() {
    var center = map.getView().getCenter();
    if (!center) return;

    var lonLat = ol.proj.toLonLat(center);
    var lng = lonLat[0];
    var lat = lonLat[1];

    getElement('wgs84-lat').textContent = lat.toFixed(7);
    getElement('wgs84-lng').textContent = lng.toFixed(7);
    getElement('wgs84-lat-format').textContent = formatCoord(lat, true);
    getElement('wgs84-lng-format').textContent = formatCoord(lng, false);

    fetch(API.convert, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'wgs84_to_sk42', lat: lat, lng: lng })
    })
    .then(r => r.json())
    .then(data => {
        if (data.x !== undefined) {
            getElement('sk42-x').textContent = Math.round(data.x);
            getElement('sk42-y').textContent = Math.round(data.y);
            getElement('sk42-x-format').textContent = Math.round(data.x) + ' м (X - широта)';
            getElement('sk42-y-format').textContent = Math.round(data.y) + ' м (Y - долгота)';
        }
    })
    .catch(function(e) {
        log('Ошибка СК42: ' + e.message, 'error');
    });

    fetch(API.elevation, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: lat, lng: lng })
    })
    .then(r => r.json())
    .then(data => {
        if (data.elevation !== undefined) {
            getElement('elevation').textContent = data.elevation.toFixed(1) + ' м';
        }
    })
    .catch(function() {
        // Fallback
        fetch('https://api.open-elevation.com/api/v1/lookup?locations=' + lat + ',' + lng)
        .then(r => r.json())
        .then(data => {
            if (data.results && data.results[0]) {
                getElement('elevation').textContent = data.results[0].elevation.toFixed(1) + ' м';
            }
        })
        .catch(function() {});
    });
}