# 🔥 HeatNet Digital Twin

**Информационно-аналитическая и диспетчерская платформа для мониторинга тепловых сетей города Костанай**

[![Status](https://img.shields.io/badge/status-MVP-green)]() [![Node.js](https://img.shields.io/badge/backend-Node.js%20%2B%20Express-green)]() [![Database](https://img.shields.io/badge/database-SQLite%20%2B%20PostGIS%20ready-blue)]()

## 🎯 О проекте

HeatNet Digital Twin — единая цифровая модель тепловой инфраструктуры с:

- **GIS-карта** реальной сети с геолокацией объектов
- **Мониторинг параметров** (температура, давление, расход)
- **Анализ аварийности** с историческим анализом
- **Симуляция отключений** для расчета зоны влияния
- **Диспетчерская панель** с алертами и KPI
- **Полевой режим (PWA)** для мобильных бригад
- **GPS-мониторинг** автомобилей и бригад

**Важно:** Это исключительно информационно-аналитическая система. **Система НЕ управляет оборудованием.**

## 🚀 Быстрый старт

```bash
# Клонировать проект
git clone https://github.com/qw0rou/termovision.git
cd termovision

# Установить зависимости и импортировать данные
npm install
npm run import-all
node server/scripts/seed-demo.js

# Запустить сервер
npm start
```

Откройте http://localhost:4000

## 📊 Основные страницы

| URL | Описание |
|-----|---------|
| `/dashboard.html` | KPI и аналитика |
| `/index.html` | GIS-карта с симуляцией |
| `/mobile.html` | Полевой режим для бригад |

## 🔐 Demo аккаунты

```
dispatcher@demo.local  / Demo123!
engineer@demo.local    / Demo123!
field@demo.local       / Demo123!
manager@demo.local     / Demo123!
admin@demo.local       / Demo123!
```

## 📡 API Endpoints

```
Dashboard
  GET /api/dashboard              KPI и показатели
  GET /api/analytics/risk         Risk scores
  GET /api/analytics/impact       Расчет отключения

GIS & Карта
  GET /api/map                    GeoJSON (узлы, трубы)
  GET /api/spatial/nearby         Объекты рядом (GPS)

Operations
  GET /api/repairs                Ремонты
  GET /api/incidents              Аварии

Mobile / Field
  GET /api/mobile/tasks           Список заданий
  POST /api/mobile/inspections    Создать осмотр
  POST /api/mobile/sync           Offline-sync
```

## 📋 Основные сценарии

### 1. Просмотр Dashboard
Откройте `/dashboard.html` → смотрите KPI и тренды

### 2. Просмотр карты
Откройте `/index.html` → кликните на объект → паспорт

### 3. Симуляция отключения
На карте выберите участок → "Simulate outage" → получите зону влияния

### 4. Полевая бригада
Откройте `/mobile.html` на планшете → выполняйте задания → добавьте фото → синхронизируется

### 5. Offline режим
Отключите интернет → заполняйте форму → включите → автосинхронизация

## 📊 Импортированные данные

- **433** узлов
- **782** труб
- **6,455** потребителей
- **430** исторических аварий
- **192** дефектов

## 🗂️ Структура

```
server/
  ├── index.js          Express app
  ├── db.js             SQLite
  ├── routes/api.js     API endpoints
  ├── lib/
  │   ├── network.js    Topology engine
  │   ├── analytics.js  Analytics & scoring
  │   └── auth.js       Auth & RBAC
  └── scripts/
      ├── import-kml.js
      └── seed-demo.js  Demo data

web/
  ├── index.html        GIS map
  ├── dashboard.html    Executive dashboard
  ├── mobile.html       Field PWA
  └── js/app.js         Frontend logic
```

## 🔒 Безопасность

- ✅ Хеширование паролей
- ✅ JWT / Session auth
- ✅ RBAC (roles)
- ✅ Audit logging
- ✅ Input validation

## ✅ Реализованные функции

- [x] Dashboard с KPI
- [x] GIS-карта и topology
- [x] Outage simulation (граф)
- [x] Risk scoring
- [x] Mobile PWA
- [x] Offline sync
- [x] GPS tracking
- [x] Incident management
- [x] Work orders
- [x] Telemetry monitoring
- [x] Demo data & Docker

## 🚀 Deployment

```bash
# Docker
docker compose up

# Production: используйте PostgreSQL + PostGIS
```

## 📞 Поддержка

Проект разработан для ГКП "КТЭК", Костанай

**Version:** 0.1.0 (MVP)  
**Status:** 🟢 Production Ready  
**Last Updated:** August 13, 2026
