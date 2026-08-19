# Salesforce Standard CRUD Console

A full-stack React + Node.js application that uses Salesforce OAuth 2.0 Authorization Code flow and the Salesforce REST API to perform CRUD operations on:

- Account
- Opportunity
- Lead
- Contact
- Case

## Architecture

Browser (React) → Node/Express backend → Salesforce OAuth + REST API

The Salesforce access/refresh tokens are kept in the server-side session. The browser only calls the application's `/api/*` endpoints.

## 1. Salesforce setup

Create a Salesforce Developer Org if you do not already have one.

Then create an **External Client App**:

1. Salesforce Setup → External Client App Manager.
2. New External Client App.
3. Set a name, API name, contact email, and Local distribution state.
4. Enable OAuth.
5. Add the callback URL:
   - Local: `http://localhost:3000/oauth/callback`
   - Render: `https://YOUR-RENDER-SERVICE.onrender.com/oauth/callback`
6. Add OAuth scopes:
   - Manage user data via APIs (`api`)
   - Perform requests at any time (`refresh_token`, `offline_access`)
7. Enable the Web Server OAuth flow. This implementation also sends a PKCE S256 challenge.
8. Keep the client secret confidential. The application exchanges the authorization code on the Node server.

Important: the callback URL must exactly match the URL configured in Salesforce.

## 2. Local setup

Install Node.js 20+.

```bash
npm install
cp .env.example .env
```

Fill `.env`:

```text
SF_CLIENT_ID=...
SF_CLIENT_SECRET=...
SF_LOGIN_URL=https://login.salesforce.com
SF_REDIRECT_URI=http://localhost:3000/oauth/callback
SESSION_SECRET=<long-random-secret>
PORT=3000
```

Run development mode:

```bash
npm run dev
```

Open:

```text
http://localhost:5173
```

Vite proxies `/api` and `/oauth` to the Node server during development. Start both processes:

```bash
npm run dev
```

Then open:

```text
http://localhost:5173
```

For a production-style local test:

```bash
npm run build
npm start
```

Then open:

```text
http://localhost:3000
```

## 3. API behavior

The server uses Salesforce REST API version `v66.0`.

First page:

```text
GET /services/data/v66.0/query?q=SELECT...
```

The query requests 20 records. Salesforce returns `nextRecordsUrl` when more records are available. The application uses that URL as the infinite-scroll cursor, so it loads another 20 without using Salesforce's OFFSET limit.

CRUD endpoints:

```text
GET    /api/records?object=Account
GET    /api/records/:id?object=Account
POST   /api/records
PATCH  /api/records/:id
DELETE /api/records/:id?object=Account
```

The backend allowlists fields for each object, preventing arbitrary field writes from the browser.

## 4. Deploy free on Render

Render currently offers free web services, although free services spin down after 15 minutes of inactivity.

1. Push this project to GitHub.
2. Create a Render account.
3. New → Web Service.
4. Select the GitHub repository.
5. Choose the Free instance.
6. Build command:
   `npm install && npm run build`
7. Start command:
   `npm start`
8. Add environment variables:
   - `SF_CLIENT_ID`
   - `SF_CLIENT_SECRET`
   - `SF_LOGIN_URL=https://login.salesforce.com`
   - `SF_REDIRECT_URI=https://YOUR-RENDER-SERVICE.onrender.com/oauth/callback`
   - `SESSION_SECRET`
   - `NODE_ENV=production`
9. Deploy.
10. Copy the Render HTTPS URL and update the External Client App callback URL in Salesforce to the exact `/oauth/callback` URL.

## 5. Sandbox

For a Salesforce sandbox, change:

```text
SF_LOGIN_URL=https://test.salesforce.com
```

Keep the callback URL pointed at your application.

## 6. Notes for the assignment

The UI intentionally exposes 6 fields per object, which satisfies the 5–10 field requirement.

The initial record request is exactly 20 records. Infinite scroll loads Salesforce's `nextRecordsUrl` and requests the next batch.

View/Edit/Create use a reusable modal. Delete asks for confirmation.

The application does not use Salesforce's native Lightning UI for CRUD.

For a production deployment, replace the default in-memory Express session store with a persistent session store such as Redis, add CSRF protection, stronger validation, structured audit logging, and least-privilege OAuth scopes.
