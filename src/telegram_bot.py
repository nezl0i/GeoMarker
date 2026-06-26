import asyncio
import re
from datetime import datetime, timezone, timedelta
from telethon import TelegramClient, events
import logging
import requests
from pyproj import Transformer
from src.config import settings
from src.websocket import emit_new_marker

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ============================================
# ЗАГРУЗКА КОНФИГУРАЦИИ ИЗ .ENV
# ============================================

API_ID = settings.API_ID
API_HASH = settings.API_HASH
PHONE_NUMBER = settings.PHONE_NUMBER
GROUP_ID = settings.GROUP_ID

MOSCOW_TZ = timezone(timedelta(hours=3))

class TelegramListener:
    def __init__(self, app, db, marker_model):
        self.app = app
        self.db = db
        self.Marker = marker_model
        self.client = None
        self.running = False
        self.group_entity = None
        self.session_name = f"telegram_session"  # Уникальное имя сессии

    async def start(self):
        """Запуск клиента Telegram"""
        try:
            logger.info(f"📡 Стартует Telegram клиент...")

            # Создаем клиент с уникальным именем сессии
            self.client = TelegramClient(self.session_name, API_ID, API_HASH, lang_code="ru", system_lang_code="ru-RU")

            # Устанавливаем параметры для уменьшения блокировок
            self.client.flood_sleep_threshold = 60

            # Запускаем клиент
            await self.client.start(phone=PHONE_NUMBER)
            logger.info("✅ Telegram клиент успешно запущен!")

            # Получаем группу
            try:
                self.group_entity = await self.client.get_entity(GROUP_ID)
                logger.info(f"✅ Успешное подключение к группе с ID: {GROUP_ID}")

            except ValueError:
                logger.error(f"❌ Неверный идентификатор группы: {GROUP_ID}")
                return
            except Exception as e:
                logger.error(f"❌ Ошибка чтения группы: {e}")
                return

            # Добавляем обработчик новых сообщений
            @self.client.on(events.NewMessage(chats=self.group_entity))
            async def handle_new_message(event):
                await self.process_message(event.message)

            self.running = True

            # Читаем последние сообщения для теста
            await self.read_recent_messages(limit=5)

            # Ожидание новых сообщений
            logger.info("🔄 Ожидание новых сообщений...")
            await self.client.run_until_disconnected()

        except Exception as e:
            logger.error(f"❌ Ошибка запуска Telegram клиента: {e}")
            if self.client:
                try:
                    await self.client.disconnect()
                except (Exception,):
                    pass

    async def read_recent_messages(self, limit=3):
        """Читает последние сообщения из группы"""
        try:
            if not self.group_entity:
                logger.error("❌ Группа не найдена")
                return

            messages = await self.client.get_messages(self.group_entity, limit=limit)
            logger.info(f"📥 Читаем {len(messages)} последних сообщения...")

            for msg in reversed(messages):
                if msg.text and msg.text.strip():
                    await self.process_message(msg)

                    # Небольшая пауза между сообщениями
                    await asyncio.sleep(0.5)

        except Exception as e:
            logger.error(f"❌ Ошибка чтения сообщения: {e}")

    async def process_message(self, message):
        """Обработка нового сообщения"""
        try:
            if not message.text:
                return

            text = message.text
            message_date = message.date.strftime('%Y-%m-%d %H:%M:%S')

            logger.info(f"📨 Найдено сообщение: {text[:100]}...")

            # Получаем имя отправителя
            sender_name = "Unknown"
            try:
                if message.sender_id:
                    sender = await message.get_sender()
                    if sender:
                        if hasattr(sender, 'first_name'):
                            sender_name = sender.first_name or sender.username or "Unknown"
                        elif hasattr(sender, 'title'):
                            sender_name = sender.title
            except Exception as e:
                logger.warning(f"⚠️ Не удалось определить отправителя: {e}")

            # Парсим сообщение с учетом имени отправителя
            parsed_data = parse_message_content(text, message_date, sender_name)

            if parsed_data:
                logger.info(f"✅ Парсим данные: {parsed_data}")
                await self.create_marker_from_data(parsed_data)
            else:
                logger.info("ℹ️ В сообщении отсутствуют данные для парсинга")

        except Exception as e:
            logger.error(f"❌ Ошибка парсинга сообщения: {e}")

    async def create_marker_from_data(self, data):
        """Создает метку из распарсенных данных"""
        try:
            x_val = data.get('x_value')
            y_val = data.get('y_value')
            agent = data.get('agent', 'Unknown')
            # message_text = data.get('message_text', '')
            message_date = data.get('message_date', datetime.now(MOSCOW_TZ).isoformat())

            if not x_val or not y_val:
                return

            # Конвертируем СК42 в WGS84
            crs_sk42 = 'EPSG:28406'
            crs_wgs84 = 'EPSG:4326'
            transformer = Transformer.from_crs(crs_sk42, crs_wgs84)

            # Преобразуем (долгота, широта) -> (lng, lat)
            lat, lng = transformer.transform(x_val, y_val)

            # Формируем название метки
            label = f"{agent} | {message_date}"

            # Сохраняем в БД
            try:
                with self.app.app_context():
                    marker = self.Marker(
                        lat=lat,
                        lng=lng,
                        label=label,
                        created_at=datetime.now(MOSCOW_TZ)
                    )
                    self.db.session.add(marker)
                    self.db.session.commit()

                    logger.info(f"✅ Метка создана: {label} at ({lat}, {lng})")

                    try:
                        # Вызываем API для обновления счетчиков на фронтенде
                        # requests.post('http://localhost:5000/api/markers/refresh', json={"marker_id": marker.id})
                        emit_new_marker(marker.to_dict())
                        logger.info(f"📡 WebSocket уведомление отправлено")
                    except (Exception,) as e:
                        logger.warning(f"⚠️ Ошибка отправки WebSocket: {e}")

            except Exception as db_error:
                logger.error(f"❌ Ошибка БД: {db_error}")
                self.db.session.rollback()

        except Exception as e:
            logger.error(f"❌ Ошибка создания метки: {e}")

    @staticmethod
    async def notify_frontend(marker):
        """Уведомляет фронтенд о новой метке"""
        logger.info(f"📡 Обнаружена новая метка: {marker.label}")

    async def stop(self):
        """Остановка клиента"""
        if self.client:
            try:
                await self.client.disconnect()
                logger.info("🛑 Telegram остановлен")
            except Exception as e:
                logger.error(f"❌ Ошибка остановки клиента: {e}")
            self.running = False

