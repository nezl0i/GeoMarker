// static/js/ui.js

// ============================================
// ОТКРЫТИЕ МОДАЛЬНОГО ОКНА МЕТКИ
// ============================================

window.openMarkerModal = function(feature) {
    if (!feature) {
        log('Ошибка: feature не передан', 'error');
        return;
    }

    currentFeature = feature;
    var id = feature.getId();
    var label = feature.get('label') || 'Без названия';
    var lat = feature.get('lat');
    var lng = feature.get('lng');
    var flashStart = feature.get('flashStart');
    var created_at = feature.get('created_at');

    console.log('Открытие метки:', { id, label, lat, lng });

    var editLabel = getElement('editLabel');
    if (editLabel) {
        editLabel.value = label;
    }

    var modalLat = getElement('modal-lat');
    var modalLng = getElement('modal-lng');
    if (modalLat) modalLat.textContent = lat ? lat.toFixed(7) : '—';
    if (modalLng) modalLng.textContent = lng ? lng.toFixed(7) : '—';

    // Показываем время создания
    var timeInfo = '';
    if (flashStart) {
        var age = Date.now() - flashStart;
        var minutes = Math.floor(age / 60000);
        var seconds = Math.floor((age % 60000) / 1000);
        var isFlashing = age < 300000;
        var status = isFlashing ? '🔥 Новая (мигает)' : '⚫ Старая';
        timeInfo = '<div style="font-size: 10px; color: rgba(0,255,65,0.3); margin-top: 2px;">' +
            status + ' (' + minutes + 'м ' + seconds + 'с назад)</div>';
    }

    // Добавляем время в модальное окно
    var container = document.querySelector('#markerModal .coord-container:last-child');
    if (container) {
        var oldTime = container.querySelector('.marker-time-info');
        if (oldTime) oldTime.remove();

        var timeDiv = document.createElement('div');
        timeDiv.className = 'marker-time-info';
        timeDiv.innerHTML = timeInfo;
        container.appendChild(timeDiv);
    }

    // Получаем СК42
    if (lat && lng) {
        if (typeof window.getMarkerSK42 === 'function') {
            window.getMarkerSK42(lat, lng).then(function(data) {
                if (data && data.x !== undefined) {
                    var sk42X = getElement('modal-sk42-x');
                    var sk42Y = getElement('modal-sk42-y');
                    if (sk42X) sk42X.textContent = Math.round(data.x);
                    if (sk42Y) sk42Y.textContent = Math.round(data.y);
                }
            });
        }

        if (typeof window.getMarkerElevation === 'function') {
            window.getMarkerElevation(lat, lng).then(function(elevation) {
                if (elevation !== null) {
                    var elevEl = getElement('modal-elevation');
                    if (elevEl) elevEl.textContent = elevation.toFixed(1) + ' м';
                }
            });
        }
    }

    var modal = getElement('markerModal');
    if (modal) {
        modal.style.display = 'flex';
    }
};

// ============================================
// ЗАКРЫТИЕ МОДАЛЬНОГО ОКНА
// ============================================

window.closeMarkerModal = function() {
    var modal = getElement('markerModal');
    if (modal) {
        modal.style.display = 'none';
    }
    currentFeature = null;
};

// ============================================
// СОХРАНЕНИЕ МЕТКИ
// ============================================

window.saveMarker = async function() {
    if (!currentFeature) {
        log('Нет выбранной метки для сохранения', 'error');
        return;
    }

    var id = currentFeature.getId();
    var editLabel = getElement('editLabel');
    var newLabel = editLabel ? editLabel.value.trim() : 'Без названия';

    if (!newLabel) {
        newLabel = 'Без названия';
    }

    try {
        var res = await fetch(API.markers + '/' + id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label: newLabel })
        });

        var data = await res.json();

        if (res.ok) {
            currentFeature.set('label', newLabel);
            markerLayer.getSource().changed();

            log('Метка обновлена: ' + newLabel, 'success');
            alert('Метка сохранена!');

            closeMarkerModal();
            loadAllMarkersList();

            if (typeof updateMarkersCount === 'function') {
                updateMarkersCount();
            }
        } else {
            log('Ошибка сохранения: ' + (data.error || 'Неизвестная ошибка'), 'error');
            alert('Ошибка сохранения: ' + (data.error || 'Неизвестная ошибка'));
        }
    } catch(e) {
        log('Ошибка сохранения: ' + e.message, 'error');
        alert('Ошибка сохранения');
    }
};

// ============================================
// УДАЛЕНИЕ МЕТКИ ИЗ МОДАЛЬНОГО ОКНА
// ============================================

