import os
from datetime import datetime, timezone, timedelta
from typing import Optional
from sqlalchemy import String, Float, Boolean, DateTime, Integer
from sqlalchemy.orm import Mapped, mapped_column
from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from src.config import settings


MOSCOW_TZ = timezone(timedelta(hours=3))

# ==================== ПУТИ ====================
BASE_DIR = settings.BASE_DIR
DB_PATH = settings.DB_PATH

TEMPLATE_DIR = os.path.join(BASE_DIR, 'templates')
STATIC_DIR = os.path.join(BASE_DIR, 'static')

UPLOAD_FOLDER = settings.UPLOAD_FOLDER
MBTILES_FOLDER = settings.MBTILES_FOLDER
HGT_FOLDER = settings.HGT_FOLDER
KML_FOLDER = settings.KML_FOLDER

# Создаём папки
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(MBTILES_FOLDER, exist_ok=True)
os.makedirs(HGT_FOLDER, exist_ok=True)
os.makedirs(KML_FOLDER, exist_ok=True)

# ==================== FLASK APP ====================
app = Flask(
    __name__,
    template_folder=TEMPLATE_DIR,
    static_folder=STATIC_DIR
)

app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{DB_PATH}"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["MAX_CONTENT_LENGTH"] = 1024 * 1024 * 1024  # 1GB
app.config['TEMPLATES_AUTO_RELOAD'] = True
app.config["KML_FOLDER"] = KML_FOLDER

db = SQLAlchemy(app)


# ==================== МОДЕЛИ (SQLAlchemy 2.0 Style) ====================

class Marker(db.Model):
    __tablename__ = 'marker'

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    label: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(MOSCOW_TZ)
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "lat": self.lat,
            "lng": self.lng,
            "label": self.label,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }


class MBTilesLayer(db.Model):
    __tablename__ = 'mbtiles_layer'

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    filename: Mapped[str] = mapped_column(String(200), nullable=False)
    filepath: Mapped[str] = mapped_column(String(500), nullable=False)
    visible: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(MOSCOW_TZ)
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "filename": self.filename,
            "visible": self.visible,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }


class HGTFile(db.Model):
    __tablename__ = 'hgt_file'

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    filename: Mapped[str] = mapped_column(String(200), nullable=False)
    filepath: Mapped[str] = mapped_column(String(500), nullable=False)
    latitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    longitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(MOSCOW_TZ)
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "filename": self.filename,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }


class KMLLayer(db.Model):
    __tablename__ = 'kml_layer'

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    filename: Mapped[str] = mapped_column(String(200), nullable=False)
    filepath: Mapped[str] = mapped_column(String(500), nullable=False)
    visible: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(MOSCOW_TZ)
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "filename": self.filename,
            "visible": self.visible,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }