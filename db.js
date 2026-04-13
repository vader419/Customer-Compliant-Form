/**
 * Cospharm Complaint System — IndexedDB Database Layer
 * Provides persistent storage in the browser. No server required.
 */

const DB_NAME = 'CospharmDB';
const DB_VERSION = 1;

let _db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (_db) return resolve(_db);
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      // --- COMPLAINTS ---
      if (!db.objectStoreNames.contains('complaints')) {
        const cs = db.createObjectStore('complaints', { keyPath: 'id', autoIncrement: true });
        cs.createIndex('status', 'status', { unique: false });
        cs.createIndex('createdAt', 'createdAt', { unique: false });
        cs.createIndex('category', 'category', { unique: false });
        cs.createIndex('complaintType', 'complaintType', { unique: false });
        cs.createIndex('institution', 'institution', { unique: false });
      }

      // --- USERS (QA staff) ---
      if (!db.objectStoreNames.contains('users')) {
        const us = db.createObjectStore('users', { keyPath: 'id', autoIncrement: true });
        us.createIndex('username', 'username', { unique: true });
        us.createIndex('email', 'email', { unique: true });
      }

      // --- AUDIT TRAIL ---
      if (!db.objectStoreNames.contains('audit')) {
        const au = db.createObjectStore('audit', { keyPath: 'id', autoIncrement: true });
        au.createIndex('complaintId', 'complaintId', { unique: false });
        au.createIndex('userId', 'userId', { unique: false });
        au.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // --- SESSIONS ---
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'key' });
      }
    };

    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

// ─── Generic helpers ────────────────────────────────────────────────────────

function txGet(store, key) {
  return openDB().then(db => new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  }));
}

function txGetAll(store, indexName, query) {
  return openDB().then(db => new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const os = tx.objectStore(store);
    const req = indexName ? os.index(indexName).getAll(query) : os.getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  }));
}

function txPut(store, data) {
  return openDB().then(db => new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(data);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  }));
}

function txAdd(store, data) {
  return openDB().then(db => new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).add(data);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  }));
}

function txDelete(store, key) {
  return openDB().then(db => new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  }));
}

// ─── Simple password hashing (SHA-256 via Web Crypto) ────────────────────────

async function hashPassword(password) {
  const enc = new TextEncoder().encode(password + 'cospharm_salt_2026');
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── USER API ────────────────────────────────────────────────────────────────

const Users = {
  async create(data) {
    const existing = await txGetAll('users', 'username', data.username);
    if (existing.length) throw new Error('Username already exists');
    const hash = await hashPassword(data.password);
    return txAdd('users', {
      username: data.username,
      passwordHash: hash,
      fullName: data.fullName,
      email: data.email,
      role: data.role || 'qa_staff', // qa_staff | admin
      createdAt: new Date().toISOString(),
      active: true
    });
  },

  async authenticate(username, password) {
    const list = await txGetAll('users', 'username', username);
    if (!list.length) return null;
    const user = list[0];
    if (!user.active) return null;
    const hash = await hashPassword(password);
    if (hash !== user.passwordHash) return null;
    return user;
  },

  getAll() { return txGetAll('users'); },

  async getById(id) { return txGet('users', id); },

  async update(user) { return txPut('users', user); },

  async ensureDefaultAdmin() {
    const all = await txGetAll('users');
    if (!all.length) {
      await Users.create({
        username: 'admin',
        password: 'Cospharm@2026',
        fullName: 'System Administrator',
        email: 'supportna@cospharm.org',
        role: 'admin'
      });
      await Users.create({
        username: 'qa_team',
        password: 'QAteam@2026',
        fullName: 'QA Pharmacist',
        email: 'qa@cospharm.org',
        role: 'qa_staff'
      });
    }
  }
};

// ─── SESSION API ─────────────────────────────────────────────────────────────

const Session = {
  async save(user) {
    const token = crypto.randomUUID();
    await txPut('sessions', {
      key: 'current',
      token,
      userId: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      loginAt: new Date().toISOString()
    });
    return token;
  },

  async get() { return txGet('sessions', 'current'); },

  async clear() {
    try { await txDelete('sessions', 'current'); } catch(e) {}
  },

  async require(redirectTo = 'qa-login.html') {
    const sess = await Session.get();
    if (!sess) { window.location.href = redirectTo; return null; }
    return sess;
  }
};

// ─── COMPLAINTS API ──────────────────────────────────────────────────────────

function generateRef() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const r = Math.floor(Math.random()*9000)+1000;
  return `COS-${y}${m}-${r}`;
}