window.deleteMarkerFromModal = async function() {
    if (!currentFeature) {
        log('Нет выбранной метки для удаления', 'error');
        return;
    }

    if (!confirm('Удалить эту метку?')) return;

    var id = currentFeature.getId();

    if (typeof deleteMarker === 'function') {
        await deleteMarker(id, currentFeature);
    } else {
        try {
            var res = await fetch(API.markers + '/' + id, { method: 'DELETE' });
            if (res.ok) {
                markerLayer.getSource().removeFeature(currentFeature);
                log('Метка удалена', 'success');
            }
        } catch(e) {
            log('Ошибка удаления: ' + e.message, 'error');
        }
    }
    closeMarkerModal();
    loadAllMarkersList();
};

// ============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================

function createActionButton(text, title, onClick) {
    var btn = document.createElement('button');
    btn.textContent = text;
    btn.title = title;
    btn.addEventListener('click', onClick);
    return btn;
}

// ============================================
// ЗАГРУЗКА СПИСКА ВСЕХ МЕТОК
// ============================================

window.loadAllMarkersList = async function() {
    try {
        var res = await fetch(API.markers);
        var markers = await res.json();
        var list = getElement('allMarkersList');

        if (!list) {
            log('Элемент allMarkersList не найден', 'error');
            return;
        }

        list.innerHTML = '';

        if (markers.length === 0) {
            list.innerHTML = '<p style="color: rgba(0,255,65,0.4); text-align: center; padding: 20px; font-family: \'Courier New\', monospace;">Нет меток</p>';
            return;
        }

        // Сортируем по времени создания (новые сверху)
        markers.sort(function(a, b) {
            var timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
            var timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
            return timeB - timeA;
        });

        // Используем forEach вместо for - для правильного замыкания
        markers.forEach(function(m) {
            var markerId = m.id;
            var markerLabel = m.label || 'Без названия';
            var markerLat = m.lat;
            var markerLng = m.lng;
            var markerCreatedAt = m.created_at;

            // Проверяем, что created_at существует
            var isNew = false;
            if (markerCreatedAt) {
                var createdAt = new Date(markerCreatedAt).getTime();
                var now = Date.now();
                var age = now - createdAt;
                isNew = age < 300000;
            }

            // ========== ИСПРАВЛЕНО: создаем item ДО использования ==========
            var item = document.createElement('div');
            item.className = 'marker-item';
            item.setAttribute('data-marker-id', markerId);

            // Добавляем класс для новых меток
            if (isNew) {
                item.classList.add('new-marker');
            }

            // Информация о метке
            var info = document.createElement('div');
            info.className = 'info';

            // ========== ИСПРАВЛЕНО: используем newBadge ==========
            var newBadge = isNew ? '<span class="new-badge">🔥 NEW</span>' : '';

            // Получаем СК42
            fetch(API.convert, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ from: 'wgs84_to_sk42', lat: markerLat, lng: markerLng })
            })
            .then(function(skRes) { return skRes.json(); })
            .then(function(sk42) {
                var sk42Text = (sk42 && sk42.x !== undefined) ? 'X=' + Math.round(sk42.x) + ', Y=' + Math.round(sk42.y) : '—';
                info.innerHTML = `
                    <div class="name">${markerLabel} ${newBadge}</div>
                    <div class="coords">WGS84: ${markerLat.toFixed(6)}, ${markerLng.toFixed(6)}</div>
                    <div class="coords" style="color: rgba(0,255,65,0.5);">СК42: ${sk42Text}</div>
                    <div style="font-size: 9px; color: rgba(0,255,65,0.2); margin-top: 2px;">
                        ${markerCreatedAt ? new Date(markerCreatedAt).toLocaleString() : '—'}
                    </div>
                `;
            })
            .catch(function(e) {
                console.error('Ошибка получения СК42:', e);
                info.innerHTML = `
                    <div class="name">${markerLabel} ${newBadge}</div>
                    <div class="coords">WGS84: ${markerLat.toFixed(6)}, ${markerLng.toFixed(6)}</div>
                    <div class="coords" style="color: rgba(0,255,65,0.5);">СК42: —</div>
                    <div style="font-size: 9px; color: rgba(0,255,65,0.2); margin-top: 2px;">
                        ${markerCreatedAt ? new Date(markerCreatedAt).toLocaleString() : '—'}
                    </div>
                `;
            });

            // Кнопки действий
            var actions = document.createElement('div');
            actions.className = 'actions';

            // Кнопка "Перейти к метке"
            var gotoBtn = document.createElement('button');
            gotoBtn.textContent = '📍';
            gotoBtn.title = 'Перейти к метке';
            gotoBtn.addEventListener('click', function() {
                var coords = ol.proj.fromLonLat([markerLng, markerLat]);
                map.getView().animate({ center: coords, zoom: 15, duration: 1000 });
                var modal = getElement('allMarkersModal');
                if (modal) modal.style.display = 'none';
            });

            // Кнопка "Редактировать"
            var editBtn = document.createElement('button');
            editBtn.textContent = '✏️';
            editBtn.title = 'Редактировать';
            editBtn.addEventListener('click', function() {
                var modal = getElement('allMarkersModal');
                if (modal) modal.style.display = 'none';

                var features = markerLayer.getSource().getFeatures();
                var targetFeature = features.find(function(f) {
                    return f.getId() === markerId;
                });

                if (targetFeature) {
                    setTimeout(function() {
                        openMarkerModal(targetFeature);
                    }, 300);
                } else {
                    log('Метка не найдена в слое, создаем временную', 'warning');
                    var coords = ol.proj.fromLonLat([markerLng, markerLat]);
                    var tempFeature = new ol.Feature({
                        geometry: new ol.geom.Point(coords),
                        label: markerLabel,
                        id: markerId,
                        lat: markerLat,
                        lng: markerLng,
                        flashing: false,
                        flashStart: markerCreatedAt ? new Date(markerCreatedAt).getTime() : Date.now()
                    });
                    tempFeature.setId(markerId);
                    markerLayer.getSource().addFeature(tempFeature);
                    setTimeout(function() {
                        openMarkerModal(tempFeature);
                    }, 300);
                }
            });

            // Кнопка "Удалить"
            var deleteBtn = document.createElement('button');
            deleteBtn.textContent = '🗑️';
            deleteBtn.title = 'Удалить';
            deleteBtn.addEventListener('click', function() {
                var idToDelete = markerId;
                var labelToDelete = markerLabel;

                if (!confirm('Удалить метку "' + labelToDelete + '"?')) return;

                var features = markerLayer.getSource().getFeatures();
                var targetFeature = features.find(function(f) {
                    return f.getId() === idToDelete;
                });

                if (targetFeature) {
                    if (typeof deleteMarker === 'function') {
                        deleteMarker(idToDelete, targetFeature).then(function() {
                            loadAllMarkersList();
                            if (typeof updateMarkersCount === 'function') {
                                updateMarkersCount();
                            }
                        });
                    } else {
                        fetch(API.markers + '/' + idToDelete, { method: 'DELETE' })
                            .then(function(res) {
                                if (res.ok) {
                                    markerLayer.getSource().removeFeature(targetFeature);
                                    log('Метка удалена: ' + labelToDelete, 'success');
                                    loadAllMarkersList();
                                    if (typeof updateMarkersCount === 'function') {
                                        updateMarkersCount();
                                    }
                                }
                            })
                            .catch(function(e) {
                                log('Ошибка удаления: ' + e.message, 'error');
                            });
                    }
                } else {
                    fetch(API.markers + '/' + idToDelete, { method: 'DELETE' })
                        .then(function(res) {
                            if (res.ok) {
                                log('Метка удалена: ' + labelToDelete, 'success');
                                loadAllMarkersList();
                                if (typeof updateMarkersCount === 'function') {
                                    updateMarkersCount();
                                }
                            }
                        })
                        .catch(function(e) {
                            log('Ошибка удаления: ' + e.message, 'error');
                        });
                }
            });

            actions.appendChild(gotoBtn);
            actions.appendChild(editBtn);
            actions.appendChild(deleteBtn);

            item.appendChild(info);
            item.appendChild(actions);
            list.appendChild(item);
        });
    } catch(e) {
        log('Ошибка загрузки списка меток: ' + e.message, 'error');
        var list = getElement('allMarkersList');
        if (list) {
            list.innerHTML = '<p style="color: #ff4444; text-align: center; padding: 20px;">Ошибка загрузки меток</p>';
        }
    }
};

