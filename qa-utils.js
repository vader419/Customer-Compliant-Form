/**
 * Shared helpers for all QA pages: auth guard, nav rendering, utils
 */

// ── Auth guard ──────────────────────────────────────────────────────────────
async function requireAuth() {
  const sess = await DB.Session.get();
  if (!sess) { window.location.href = 'qa-login.html'; return null; }
  return sess;
}

// ── Render the header + nav ──────────────────────────────────────────────────
function renderHeader(sess, activePage) {
  const initials = sess.fullName.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  const isAdmin = sess.role === 'admin';

  document.getElementById('userChipName').textContent = sess.fullName;
  document.getElementById('userAvatar').textContent = initials;
  document.getElementById('userRoleBadge').textContent = isAdmin ? 'Admin' : 'QA Staff';

  const navLinks = [
    { href:'qa-dashboard.html',  label:'📊 Dashboard',   key:'dashboard'  },
    { href:'qa-complaints.html', label:'📋 Complaints',  key:'complaints' },
    { href:'qa-review.html',     label:'🔍 New Review',  key:'review'     },
    { href:'qa-analytics.html',  label:'📈 Analytics',   key:'analytics'  },
    { href:'qa-audit.html',      label:'🗂 Audit Trail', key:'audit'      },
  ];
  if (isAdmin) navLinks.push({ href:'qa-admin.html', label:'⚙️ Admin', key:'admin' });

  const navEl = document.getElementById('qaNav');
  if (navEl) {
    navEl.innerHTML = navLinks.map(l =>
      `<a href="${l.href}" class="nav-link${activePage===l.key?' active':''}">${l.label}</a>`
    ).join('') + `<a href="#" onclick="doLogout()" class="nav-link" style="margin-left:auto;color:rgba(255,255,255,.45)">Sign Out</a>`;
  }
}

async function doLogout() {
  const sess = await DB.Session.get();
  if (sess) await DB.Audit.log({ action:'USER_LOGOUT', detail:`User logged out: ${sess.username}`, userId:sess.userId, userName:sess.fullName });
  await DB.Session.clear();
  window.location.href = 'qa-login.html';
}

// ── Utility ──────────────────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-NA',{day:'2-digit',month:'short',year:'numeric'});
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-NA',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
}

function fmtDaysAgo(iso) {
  if (!iso) return '';
  const diff = Math.round((Date.now()-new Date(iso))/(1000*60*60*24));
  if (diff===0) return 'Today';
  if (diff===1) return 'Yesterday';
  return `${diff}d ago`;
}

function statusBadge(status) {
  const map = { open:'badge-open', in_progress:'badge-progress', closed:'badge-closed' };
  const label = { open:'Open', in_progress:'In Progress', closed:'Closed' }[status] || status;
  return `<span class="badge ${map[status]||'badge-unclass'}">${label}</span>`;
}

function categoryBadge(cat) {
  if (!cat) return `<span class="badge badge-unclass">Unclassified</span>`;
  const map = { Minor:'badge-minor', Major:'badge-major', Critical:'badge-critical' };
  return `<span class="badge ${map[cat]||'badge-unclass'}">${cat}</span>`;
}

function toggleSection(head) {
  head.classList.toggle('collapsed');
  head.nextElementSibling.style.display = head.classList.contains('collapsed') ? 'none' : '';
}

function toggleCheck(el) { el.classList.toggle('checked'); }

function toggleRadio(el, name) {
  document.querySelectorAll(`.radio-item input[name="${name}"]`).forEach(r => {
    r.closest('.radio-item').classList.remove('selected');
  });
  el.classList.add('selected');
}

function getChecked(container) {
  return [...container.querySelectorAll('.check-item.checked')].map(el => el.querySelector('span:last-child').textContent.trim());
}

function getSelected(name) {
  const el = document.querySelector(`.radio-item.selected input[name="${name}"]`);
  return el ? el.closest('.radio-item').querySelector('span:last-child')?.textContent.trim() : '';
}

function setSelected(name, value) {
  document.querySelectorAll(`.radio-item input[name="${name}"]`).forEach(r => {
    const label = r.closest('.radio-item').querySelector('span:last-child')?.textContent.trim();
    r.closest('.radio-item').classList.toggle('selected', label === value);
  });
}

function setChecked(container, values = []) {
  container.querySelectorAll('.check-item').forEach(el => {
    const label = el.querySelector('span:last-child').textContent.trim();
    el.classList.toggle('checked', values.includes(label));
  });
}

