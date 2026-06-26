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

    let socket = null;
    let wsConnected = false;
    let wsRetryCount = 0;
    const MAX_WS_RETRY = 5;

    function initWebSocket() {
        try {
            // Проверяем, доступен ли WebSocket
            if (typeof io === 'undefined') {
                console.warn('⚠️ Socket.IO не загружен, используем polling');
                // Запускаем polling если WebSocket недоступен
            if (typeof startAutoUpdate === 'function') {
                startAutoUpdate();
            }
                return;
            }

            socket = io({
                reconnection: true,
                reconnectionAttempts: MAX_WS_RETRY,
                reconnectionDelay: 1000
            });

            socket.on('connect', function() {
                wsConnected = true;
                wsRetryCount = 0;
                console.log('✅ WebSocket подключен');

                            // Останавливаем polling
            if (typeof stopAutoUpdate === 'function') {
                stopAutoUpdate();
                console.log('🛑 Polling остановлен (WebSocket активен)');
            }

            });

            socket.on('new_marker', function(marker) {
                console.log('📥 Получена новая метка через WebSocket:', marker);

                if (typeof addMarkerFromData === 'function') {
                    addMarkerFromData(marker);
                    updateMarkersCount();
                    loadAllMarkersList();
                }
            });

            socket.on('disconnect', function() {
                wsConnected = false;
                console.log('❌ WebSocket отключен');

                // Запускаем polling как резерв
                if (typeof startAutoUpdate === 'function') {
                    startAutoUpdate();
                    console.log('🔄 Polling запущен (WebSocket отключен)');
                }
                // Пробуем переподключиться через 5 секунд
                // setTimeout(function() {
                //     if (!wsConnected) {
                //         initWebSocket();
                //     }
                // }, 5000);
            });

            socket.on('connect_error', function(error) {
                console.error('WebSocket ошибка:', error);
                wsRetryCount++;

                if (wsRetryCount >= MAX_WS_RETRY) {
                console.warn('⚠️ Превышено количество попыток WebSocket, переключение на polling');
                if (typeof startAutoUpdate === 'function') {
                    startAutoUpdate();
                    }
                }
            });

        } catch(e) {
            console.warn('⚠️ Ошибка инициализации WebSocket:', e);

            if (typeof startAutoUpdate === 'function') {
            startAutoUpdate();
            }
        }
    }

    // Запускаем WebSocket через 1 секунду
    setTimeout(function() {
        initWebSocket();
    }, 1000);

    // Если WebSocket не подключился через 5 секунд, запускаем polling как резерв
    setTimeout(function() {
        if (!wsConnected && typeof startAutoUpdate === 'function') {
            console.log('🔄 WebSocket не подключен, запускаем polling');
            startAutoUpdate();
        }
    }, 5000);

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