# KTEK Heat SCADA Platform

Hackathon prototype for monitoring, analytics and dispatch of Kostanay heating networks. It has **no equipment-control endpoints**.

## Run

```powershell
copy .env.example .env
npm install
npm run import-all
npm start
```

Open http://localhost:4000. The dispatcher map uses the supplied KML and imported data. The field page is an offline-capable PWA; records queued while offline sync when connectivity returns. Telemetry and GPS/meter adapters are clearly labelled mock/simulated until real integration credentials are supplied.

## Handoff / scale-up

The prototype uses Express and SQLite for local demo speed. For deployment, move SQLite to managed PostgreSQL, run API instances behind a reverse proxy, and configure real GPS/heat-meter adapters from `.env`. Raw source files and original legacy prototypes are preserved unchanged under `server/data` and `web/legacy`.
