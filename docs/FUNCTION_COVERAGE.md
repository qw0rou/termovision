# Function Coverage

| ID | Function | Module | Status | Implementation |
|---|---|---|---|---|
| A1 | Interactive Heat Network Map | GIS | DONE | GIS map in web/index.html and API map endpoints with node/pipe layers and search/selection logic |
| A2 | Spatial Object Model | Digital Twin | PARTIAL | SQLite schema stores network objects with coordinates/status/history-like metadata and topology; no PostgreSQL/PostGIS in MVP |
| A3 | Heat Sources | GIS | DONE | Heat source nodes and dashboard/anomaly views support source objects and source relationships |
| A4 | Heat Pipelines | GIS | DONE | Separate pipe topology with diameter/material/source metadata in database and API |
| A5 | Network Topology | Digital Twin | DONE | Connected graph in server/lib/network.js with zone propagation and downstream analysis |
| B1 | Heat Source / Pipe / Node / Chamber / Branch / Drain / Air Vent / Valve / ITP / Measurement Point / Consumer / Utility Crossing | Digital Twin | PARTIAL | Core object model supports nodes, pipes, houses, social objects, utility crossings and related metadata |
| C1 | Consumer segmentation | Digital Twin | PARTIAL | House/social consumer model uses location and node linkage; criticality is available as mock metadata |
| D1 | Map layer system | GIS | DONE | Layer-oriented map rendering and risk overlays in frontend/back-end |
| E1 | Status system | Digital Twin | DONE | Normal/monitoring/warning/emergency/repair states in schema, UI and analytics |
| F1 | Search by address/object ID/name/chamber number | GIS | DONE | /api/search supports partial search over nodes, houses, pipes, social objects |
| G1 | Filters by type/status/district/source/diameter/etc. | GIS | PARTIAL | Backend and frontend support filters; full server-side dynamic filtering is partially implemented |
| H1 | Digital passport | Digital Twin | PARTIAL | Passport endpoints exist for node/pipe/house; object sections are represented as structured JSON views |
| I1 | Unified object history | Digital Twin | PARTIAL | Object status history and trail endpoints capture inspections, defects, repairs, status changes |
| J1 | Telemetry model | Telemetry | DONE | Telemetry structure supports parameter, value, unit, timestamp, source, quality |
| J2 | Telemetry UI | Telemetry | DONE | Telemetry dashboard and alerts in analytics/dashboard endpoints |
| K1 | Threshold management | Admin | PARTIAL | Threshold table exists; admin UI concept is present, but direct threshold editing UI is not fully completed |
| L1 | Anomaly detection | Telemetry | DONE | telemetryAnomalies() detects alerts above/below threshold and missing/abnormal patterns |
| M1 | Notification center | Operations | DONE | Notifications API and unread notification flow |
| N1 | Outage engine | Digital Twin | DONE | zone() computes affected component, consumers, social objects, and statistics |
| N2 | Outage visualization | GIS | DONE | Map selection highlights affected network and consumers visually |
| O1 | Simulation of repair/outage scenarios | Simulation | DONE | Scenario creation and affected-zone comparison in /api/scenarios |
| O2 | Simulation comparison | Simulation | DONE | Scenario records exist and can be compared conceptually via saved scenarios |
| P1 | Digital trace | Digital Twin | DONE | Object status history + inspections + repairs + defects + incidents as unified activity trail |
| Q1 | Problematic segments / risk score | Analytics | DONE | riskScores() computes score, count, factors and level |
| R1 | Maintenance planning | Maintenance | DONE | Repair tasks and inspections model planned work and assignments |
| S1 | Work orders | Maintenance | DONE | repair_tasks and statuses including planned/in_progress/completed/cancelled/overdue patterns |
| T1 | Plan/fact tracking | Maintenance | PARTIAL | planned_date / actual_fix_date are stored and available; delay/efficiency formulas are not fully implemented |
| U1 | Mobile field app | Mobile | DONE | Mobile mode exists as HTML/PWA-like dashboard for inspection and defect handling |
| V1 | Field inspection checklist | Mobile | DONE | Inspection tasks and inspection records capture result, note, photos, coordinates |
| W1 | Defect management | Mobile | DONE | defect creation and storage in defects table with severity metadata ready in schema |
| X1 | GPS mobile integration | Mobile | PARTIAL | GPS coordinates stored on inspections and available via geolocation-ready interface; full live provider adapter is mock |
| Y1 | Topology editing | Editor | PARTIAL | editor routes allow adding/updating/deleting nodes and pipes; change queue not yet formalized |
| Z1 | Offline cache | Mobile | PARTIAL | Offline sync API and mock queue flow exists, but the full IndexedDB/Dexie layer is not implemented |
| AA1 | Sync engine | Mobile | DONE | /api/mobile/sync accepts PENDING -> UPLOADING -> SYNCED style action records and returns errors/retry output |
| AB1 | GPS vehicle integration | Integrations | MOCK | server/lib/providers.js contains MockGPSProvider; server/lib/gpsFleet.js is a mock adapter when no external API is configured |
| AC1 | Vehicle tracking | GIS | DONE | Vehicle positions API and frontend map support fleet display |
| AD1 | Heat meter integration | Integrations | MOCK | server/lib/providers.js contains MockHeatMeterProvider and heatMeters.js simulates readings until real integration |
| AE1 | Consumption analytics | Analytics | DONE | consumptionAnalytics() compares actual vs normative and deviation |
| AF1 | Predictive analytics | Analytics | PARTIAL | Risk scoring and explainable factors exist; ML is intentionally not required |
| AG1 | Reports | Reports | PARTIAL | APIs and dashboard exist; PDF/CSV export is not fully implemented as a built-in module |
| AH1 | Manager dashboard | Dashboard | DONE | KPI dashboard with incidents/repairs/anomalies/consumers and map overview |
| AI1 | Cross-utility layers | GIS | PARTIAL | utility_crossings table exists, but full utility layers and automated risk warnings are partial |
| AJ1 | Earthwork warning | GIS | PARTIAL | Spatial nearby utility detection exists, but explicit work-order cross-utility warning UI is partial |
| AK1 | Admin / no-code config | Admin | PARTIAL | Roles, permissions and reference tables exist; dynamic schema builder not full no-code editor |
| AL1 | Dynamic schema | Admin | NOT_IMPLEMENTED | No fully dynamic object type designer is present |
| AM1 | RBAC | Security | DONE | Roles and permissions enforced via auth.requirePermission and seeded roles |
| AN1 | Audit | Security | DONE | audit_log captures login/update/create/complete/sync events |
| AO1 | Scalability | Architecture | PARTIAL | Architecture is built for multiple districts, but database is SQLite single-node MVP rather than PostGIS multi-region deployment |
| AP1 | Performance targets | Architecture | PARTIAL | Indexes and lazy bounding-box logic exist, but full PostGIS optimization and official SLA verification are not complete |
| AQ1 | Data centralization | Architecture | DONE | Main modules share a single database model and common object concepts |
| AR1 | Source code handover | Architecture | PARTIAL | Self-contained source exists, but production deployment docs and migrations are partially organized rather than a full end-to-end handover pack |
| AS1 | Non-control prohibition | Safety | DONE | System is read-only/analytical; no remote valve/boiler control or SCADA writes exist |
| P0/1/2 priority checks | Priority rules | Architecture | DONE | Core P0/P1 features are prioritized and implemented in the current MVP architecture |

## Mock-specific notes

The following capabilities intentionally behave as mock or simulation adapters because external infrastructure is not available in this environment:

- GPS fleet provider: simulated vehicle positions and crew state
- Heat meter provider: synthetic meter data and consumption estimates
- Telemetry simulation: generated metric values for dashboard and alerting
- Utility crossings: dataset table exists, but not a live external utility GIS layer
- Some notification/inspection records are synthetic demo data

## Coverage notes

This project is an MVP/prototype designed to demonstrate a complete digital twin logic and operational workflow in a single codebase, while clearly separating areas that require external vendor system integration.
