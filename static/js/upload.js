// static/js/upload.js

// Загрузка MBTiles
async function uploadMbtiles() {
    var fileInput = getElement('mbtilesUpload');
    var nameInput = getElement('mbtilesName');

    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        alert('Выберите файл .mbtiles');
        return;
    }

    var file = fileInput.files[0];
    var formData = new FormData();
    formData.append('file', file);
    formData.append('name', nameInput ? nameInput.value || file.name.replace('.mbtiles', '') : file.name.replace('.mbtiles', ''));

    try {
        var res = await fetch(API.mbtiles + '/upload', { method: 'POST', body: formData });
        var data = await res.json();

        if (res.ok) {
            alert('Слой "' + data.name + '" загружен успешно!');
            fileInput.value = '';
            if (nameInput) nameInput.value = '';
            loadMbtilesLayers();
        } else {
            alert('Ошибка загрузки: ' + (data.error || ''));
        }
    } catch(e) {
        alert('Ошибка сети');
        log('Ошибка загрузки MBTiles: ' + e.message, 'error');
    }
}

// Загрузка KML
async function uploadKml() {
    var fileInput = getElement('kmlUpload');
    var nameInput = getElement('kmlName');

    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        alert('Выберите файл .kml');
        return;
    }

    var file = fileInput.files[0];
    var formData = new FormData();
    formData.append('file', file);
    formData.append('name', nameInput ? nameInput.value || file.name.replace('.kml', '') : file.name.replace('.kml', ''));

    try {
        var res = await fetch(API.kml + '/upload', { method: 'POST', body: formData });
        var data = await res.json();

        if (res.ok) {
            alert('KML слой "' + data.name + '" загружен успешно!');
            fileInput.value = '';
            if (nameInput) nameInput.value = '';
            await addKmlLayer(data);
            loadKmlLayers();
        } else {
            alert('Ошибка загрузки: ' + (data.error || ''));
        }
    } catch(e) {
        alert('Ошибка сети');
        log('Ошибка загрузки KML: ' + e.message, 'error');
    }
}

// Загрузка HGT
async function uploadHgt() {
    var fileInput = getElement('hgtUpload');

    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        alert('Выберите файл .hgt');
        return;
    }

    var file = fileInput.files[0];
    var formData = new FormData();
    formData.append('file', file);

    try {
        var res = await fetch(API.hgt + '/upload', { method: 'POST', body: formData });
        var data = await res.json();

        if (res.ok) {
            alert('Файл "' + data.name + '" загружен успешно!');
            fileInput.value = '';
            loadHgtFiles();
        } else {
            alert('Ошибка загрузки: ' + (data.error || ''));
        }
    } catch(e) {
        alert('Ошибка сети');
        log('Ошибка загрузки HGT: ' + e.message, 'error');
    }
}

// Загрузка HGT файлов
async function loadHgtFiles() {
    try {
        var res = await fetch(API.hgt + '/files');
        var files = await res.json();
        log('Загружено ' + files.length + ' HGT файлов', 'success');
    } catch(e) {
        log('Ошибка загрузки HGT файлов: ' + e.message, 'error');
    }
}