import os
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class TelegramSettings(BaseSettings):
    """Настройки API Telegram из переменных окружения или .env файла"""
    BASE_DIR: str = str(Path(__file__).resolve().parent.parent)
    DB_FOLDER: str = os.path.join(BASE_DIR, 'instance')
    DB_PATH: str = f"{DB_FOLDER}/markers.db"

    UPLOAD_FOLDER: str = os.path.join(BASE_DIR, 'uploads')
    MBTILES_FOLDER: str = os.path.join(UPLOAD_FOLDER, 'mbtiles')
    HGT_FOLDER: str = os.path.join(UPLOAD_FOLDER, 'hgt')
    KML_FOLDER: str = os.path.join(UPLOAD_FOLDER, 'kml')

    API_ID: int = 0
    API_HASH: str = ""
    PHONE_NUMBER: str = ""
    GROUP_ID: int = 0

    # Настройки карты
    DEFAULT_ZOOM: int = 13
    DEFAULT_CENTER_LAT: float = 51.08638
    DEFAULT_CENTER_LNG: float = 34.90163

    model_config = SettingsConfigDict(env_file=f"{BASE_DIR}/.env")

settings = TelegramSettings()