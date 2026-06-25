import os
from datetime import datetime, timezone
from config import TelegramSettings
from flask import Flask
from flask_sqlalchemy import SQLAlchemy

settings = TelegramSettings()

BASE_DIR = settings.BASE_DIR
DB_PATH = settings.DB_PATH
UPLOAD_FOLDER = settings.UPLOAD_FOLDER
MBTILES_FOLDER = settings.MBTILES_FOLDER
HGT_FOLDER = settings.HGT_FOLDER
KML_FOLDER = settings.KML_FOLDER

# Создаём папки принудительно
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(MBTILES_FOLDER, exist_ok=True)
os.makedirs(HGT_FOLDER, exist_ok=True)
os.makedirs(KML_FOLDER, exist_ok=True)

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{DB_PATH}"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["MAX_CONTENT_LENGTH"] = 1024 * 1024 * 1024  # 1GB
app.config["KML_FOLDER"] = KML_FOLDER
db = SQLAlchemy(app)

class Marker(db.Model):
    __tablename__ = 'marker'

    id = db.Column(db.Integer, primary_key=True)
    lat = db.Column(db.Float, nullable=False)
    lng = db.Column(db.Float, nullable=False)
    label = db.Column(db.String(200), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    def to_dict(self):
        return {
            "id": self.id,
            "lat": self.lat,
            "lng": self.lng,
            "label": self.label,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }

class MBTilesLayer(db.Model):
    __tablename__ = 'mbtiles_layer'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    filename = db.Column(db.String(200), nullable=False)
    filepath = db.Column(db.String(500), nullable=False)
    visible = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "filename": self.filename,
            "visible": self.visible,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }

class HGTFile(db.Model):
    __tablename__ = 'hgt_file'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    filename = db.Column(db.String(200), nullable=False)
    filepath = db.Column(db.String(500), nullable=False)
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "filename": self.filename,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }

class KMLLayer(db.Model):
    id: object = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    filename = db.Column(db.String(200), nullable=False)
    filepath = db.Column(db.String(500), nullable=False)
    visible = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "filename": self.filename,
            "visible": self.visible,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }