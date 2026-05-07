/**
 * Cospharm Complaint System — Supabase Database Layer
 * Replaces IndexedDB with a real shared PostgreSQL database via Supabase.
 *
 * ── SETUP ──────────────────────────────────────────────────────────────────
 * 1. Go to https://supabase.com and create a free project
 * 2. Replace the two values below with your project URL and anon key
 * 3. Run the SQL in SUPABASE_SETUP.sql in the Supabase SQL Editor
 * ───────────────────────────────────────────────────────────────────────────
 */

const SUPABASE_URL  = 'YOUR_SUPABASE_URL';   // e.g. https://xyzabc.supabase.co
const SUPABASE_KEY  = 'YOUR_SUPABASE_ANON_KEY'; // your project's anon/public key

// ── Load Supabase client from CDN ────────────────────────────────────────────
// (added to each HTML page via <script> tag — see the HTML files)

function getClient() {
  if (typeof supabase === 'undefined' || !supabase.createClient) {
    console.error('Supabase JS client not loaded. Make sure the CDN script tag is present.');
    return null;
  }
  if (!window._supabaseClient) {
    window._supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return window._supabaseClient;
}

// ── Simple password hashing (SHA-256 via Web Crypto) ─────────────────────────
async function hashPassword(password) {
  const enc = new TextEncoder().encode(password + 'cospharm_salt_2026');
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Reference number generator ────────────────────────────────────────────────
function generateRef() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const r = Math.floor(Math.random() * 9000) + 1000;
  return `COS-${y}${m}-${r}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// USERS
// ─────────────────────────────────────────────────────────────────────────────
const Users = {

  async create(data) {
    const db = getClient();
    const hash = await hashPassword(data.password);
    const { data: result, error } = await db
      .from('users')
      .insert([{
        username:      data.username,
        password_hash: hash,
        full_name:     data.fullName,
        email:         data.email || '',
        role:          data.role || 'qa_staff',
        active:        true,
        created_at:    new Date().toISOString()
      }])
      .select()
      .single();
    if (error) throw new Error(error.message);
    return result.id;
  },

  async authenticate(username, password) {
    const db = getClient();
    const { data, error } = await db
      .from('users')
      .select('*')
      .eq('username', username)
      .eq('active', true)
      .single();
    if (error || !data) return null;
    const hash = await hashPassword(password);
    if (hash !== data.password_hash) return null;
    return {
      id:       data.id,
      username: data.username,
      fullName: data.full_name,
      email:    data.email,
      role:     data.role,
      active:   data.active
    };
  },

  async getAll() {
    const db = getClient();
    const { data, error } = await db
      .from('users')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []).map(u => ({
      id:        u.id,
      username:  u.username,
      fullName:  u.full_name,
      email:     u.email,
      role:      u.role,
      active:    u.active,
      createdAt: u.created_at
    }));
  },

  async getById(id) {
    const db = getClient();
    const { data, error } = await db
      .from('users')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !data) return null;
    return {
      id:        data.id,
      username:  data.username,
      fullName:  data.full_name,
      email:     data.email,
      role:      data.role,
      active:    data.active,
      createdAt: data.created_at
    };
  },

  async update(user) {
    const db = getClient();
    const { error } = await db
      .from('users')
      .update({ active: user.active, role: user.role, full_name: user.fullName, email: user.email })
      .eq('id', user.id);
    if (error) throw new Error(error.message);
  },

  async ensureDefaultAdmin() {
    const db = getClient();
    const { data } = await db.from('users').select('id').limit(1);
    if (data && data.length > 0) return; // users already exist
    await Users.create({
      username: 'admin',
      password: 'Cospharm@2026',
      fullName: 'System Administrator',
      email:    'supportna@cospharm.org',
      role:     'admin'
    });
    await Users.create({
      username: 'qa_team',
      password: 'QAteam@2026',
      fullName: 'QA Pharmacist',
      email:    'qa@cospharm.org',
      role:     'qa_staff'
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SESSION  (still uses localStorage — sessions are per-device by design)
// ─────────────────────────────────────────────────────────────────────────────
const Session = {

  async save(user) {
    const token = crypto.randomUUID();
    const sess = {
      key:      'current',
      token,
      userId:   user.id,
      username: user.username,
      fullName: user.fullName,
      role:     user.role,
      loginAt:  new Date().toISOString()
    };
    localStorage.setItem('cospharm_session', JSON.stringify(sess));
    return token;
  },

  async get() {
    const raw = localStorage.getItem('cospharm_session');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  },

  async clear() {
    localStorage.removeItem('cospharm_session');
  },

  async require(redirectTo = 'qa-login.html') {
    const sess = await Session.get();
    if (!sess) { window.location.href = redirectTo; return null; }
    return sess;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPLAINTS
// ─────────────────────────────────────────────────────────────────────────────

// Map JS camelCase ↔ DB snake_case
function complaintToRow(data) {
  return {
    ref:                       data.ref,
    status:                    data.status || 'open',
    institution:               data.institution,
    contact_person:            data.contactPerson,
    designation:               data.designation,
    contact_phone:             data.contactPhone,
    contact_email:             data.contactEmail,
    date_received:             data.dateReceived || null,
    complaint_methods:         data.complaintMethods || [],
    generic_name:              data.genericName,
    trade_name:                data.tradeName,
    dosage_form:               data.dosageForm,
    strength:                  data.strength,
    pack_size:                 data.packSize,
    manufacturer:              data.manufacturer,
    batch_no:                  data.batchNo,
    expiry_date:               data.expiryDate || null,
    invoice_no:                data.invoiceNo,
    quantity_received:         data.quantityReceived ? parseInt(data.quantityReceived) : null,
    quantity_affected:         data.quantityAffected ? parseInt(data.quantityAffected) : null,
    date_received_by_customer: data.dateReceivedByCustomer || null,
    storage_conditions:        data.storageConditions,
    complaint_types:           data.complaintTypes || [],
    description:               data.description,
    entire_batch_affected:     data.entireBatchAffected,
    patient_harm:              data.patientHarm,
    product_used_on_patients:  data.productUsedOnPatients,
    product_quarantined:       data.productQuarantined,
    pct_affected:              data.pctAffected ? parseFloat(data.pctAffected) : null,
    qa_category:               data.qaCategory,
    qa_batch_status:           data.qaBatchStatus,
    qa_investigation_required: data.qaInvestigationRequired,
    qa_supplier_notified:      data.qaSupplierNotified,
    qa_nmrc_required:          data.qaNMRCRequired,
    feedback_sent_to_client:   data.feedbackSentToClient,
    qa_root_cause:             data.qaRootCause,
    qa_capa:                   data.qaCapa,
    qa_decisions:              data.qaDecisions || [],
    qa_pharmacist:             data.qaPharmacist,
    internal_notes:            data.internalNotes,
    closed_at:                 data.closedAt || null,
    updated_at:                new Date().toISOString()
  };
}

function rowToComplaint(r) {
  if (!r) return null;
  return {
    id:                      r.id,
    ref:                     r.ref,
    status:                  r.status,
    institution:             r.institution,
    contactPerson:           r.contact_person,
    designation:             r.designation,
    contactPhone:            r.contact_phone,
    contactEmail:            r.contact_email,
    dateReceived:            r.date_received,
    complaintMethods:        r.complaint_methods || [],
    genericName:             r.generic_name,
    tradeName:               r.trade_name,
    dosageForm:              r.dosage_form,
    strength:                r.strength,
    packSize:                r.pack_size,
    manufacturer:            r.manufacturer,
    batchNo:                 r.batch_no,
    expiryDate:              r.expiry_date,
    invoiceNo:               r.invoice_no,
    quantityReceived:        r.quantity_received,
    quantityAffected:        r.quantity_affected,
    dateReceivedByCustomer:  r.date_received_by_customer,
    storageConditions:       r.storage_conditions,
    complaintTypes:          r.complaint_types || [],
    description:             r.description,
    entireBatchAffected:     r.entire_batch_affected,
    patientHarm:             r.patient_harm,
    productUsedOnPatients:   r.product_used_on_patients,
    productQuarantined:      r.product_quarantined,
    pctAffected:             r.pct_affected,
    qaCategory:              r.qa_category,
    qaBatchStatus:           r.qa_batch_status,
    qaInvestigationRequired: r.qa_investigation_required,
    qaSupplierNotified:      r.qa_supplier_notified,
    qaNMRCRequired:          r.qa_nmrc_required,
    feedbackSentToClient:    r.feedback_sent_to_client,
    qaRootCause:             r.qa_root_cause,
    qaCapa:                  r.qa_capa,
    qaDecisions:             r.qa_decisions || [],
    qaPharmacist:            r.qa_pharmacist,
    internalNotes:           r.internal_notes,
    closedAt:                r.closed_at,
    createdAt:               r.created_at,
    updatedAt:               r.updated_at
  };
}

const Complaints = {

  async create(data) {
    const db = getClient();
    const ref = generateRef();
    const row = {
      ...complaintToRow(data),
      ref,
      status:     'open',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    const { data: result, error } = await db
      .from('complaints')
      .insert([row])
      .select()
      .single();
    if (error) throw new Error(error.message);
    await Audit.log({
      complaintId: result.id,
      action:      'COMPLAINT_SUBMITTED',
      detail:      `New complaint submitted. Ref: ${ref}`,
      userId:      null,
      userName:    data.contactPerson || 'Client'
    });
    return { id: result.id, ref };
  },

  async getAll() {
    const db = getClient();
    const { data, error } = await db
      .from('complaints')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []).map(rowToComplaint);
  },

  async getById(id) {
    const db = getClient();
    const { data, error } = await db
      .from('complaints')
      .select('*')
      .eq('id', id)
      .single();
    if (error) return null;
    return rowToComplaint(data);
  },

  async update(complaint, userId, userName, changeNote) {
    const db = getClient();
    const row = complaintToRow(complaint);
    const { error } = await db
      .from('complaints')
      .update(row)
      .eq('id', complaint.id);
    if (error) throw new Error(error.message);
    await Audit.log({
      complaintId: complaint.id,
      action:      'COMPLAINT_UPDATED',
      detail:      changeNote || 'Complaint record updated',
      userId,
      userName
    });
    return complaint;
  },

  async updateStatus(id, status, userId, userName) {
    const db = getClient();
    const updates = {
      status,
      updated_at: new Date().toISOString(),
      ...(status === 'closed' ? { closed_at: new Date().toISOString() } : {})
    };
    const { error } = await db
      .from('complaints')
      .update(updates)
      .eq('id', id);
    if (error) throw new Error(error.message);
    await Audit.log({
      complaintId: id,
      action:      'STATUS_CHANGED',
      detail:      `Status changed to: ${status.toUpperCase()}`,
      userId,
      userName
    });
  },

  async getStats() {
    const all = await Complaints.getAll();
    const total      = all.length;
    const open       = all.filter(c => c.status === 'open').length;
    const inProgress = all.filter(c => c.status === 'in_progress').length;
    const closed     = all.filter(c => c.status === 'closed').length;

    const typeCounts = {};
    all.forEach(c => (c.complaintTypes || []).forEach(t => { typeCounts[t] = (typeCounts[t] || 0) + 1; }));

    const instCounts = {};
    all.forEach(c => { if (c.institution) instCounts[c.institution] = (instCounts[c.institution] || 0) + 1; });

    const catCounts = { Minor: 0, Major: 0, Critical: 0, Unclassified: 0 };
    all.forEach(c => { const cat = c.qaCategory || 'Unclassified'; catCounts[cat] = (catCounts[cat] || 0) + 1; });

    const monthly = {};
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthly[d.toLocaleString('default', { month: 'short', year: '2-digit' })] = 0;
    }
    all.forEach(c => {
      const key = new Date(c.createdAt).toLocaleString('default', { month: 'short', year: '2-digit' });
      if (monthly[key] !== undefined) monthly[key]++;
    });

    const resolved = all.filter(c => c.closedAt && c.createdAt);
    const avgDays  = resolved.length
      ? Math.round(resolved.reduce((s, c) => s + (new Date(c.closedAt) - new Date(c.createdAt)) / (1000 * 60 * 60 * 24), 0) / resolved.length)
      : 0;

    const decisions = {};
    all.forEach(c => { if (c.qaDecisions) c.qaDecisions.forEach(d => { decisions[d] = (decisions[d] || 0) + 1; }); });

    return { total, open, inProgress, closed, typeCounts, instCounts, catCounts, monthly, avgDays, decisions };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT
// ─────────────────────────────────────────────────────────────────────────────
const Audit = {

  async log({ complaintId, action, detail, userId, userName }) {
    const db = getClient();
    const { error } = await db.from('audit').insert([{
      complaint_id: complaintId || null,
      action,
      detail,
      user_id:   userId   || null,
      user_name: userName || 'System',
      timestamp: new Date().toISOString()
    }]);
    if (error) console.warn('Audit log error:', error.message);
  },

  async getAll() {
    const db = getClient();
    const { data, error } = await db
      .from('audit')
      .select('*')
      .order('timestamp', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []).map(r => ({
      id:          r.id,
      complaintId: r.complaint_id,
      action:      r.action,
      detail:      r.detail,
      userId:      r.user_id,
      userName:    r.user_name,
      timestamp:   r.timestamp
    }));
  },

  async getForComplaint(complaintId) {
    const db = getClient();
    const { data, error } = await db
      .from('audit')
      .select('*')
      .eq('complaint_id', complaintId)
      .order('timestamp', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []).map(r => ({
      id:          r.id,
      complaintId: r.complaint_id,
      action:      r.action,
      detail:      r.detail,
      userId:      r.user_id,
      userName:    r.user_name,
      timestamp:   r.timestamp
    }));
  }
};

// ── Expose globally ──────────────────────────────────────────────────────────
window.DB = { Users, Session, Complaints, Audit };
