(function () {
  'use strict';

  // ---- Config (hardcoded — no banner needed) ----
  var SUPABASE_URL = 'https://tndwzftilgkhzxseiszj.supabase.co';
  var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRuZHd6ZnRpbGdraHp4c2Vpc3pqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyMjcwOTIsImV4cCI6MjA4NDgwMzA5Mn0.AZC2RWDl-Pq43AWRD5UE-C_uR9ada3hcC2xWr5ix5ao';
  var TABLE = 'meeting_minute';

  // ---- State ----
  var sb = null;
  var currentMeeting = null;
  var currentUser = null;
  var allMeetings = [];

  // ---- Helpers ----
  function $(s) { return document.querySelector(s); }
  function $$(s) { return document.querySelectorAll(s); }
  function esc(s) { return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : ''; }
  function escA(s) { return s ? String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;') : ''; }

  function genId() {
    var d = new Date();
    return 'MTG-' + d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0') + '-' + Math.random().toString(36).substring(2,6).toUpperCase();
  }

  // ---- Toast ----
  function toast(msg, type) {
    var c = $('.toast-container');
    if (!c) { c = document.createElement('div'); c.className='toast-container'; document.body.appendChild(c); }
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    t.style.background = type==='success'?'#059669':type==='error'?'#dc2626':'#4f46e5';
    c.appendChild(t);
    requestAnimationFrame(function(){ t.classList.add('show'); });
    setTimeout(function(){ t.classList.remove('show'); setTimeout(function(){ t.remove(); },300); },2500);
  }

  // ---- Views ----
  function showView(v) {
    var views = { login:'login-gate', empty:'empty-state', meeting:'current-meeting', dashboard:'dashboard-view' };
    Object.keys(views).forEach(function(k) {
      var el = $('#'+views[k]);
      if (el) el.style.display = k===v ? (k==='login'||k==='empty'?'flex':'block') : 'none';
    });
  }

  // ---- Auth ----
  async function signInGoogle() {
    if (!sb) return;
    var r = await sb.auth.signInWithOAuth({ provider:'google', options:{ redirectTo: window.location.origin + window.location.pathname } });
    if (r.error) toast('Login failed: '+r.error.message,'error');
  }

  async function signOut() {
    if (!sb) return;
    await sb.auth.signOut();
    currentUser = null;
    updateAuthUI();
    showView('login');
    toast('Signed out.','success');
  }

  function updateAuthUI() {
    var loginBtn = $('#google-login-btn');
    var profile = $('#user-profile');
    if (!currentUser) {
      if (loginBtn) loginBtn.style.display = 'inline-flex';
      if (profile) profile.style.display = 'none';
      return;
    }
    if (loginBtn) loginBtn.style.display = 'none';
    if (profile) profile.style.display = 'flex';
    var m = currentUser.user_metadata || {};
    var av = $('#user-avatar');
    var nm = $('#user-name');
    if (av) av.src = m.avatar_url || m.picture || '';
    if (nm) nm.textContent = m.full_name || m.name || currentUser.email || '';
  }

  function userName() { var m = (currentUser||{}).user_metadata||{}; return m.full_name||m.name||(currentUser||{}).email||''; }
  function userEmail() { return (currentUser||{}).email||''; }

  // ---- CRUD ----
  async function createMeeting(title, date, attendees) {
    var rec = { meeting_id:genId(), title:title, date:date, attendees:attendees, points_discussed:[], decisions:[], action_items:[], user_id:currentUser?currentUser.id:null };
    var r = await sb.from(TABLE).insert([rec]).select().single();
    if (r.error) { toast('Error: '+r.error.message,'error'); return null; }
    toast('Meeting created!','success');
    return r.data;
  }

  async function loadMeetings() {
    var r = await sb.from(TABLE).select('*').order('date',{ascending:false});
    return r.error ? [] : (r.data||[]);
  }

  async function loadMeeting(id) {
    var r = await sb.from(TABLE).select('*').eq('id',id).single();
    if (r.error) { toast('Error: '+r.error.message,'error'); return null; }
    return r.data;
  }

  async function updateMeeting(id, fields) {
    fields.updated_at = new Date().toISOString();
    var r = await sb.from(TABLE).update(fields).eq('id',id).select().single();
    if (r.error) { toast('Save error: '+r.error.message,'error'); return null; }
    return r.data;
  }

  async function deleteMeeting(id) {
    var r = await sb.from(TABLE).delete().eq('id',id);
    if (r.error) { toast('Delete error: '+r.error.message,'error'); return false; }
    toast('Meeting deleted.','success');
    return true;
  }

  // ---- Auto-save ----
  async function collectAndSave() {
    if (!currentMeeting||!sb) return;
    var points=[]; $$('#points-list .point-input').forEach(function(el){ if(el.value.trim()) points.push(el.value.trim()); });
    var decisions=[]; $$('#decisions-list .decision-input').forEach(function(el){ if(el.value.trim()) decisions.push(el.value.trim()); });
    var actions=[]; $$('#action-items-list .action-item-row').forEach(function(row){
      var w=row.querySelector('.action-who'), t=row.querySelector('.action-what'), d=row.querySelector('.action-deadline');
      if(w&&t&&(w.value.trim()||t.value.trim())) actions.push({who:w.value.trim(),what:t.value.trim(),deadline:d?d.value:''});
    });
    var f={points_discussed:points,decisions:decisions,action_items:actions};
    var ti=$('#edit-meeting-title'); if(ti&&ti.value.trim()) f.title=ti.value.trim();
    var dt=$('#edit-meeting-date'); if(dt&&dt.value) f.date=dt.value;
    var at=$('#edit-meeting-attendees'); if(at) f.attendees=at.value.split(',').map(function(s){return s.trim();}).filter(Boolean);
    var u = await updateMeeting(currentMeeting.id,f);
    if(u){ currentMeeting=u; toast('Saved','success'); await refreshList(); }
  }
  var saveTimer=null;
  function schedSave(){ clearTimeout(saveTimer); saveTimer=setTimeout(collectAndSave,1500); }

  // ---- Sidebar ----
  function renderList(meetings) {
    var ul=$('#meetings-list'); if(!ul) return;
    ul.innerHTML='';
    if(!meetings.length){ ul.innerHTML='<li class="meetings-list__empty">No meetings yet</li>'; return; }
    meetings.forEach(function(m){
      var li=document.createElement('li');
      li.className='meeting-item'+(currentMeeting&&currentMeeting.id===m.id?' active':'');
      li.dataset.id=m.id;
      li.innerHTML='<div class="meeting-item-title">'+esc(m.title)+'</div><div class="meeting-item-meta">'+esc(m.meeting_id)+' &middot; '+esc(m.date)+'</div>';
      li.addEventListener('click',function(){ openMeeting(m.id); });
      ul.appendChild(li);
    });
  }
  async function refreshList(){ allMeetings=await loadMeetings(); renderList(allMeetings); }
  function filterList(q){
    if(!q){ renderList(allMeetings); return; }
    var ql=q.toLowerCase();
    renderList(allMeetings.filter(function(m){ return (m.title||'').toLowerCase().includes(ql)||(m.meeting_id||'').toLowerCase().includes(ql)||(m.date||'').includes(ql); }));
  }

  // ---- Render meeting ----
  function renderMeeting(m) {
    var el=$('#current-meeting'); if(!el||!m) return;
    var att=Array.isArray(m.attendees)?m.attendees.join(', '):m.attendees||'';
    var pts=m.points_discussed||[], decs=m.decisions||[], acts=m.action_items||[];
    var h='';

    h+='<div class="mv-header"><div class="mv-header-left">';
    h+='<input type="text" id="edit-meeting-title" class="mv-title-input" value="'+escA(m.title)+'" placeholder="Meeting title">';
    h+='<span class="mv-id">'+esc(m.meeting_id)+'</span>';
    h+='</div><div class="mv-actions">';
    h+='<button id="download-pdf-btn" class="btn btn--secondary"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>PDF</button>';
    h+='<button id="save-meeting-btn" class="btn btn--primary">Save</button>';
    h+='<button id="delete-meeting-btn" class="btn btn--danger">Delete</button>';
    h+='</div></div>';

    h+='<div class="mv-meta"><div><strong>Date</strong> <input type="date" id="edit-meeting-date" value="'+escA(m.date||'')+'"></div>';
    h+='<div><strong>Attendees</strong> <input type="text" id="edit-meeting-attendees" value="'+escA(att)+'" placeholder="Alice, Bob" style="min-width:220px;"></div></div>';

    // Points
    h+='<div class="mv-section"><div class="mv-section-head"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>Points Discussed<span class="mv-section-count">'+pts.length+'</span></div>';
    h+='<div id="points-list">';
    pts.forEach(function(p,i){ h+=rowHtml('point-input','Discussion point...',p,i); });
    h+='</div><button type="button" class="btn-add" id="add-point-btn">+ Add Point</button></div>';

    // Decisions
    h+='<div class="mv-section"><div class="mv-section-head"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>Decisions<span class="mv-section-count">'+decs.length+'</span></div>';
    h+='<div id="decisions-list">';
    decs.forEach(function(d,i){ h+=rowHtml('decision-input','Decision...',d,i); });
    h+='</div><button type="button" class="btn-add" id="add-decision-btn">+ Add Decision</button></div>';

    // Actions
    h+='<div class="mv-section"><div class="mv-section-head"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>Action Items<span class="mv-section-count">'+acts.length+'</span></div>';
    h+='<div id="action-items-list">';
    acts.forEach(function(a,i){ h+=actionHtml(a,i); });
    h+='</div><button type="button" class="btn-add" id="add-action-btn">+ Add Action Item</button></div>';

    h+='<div class="mv-footer"><button id="save-meeting-btn2" class="btn btn--primary">Save Changes</button></div>';

    el.innerHTML=h;
    showView('meeting');
    wireMeetingEvents();
  }

  function rowHtml(cls,ph,val,i){
    return '<div class="list-row" data-index="'+i+'"><input type="text" class="'+cls+'" placeholder="'+ph+'" value="'+escA(val)+'">'+removeBtn()+'</div>';
  }
  function actionHtml(item,i){
    item=item||{};
    return '<div class="list-row action-item-row" data-index="'+i+'"><input type="text" class="action-what" placeholder="Action item..." value="'+escA(item.what||'')+'"><input type="text" class="action-who" placeholder="Assigned to" value="'+escA(item.who||'')+'"><input type="date" class="action-deadline" value="'+escA(item.deadline||'')+'">'+removeBtn()+'</div>';
  }
  function removeBtn(){
    return '<button type="button" class="btn-remove remove-btn" title="Remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';
  }

  // ---- Wire meeting events ----
  function wireMeetingEvents(){
    var s=$('#save-meeting-btn'); if(s) s.onclick=function(e){e.preventDefault();collectAndSave();};
    var s2=$('#save-meeting-btn2'); if(s2) s2.onclick=function(e){e.preventDefault();collectAndSave();};
    var p=$('#download-pdf-btn'); if(p) p.onclick=downloadPdf;
    var d=$('#delete-meeting-btn'); if(d) d.onclick=async function(){ if(!currentMeeting||!confirm('Delete this meeting?')) return; if(await deleteMeeting(currentMeeting.id)){ currentMeeting=null; showView('empty'); await refreshList(); }};
    var ap=$('#add-point-btn'); if(ap) ap.onclick=function(){ var l=$('#points-list'); if(!l) return; l.insertAdjacentHTML('beforeend',rowHtml('point-input','Discussion point...','',l.querySelectorAll('.list-row').length)); wireRemove(); wireInputs(); l.querySelector('.list-row:last-child .point-input').focus(); };
    var ad=$('#add-decision-btn'); if(ad) ad.onclick=function(){ var l=$('#decisions-list'); if(!l) return; l.insertAdjacentHTML('beforeend',rowHtml('decision-input','Decision...','',l.querySelectorAll('.list-row').length)); wireRemove(); wireInputs(); l.querySelector('.list-row:last-child .decision-input').focus(); };
    var aa=$('#add-action-btn'); if(aa) aa.onclick=function(){ var l=$('#action-items-list'); if(!l) return; l.insertAdjacentHTML('beforeend',actionHtml({},l.querySelectorAll('.action-item-row').length)); wireRemove(); wireInputs(); l.querySelector('.action-item-row:last-child .action-what').focus(); };
    wireRemove(); wireInputs();
  }
  function wireRemove(){ $$('#current-meeting .remove-btn').forEach(function(b){ b.onclick=function(){ b.closest('.list-row').remove(); schedSave(); }; }); }
  function wireInputs(){ $$('#current-meeting input').forEach(function(i){ i.oninput=schedSave; }); }

  async function openMeeting(id){
    var m=await loadMeeting(id); if(!m) return;
    currentMeeting=m; renderMeeting(m);
    $$('.meeting-item').forEach(function(el){ el.classList.toggle('active',el.dataset.id===String(id)); });
  }

  // ---- PDF ----
  function downloadPdf(){
    if(!currentMeeting){ toast('No meeting selected','error'); return; }
    var J=(window.jspdf&&window.jspdf.jsPDF)||window.jsPDF;
    if(!J){ toast('jsPDF not loaded','error'); return; }
    var doc=new J(), y=20, mg=20, pw=doc.internal.pageSize.getWidth(), mw=pw-mg*2;
    function chk(n){ if(y+n>270){ doc.addPage(); y=20; } }
    doc.setFontSize(20); doc.setFont(undefined,'bold'); doc.text(currentMeeting.title||'Untitled',mg,y); y+=10;
    doc.setFontSize(11); doc.setFont(undefined,'normal');
    doc.text('ID: '+currentMeeting.meeting_id,mg,y); y+=6;
    doc.text('Date: '+(currentMeeting.date||'N/A'),mg,y); y+=6;
    var att=Array.isArray(currentMeeting.attendees)?currentMeeting.attendees.join(', '):currentMeeting.attendees||'';
    doc.text('Attendees: '+att,mg,y,{maxWidth:mw}); y+=10;
    doc.setDrawColor(200); doc.line(mg,y,pw-mg,y); y+=8;
    doc.setFontSize(14); doc.setFont(undefined,'bold'); doc.text('Points Discussed',mg,y); y+=8;
    doc.setFontSize(11); doc.setFont(undefined,'normal');
    (currentMeeting.points_discussed||[]).forEach(function(p,i){ chk(8); var l=doc.splitTextToSize((i+1)+'. '+p,mw); doc.text(l,mg,y); y+=l.length*6; }); y+=6;
    chk(16); doc.setFontSize(14); doc.setFont(undefined,'bold'); doc.text('Decisions',mg,y); y+=8;
    doc.setFontSize(11); doc.setFont(undefined,'normal');
    (currentMeeting.decisions||[]).forEach(function(d,i){ chk(8); var l=doc.splitTextToSize((i+1)+'. '+d,mw); doc.text(l,mg,y); y+=l.length*6; }); y+=6;
    chk(16); doc.setFontSize(14); doc.setFont(undefined,'bold'); doc.text('Action Items',mg,y); y+=8;
    doc.setFontSize(11); doc.setFont(undefined,'normal');
    (currentMeeting.action_items||[]).forEach(function(a,i){ chk(14); var ln=(i+1)+'. ['+(a.who||'?')+'] '+(a.what||'')+(a.deadline?' (Due: '+a.deadline+')':''); var l=doc.splitTextToSize(ln,mw); doc.text(l,mg,y); y+=l.length*6; });
    doc.save((currentMeeting.meeting_id||'meeting')+'.pdf');
    toast('PDF downloaded','success');
  }

  // ---- Dashboard ----
  function renderDashboard(){
    var el=$('#dashboard-view'); if(!el) return;
    var un=userName(), ue=userEmail();
    var myMeetings=allMeetings.filter(function(m){
      var a=Array.isArray(m.attendees)?m.attendees:[];
      return a.some(function(x){ var l=x.toLowerCase(); return l===ue.toLowerCase()||l===un.toLowerCase()||(un&&l.includes(un.split(' ')[0].toLowerCase())); })||(m.user_id&&currentUser&&m.user_id===currentUser.id);
    });
    var myActions=[];
    allMeetings.forEach(function(m){ (m.action_items||[]).forEach(function(a){ if(!a.who) return; var w=a.who.toLowerCase(); if(w===ue.toLowerCase()||w===un.toLowerCase()||(un&&w.includes(un.split(' ')[0].toLowerCase()))) myActions.push({meeting:m,action:a}); }); });
    myActions.sort(function(a,b){ return (a.action.deadline||'9999').localeCompare(b.action.deadline||'9999'); });

    var h='<div class="dash-header"><h2>My Dashboard</h2><p>Welcome back, '+esc(un||ue)+'</p></div>';

    h+='<div class="dash-section"><h3><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>My Action Items ('+myActions.length+')</h3>';
    if(!myActions.length) h+='<p class="empty-dash-msg">No action items assigned to you.</p>';
    else myActions.forEach(function(e){
      var a=e.action, m=e.meeting, bc='future', bt=a.deadline||'No deadline';
      if(a.deadline){ var td=new Date().toISOString().slice(0,10); if(a.deadline<td){bc='overdue';bt='Overdue: '+a.deadline;} else if(a.deadline<=new Date(Date.now()+3*864e5).toISOString().slice(0,10)){bc='upcoming';bt='Due: '+a.deadline;} else bt='Due: '+a.deadline; }
      h+='<div class="dash-card"><div class="action-item-card"><div class="action-details"><div class="action-task-text">'+esc(a.what)+'</div><div class="action-from-meeting">From: '+esc(m.title)+' ('+esc(m.meeting_id)+')</div></div><span class="deadline-badge '+bc+'">'+esc(bt)+'</span></div></div>';
    });
    h+='</div>';

    h+='<div class="dash-section"><h3><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>My Meetings ('+myMeetings.length+')</h3>';
    if(!myMeetings.length) h+='<p class="empty-dash-msg">No meetings found.</p>';
    else myMeetings.forEach(function(m){
      h+='<div class="dash-card" data-meeting-id="'+m.id+'"><div class="dash-card-title">'+esc(m.title)+'</div><div class="dash-card-meta">'+esc(m.meeting_id)+' &middot; '+esc(m.date)+' &middot; '+(Array.isArray(m.attendees)?m.attendees.length:0)+' attendees</div></div>';
    });
    h+='</div>';

    el.innerHTML=h; showView('dashboard');
    el.querySelectorAll('[data-meeting-id]').forEach(function(c){ c.addEventListener('click',function(){ openMeeting(parseInt(c.dataset.meetingId)); }); });
  }

  // ---- Modal ----
  function openModal(){
    var o=$('#meeting-modal-overlay'); if(o) o.style.display='flex';
    var d=$('#meeting-date'); if(d) d.value=new Date().toISOString().slice(0,10);
    var t=$('#meeting-title'); if(t){t.value='';t.focus();}
    var a=$('#meeting-attendees'); if(a) a.value=currentUser?userName():'';
  }
  function closeModal(){ var o=$('#meeting-modal-overlay'); if(o) o.style.display='none'; }

  // ---- Init ----
  function wireStatic(){
    // Auth
    var gb=$('#google-login-btn'); if(gb) gb.onclick=signInGoogle;
    var gb2=$('#login-gate-btn'); if(gb2) gb2.onclick=signInGoogle;
    var lo=$('#logout-btn'); if(lo) lo.onclick=signOut;
    var db=$('#my-dashboard-btn'); if(db) db.onclick=function(){ currentMeeting=null; $$('.meeting-item').forEach(function(e){e.classList.remove('active');}); renderDashboard(); };

    // New meeting
    var nb=$('#new-meeting-btn'); if(nb) nb.onclick=openModal;
    var cb=$('#modal-close-btn'); if(cb) cb.onclick=closeModal;
    var cn=$('#modal-cancel-btn'); if(cn) cn.onclick=closeModal;
    var ov=$('#meeting-modal-overlay'); if(ov) ov.onclick=function(e){ if(e.target===ov) closeModal(); };

    var fm=$('#meeting-form');
    if(fm) fm.onsubmit=async function(e){
      e.preventDefault();
      var t=($('#meeting-title')||{}).value||'', d=($('#meeting-date')||{}).value||'', a=($('#meeting-attendees')||{}).value||'';
      if(!t.trim()){toast('Enter a title','error');return;}
      var att=a.split(',').map(function(s){return s.trim();}).filter(Boolean);
      var m=await createMeeting(t.trim(),d,att);
      if(m){ currentMeeting=m; renderMeeting(m); await refreshList(); closeModal(); }
    };

    // Search
    var si=$('#search-meetings'); if(si) si.oninput=function(){ filterList(si.value.trim()); };

    // Sidebar toggle
    var st=$('#sidebar-toggle'), sb2=$('#sidebar');
    if(st&&sb2) st.onclick=function(){ sb2.classList.toggle('open'); };
  }

  document.addEventListener('DOMContentLoaded', async function(){
    wireStatic();

    // Auto-connect
    try {
      sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    } catch(e) {
      toast('Connection failed','error');
      return;
    }

    // Check session
    var sess = await sb.auth.getSession();
    if(sess.data && sess.data.session){
      var u = await sb.auth.getUser();
      if(u.data && u.data.user){ currentUser=u.data.user; updateAuthUI(); await refreshList(); showView('empty'); }
      else showView('login');
    } else {
      showView('login');
    }

    // Auth listener
    sb.auth.onAuthStateChange(async function(ev,session){
      if(ev==='SIGNED_IN'&&session){
        var u=await sb.auth.getUser();
        if(u.data&&u.data.user){ currentUser=u.data.user; updateAuthUI(); await refreshList(); showView('empty'); }
      } else if(ev==='SIGNED_OUT'){
        currentUser=null; updateAuthUI(); showView('login');
      }
    });
  });
})();