# ============================================
# ПАРСИНГ СООБЩЕНИЙ
# ============================================

def parse_message_content(text: str, message_date: str, sender_name: str = "Unknown"):
    """
    Парсинг сообщения на наличие ключевых слов и извлечение данных
    """

    def find_first(pattern: str) -> str | None:
        match = re.search(pattern, text)
        return match.group(0) if match else None

    # 1. Поиск агента (ключевые слова или имя отправителя)
    agent = None
    keywords = ['Пенициллин 9АБр', 'Аргус 30', 'Гармонь 30']

    for keyword in keywords:
        if keyword in text:
            agent = keyword
            break

    # Если ключевое слово не найдено, используем имя отправителя
    if not agent:
        agent = sender_name

    # 2. Поиск времени в формате HH:MM
    # real_time = None
    date_part = message_date.split()[0] if ' ' in message_date else message_date.split('T')[0]

    time_pattern = re.compile(r'\b(\d{1,2}):(\d{2})\b')
    time_match = time_pattern.search(text)

    if time_match:
        hour = time_match.group(1).zfill(2)
        minute = time_match.group(2)
        real_time = f'{date_part} {hour}:{minute}:00'
    else:
        real_time = message_date

    # 3. Поиск координат СК42
    x_val = find_first(r"\b(?:56|57)\d{5}\b")
    y_val = find_first(r"\b(?:66|67)\d{5}\b")

    # Если координаты не найдены, ищем 5-значные числа
    if not x_val and not y_val:
        numbers_5digit = re.findall(r"\b\d{5}\b", text)
        if len(numbers_5digit) >= 2:
            x_val = f"56{numbers_5digit[0]}"
            y_val = f"66{numbers_5digit[1]}"

            if len(numbers_5digit) >= 3:
                for i in range(len(numbers_5digit) - 1):
                    for j in range(i + 1, len(numbers_5digit)):
                        test_x = f"56{numbers_5digit[i]}"
                        test_y = f"66{numbers_5digit[j]}"
                        try:
                            if 5600000 <= float(test_x) <= 5799999 and 6600000 <= float(test_y) <= 6799999:
                                x_val = test_x
                                y_val = test_y
                                break
                        except ValueError:
                            continue
                    if x_val and y_val:
                        break

    # Если координаты найдены
    if x_val and y_val:
        try:
            x_float = float(x_val)
            y_float = float(y_val)
            if 5600000 <= x_float <= 5799999 and 6600000 <= y_float <= 6799999:
                return {
                    "x_value": x_val,
                    "y_value": y_val,
                    "agent": agent,
                    "message_text": text,
                    "message_date": real_time,
                }
        except ValueError:
            pass

    # Если координаты не найдены, но есть другие данные
    coord_pattern = re.compile(r'(\d{7})\s+(\d{7})')
    coord_match = coord_pattern.search(text)
    if coord_match:
        x_val = coord_match.group(1)
        y_val = coord_match.group(2)
        if x_val and y_val:
            return {
                "x_value": x_val,
                "y_value": y_val,
                "agent": agent,
                "message_text": text,
                "message_date": real_time,
            }

    return None