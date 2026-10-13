# TokenFlow

Digital queues for banks, hospitals, police stations and public-service branches. The existing visual design and logo are retained.

## Quick start: shared laptop + phone demo

Requires Python 3.10+ with pip. The ZIP includes the built frontend.

```sh
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r backend/requirements.txt
python run_demo.py
```

Open the printed LAN address on your laptop and phone on the same Wi-Fi. Allow port 5000 through your local firewall if needed. The launcher prints a first-admin setup key when no administrator exists. Choose Admin setup and enter that key; then create a customer account in a separate browser session to demonstrate both roles.

### Live ticket walkthrough

Install the backend dependencies and start the demo from the project root:

```sh
pip install -r backend/requirements.txt
python run_demo.py
```

1. **Admin dashboard:** Open Admin login or account setup, enter the first-admin setup key printed in the server terminal, and create the admin account. Open the dashboard to review Now Serving, counter recommendations, and the simulation comparison.
2. **Customer:** In a separate browser session, create a customer account, choose a service, and generate a ticket.
3. **QR scan:** Open the ticket QR code with a phone on the same Wi-Fi and follow its link to the live ticket page.
4. **Call the ticket:** Return to the admin dashboard and call the waiting ticket. The customer ticket page polls for updates and reflects the call live.

If automatic IP selection is incorrect, set PUBLIC_ORIGIN to http://YOUR-LAPTOP-LAN-IP:5000 before launching. A phone cannot reach the laptop through localhost. The QR contains a link: scan it and tap the link to open live ticket details without signing in.

The local development server is suitable for the demonstration. For internet access, deploy behind HTTPS using a production server. Browser notifications normally require HTTPS (or localhost) and permission; in-app alerts work while the page is open on the LAN demo. Closed-page push delivery is not implemented.

## Existing installation

Back up and retain your existing backend/tokenflow.db and private .env files before copying updated source. This distribution deliberately excludes private environment files, databases, credentials and installed dependencies. It does not erase your original data. Existing ticket records remain compatible. Old unsigned tracking links must be replaced: sign in as the ticket owner and open the ticket to generate a new QR.

## Features

- Customer registration, login, service selection, idempotent digital tickets and cancellation.
- Admin counter controls, live Now Serving, queue updates and branch instructions.
- Ticket name, number, issue time, branch, service, position, people ahead, estimate, readable counter and current instructions.
- Live updates every three seconds, stale-data/error feedback and deduplicated approaching/called alerts. No SMS integration.
- Signed read-only QR links, 48-hour expiry, owner-controlled replacement/revocation and limited public fields. Anyone with the link can view the ticket name; do not share it publicly. Completed/cancelled tickets become unavailable after 24 hours.
- Actual waiting/service-time averages with sample counts, completed tokens, queue length and initial prediction error where measured records exist.
- Recommendations estimate the current queue improvement from opening an available counter. An administrator chooses whether to act; sufficient staff and unchanged service times are assumptions.
- Repeatable FIFO simulation comparison with identical arrivals/service durations, adjustable counter counts, measured wait reduction and CSV export. Comparison does not alter the live queue. Live simulated-arrival controls are separately available for demonstrations.

## Architecture

React/Vite customer and admin pages call a Flask JSON API. The default SQLite store applies queue changes transactionally. A shared queue engine calculates positions and estimates from active counters and observed service duration, with configured defaults for new branches. Clients poll the shared API; the browser showcase instead stores state locally and cannot share a queue across devices.

Authentication and queue mutations require an account bearer token. Public tracking requires a separate signed ticket capability carried in the URL fragment and sent to the API in an Authorization header. It grants no queue mutation rights. The signing secret must remain stable across restarts; the local launcher creates backend/.session-secret when SECRET_KEY is unset.

The optional Firebase mode uses Firebase Authentication and Firestore through the backend. Admin roles are provisioned by a trusted operator using backend/create_admin.py. Keep Firebase service-account credentials server-side.

## Develop and deploy

```sh
cd frontend
npm install
npm run dev
npm run build
```

Use Node 22+ for Vite 8. The default build writes ../dist and uses /api. For separate frontend/backend deployments, build with VITE_APP_MODE=api and VITE_API_URL=https://YOUR-BACKEND/api. Set backend PUBLIC_ORIGIN to the frontend HTTPS origin and FRONTEND_ORIGIN to the same allowed origin. Configure SECRET_KEY, STORE_MODE, database credentials and ADMIN_SETUP_KEY as appropriate. Set SIMULATION_ENABLED=false for deployments that should not allow simulated arrivals. See the provided environment examples, render.yaml, vercel.json and Firebase configuration; configure actual project identifiers before deployment.

For local development with separate ports, use frontend/.env with VITE_API_URL=http://localhost:5000/api and set backend PUBLIC_ORIGIN=http://localhost:5173. Cross-device use is easiest with run_demo.py instead.

npm run build:showcase creates dist-showcase with browser-local simulated state. This is an explicitly separate demonstration mode, not the multi-device backend application.

For an explicit browser-only demo with simulated queue data, set `VITE_APP_MODE=demo` in `frontend/.env` and restart Vite. Admin sign-in accepts any valid-format email and any non-empty password in this mode, and the header shows a **Demo Mode** badge. The default `api` mode and Firebase mode continue to require real Admin credentials. Never deploy a `demo` build as a production application.

## Verification

```sh
python -m pytest backend/tests -q
cd frontend
npm test
npm run build
```

Verified in the repair environment: 24 backend tests; frontend queue/upgrade tests; API and showcase production builds. Coverage includes a separate scanner client, QR revocation/expiry/tampering, unauthorized mutations, concurrent duplicate requests, counter races, old ticket records, recommendation scope and deterministic simulation.

Default simulation: 15 simultaneous arrivals, seed 42, five-minute nominal service with 20% variation, 30-minute reporting horizon. One counter averages 33.29 minutes wait; three counters average 9.44 minutes, a 71.6% reduction in this simulated workload. This is not a real-world measured impact or a staffing-cost saving.

Physical phone-camera scanning, visual browser interaction and live Firebase deployment were not verified in this environment. Before presenting, run the LAN demo on the actual laptop and phone, scan a ticket, call it from the admin dashboard and confirm its live update. Keep the application open for alerts.