// ============================================
// МАСШТАБИРОВАНИЕ К МЕТКАМ
// ============================================

window.zoomToAllMarkers = function() {
    var features = markerLayer.getSource().getFeatures();
    if (features.length === 0) {
        alert('Нет меток для отображения');
        return;
    }

    var coordinates = features.map(function(f) {
        return f.getGeometry().getCoordinates();
    });

    if (coordinates.length === 1) {
        map.getView().animate({ center: coordinates[0], zoom: 15, duration: 1000 });
        var modal = getElement('allMarkersModal');
        if (modal) modal.style.display = 'none';
        return;
    }

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    coordinates.forEach(function(coord) {
        if (coord[0] < minX) minX = coord[0];
        if (coord[0] > maxX) maxX = coord[0];
        if (coord[1] < minY) minY = coord[1];
        if (coord[1] > maxY) maxY = coord[1];
    });

    var padding = Math.max((maxX - minX) * 0.2, (maxY - minY) * 0.2, 0.01);
    map.getView().fit([minX - padding, minY - padding, maxX + padding, maxY + padding], {
        padding: [50, 50, 50, 50],
        duration: 1500,
        maxZoom: 16
    });

    var modal = getElement('allMarkersModal');
    if (modal) modal.style.display = 'none';
    log('Показаны все метки: ' + features.length, 'success');
};

