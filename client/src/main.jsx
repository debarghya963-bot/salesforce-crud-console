import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import salesforceLogo from "../../Salesforce-logo.webp";
const API = "";

function App() {
  const [session, setSession] = useState({ authenticated: false, instanceUrl: null });
  const [objects, setObjects] = useState([]);
  const [objectName, setObjectName] = useState("Account");
  const [records, setRecords] = useState([]);
  const [next, setNext] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [sentinel, setSentinel] = useState(null);

  const selectedObject = useMemo(
    () => objects.find((o) => o.name === objectName),
    [objects, objectName]
  );

  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/session`, {
        credentials: "include"
      }).then((r) => r.json()),
      fetch(`${API}/api/objects`, {
        credentials: "include"
      }).then((r) => r.json())
    ])
      .then(([sessionData, objectData]) => {
        setSession(sessionData);
        setObjects(objectData);
      })
      .catch(() => setError("Unable to initialize the application."));
  }, []);

  useEffect(() => {
    if (session.authenticated && objectName) {
      loadRecords(true);
    } else {
      setRecords([]);
      setNext(null);
    }
  }, [session.authenticated, objectName]);

  useEffect(() => {
    if (!sentinel || !session.authenticated || !next || loading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadRecords(false);
      },
      { rootMargin: "300px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, next, loading, session.authenticated]);

  async function loadRecords(reset) {
    if (loading) return;
    setLoading(true);
    setError("");

    try {
      const cursor = reset ? "" : `&next=${encodeURIComponent(next)}`;
      const response = await fetch(
        `${API}/api/records?object=${encodeURIComponent(objectName)}${cursor}`
      );
      const data = await response.json();

      if (!response.ok) throw new Error(data.message || data.error || "Unable to load records.");

      setRecords((current) => (reset ? data.records : [...current, ...data.records]));
      setNext(data.next);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function startCreate() {
    const fields = {};
    for (const field of selectedObject.fields) fields[field.name] = "";
    setModal({ mode: "create", record: fields });
    setError("");
  }

  function startEdit(record) {
    const fields = {};
    for (const field of selectedObject.fields) fields[field.name] = record[field.name] ?? "";
    setModal({ mode: "edit", id: record.Id, record: fields });
    setError("");
  }

  function startView(record) {
    const fields = {};
    for (const field of selectedObject.fields) fields[field.name] = record[field.name] ?? "";
    setModal({ mode: "view", id: record.Id, record: fields });
    setError("");
  }

  async function saveRecord() {
    setSaving(true);
    setError("");

    try {
      const method = modal.mode === "create" ? "POST" : "PATCH";
      const url =
        modal.mode === "create"
          ? `${API}/api/records`
          : `${API}/api/records/${encodeURIComponent(modal.id)}`;

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ object: objectName, fields: modal.record })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.message || data.error || "Save failed.");

      setModal(null);
      setMessage(modal.mode === "create" ? "Record created." : "Record updated.");
      await loadRecords(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteRecord(record) {
    const displayName = record.Name || record.Subject || record.Company || record.Id;
    if (!window.confirm(`Delete ${displayName}? This cannot be undone.`)) return;

    setError("");
    try {
      const response = await fetch(
        `${API}/api/records/${encodeURIComponent(record.Id)}?object=${encodeURIComponent(objectName)}`,
        { method: "DELETE" }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || data.error || "Delete failed.");

      setMessage("Record deleted.");
      await loadRecords(true);
    } catch (e) {
      setError(e.message);
    }
  }

  async function logout() {
    await fetch(`${API}/oauth/logout`, { method: "POST" });
    setSession({ authenticated: false, instanceUrl: null });
    setRecords([]);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">SALESFORCE PROJECT</div>
          <h1>CRUD APP</h1>
        </div>
        {session.authenticated ? (
          <button className="secondary" onClick={logout}>Log out</button>
        ) : null}
      </header>

      <main className="main">
        {!session.authenticated ? (
          <section className="login-card">
            <img
              src={salesforceLogo}
              alt="Salesforce"
              className="salesforce-logo"
            />
            <h2>Oauth Login Screen</h2>
            <p>
              Authenticate with Salesforce OAuth 2.0, choose a standard object,
              then create, view, update, and delete records through the REST API.
            </p>
              <a
                className="primary button-link"
                href="http://localhost:3000/oauth/login"
              >
                Log INTO Salesforce Org
              </a>           
              <div className="security-note">
              """
              <b>Created By : Debarghya Bera.</b>
              """
            </div>
          </section>
        ) : (
          <>
            <section className="toolbar">
              <div>
                <label htmlFor="object">Salesforce object</label>
                <select
                  id="object"
                  value={objectName}
                  onChange={(e) => setObjectName(e.target.value)}
                >
                  {objects.map((object) => (
                    <option key={object.name} value={object.name}>{object.label}</option>
                  ))}
                </select>
              </div>

              <div className="toolbar-right">
                <span className="connection">
                  Connected to {session.instanceUrl?.replace(/^https?:\/\//, "")}
                </span>
                <button className="primary" onClick={startCreate}>+ New {objectName}</button>
              </div>
            </section>

            {error && <div className="alert error">{error}</div>}
            {message && <div className="alert success">{message}</div>}

            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>{selectedObject?.label} records</h2>
                  <span>{records.length} loaded · 20 records per request</span>
                </div>
                <button className="secondary" onClick={() => loadRecords(true)} disabled={loading}>
                  Refresh
                </button>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {selectedObject?.fields.map((field) => (
                        <th key={field.name}>{field.label}</th>
                      ))}
                      <th className="actions-col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((record) => (
                      <tr key={record.Id}>
                        {selectedObject?.fields.map((field) => (
                          <td key={field.name} title={String(record[field.name] ?? "")}>
                            {formatValue(record[field.name], field.type)}
                          </td>
                        ))}
                        <td className="actions">
                          <button onClick={() => startView(record)}>View</button>
                          <button onClick={() => startEdit(record)}>Edit</button>
                          <button className="danger-text" onClick={() => deleteRecord(record)}>Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {!records.length && !loading && (
                  <div className="empty">No records found.</div>
                )}
              </div>

              <div ref={setSentinel} className="load-more">
                {loading ? "Loading records…" : next ? "Scroll to load more" : records.length ? "All available records loaded" : ""}
              </div>
            </section>
          </>
        )}
      </main>

      {modal && (
        <RecordModal
          modal={modal}
          object={selectedObject}
          onClose={() => setModal(null)}
          onChange={(record) => setModal((m) => ({ ...m, record }))}
          onSave={saveRecord}
          saving={saving}
        />
      )}
    </div>
  );
}

function RecordModal({ modal, object, onClose, onChange, onSave, saving }) {
  const readOnly = modal.mode === "view";

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="eyebrow">{object.label}</div>
            <h2>{modal.mode === "create" ? `New ${object.label}` : modal.mode === "edit" ? `Edit ${object.label}` : `View ${object.label}`}</h2>
          </div>
          <button className="icon-button" onClick={onClose}>×</button>
        </div>

        <div className="form-grid">
          {object.fields.map((field) => (
            <label key={field.name} className={field.type === "textarea" ? "full" : ""}>
              <span>{field.label}{field.required ? " *" : ""}</span>
              {field.type === "textarea" ? (
                <textarea
                  value={modal.record[field.name] ?? ""}
                  readOnly={readOnly}
                  onChange={(e) => onChange({ ...modal.record, [field.name]: e.target.value })}
                  rows="4"
                />
              ) : (
                <input
                  type={field.type}
                  value={modal.record[field.name] ?? ""}
                  readOnly={readOnly}
                  onChange={(e) => onChange({ ...modal.record, [field.name]: e.target.value })}
                />
              )}
            </label>
          ))}
        </div>

        <div className="modal-foot">
          <button className="secondary" onClick={onClose}>Close</button>
          {!readOnly && (
            <button className="primary" onClick={onSave} disabled={saving}>
              {saving ? "Saving…" : modal.mode === "create" ? "Create record" : "Save changes"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function formatValue(value, type) {
  if (value === null || value === undefined || value === "") return "—";
  if (type === "number") return Number(value).toLocaleString();
  return String(value);
}

createRoot(document.getElementById("root")).render(<App />);