// Simple SVG bar chart renderer
function renderBarChart(containerId, data, color='#c0392b', maxItems=8) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const entries = Object.entries(data).sort((a,b)=>b[1]-a[1]).slice(0,maxItems);
  const max = entries.length ? entries[0][1] : 1;
  if (!entries.length) { container.innerHTML = '<div class="empty-state"><div class="empty-sub">No data yet</div></div>'; return; }
  container.innerHTML = `<div class="bar-chart">${entries.map(([label,count])=>`
    <div class="bar-row">
      <div class="bar-row-label" title="${label}">${label}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.round(count/max*100)}%;background:${color}"></div></div>
      <div class="bar-count">${count}</div>
    </div>`).join('')}</div>`;
}

// Simple SVG line chart
function renderLineChart(containerId, data) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const entries = Object.entries(data);
  const max = Math.max(...entries.map(e=>e[1]), 1);
  const W=500, H=120, pad=20, bw=Math.floor((W-pad*2)/entries.length);
  const pts = entries.map(([,v],i)=>{
    const x = pad + i*bw + bw/2;
    const y = H - pad - ((v/max)*(H-pad*2));
    return `${x},${y}`;
  });
  const polyline = `<polyline points="${pts.join(' ')}" fill="none" stroke="#2c3e6b" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  const dots = entries.map(([,v],i)=>{
    const x=pad+i*bw+bw/2, y=H-pad-((v/max)*(H-pad*2));
    return `<circle cx="${x}" cy="${y}" r="4" fill="#2c3e6b"/><text x="${x}" y="${y-8}" text-anchor="middle" font-size="10" fill="#6b7280">${v}</text>`;
  }).join('');
  const labels = entries.map(([k],i)=>{
    const x=pad+i*bw+bw/2;
    return `<text x="${x}" y="${H-4}" text-anchor="middle" font-size="9" fill="#9ca3af">${k}</text>`;
  }).join('');
  const area = entries.length>1?`<polygon points="${pts[0].split(',')[0]},${H-pad} ${pts.join(' ')} ${pts[pts.length-1].split(',')[0]},${H-pad}" fill="#2c3e6b" opacity="0.07"/>`:'';
  container.innerHTML=`<svg viewBox="0 0 ${W} ${H}" style="width:100%;overflow:visible">${area}${polyline}${dots}${labels}</svg>`;
}

// Donut chart
function renderDonut(containerId, data, colors) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const entries = Object.entries(data).filter(([,v])=>v>0);
  const total = entries.reduce((s,[,v])=>s+v,0);
  if (!total) { container.innerHTML='<div class="empty-state"><div class="empty-sub">No data yet</div></div>'; return; }
  const R=60, cx=80, cy=80, sw=28;
  let startAngle=-Math.PI/2;
  const paths = entries.map(([label,val],i)=>{
    const angle=(val/total)*Math.PI*2;
    const x1=cx+R*Math.cos(startAngle), y1=cy+R*Math.sin(startAngle);
    const x2=cx+R*Math.cos(startAngle+angle), y2=cy+R*Math.sin(startAngle+angle);
    const large=angle>Math.PI?1:0;
    const d=`M${cx},${cy} L${x1},${y1} A${R},${R} 0 ${large} 1 ${x2},${y2} Z`;
    const col=colors[i%colors.length];
    startAngle+=angle;
    return `<path d="${d}" fill="${col}" opacity=".85"/>`;
  }).join('');
  const legend = entries.map(([label,val],i)=>{
    const pct=Math.round(val/total*100);
    return `<div style="display:flex;align-items:center;gap:.4rem;font-size:.73rem;color:var(--text)"><span style="width:10px;height:10px;border-radius:2px;background:${colors[i%colors.length]};flex-shrink:0"></span><span style="flex:1">${label}</span><strong>${val}</strong></div>`;
  }).join('');
  container.innerHTML=`<div style="display:flex;align-items:center;gap:1.5rem;flex-wrap:wrap">
    <svg viewBox="0 0 160 160" style="width:120px;flex-shrink:0">${paths}<text x="${cx}" y="${cy+5}" text-anchor="middle" font-size="18" font-weight="700" fill="#1a1e2e">${total}</text><text x="${cx}" y="${cy+18}" text-anchor="middle" font-size="9" fill="#6b7280">total</text></svg>
    <div style="display:flex;flex-direction:column;gap:.5rem;flex:1">${legend}</div>
  </div>`;
}
