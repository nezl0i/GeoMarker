// static/js/search.js

// Инициализация поиска
function initSearch() {
    var searchX = getElement('search-x');
    var searchY = getElement('search-y');
    var searchBtn = getElement('search-btn');

    if (searchX && searchY) {
        searchX.addEventListener('input', function() {
            this.value = this.value.replace(/[^0-9-]/g, '');
            if (this.value.length >= 7) {
                searchY.focus();
                searchY.select();
            }
        });

        searchY.addEventListener('input', function() {
            this.value = this.value.replace(/[^0-9-]/g, '');
        });
    }

    if (searchBtn) {
        searchBtn.addEventListener('click', searchByCoords);
    }

    if (searchX) {
        searchX.addEventListener('keypress', function(e) {
            if (e.key === 'Enter' && searchY) {
                searchY.focus();
                searchY.select();
            }
        });
    }

    if (searchY) {
        searchY.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                searchBtn.click();
            }
        });
    }
}

// Поиск по координатам СК42
function searchByCoords() {
    var x = parseFloat(getElement('search-x').value.trim());
    var y = parseFloat(getElement('search-y').value.trim());

    if (isNaN(x) || isNaN(y)) {
        alert('Введите координаты СК42:\nX (широта): 5655123\nY (долгота): 6633123');
        return;
    }

    fetch(API.convert, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'sk42_to_wgs84', x: x, y: y })
    })
    .then(r => r.json())
    .then(data => {
        if (data.lat !== undefined) {
            var coords = ol.proj.fromLonLat([data.lng, data.lat]);
            map.getView().animate({
                center: coords,
                zoom: 15,
                duration: 1500
            });

            var tempFeature = new ol.Feature({
                geometry: new ol.geom.Point(coords),
                label: '📍 Найдено'
            });

            var tempLayer = new ol.layer.Vector({
                source: new ol.source.Vector({ features: [tempFeature] }),
                style: new ol.style.Style({
                    image: new ol.style.Circle({
                        radius: 12,
                        fill: new ol.style.Fill({ color: '#ff4444' }),
                        stroke: new ol.style.Stroke({ color: '#ffffff', width: 3 })
                    }),
                    text: new ol.style.Text({
                        text: '📍 Найдено',
                        font: '14px Arial',
                        fill: new ol.style.Fill({ color: '#000000' }),
                        stroke: new ol.style.Stroke({ color: '#ffffff', width: 4 }),
                        offsetY: -20,
                        textAlign: 'center'
                    })
                })
            });

            map.addLayer(tempLayer);
            setTimeout(function() { map.removeLayer(tempLayer); }, 5000);
            log('Переход к точке: ' + data.lat + ', ' + data.lng, 'success');
        } else {
            alert('Точка не найдена');
        }
    })
    .catch(function(e) {
        log('Ошибка поиска: ' + e.message, 'error');
        alert('Ошибка поиска');
    });
}