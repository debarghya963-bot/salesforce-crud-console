import "dotenv/config";
import express from "express";
import session from "express-session";
import cookieParser from "cookie-parser";
import compression from "compression";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const app = express();
const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");
const CLIENT_DIST = path.join(ROOT, "client", "dist");

app.set("trust proxy", 1);
app.use(compression());
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

app.use(session({
  secret: process.env.SESSION_SECRET || "development-only-secret-change-me",
  resave: false,
  saveUninitialized: false,
cookie: {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production" && process.env.USE_HTTPS === "true",
  maxAge: 8 * 60 * 60 * 1000
}
}));

const OBJECTS = {
  Account: {
    label: "Account",
    fields: [
      { name: "Name", label: "Account Name", type: "text", required: true },
      { name: "Industry", label: "Industry", type: "text" },
      { name: "Phone", label: "Phone", type: "tel" },
      { name: "Website", label: "Website", type: "url" },
      { name: "Type", label: "Type", type: "text" },
      { name: "BillingCity", label: "Billing City", type: "text" }
    ]
  },
  Opportunity: {
    label: "Opportunity",
    fields: [
      { name: "Name", label: "Opportunity Name", type: "text", required: true },
      { name: "StageName", label: "Stage", type: "text", required: true },
      { name: "CloseDate", label: "Close Date", type: "date", required: true },
      { name: "Amount", label: "Amount", type: "number" },
      { name: "Probability", label: "Probability (%)", type: "number" },
      { name: "Type", label: "Type", type: "text" }
    ]
  },
  Lead: {
    label: "Lead",
    fields: [
      { name: "FirstName", label: "First Name", type: "text" },
      { name: "LastName", label: "Last Name", type: "text", required: true },
      { name: "Company", label: "Company", type: "text", required: true },
      { name: "Status", label: "Status", type: "text", required: true },
      { name: "Email", label: "Email", type: "email" },
      { name: "Phone", label: "Phone", type: "tel" }
    ]
  },
  Contact: {
    label: "Contact",
    fields: [
      { name: "FirstName", label: "First Name", type: "text" },
      { name: "LastName", label: "Last Name", type: "text", required: true },
      { name: "Email", label: "Email", type: "email" },
      { name: "Phone", label: "Phone", type: "tel" },
      { name: "Title", label: "Title", type: "text" },
      { name: "AccountId", label: "Account ID", type: "text" }
    ]
  },
  Case: {
    label: "Case",
    fields: [
      { name: "Subject", label: "Subject", type: "text", required: true },
      { name: "Status", label: "Status", type: "text", required: true },
      { name: "Priority", label: "Priority", type: "text" },
      { name: "Origin", label: "Origin", type: "text", required: true },
      { name: "Type", label: "Type", type: "text" },
      { name: "Description", label: "Description", type: "textarea" }
    ]
  }
};