const Complaints = {
  async create(data) {
    const ref = generateRef();
    const id = await txAdd('complaints', {
      ...data,
      ref,
      status: 'open',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    await Audit.log({ complaintId: id, action: 'COMPLAINT_SUBMITTED', detail: `New complaint submitted. Ref: ${ref}`, userId: null, userName: data.contactPerson || 'Client' });
    return { id, ref };
  },

  async getAll() {
    const list = await txGetAll('complaints');
    return list.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async getById(id) { return txGet('complaints', id); },

  async update(complaint, userId, userName, changeNote) {
    complaint.updatedAt = new Date().toISOString();
    await txPut('complaints', complaint);
    await Audit.log({ complaintId: complaint.id, action: 'COMPLAINT_UPDATED', detail: changeNote || 'Complaint record updated', userId, userName });
    return complaint;
  },

  async updateStatus(id, status, userId, userName) {
    const c = await txGet('complaints', id);
    if (!c) throw new Error('Not found');
    c.status = status;
    c.updatedAt = new Date().toISOString();
    if (status === 'closed') c.closedAt = new Date().toISOString();
    await txPut('complaints', c);
    await Audit.log({ complaintId: id, action: 'STATUS_CHANGED', detail: `Status changed to: ${status.toUpperCase()}`, userId, userName });
  },

  async getStats() {
    const all = await Complaints.getAll();
    const total = all.length;
    const open = all.filter(c => c.status === 'open').length;
    const inProgress = all.filter(c => c.status === 'in_progress').length;
    const closed = all.filter(c => c.status === 'closed').length;

    // Complaint types breakdown
    const typeCounts = {};
    all.forEach(c => {
      const types = c.complaintTypes || [];
      types.forEach(t => { typeCounts[t] = (typeCounts[t]||0)+1; });
    });

    // By institution
    const instCounts = {};
    all.forEach(c => {
      if (c.institution) instCounts[c.institution] = (instCounts[c.institution]||0)+1;
    });

    // By category
    const catCounts = { Minor: 0, Major: 0, Critical: 0, Unclassified: 0 };
    all.forEach(c => {
      const cat = c.qaCategory || 'Unclassified';
      catCounts[cat] = (catCounts[cat]||0)+1;
    });

    // By month (last 6 months)
    const monthly = {};
    const now = new Date();
    for (let i=5; i>=0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
      const key = d.toLocaleString('default',{month:'short',year:'2-digit'});
      monthly[key] = 0;
    }
    all.forEach(c => {
      const d = new Date(c.createdAt);
      const key = d.toLocaleString('default',{month:'short',year:'2-digit'});
      if (monthly[key] !== undefined) monthly[key]++;
    });

    // Avg resolution days
    const resolved = all.filter(c => c.closedAt && c.createdAt);
    const avgDays = resolved.length
      ? Math.round(resolved.reduce((s,c) => s + (new Date(c.closedAt)-new Date(c.createdAt))/(1000*60*60*24), 0) / resolved.length)
      : 0;

    // Top decisions
    const decisions = {};
    all.forEach(c => {
      if (c.qaDecisions) c.qaDecisions.forEach(d => { decisions[d] = (decisions[d]||0)+1; });
    });

    return { total, open, inProgress, closed, typeCounts, instCounts, catCounts, monthly, avgDays, decisions };
  }
};

// ─── AUDIT API ───────────────────────────────────────────────────────────────

const Audit = {
  async log({ complaintId, action, detail, userId, userName }) {
    return txAdd('audit', {
      complaintId: complaintId || null,
      action,
      detail,
      userId: userId || null,
      userName: userName || 'System',
      timestamp: new Date().toISOString()
    });
  },

  async getAll() {
    const list = await txGetAll('audit');
    return list.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
  },

  async getForComplaint(complaintId) {
    const list = await txGetAll('audit', 'complaintId', complaintId);
    return list.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
  }
};

// Export
window.DB = { Users, Session, Complaints, Audit, openDB };
