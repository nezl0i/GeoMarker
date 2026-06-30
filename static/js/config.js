// static/js/config.js

// Конфигурация приложения
const APP_CONFIG = {
    // Дефолтный центр карты (Курская область)
    defaultCenter: [34.90163, 51.08638],
    defaultZoom: 13,

    // Ключ для localStorage
    mapStateKey: 'map_state',

    // Цвета для разных типов слоев
    colors: {
        mbtiles: '#00ff41',
        kml: '#FF0000',
        marker: '#ff0000'
    },

    // Настройки OpenLayers
    ol: {
        loadTilesWhileAnimating: true,
        loadTilesWhileInteracting: true,
        pixelRatio: window.devicePixelRatio || 1
    }
};

// API endpoints
const API = {
    markers: '/api/markers',
    convert: '/api/convert',
    elevation: '/api/hgt/elevation',
    mbtiles: '/api/mbtiles',
    kml: '/api/kml',
    hgt: '/api/hgt'
};