function getConfig() {
  const required = ["SF_CLIENT_ID", "SF_CLIENT_SECRET", "SF_LOGIN_URL", "SF_REDIRECT_URI"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  return {
    clientId: process.env.SF_CLIENT_ID,
    clientSecret: process.env.SF_CLIENT_SECRET,
    loginUrl: process.env.SF_LOGIN_URL.replace(/\/$/, ""),
    redirectUri: process.env.SF_REDIRECT_URI
  };
}

function requireAuth(req, res, next) {
  if (!req.session.sf) return res.status(401).json({ error: "Not authenticated" });
  next();
}

function getObjectConfig(name) {
  if (!OBJECTS[name]) {
    const err = new Error("Unsupported Salesforce object.");
    err.status = 400;
    throw err;
  }
  return OBJECTS[name];
}

function getFieldNames(objectName) {
  return getObjectConfig(objectName).fields.map((f) => f.name);
}

function buildSoql(objectName) {
  const fields = ["Id", "CreatedDate", ...getFieldNames(objectName)];
  return `SELECT ${[...new Set(fields)].join(", ")} FROM ${objectName} ORDER BY CreatedDate DESC LIMIT 20`;
}

async function salesforceFetch(req, url, options = {}) {
  const sf = req.session.sf;
  const headers = {
    Accept: "application/json",
    ...(options.headers || {}),
    Authorization: `Bearer ${sf.accessToken}`
  };

  let response = await fetch(url, { ...options, headers });

  // Retry once after refreshing an expired access token.
  if (response.status === 401 && sf.refreshToken) {
    const refreshed = await refreshAccessToken(req);
    if (refreshed) {
      headers.Authorization = `Bearer ${req.session.sf.accessToken}`;
      response = await fetch(url, { ...options, headers });
    }
  }

  return response;
}

async function refreshAccessToken(req) {
  const sf = req.session.sf;
  if (!sf?.refreshToken) return false;

  const config = getConfig();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: sf.refreshToken
  });

  const response = await fetch(`${config.loginUrl}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!response.ok) return false;

  const token = await response.json();
  req.session.sf.accessToken = token.access_token;
  if (token.instance_url) req.session.sf.instanceUrl = token.instance_url;
  return true;
}

async function readSalesforceError(response) {
  let data;
  try {
    data = await response.json();
  } catch {
    return { message: `Salesforce request failed with HTTP ${response.status}` };
  }
  if (Array.isArray(data)) {
    return {
      message: data.map((e) => e.message || e.errorCode || "Salesforce error").join("; "),
      details: data
    };
  }
  return { message: data.message || "Salesforce request failed", details: data };
}

// OAuth: authorization-code web server flow.
app.get("/oauth/login", (req, res) => {
  const config = getConfig();
  const state = cryptoRandom();
  const codeVerifier = cryptoRandom() + cryptoRandom();
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  req.session.oauthState = state;
  req.session.oauthCodeVerifier = codeVerifier;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: "api refresh_token offline_access",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256"
  });

  res.redirect(`${config.loginUrl}/services/oauth2/authorize?${params.toString()}`);
});

app.get("/oauth/callback", async (req, res) => {
console.log("=== OAUTH CALLBACK HIT ===");
console.log("Callback URL:", req.originalUrl);
console.log("Has code:", Boolean(req.query.code));
console.log("Has state:", Boolean(req.query.state));
  try {
    const config = getConfig();

    if (!req.query.state || req.query.state !== req.session.oauthState) {
      return res.status(400).send("Invalid OAuth state.");
    }
    delete req.session.oauthState;

    if (!req.query.code) {
      return res.status(400).send("Salesforce did not return an authorization code.");
    }

    const codeVerifier = req.session.oauthCodeVerifier;
    delete req.session.oauthCodeVerifier;

    if (!codeVerifier) {
      return res.status(400).send("Missing OAuth PKCE verifier.");
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: req.query.code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      code_verifier: codeVerifier
    });

    const response = await fetch(`${config.loginUrl}/services/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });

    if (!response.ok) {
      const error = await readSalesforceError(response);
      return res.status(502).send(`OAuth token exchange failed: ${error.message}`);
    }

    const token = await response.json();
req.session.sf = {
  accessToken: token.access_token,
  refreshToken: token.refresh_token,
  instanceUrl: token.instance_url,
  issuedAt: Date.now()
};

console.log("========== TOKEN RECEIVED ==========");
console.log("Instance URL:", token.instance_url);
console.log("Session authenticated:", Boolean(req.session.sf));

req.session.save((saveError) => {
  if (saveError) {
    console.error("SESSION SAVE ERROR:", saveError);
    return res.status(500).send("Unable to save login session.");
  }

  console.log("SESSION SAVED SUCCESSFULLY");

res.redirect("http://localhost:3000");
});
  } catch (error) {
    console.error(error);
    res.status(500).send("OAuth callback failed.");
  }
});

app.post("/oauth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/session", (req, res) => {
  console.log("========== SESSION CHECK ==========");
  console.log("Session ID:", req.sessionID);
  console.log("Authenticated:", Boolean(req.session.sf));

  res.json({
    authenticated: Boolean(req.session.sf),
    instanceUrl: req.session.sf?.instanceUrl || null
  });
});

