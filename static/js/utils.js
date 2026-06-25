// static/js/utils.js

// Форматирование координат в градусы/минуты/секунды
function formatCoord(deg, isLat) {
    var abs = Math.abs(deg);
    var d = Math.floor(abs);
    var m = Math.floor((abs - d) * 60);
    var s = ((abs - d - m / 60) * 3600).toFixed(2);
    var dir = isLat ? (deg >= 0 ? 'N' : 'S') : (deg >= 0 ? 'E' : 'W');
    return d + '°' + m + '′' + s + '″' + dir;
}

// Безопасное получение элемента
function getElement(id) {
    return document.getElementById(id);
}

// Показать уведомление
function showAlert(message, type) {
    alert(message);
}

// Логирование в консоль с цветом
function log(message, type) {
    var colors = {
        info: '#00ccff',
        success: '#00ff41',
        warning: '#ffaa00',
        error: '#ff4444'
    };
    console.log('%c[%s] %s', 'color: ' + (colors[type] || '#ffffff'), type.toUpperCase(), message);
}

// Сохранение состояния в localStorage
function saveState(key, data) {
    try {
        localStorage.setItem(key, JSON.stringify(data));
        return true;
    } catch(e) {
        return false;
    }
}

// Загрузка состояния из localStorage
function loadState(key) {
    try {
        var saved = localStorage.getItem(key);
        if (!saved) return null;
        return JSON.parse(saved);
    } catch(e) {
        return null;
    }
}