// ============================================
// ИНИЦИАЛИЗАЦИЯ UI
// ============================================

function initUI() {
    // Модальное окно метки
    var closeBtn = getElement('modalCloseBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeMarkerModal);
    }

    var modal = getElement('markerModal');
    if (modal) {
        modal.addEventListener('click', function(e) {
            if (e.target === this) closeMarkerModal();
        });
    }

    // Сохранение метки
    var saveBtn = getElement('modalSaveBtn');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveMarker);
    }

    // Удаление метки
    var deleteBtn = getElement('modalDeleteBtn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', deleteMarkerFromModal);
    }

    // Список всех меток
    var showAllBtn = getElement('btnShowAllMarkers');
    if (showAllBtn) {
        showAllBtn.addEventListener('click', function() {
            loadAllMarkersList();
            var modal = getElement('allMarkersModal');
            if (modal) modal.style.display = 'flex';
        });
    }

    var closeAllBtn = getElement('allMarkersCloseBtn');
    if (closeAllBtn) {
        closeAllBtn.addEventListener('click', function() {
            var modal = getElement('allMarkersModal');
            if (modal) modal.style.display = 'none';
        });
    }

    var allModal = getElement('allMarkersModal');
    if (allModal) {
        allModal.addEventListener('click', function(e) {
            if (e.target === this) this.style.display = 'none';
        });
    }

    // Показать все метки на карте
    var zoomBtn = getElement('allMarkersZoomBtn');
    if (zoomBtn) {
        zoomBtn.addEventListener('click', zoomToAllMarkers);
    }

    // Удалить все метки
    var deleteAllBtn = getElement('allMarkersDeleteAllBtn');
    if (deleteAllBtn) {
        deleteAllBtn.addEventListener('click', function() {
            if (confirm('Удалить все метки?')) {
                if (typeof clearAllMarkers === 'function') {
                    clearAllMarkers();
                } else {
                    log('Функция clearAllMarkers не определена', 'error');
                }
            }
        });
    }

    // Добавление метки
    var addBtn = getElement('addMarkerBtn');
    if (addBtn) {
        addBtn.addEventListener('click', function() {
            var center = map.getView().getCenter();
            var lonLat = ol.proj.toLonLat(center);
            var labelInput = getElement('labelInput');
            var label = labelInput ? labelInput.value.trim() : 'Без названия';
            if (!label) label = 'Без названия';

            if (typeof addMarker === 'function') {
                addMarker(lonLat[1], lonLat[0], label);
            } else {
                log('Функция addMarker не определена', 'error');
            }
        });
    }

    // Очистка всех меток
    var clearBtn = getElement('btnClearAll');
    if (clearBtn) {
        clearBtn.addEventListener('click', function() {
            if (confirm('Удалить все метки?')) {
                if (typeof clearAllMarkers === 'function') {
                    clearAllMarkers();
                } else {
                    log('Функция clearAllMarkers не определена', 'error');
                }
            }
        });
    }

    // Панель слоёв
    var toggleBtn = getElement('toggleLayersMenu');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', function() {
            var panel = getElement('layersPanel');
            if (panel) {
                var visible = panel.style.display !== 'block';
                panel.style.display = visible ? 'block' : 'none';
                if (visible) {
                    if (typeof loadMbtilesLayers === 'function') {
                        loadMbtilesLayers();
                    }
                    if (typeof loadKmlLayers === 'function') {
                        loadKmlLayers();
                    }
                }
            }
        });
    }

    // Загрузка MBTiles
    var uploadMbtilesBtn = getElement('uploadMbtilesBtn');
    if (uploadMbtilesBtn) {
        uploadMbtilesBtn.addEventListener('click', function() {
            if (typeof uploadMbtiles === 'function') {
                uploadMbtiles();
            } else {
                log('Функция uploadMbtiles не определена', 'error');
            }
        });
    }

    // Загрузка KML
    var uploadKmlBtn = getElement('uploadKmlBtn');
    if (uploadKmlBtn) {
        uploadKmlBtn.addEventListener('click', function() {
            if (typeof uploadKml === 'function') {
                uploadKml();
            } else {
                log('Функция uploadKml не определена', 'error');
            }
        });
    }

    // Загрузка HGT
    var uploadHgtBtn = getElement('uploadHgtBtn');
    if (uploadHgtBtn) {
        uploadHgtBtn.addEventListener('click', function() {
            if (typeof uploadHgt === 'function') {
                uploadHgt();
            } else {
                log('Функция uploadHgt не определена', 'error');
            }
        });
    }
}