app.get("/api/objects", (req, res) => {
  res.json(Object.entries(OBJECTS).map(([name, config]) => ({
    name,
    label: config.label,
    fields: config.fields
  })));
});

app.get("/api/records", requireAuth, async (req, res) => {
  try {
    const objectName = String(req.query.object || "");
    getObjectConfig(objectName);

    const next = req.query.next ? decodeURIComponent(String(req.query.next)) : null;
    let url;

    if (next) {
      if (!next.startsWith("/services/data/")) {
        return res.status(400).json({ error: "Invalid pagination cursor." });
      }
      url = `${req.session.sf.instanceUrl}${next}`;
    } else {
      const soql = encodeURIComponent(buildSoql(objectName));
      url = `${req.session.sf.instanceUrl}/services/data/v66.0/query?q=${soql}`;
    }

    const response = await salesforceFetch(req, url);
    if (!response.ok) {
      const error = await readSalesforceError(response);
      return res.status(response.status).json(error);
    }

    const data = await response.json();
    res.json({
      records: data.records || [],
      next: data.nextRecordsUrl || null,
      done: Boolean(data.done)
    });
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ error: error.message || "Unable to load records." });
  }
});

app.get("/api/records/:id", requireAuth, async (req, res) => {
  try {
    const objectName = String(req.query.object || "");
    getObjectConfig(objectName);

    const fields = ["Id", "CreatedDate", ...getFieldNames(objectName)].join(",");
    const url = `${req.session.sf.instanceUrl}/services/data/v66.0/sobjects/${objectName}/${encodeURIComponent(req.params.id)}?fields=${encodeURIComponent(fields)}`;
    const response = await salesforceFetch(req, url);

    if (!response.ok) {
      const error = await readSalesforceError(response);
      return res.status(response.status).json(error);
    }
    res.json(await response.json());
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Unable to load record." });
  }
});

function cleanPayload(objectName, input) {
  const allowed = new Set(getFieldNames(objectName));
  const payload = {};

  for (const [key, value] of Object.entries(input || {})) {
    if (allowed.has(key)) {
      payload[key] = value === "" ? null : value;
    }
  }
  return payload;
}

app.post("/api/records", requireAuth, async (req, res) => {
  try {
    const objectName = String(req.body?.object || "");
    getObjectConfig(objectName);
    const payload = cleanPayload(objectName, req.body?.fields);

    const url = `${req.session.sf.instanceUrl}/services/data/v66.0/sobjects/${objectName}`;
    const response = await salesforceFetch(req, url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await readSalesforceError(response);
      return res.status(response.status).json(error);
    }

    res.status(201).json(await response.json());
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Unable to create record." });
  }
});

app.patch("/api/records/:id", requireAuth, async (req, res) => {
  try {
    const objectName = String(req.body?.object || "");
    getObjectConfig(objectName);
    const payload = cleanPayload(objectName, req.body?.fields);

    const url = `${req.session.sf.instanceUrl}/services/data/v66.0/sobjects/${objectName}/${encodeURIComponent(req.params.id)}`;
    const response = await salesforceFetch(req, url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await readSalesforceError(response);
      return res.status(response.status).json(error);
    }

    res.json({ success: true, id: req.params.id });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Unable to update record." });
  }
});

app.delete("/api/records/:id", requireAuth, async (req, res) => {
  try {
    const objectName = String(req.query.object || "");
    getObjectConfig(objectName);

    const url = `${req.session.sf.instanceUrl}/services/data/v66.0/sobjects/${objectName}/${encodeURIComponent(req.params.id)}`;
    const response = await salesforceFetch(req, url, { method: "DELETE" });

    if (!response.ok) {
      const error = await readSalesforceError(response);
      return res.status(response.status).json(error);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Unable to delete record." });
  }
});

function cryptoRandom() {
  return [...cryptoRandomBytes(24)].map((n) => n.toString(16).padStart(2, "0")).join("");
}

function cryptoRandomBytes(size) {
  return randomBytes(size);
}

app.use(express.static(CLIENT_DIST));

app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(CLIENT_DIST, "index.html"));
});
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Salesforce CRUD app listening on port ${PORT}`);
});
