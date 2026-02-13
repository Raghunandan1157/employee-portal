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
  var currentDept = null;

  var DEPARTMENTS = ['HR','Training','Audit','Ops','IT and Admin','NMSPL'];
  var allAttendeeNames = []; // Feature 4: attendee suggestions cache

  var DEPT_AGENDAS = {
    'HR': ['Employee grievances','Recruitment updates','Policy changes','Training needs','Attendance review'],
    'Training': ['Training calendar review','Skill gap analysis','Feedback from recent trainings','Upcoming programs','Budget utilization'],
    'Audit': ['Audit findings review','Compliance status','Corrective actions follow-up','Risk assessment','Upcoming audits'],
    'Ops': ['Production targets review','Quality metrics','Safety incidents','Resource allocation','Process improvements'],
    'IT and Admin': ['Infrastructure updates','Security patches','Helpdesk ticket review','Asset management','Facility maintenance'],
    'NMSPL': ['Business development updates','Client feedback','Revenue review','Project status','Strategic initiatives']
  };

  // ---- Speech Recognition State ----
  var recognition = null;
  var isRecording = false;
  var fullTranscript = '';

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

  // ---- Department Modal ----
  function showDeptModal() {
    var existing = $('#dept-modal-overlay');
    if (existing) existing.remove();
    var overlay = document.createElement('div');
    overlay.id = 'dept-modal-overlay';
    overlay.className = 'dept-modal-overlay';
    var h = '<div class="dept-modal">';
    h += '<div class="dept-modal-title">Select Your Department</div>';
    h += '<div class="dept-modal-subtitle">Choose your department to view and manage meetings</div>';
    h += '<div class="dept-grid">';
    DEPARTMENTS.forEach(function(d) {
      h += '<div class="dept-card" onclick="window.__selectDept(\'' + d.replace(/'/g,"\\'") + '\')"><div class="dept-card-name">' + esc(d) + '</div></div>';
    });
    h += '<div class="dept-card dept-card--authority" onclick="window.__selectDept(\'Higher Authority\')"><div class="dept-card-name">Higher Authority</div><div class="dept-card-desc">Access all departments</div></div>';
    h += '</div></div>';
    overlay.innerHTML = h;
    document.body.appendChild(overlay);
  }

  function selectDept(dept) {
    currentDept = dept;
    localStorage.setItem('meeting_dept', dept);
    var overlay = $('#dept-modal-overlay');
    if (overlay) overlay.remove();
    updateAuthUI();
    refreshList();
    toast('Department set to ' + dept, 'success');
  }
  window.__selectDept = selectDept;

  function changeDept() {
    showDeptModal();
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
    currentDept = null;
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

    // Department badge
    var pill = nm ? nm.parentElement : null;
    if (pill) {
      var oldBadge = pill.querySelector('.dept-badge');
      if (oldBadge) oldBadge.remove();
      var oldBtn = pill.querySelector('.dept-change-btn');
      if (oldBtn) oldBtn.remove();
      if (currentDept) {
        var badge = document.createElement('span');
        badge.className = 'dept-badge' + (currentDept === 'Higher Authority' ? ' dept-badge--authority' : '');
        badge.textContent = currentDept;
        pill.appendChild(badge);
        var chBtn = document.createElement('button');
        chBtn.className = 'dept-change-btn';
        chBtn.textContent = 'Change';
        chBtn.onclick = function(e) { e.stopPropagation(); changeDept(); };
        pill.appendChild(chBtn);
      }
    }
  }

  function userName() { var m = (currentUser||{}).user_metadata||{}; return m.full_name||m.name||(currentUser||{}).email||''; }
  function userEmail() { return (currentUser||{}).email||''; }

  // ---- CRUD ----
  async function createMeeting(title, date, attendees, department) {
    var dept = department || currentDept || '';
    var points = DEPT_AGENDAS[dept] ? DEPT_AGENDAS[dept].slice() : [];
    var rec = { meeting_id:genId(), title:title, date:date, attendees:attendees, points_discussed:points, decisions:[], action_items:[], user_id:currentUser?currentUser.id:null, department:dept, status:'draft' };
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
    if (currentMeeting.status==='finalized') return; // Feature 2: block saves on finalized
    var points=[]; $$('#points-list .point-input').forEach(function(el){ if(el.value.trim()) points.push(el.value.trim()); });
    var decisions=[]; $$('#decisions-list .decision-input').forEach(function(el){ if(el.value.trim()) decisions.push(el.value.trim()); });
    var actions=[]; $$('#action-items-list .action-item-row').forEach(function(row){
      var w=row.querySelector('.action-who'), t=row.querySelector('.action-what'), d=row.querySelector('.action-deadline'), cb=row.querySelector('.action-completed-cb');
      if(w&&t&&(w.value.trim()||t.value.trim())) actions.push({who:w.value.trim(),what:t.value.trim(),deadline:d?d.value:'',completed:cb?cb.checked:false});
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
  function getFilteredMeetings(meetings) {
    if (!currentDept || currentDept === 'Higher Authority') return meetings;
    return meetings.filter(function(m) { return m.department === currentDept; });
  }

  function renderList(meetings) {
    var ul=$('#meetings-list'); if(!ul) return;
    ul.innerHTML='';
    var filtered = getFilteredMeetings(meetings);
    if(!filtered.length){ ul.innerHTML='<li class="meetings-list__empty">No meetings yet</li>'; return; }
    filtered.forEach(function(m){
      var li=document.createElement('li');
      li.className='meeting-item'+(currentMeeting&&currentMeeting.id===m.id?' active':'');
      li.dataset.id=m.id;
      var deptCls = '';
      if(m.department) {
        var dk = m.department.toLowerCase().replace(/\s+/g,'-');
        if(dk==='it-and-admin') deptCls='meeting-item-dept--it';
        else if(dk==='higher-authority') deptCls='meeting-item-dept--authority';
        else deptCls='meeting-item-dept--'+dk;
      }
      var deptBadge = m.department ? '<span class="meeting-item-dept '+deptCls+'">'+esc(m.department)+'</span>' : '';
      var lockIcon = m.status==='finalized' ? '<span class="meeting-item-lock" title="Finalized" style="margin-left:6px;opacity:.6;font-size:12px;">&#128274;</span>' : '';
      li.innerHTML='<div class="meeting-item-title">'+esc(m.title)+deptBadge+lockIcon+'</div><div class="meeting-item-meta">'+esc(m.meeting_id)+' &middot; '+esc(m.date)+'</div>';
      li.addEventListener('click',function(){ openMeeting(m.id); });
      ul.appendChild(li);
    });
  }
  // Feature 6: Notification badge for overdue items (all items, not user-filtered)
  function updateNotificationBadge(){
    var dashBtn=$('#my-dashboard-btn'); if(!dashBtn) return;
    var old=dashBtn.querySelector('.notification-badge'); if(old) old.remove();
    var today=new Date().toISOString().slice(0,10);
    var overdueCount=0;
    var filtered=getFilteredMeetings(allMeetings);
    filtered.forEach(function(m){
      (m.action_items||[]).forEach(function(a){
        if(a.completed) return;
        if(a.deadline&&a.deadline<today) overdueCount++;
      });
    });
    if(overdueCount>0){
      var badge=document.createElement('span');
      badge.className='notification-badge';
      badge.textContent=overdueCount;
      dashBtn.appendChild(badge);
    }
  }

  async function refreshList(){ allMeetings=await loadMeetings(); renderList(allMeetings); collectAttendeeNames(); updateNotificationBadge(); }
  function filterList(q){
    if(!q){ renderList(allMeetings); return; }
    var ql=q.toLowerCase();
    renderList(allMeetings.filter(function(m){ return (m.title||'').toLowerCase().includes(ql)||(m.meeting_id||'').toLowerCase().includes(ql)||(m.date||'').includes(ql); }));
  }

  // ---- Render meeting ----
  function renderMeeting(m) {
    var el=$('#current-meeting'); if(!el||!m) return;
    var isFinalized = m.status==='finalized';
    var att=Array.isArray(m.attendees)?m.attendees.join(', '):m.attendees||'';
    var pts=m.points_discussed||[], decs=m.decisions||[], acts=m.action_items||[];
    var h='';

    h+='<div class="mv-header"><div class="mv-header-left">';
    h+='<input type="text" id="edit-meeting-title" class="mv-title-input" value="'+escA(m.title)+'" placeholder="Meeting title"'+(isFinalized?' readonly':'')+'>';
    h+='<span class="mv-id">'+esc(m.meeting_id)+'</span>';
    if(isFinalized) h+='<span class="finalized-badge" style="display:inline-block;margin-left:10px;padding:2px 10px;background:#dc2626;color:#fff;border-radius:4px;font-size:12px;font-weight:700;letter-spacing:1px;">FINALIZED</span>';
    h+='</div><div class="mv-actions">';
    h+='<button id="download-pdf-btn" class="btn btn--secondary"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>PDF</button>';
    if(!isFinalized){
      h+='<button id="finalize-meeting-btn" class="btn btn--secondary" style="background:#7c3aed;color:#fff;">Finalize</button>';
      h+='<button id="save-meeting-btn" class="btn btn--primary">Save</button>';
      h+='<button id="delete-meeting-btn" class="btn btn--danger">Delete</button>';
    } else {
      h+='<button id="reopen-meeting-btn" class="btn btn--secondary" style="background:#059669;color:#fff;">Reopen</button>';
    }
    h+='</div></div>';

    h+='<div class="mv-meta"><div><strong>Date</strong> <input type="date" id="edit-meeting-date" value="'+escA(m.date||'')+'"'+(isFinalized?' disabled':'')+'></div>';
    h+='<div style="position:relative;"><strong>Attendees</strong> <input type="text" id="edit-meeting-attendees" value="'+escA(att)+'" placeholder="Alice, Bob" style="min-width:220px;"'+(isFinalized?' readonly':'')+'></div></div>';

    // Smart Notes Section
    h+='<div class="recorder-section">';
    h+='<div class="recorder-section-header">';
    h+='<div class="recorder-section-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>Smart Notes</div>';
    h+='<div class="recorder-tabs">';
    h+='<button type="button" class="recorder-tab active" data-tab="text" id="tab-text">Type Notes</button>';
    h+='<button type="button" class="recorder-tab" data-tab="mic" id="tab-mic">Use Mic</button>';
    h+='</div>';
    h+='</div>';

    // Text input tab (default)
    h+='<div class="recorder-tab-content" id="tab-content-text">';
    h+='<textarea id="notes-textarea" class="notes-textarea" rows="5" placeholder="Type or paste your meeting notes here... Then click Analyze to auto-extract key points, decisions, and action items."></textarea>';
    h+='<div class="notes-actions">';
    h+='<button type="button" class="btn btn--primary" id="analyze-notes-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>Analyze Notes</button>';
    h+='<button type="button" class="btn btn--ghost btn--sm" id="clear-notes-btn">Clear</button>';
    h+='</div>';
    h+='</div>';

    // Mic tab (hidden by default)
    h+='<div class="recorder-tab-content" id="tab-content-mic" style="display:none;">';
    h+='<div class="recorder-controls">';
    h+='<button type="button" class="recorder-btn" id="recorder-btn">';
    h+='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
    h+='<span id="recorder-btn-text">Start Recording</span>';
    h+='</button>';
    h+='<div class="recording-indicator" id="recording-indicator" style="display:none;">';
    h+='<span class="recording-dot"></span>';
    h+='<span>Recording...</span>';
    h+='</div>';
    h+='</div>';
    h+='<p class="mic-note">Uses your browser\'s speech-to-text. Works best in Chrome with a stable internet connection.</p>';
    h+='<div class="transcript-panel" id="transcript-panel" style="display:none;">';
    h+='<div class="transcript-header">';
    h+='<span>Live Transcript</span>';
    h+='<button type="button" class="btn btn--ghost btn--sm" id="clear-transcript-btn">Clear</button>';
    h+='</div>';
    h+='<div class="transcript-text" id="transcript-text"></div>';
    h+='</div>';
    h+='</div>';

    // Extracted items (shared by both tabs)
    h+='<div class="extracted-items" id="extracted-items" style="display:none;">';
    h+='<div id="extracted-points-section" style="display:none;">';
    h+='<div class="extracted-category">Key Points Detected</div>';
    h+='<div id="extracted-points"></div>';
    h+='</div>';
    h+='<div id="extracted-decisions-section" style="display:none;">';
    h+='<div class="extracted-category">Decisions Detected</div>';
    h+='<div id="extracted-decisions"></div>';
    h+='</div>';
    h+='<div id="extracted-actions-section" style="display:none;">';
    h+='<div class="extracted-category">Action Items Detected</div>';
    h+='<div id="extracted-actions"></div>';
    h+='</div>';
    h+='</div>';
    h+='</div>';

    // Points
    h+='<div class="mv-section"><div class="mv-section-head"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>Points Discussed<span class="mv-section-count">'+pts.length+'</span></div>';
    h+='<div id="points-list">';
    pts.forEach(function(p,i){ h+=rowHtml('point-input','Discussion point...',p,i,isFinalized); });
    h+='</div>';
    if(!isFinalized) h+='<button type="button" class="btn-add" id="add-point-btn">+ Add Point</button>';
    h+='</div>';

    // Decisions
    h+='<div class="mv-section"><div class="mv-section-head"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>Decisions<span class="mv-section-count">'+decs.length+'</span></div>';
    h+='<div id="decisions-list">';
    decs.forEach(function(d,i){ h+=rowHtml('decision-input','Decision...',d,i,isFinalized); });
    h+='</div>';
    if(!isFinalized) h+='<button type="button" class="btn-add" id="add-decision-btn">+ Add Decision</button>';
    h+='</div>';

    // Actions
    h+='<div class="mv-section"><div class="mv-section-head"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>Action Items<span class="mv-section-count">'+acts.length+'</span></div>';
    h+='<div id="action-items-list">';
    acts.forEach(function(a,i){ h+=actionHtml(a,i,isFinalized); });
    h+='</div>';
    if(!isFinalized) h+='<button type="button" class="btn-add" id="add-action-btn">+ Add Action Item</button>';
    h+='</div>';

    if(!isFinalized) h+='<div class="mv-footer"><button id="save-meeting-btn2" class="btn btn--primary">Save Changes</button></div>';

    el.innerHTML=h;
    if(isFinalized) el.classList.add('finalized'); else el.classList.remove('finalized');
    showView('meeting');
    wireMeetingEvents();
  }

  function rowHtml(cls,ph,val,i,readonly){
    return '<div class="list-row" data-index="'+i+'"><input type="text" class="'+cls+'" placeholder="'+ph+'" value="'+escA(val)+'"'+(readonly?' readonly':'')+'>'+(readonly?'':removeBtn())+'</div>';
  }
  function actionHtml(item,i,readonly){
    item=item||{};
    var checked=item.completed?'checked':'';
    return '<div class="list-row action-item-row'+(item.completed?' action-completed':'')+'" data-index="'+i+'"><input type="checkbox" class="action-completed-cb" '+checked+' title="Mark complete"><input type="text" class="action-what" placeholder="Action item..." value="'+escA(item.what||'')+'"'+(readonly?' readonly':'')+'><input type="text" class="action-who" placeholder="Assigned to" value="'+escA(item.who||'')+'"'+(readonly?' readonly':'')+'><input type="date" class="action-deadline" value="'+escA(item.deadline||'')+'"'+(readonly?' disabled':'')+'>'+(readonly?'':removeBtn())+'</div>';
  }
  function removeBtn(){
    return '<button type="button" class="btn-remove remove-btn" title="Remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';
  }

  // ---- Speech Recognition ----
  function initSpeechRecognition() {
    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      var btn = $('#recorder-btn');
      if (btn) {
        btn.disabled = true;
        var txt = $('#recorder-btn-text');
        if (txt) txt.textContent = 'Not Supported';
      }
      return;
    }
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = function (event) {
      var interim = '';
      for (var i = event.resultIndex; i < event.results.length; i++) {
        var transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          fullTranscript += transcript + ' ';
          processTranscript(transcript.trim());
        } else {
          interim += transcript;
        }
      }
      var el = $('#transcript-text');
      if (el) {
        el.innerHTML = esc(fullTranscript) + (interim ? '<span style="color:#94a3b8;">' + esc(interim) + '</span>' : '');
        el.scrollTop = el.scrollHeight;
      }
    };

    var retryCount = 0;
    var maxRetries = 3;

    recognition.onerror = function (event) {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      // Stop on fatal errors — don't keep retrying
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        toast('Microphone access denied. Please allow mic permissions.', 'error');
        isRecording = false;
        updateRecorderUI();
        return;
      }
      if (event.error === 'network') {
        retryCount++;
        if (retryCount >= maxRetries) {
          toast('Speech recognition unavailable — check your internet connection', 'error');
          isRecording = false;
          updateRecorderUI();
          return;
        }
        // Silently retry up to maxRetries times
        return;
      }
      toast('Mic error: ' + event.error, 'error');
      isRecording = false;
      updateRecorderUI();
    };

    recognition.onresult = (function(origOnResult) { return function(event) { retryCount = 0; origOnResult(event); }; })(recognition.onresult);

    recognition.onend = function () {
      if (isRecording) {
        setTimeout(function() {
          if (!isRecording) return;
          try { recognition.start(); } catch (e) { /* already started */ }
        }, 300);
      }
    };
  }

  function toggleRecording() {
    if (!recognition) initSpeechRecognition();
    if (!recognition) return;

    if (isRecording) {
      isRecording = false;
      recognition.stop();
      updateRecorderUI();
      toast('Recording stopped', 'success');
    } else {
      isRecording = true;
      fullTranscript = '';
      var tp = $('#transcript-panel');
      if (tp) tp.style.display = 'block';
      try {
        recognition.start();
      } catch (e) {
        toast('Could not start recording', 'error');
        isRecording = false;
      }
      updateRecorderUI();
    }
  }

  function updateRecorderUI() {
    var btn = $('#recorder-btn');
    var txt = $('#recorder-btn-text');
    var ind = $('#recording-indicator');
    if (isRecording) {
      if (btn) btn.classList.add('recording');
      if (txt) txt.textContent = 'Stop Recording';
      if (ind) ind.style.display = 'flex';
    } else {
      if (btn) btn.classList.remove('recording');
      if (txt) txt.textContent = 'Record Meeting';
      if (ind) ind.style.display = 'none';
    }
  }

  function processTranscript(transcript) {
    if (!transcript) return;
    var items = extractItems(transcript);
    if (items.length) {
      var ei = $('#extracted-items');
      if (ei) ei.style.display = 'block';
      items.forEach(function (item) {
        renderExtractedItem(item.text, item.type);
      });
    }
  }

  function extractItems(text) {
    var items = [];
    var sentences = text.replace(/([.?!])\s*/g, '$1|').split('|').filter(Boolean);

    var decisionPatterns = /\b(decided|agreed|approved|will go with|decision is|concluded|finalized)\b/i;
    var actionPatterns = /\b(need to|should|will|assigned to|responsible for|has to|must|deadline|by next|action item|take care of)\b/i;
    var keyPointPatterns = /\b(important|note that|key point|remember|highlight|keep in mind|noteworthy)\b/i;

    sentences.forEach(function (s) {
      s = s.trim();
      if (!s) return;
      if (decisionPatterns.test(s)) {
        items.push({ text: s, type: 'decision' });
      } else if (actionPatterns.test(s)) {
        items.push({ text: s, type: 'action' });
      } else if (keyPointPatterns.test(s)) {
        items.push({ text: s, type: 'point' });
      } else if (s.split(/\s+/).length > 8) {
        items.push({ text: s, type: 'point' });
      }
    });

    return items;
  }

  function renderExtractedItem(text, type) {
    var containerId = type === 'decision' ? 'extracted-decisions' : type === 'action' ? 'extracted-actions' : 'extracted-points';
    var sectionId = type === 'decision' ? 'extracted-decisions-section' : type === 'action' ? 'extracted-actions-section' : 'extracted-points-section';
    var container = $('#' + containerId);
    var section = $('#' + sectionId);
    if (!container || !section) return;
    section.style.display = 'block';

    var labels = { point: 'Point', decision: 'Decision', action: 'Action' };
    var card = document.createElement('div');
    card.className = 'extracted-card extracted-card--' + type;
    card.innerHTML = '<div class="extracted-card-text">' + esc(text) + '</div>' +
      '<button type="button" class="btn btn--sm btn--primary extracted-add-btn" data-type="' + type + '">Add as ' + labels[type] + '</button>';

    card.querySelector('.extracted-add-btn').addEventListener('click', function () {
      addExtractedToMeeting(text, type);
      card.style.opacity = '0.5';
      card.querySelector('.extracted-add-btn').disabled = true;
      card.querySelector('.extracted-add-btn').textContent = 'Added';
    });

    container.appendChild(card);
  }

  function clearExtracted(){
    var ei=$('#extracted-items'); if(ei) ei.style.display='none';
    ['extracted-points','extracted-decisions','extracted-actions'].forEach(function(id){ var el=$('#'+id); if(el) el.innerHTML=''; });
    ['extracted-points-section','extracted-decisions-section','extracted-actions-section'].forEach(function(id){ var el=$('#'+id); if(el) el.style.display='none'; });
  }

  function addExtractedToMeeting(text, type) {
    if (type === 'point') {
      var l = $('#points-list');
      if (l) {
        l.insertAdjacentHTML('beforeend', rowHtml('point-input', 'Discussion point...', text, l.querySelectorAll('.list-row').length));
        wireRemove(); wireInputs(); schedSave();
      }
    } else if (type === 'decision') {
      var l2 = $('#decisions-list');
      if (l2) {
        l2.insertAdjacentHTML('beforeend', rowHtml('decision-input', 'Decision...', text, l2.querySelectorAll('.list-row').length));
        wireRemove(); wireInputs(); schedSave();
      }
    } else if (type === 'action') {
      var l3 = $('#action-items-list');
      if (l3) {
        var who = '';
        var whoMatch = text.match(/\b(?:assigned to|responsible for)\s+(\w+(?:\s+\w+)?)/i);
        if (whoMatch) who = whoMatch[1];
        l3.insertAdjacentHTML('beforeend', actionHtml({ what: text, who: who, deadline: '' }, l3.querySelectorAll('.action-item-row').length));
        wireRemove(); wireInputs(); schedSave();
      }
    }
    toast('Added to meeting', 'success');
  }

  // ---- Wire meeting events ----
  function wireMeetingEvents(){
    var s=$('#save-meeting-btn'); if(s) s.onclick=function(e){e.preventDefault();collectAndSave();};
    var s2=$('#save-meeting-btn2'); if(s2) s2.onclick=function(e){e.preventDefault();collectAndSave();};
    var p=$('#download-pdf-btn'); if(p) p.onclick=downloadPdf;
    var d=$('#delete-meeting-btn'); if(d) d.onclick=async function(){ if(!currentMeeting||!confirm('Delete this meeting?')) return; if(await deleteMeeting(currentMeeting.id)){ currentMeeting=null; showView('empty'); await refreshList(); }};
    // Feature 2: Finalize
    var fb=$('#finalize-meeting-btn'); if(fb) fb.onclick=async function(){
      if(!currentMeeting) return;
      if(!confirm('Finalize this meeting? Editing will be locked.')) return;
      var u=await updateMeeting(currentMeeting.id,{status:'finalized'});
      if(u){ currentMeeting=u; renderMeeting(u); await refreshList(); toast('Meeting finalized','success'); }
    };
    // Feature 2: Reopen
    var rb2=$('#reopen-meeting-btn'); if(rb2) rb2.onclick=async function(){
      if(!currentMeeting) return;
      var u=await updateMeeting(currentMeeting.id,{status:'draft'});
      if(u){ currentMeeting=u; renderMeeting(u); await refreshList(); toast('Meeting reopened','success'); }
    };
    // Feature 1: Action item checkboxes
    wireActionCheckboxes();
    var ap=$('#add-point-btn'); if(ap) ap.onclick=function(){ var l=$('#points-list'); if(!l) return; l.insertAdjacentHTML('beforeend',rowHtml('point-input','Discussion point...','',l.querySelectorAll('.list-row').length)); wireRemove(); wireInputs(); l.querySelector('.list-row:last-child .point-input').focus(); };
    var ad=$('#add-decision-btn'); if(ad) ad.onclick=function(){ var l=$('#decisions-list'); if(!l) return; l.insertAdjacentHTML('beforeend',rowHtml('decision-input','Decision...','',l.querySelectorAll('.list-row').length)); wireRemove(); wireInputs(); l.querySelector('.list-row:last-child .decision-input').focus(); };
    var aa=$('#add-action-btn'); if(aa) aa.onclick=function(){ var l=$('#action-items-list'); if(!l) return; l.insertAdjacentHTML('beforeend',actionHtml({},l.querySelectorAll('.action-item-row').length)); wireRemove(); wireInputs(); wireActionCheckboxes(); l.querySelector('.action-item-row:last-child .action-what').focus(); };
    // Feature 4: Attendee suggestions
    wireAttendeeSuggestions($('#edit-meeting-attendees'));
    // Tab switching
    $$('.recorder-tab').forEach(function(tab){
      tab.onclick=function(){
        var target=tab.dataset.tab;
        $$('.recorder-tab').forEach(function(t){ t.classList.toggle('active',t.dataset.tab===target); });
        var textContent=$('#tab-content-text'), micContent=$('#tab-content-mic');
        if(textContent) textContent.style.display=target==='text'?'block':'none';
        if(micContent) micContent.style.display=target==='mic'?'block':'none';
      };
    });

    // Analyze text notes
    var ab=$('#analyze-notes-btn'); if(ab) ab.onclick=function(){
      var ta=$('#notes-textarea'); if(!ta||!ta.value.trim()){ toast('Type some notes first','error'); return; }
      clearExtracted();
      var text=ta.value.trim();
      var items=extractItems(text);
      if(items.length){
        var ei=$('#extracted-items'); if(ei) ei.style.display='block';
        items.forEach(function(item){ renderExtractedItem(item.text,item.type); });
        toast(items.length+' items extracted!','success');
      } else {
        toast('No key items detected. Try adding more details.','error');
      }
    };

    // Clear notes
    var cn2=$('#clear-notes-btn'); if(cn2) cn2.onclick=function(){
      var ta=$('#notes-textarea'); if(ta) ta.value='';
      clearExtracted();
    };

    // Recorder events (mic tab)
    var rb=$('#recorder-btn'); if(rb) rb.onclick=toggleRecording;
    var ct=$('#clear-transcript-btn'); if(ct) ct.onclick=function(){
      fullTranscript='';
      var tt=$('#transcript-text'); if(tt) tt.innerHTML='';
      clearExtracted();
    };

    wireRemove(); wireInputs();
  }
  function wireRemove(){ $$('#current-meeting .remove-btn').forEach(function(b){ b.onclick=function(){ b.closest('.list-row').remove(); schedSave(); }; }); }
  function wireInputs(){ $$('#current-meeting input').forEach(function(i){ i.oninput=schedSave; }); }

  // Feature 1: Wire action item completion checkboxes
  function wireActionCheckboxes(){
    $$('#action-items-list .action-completed-cb').forEach(function(cb){
      cb.onchange=function(){
        var row=cb.closest('.action-item-row');
        if(row){ if(cb.checked) row.classList.add('action-completed'); else row.classList.remove('action-completed'); }
        schedSave();
      };
    });
  }

  // Feature 1: Toggle action item completion from dashboard
  async function toggleDashActionComplete(meetingId, actionIdx, completed){
    var m=await loadMeeting(meetingId); if(!m) return;
    var acts=m.action_items||[];
    if(acts[actionIdx]!==undefined){ acts[actionIdx].completed=completed; }
    var u=await updateMeeting(m.id,{action_items:acts});
    if(u){ await refreshList(); renderDashboard(); }
  }

  // Feature 4: Collect unique attendee names across all meetings
  function collectAttendeeNames(){
    var names={};
    allMeetings.forEach(function(m){
      var att=Array.isArray(m.attendees)?m.attendees:[];
      att.forEach(function(a){ var n=a.trim(); if(n) names[n.toLowerCase()]=n; });
    });
    allAttendeeNames=Object.values(names);
  }

  // Feature 4: Attendee autocomplete
  function wireAttendeeSuggestions(input){
    if(!input) return;
    input.addEventListener('input',function(){
      removeAttendeeSuggestions();
      var val=input.value;
      var lastComma=val.lastIndexOf(',');
      var query=(lastComma>=0?val.substring(lastComma+1):val).trim().toLowerCase();
      if(!query||query.length<1) return;
      var matches=allAttendeeNames.filter(function(n){ return n.toLowerCase().includes(query); }).slice(0,8);
      if(!matches.length) return;
      var dd=document.createElement('div');
      dd.className='attendee-suggestions';
      dd.style.cssText='position:absolute;top:100%;left:0;right:0;z-index:100;background:var(--bg-card,#fff);border:1px solid var(--border,#e2e8f0);border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.1);max-height:180px;overflow-y:auto;';
      matches.forEach(function(name){
        var item=document.createElement('div');
        item.className='attendee-suggestion-item';
        item.textContent=name;
        item.style.cssText='padding:8px 12px;cursor:pointer;font-size:14px;';
        item.addEventListener('mousedown',function(e){
          e.preventDefault();
          var before=lastComma>=0?val.substring(0,lastComma+1)+' ':'' ;
          input.value=before+name+', ';
          removeAttendeeSuggestions();
          input.focus();
          schedSave();
        });
        item.addEventListener('mouseenter',function(){ item.style.background='var(--bg-hover,#f1f5f9)'; });
        item.addEventListener('mouseleave',function(){ item.style.background=''; });
        dd.appendChild(item);
      });
      input.parentElement.style.position='relative';
      input.parentElement.appendChild(dd);
    });
    input.addEventListener('blur',function(){ setTimeout(removeAttendeeSuggestions,200); });
  }
  function removeAttendeeSuggestions(){
    var existing=document.querySelectorAll('.attendee-suggestions');
    existing.forEach(function(el){ el.remove(); });
  }

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
  var DEPT_COLORS = {
    'HR':'#6366f1','Training':'#8b5cf6','Audit':'#ef4444',
    'Ops':'#f59e0b','IT and Admin':'#06b6d4','NMSPL':'#10b981'
  };

  function renderDashboard(){
    var el=$('#dashboard-view'); if(!el) return;
    var un=userName(), ue=userEmail();
    var today=new Date().toISOString().slice(0,10);

    // Show ALL meetings (not filtered by user)
    var filtered = getFilteredMeetings(allMeetings);

    // Collect ALL actions, decisions, points across all visible meetings
    var totalActions=[], totalDecisions=0, totalCompleted=0, totalOverdue=0;
    filtered.forEach(function(m){
      (m.action_items||[]).forEach(function(a){
        totalActions.push({meeting:m,action:a});
        if(a.completed) totalCompleted++;
        else if(a.deadline&&a.deadline<today) totalOverdue++;
      });
      totalDecisions+=(m.decisions||[]).length;
    });

    // Group meetings by department
    var deptMap={};
    filtered.forEach(function(m){
      var d=m.department||'General';
      if(!deptMap[d]) deptMap[d]=[];
      deptMap[d].push(m);
    });
    var deptOrder=['HR','Training','IT and Admin','NMSPL','Ops','Audit'];
    var deptKeys=deptOrder.filter(function(d){return deptMap[d];});
    Object.keys(deptMap).forEach(function(d){ if(deptKeys.indexOf(d)<0) deptKeys.push(d); });

    var h='';

    // Header
    h+='<div class="dash-header">';
    h+='<div class="dash-header-text"><h2>Action Plan Dashboard</h2><p>'+esc(currentDept==='Higher Authority'?'All Departments Overview':currentDept||'All Departments')+'</p></div>';
    h+='<div class="dash-header-actions"><button id="export-dept-pdf-btn" class="btn btn--secondary">Export Report PDF</button></div>';
    h+='</div>';

    // Stats
    h+='<div class="dash-stats-grid">';
    h+='<div class="dash-stat-card"><div class="dash-stat-icon dash-stat-icon--pri"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div><div class="dash-stat-info"><div class="dash-stat-num">'+filtered.length+'</div><div class="dash-stat-label">Meetings</div></div></div>';
    h+='<div class="dash-stat-card"><div class="dash-stat-icon dash-stat-icon--amber"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg></div><div class="dash-stat-info"><div class="dash-stat-num">'+totalActions.length+'</div><div class="dash-stat-label">Total Actions</div></div></div>';
    h+='<div class="dash-stat-card'+(totalOverdue?' dash-stat-card--alert':'')+'"><div class="dash-stat-icon dash-stat-icon--red"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div><div class="dash-stat-info"><div class="dash-stat-num">'+totalOverdue+'</div><div class="dash-stat-label">Overdue</div></div></div>';
    h+='<div class="dash-stat-card"><div class="dash-stat-icon dash-stat-icon--green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></div><div class="dash-stat-info"><div class="dash-stat-num">'+totalCompleted+'</div><div class="dash-stat-label">Completed</div></div></div>';
    h+='</div>';

    // Department-wise Action Plan sections
    deptKeys.forEach(function(dept){
      var meetings=deptMap[dept];
      var color=DEPT_COLORS[dept]||'#64748b';
      var deptActions=[], deptDecisions=[], deptPoints=[];
      meetings.forEach(function(m){
        (m.action_items||[]).forEach(function(a,idx){ deptActions.push({meeting:m,action:a,idx:idx}); });
        (m.decisions||[]).forEach(function(d){ if(d) deptDecisions.push(d); });
        (m.points_discussed||[]).forEach(function(p){ if(p) deptPoints.push(p); });
      });
      var doneCount=deptActions.filter(function(e){return e.action.completed;}).length;
      var pendingCount=deptActions.length-doneCount;

      h+='<div class="dash-dept-section" style="border-left:4px solid '+color+';margin-bottom:24px;padding:20px;background:var(--bg-card,#fff);border-radius:10px;">';

      // Dept header
      h+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px;">';
      h+='<div style="display:flex;align-items:center;gap:10px;">';
      h+='<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:'+color+';"></span>';
      h+='<h3 style="margin:0;font-size:18px;font-weight:700;">'+esc(dept)+'</h3>';
      h+='<span style="font-size:12px;padding:2px 10px;border-radius:12px;background:'+color+'22;color:'+color+';font-weight:600;">'+deptActions.length+' actions</span>';
      h+='</div>';
      h+='<div style="display:flex;gap:12px;font-size:13px;color:var(--text-muted,#64748b);">';
      if(doneCount) h+='<span style="color:#059669;">'+doneCount+' done</span>';
      if(pendingCount) h+='<span style="color:'+color+';">'+pendingCount+' pending</span>';
      h+='</div>';
      h+='</div>';

      // Discussion points (compact)
      if(deptPoints.length){
        h+='<div style="margin-bottom:14px;">';
        h+='<div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted,#64748b);margin-bottom:6px;">Discussion Points</div>';
        h+='<div style="display:flex;flex-wrap:wrap;gap:6px;">';
        deptPoints.forEach(function(p){
          h+='<span style="font-size:12px;padding:4px 10px;border-radius:6px;background:var(--bg-hover,#f1f5f9);color:var(--text-primary,#334155);">'+esc(p)+'</span>';
        });
        h+='</div></div>';
      }

      // Decisions (compact)
      if(deptDecisions.length){
        h+='<div style="margin-bottom:14px;">';
        h+='<div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted,#64748b);margin-bottom:6px;">Key Decisions</div>';
        deptDecisions.forEach(function(d){
          h+='<div style="font-size:13px;padding:6px 0;color:var(--text-primary,#334155);border-bottom:1px solid var(--border,#e2e8f0);display:flex;align-items:flex-start;gap:6px;">';
          h+='<span style="color:'+color+';font-weight:bold;flex-shrink:0;">&#10003;</span> '+esc(d);
          h+='</div>';
        });
        h+='</div>';
      }

      // Action items table
      if(deptActions.length){
        h+='<div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted,#64748b);margin-bottom:8px;">Action Plan</div>';
        h+='<div style="overflow-x:auto;">';
        h+='<table style="width:100%;border-collapse:collapse;font-size:13px;">';
        h+='<thead><tr style="border-bottom:2px solid '+color+'33;">';
        h+='<th style="text-align:left;padding:8px 6px;font-weight:600;width:30px;"></th>';
        h+='<th style="text-align:left;padding:8px 6px;font-weight:600;">Task</th>';
        h+='<th style="text-align:left;padding:8px 6px;font-weight:600;white-space:nowrap;">Assigned To</th>';
        h+='<th style="text-align:left;padding:8px 6px;font-weight:600;white-space:nowrap;">Deadline</th>';
        h+='<th style="text-align:center;padding:8px 6px;font-weight:600;">Status</th>';
        h+='</tr></thead><tbody>';
        deptActions.forEach(function(e,i){
          var a=e.action, m=e.meeting;
          var isOverdue=!a.completed&&a.deadline&&a.deadline<today;
          var rowBg=a.completed?'var(--bg-hover,#f0fdf4)':isOverdue?'#fef2f2':'transparent';
          var statusBadge=a.completed
            ?'<span style="padding:2px 8px;border-radius:4px;background:#dcfce7;color:#059669;font-size:11px;font-weight:600;">Done</span>'
            :isOverdue
              ?'<span style="padding:2px 8px;border-radius:4px;background:#fecaca;color:#dc2626;font-size:11px;font-weight:600;">Overdue</span>'
              :'<span style="padding:2px 8px;border-radius:4px;background:#fef3c7;color:#d97706;font-size:11px;font-weight:600;">Pending</span>';
          h+='<tr style="border-bottom:1px solid var(--border,#e2e8f0);background:'+rowBg+';">';
          h+='<td style="padding:8px 6px;text-align:center;"><input type="checkbox" class="dash-action-cb" data-mid="'+m.id+'" data-aidx="'+e.idx+'" '+(a.completed?'checked':'')+' title="Mark complete"></td>';
          h+='<td style="padding:8px 6px;'+(a.completed?'text-decoration:line-through;opacity:0.6;':'')+'">'+esc(a.what)+'</td>';
          h+='<td style="padding:8px 6px;font-weight:500;white-space:nowrap;">'+esc(a.who||'-')+'</td>';
          h+='<td style="padding:8px 6px;white-space:nowrap;">'+esc(a.deadline||'No deadline')+'</td>';
          h+='<td style="padding:8px 6px;text-align:center;">'+statusBadge+'</td>';
          h+='</tr>';
        });
        h+='</tbody></table></div>';
      }

      h+='</div>'; // close dept section
    });

    el.innerHTML=h; showView('dashboard');
    var expBtn=$('#export-dept-pdf-btn'); if(expBtn) expBtn.onclick=downloadDeptReport;
    el.querySelectorAll('.dash-action-cb').forEach(function(cb){
      cb.onclick=function(e){ e.stopPropagation(); toggleDashActionComplete(parseInt(cb.dataset.mid),parseInt(cb.dataset.aidx),cb.checked); };
    });
  }

  // ---- Modal ----
  function suggestMeetingTitle() {
    var deptSel = $('#meeting-department');
    var dateInput = $('#meeting-date');
    var titleInput = $('#meeting-title');
    if (!deptSel || !dateInput || !titleInput) return;
    var dept = deptSel.value;
    var dateVal = dateInput.value;
    if (dept && dateVal) {
      var d = new Date(dateVal + 'T00:00:00');
      var monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      var monthYear = monthNames[d.getMonth()] + ' ' + d.getFullYear();
      titleInput.value = dept + ' Meeting - ' + monthYear;
    }
  }

  function openModal(){
    var o=$('#meeting-modal-overlay'); if(o) o.style.display='flex';

    // Inject department dropdown before the title field if not already present
    var form = $('#meeting-form');
    var existingDeptGroup = $('#meeting-dept-group');
    if (!existingDeptGroup && form) {
      var firstGroup = form.querySelector('.form-group');
      var deptGroup = document.createElement('div');
      deptGroup.className = 'form-group';
      deptGroup.id = 'meeting-dept-group';
      var lbl = document.createElement('label');
      lbl.setAttribute('for', 'meeting-department');
      lbl.className = 'form-label';
      lbl.textContent = 'Department';
      var sel = document.createElement('select');
      sel.id = 'meeting-department';
      sel.className = 'form-input form-select';
      sel.required = true;
      DEPARTMENTS.forEach(function(dept) {
        var opt = document.createElement('option');
        opt.value = dept;
        opt.textContent = dept;
        sel.appendChild(opt);
      });
      sel.onchange = suggestMeetingTitle;
      deptGroup.appendChild(lbl);
      deptGroup.appendChild(sel);
      form.insertBefore(deptGroup, firstGroup);
    }

    var deptSel = $('#meeting-department');
    if (deptSel) {
      if (currentDept && currentDept !== 'Higher Authority') {
        deptSel.value = currentDept;
        deptSel.disabled = true;
      } else if (currentDept === 'Higher Authority') {
        deptSel.value = DEPARTMENTS[0];
        deptSel.disabled = false;
      }
    }

    var d=$('#meeting-date'); if(d) { d.value=new Date().toISOString().slice(0,10); d.onchange=suggestMeetingTitle; }
    suggestMeetingTitle();
    var t=$('#meeting-title'); if(t) t.focus();
    var a=$('#meeting-attendees'); if(a) a.value=currentUser?userName():'';
  }
  function closeModal(){ var o=$('#meeting-modal-overlay'); if(o) o.style.display='none'; }

  // Feature 5: Dark mode toggle
  function initDarkMode(){
    var saved=localStorage.getItem('meeting_dark_mode');
    if(saved==='true') document.documentElement.classList.add('dark');
    // Inject toggle button into topbar-right
    var topRight=$('.topbar-right');
    if(!topRight) return;
    var btn=document.createElement('button');
    btn.className='dark-mode-toggle';
    btn.title='Toggle dark mode';
    btn.innerHTML=document.documentElement.classList.contains('dark')
      ?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
      :'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    btn.onclick=function(){
      var isDark=document.documentElement.classList.toggle('dark');
      localStorage.setItem('meeting_dark_mode',isDark?'true':'false');
      btn.innerHTML=isDark
        ?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
        :'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    };
    topRight.insertBefore(btn,topRight.firstChild);
  }

  // Feature 3: Export department PDF report
  function downloadDeptReport(){
    var J=(window.jspdf&&window.jspdf.jsPDF)||window.jsPDF;
    if(!J){ toast('jsPDF not loaded','error'); return; }
    var dept=currentDept||'All';
    var meetings=dept==='Higher Authority'?allMeetings:allMeetings.filter(function(m){ return m.department===dept; });
    if(!meetings.length){ toast('No meetings to export','error'); return; }
    meetings.sort(function(a,b){ return (a.date||'').localeCompare(b.date||''); });

    var doc=new J(), y=20, mg=20, pw=doc.internal.pageSize.getWidth(), mw=pw-mg*2;
    function chk(n){ if(y+n>270){ doc.addPage(); y=20; } }

    // Title page
    doc.setFontSize(22); doc.setFont(undefined,'bold');
    doc.text(dept+' — Meeting Minutes Report',mg,y); y+=10;
    doc.setFontSize(11); doc.setFont(undefined,'normal');
    doc.text('Generated: '+new Date().toLocaleDateString(),mg,y); y+=6;
    doc.text('Total meetings: '+meetings.length,mg,y); y+=10;
    doc.setDrawColor(180); doc.line(mg,y,pw-mg,y); y+=10;

    meetings.forEach(function(m,idx){
      chk(30);
      doc.setFontSize(15); doc.setFont(undefined,'bold');
      doc.text((idx+1)+'. '+esc(m.title||'Untitled').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"'),mg,y); y+=7;
      doc.setFontSize(10); doc.setFont(undefined,'normal');
      doc.text('ID: '+(m.meeting_id||'N/A')+'  |  Date: '+(m.date||'N/A')+'  |  Status: '+(m.status||'draft'),mg,y); y+=5;
      var att=Array.isArray(m.attendees)?m.attendees.join(', '):m.attendees||'';
      if(att){ doc.text('Attendees: '+att,mg,y,{maxWidth:mw}); y+=6; }
      y+=3;

      // Points
      var pts=m.points_discussed||[];
      if(pts.length){
        doc.setFontSize(11); doc.setFont(undefined,'bold'); doc.text('Points Discussed:',mg,y); y+=6;
        doc.setFontSize(10); doc.setFont(undefined,'normal');
        pts.forEach(function(p,i){ chk(7); var l=doc.splitTextToSize('  '+(i+1)+'. '+p,mw); doc.text(l,mg,y); y+=l.length*5; });
        y+=3;
      }
      // Decisions
      var decs=m.decisions||[];
      if(decs.length){
        chk(10); doc.setFontSize(11); doc.setFont(undefined,'bold'); doc.text('Decisions:',mg,y); y+=6;
        doc.setFontSize(10); doc.setFont(undefined,'normal');
        decs.forEach(function(d,i){ chk(7); var l=doc.splitTextToSize('  '+(i+1)+'. '+d,mw); doc.text(l,mg,y); y+=l.length*5; });
        y+=3;
      }
      // Actions
      var acts=m.action_items||[];
      if(acts.length){
        chk(10); doc.setFontSize(11); doc.setFont(undefined,'bold'); doc.text('Action Items:',mg,y); y+=6;
        doc.setFontSize(10); doc.setFont(undefined,'normal');
        acts.forEach(function(a,i){ chk(7); var ln='  '+(i+1)+'. ['+(a.who||'?')+'] '+(a.what||'')+(a.deadline?' (Due: '+a.deadline+')':'')+(a.completed?' [DONE]':''); var l=doc.splitTextToSize(ln,mw); doc.text(l,mg,y); y+=l.length*5; });
        y+=3;
      }
      y+=6; chk(6); doc.setDrawColor(220); doc.line(mg,y,pw-mg,y); y+=8;
    });

    doc.save(dept.replace(/\s+/g,'_')+'_report.pdf');
    toast('Department report downloaded','success');
  }

  // ---- Import: 9-Feb-2026 Review Meeting ----
  async function importReviewMeeting() {
    if (!sb || !currentUser) { toast('Please log in first', 'error'); return; }

    var date = '2026-02-09';
    var commonAttendees = [
      'Nagendra V. Mali', 'Suresh B.K.', 'Nandakishore', 'Veeresh',
      'Vishwanath', 'Shivakumar', 'Anitha M.L.', 'Sudha',
      'Naveen', 'Raghunandam', 'Kotragouda', 'Ajjanagouda'
    ];

    var commonDecisions = [
      'New partnership with Shriram Finance for Vehicle Loans and Kotak for HL, PL & LAP – implementation, team building, and operational readiness to be planned',
      'ESAF Lending: 30% Individual Loans (IL) and 70% Group Loans / IGL from next financial year',
      'Clear process flow, business plan, and operational strategy to be defined for ESAF',
      'ICICI partnership from April 2026 – Lending through SHG Model, requires branch setup and dedicated teams',
      'Vivrutti Gold Loan – Preparatory activities to be initiated',
      'Monthly review meetings to be conducted; departments to prepare and present PPTs',
      'Each department to conduct in-depth study on one focus area every month and present improvements, strategies, challenges, and implications',
      'One middle-management level analyst with cross-functional experience to be identified for HR & Training, Operations, Admin & IT, Audit'
    ];

    var deptData = [
      {
        department: 'HR',
        title: 'HR Review Meeting - February 2026',
        points_discussed: [
          'Manpower planning – field & department-wise',
          'Attrition analysis',
          'Recruitment status',
          'Salary projections & manpower plan – Feb 2026',
          'Employee engagement initiatives: Drawing competition (Republic Day theme), Short video creation for awareness, Branch team contests, Potluck lunch at corporate office, Leader boards'
        ],
        decisions: commonDecisions.slice(),
        action_items: [
          { who: 'Vishwanath', what: 'Revision of HR & Training Policy', deadline: '2026-02-28', completed: false },
          { who: 'Vishwanath', what: 'Maintain department-wise manpower data (HO & CO)', deadline: '2026-02-28', completed: false },
          { who: 'Vishwanath', what: 'Add Sr. Manager reporting directly to CEO in organization structure', deadline: '2026-02-28', completed: false },
          { who: 'Vishwanath', what: 'Define DOE roles & responsibilities along with Ops Team', deadline: '2026-02-28', completed: false },
          { who: 'Vishwanath', what: 'Design Secured Lending Team Structure (Housing Loan & Vehicle Loan) with Designation', deadline: '2026-02-28', completed: false },
          { who: 'Vishwanath', what: 'Collect data of old MBL team members (NMSPL/NLPL) – number of accounts handled and plan further action', deadline: '2026-02-28', completed: false },
          { who: 'Vishwanath', what: 'Team placement: Mrs. Siddagangamma to HL Team', deadline: '2026-02-28', completed: false },
          { who: 'Vishwanath', what: 'Team placement: Mr. Varun to Digital Lending Team', deadline: '2026-02-28', completed: false },
          { who: 'Vishwanath', what: 'Team placement: Mrs. Sharadhi from Accounts Team to Ops', deadline: '2026-02-28', completed: false },
          { who: 'Vishwanath', what: 'Collect & Analyse employee exit formalities, exit reasons and tracking', deadline: '2026-02-28', completed: false },
          { who: 'Vishwanath', what: 'Coordinate with RMs to obtain projected recruitment plan for next year (attrition & recruitment)', deadline: '2026-02-28', completed: false },
          { who: 'Vishwanath', what: 'Analyse low performance reasons, plan skip-level meetings', deadline: '2026-02-28', completed: false },
          { who: 'Vishwanath', what: 'Bifurcate Full & Final pending details – Salary & TA', deadline: '2026-02-28', completed: false },
          { who: 'Vishwanath', what: 'Prepare DRAFT copy of overall incentive structure for all products/entities effective 1st April 2026', deadline: '2026-02-28', completed: false },
          { who: 'Vishwanath', what: 'Conduct pay-out simulations', deadline: '2026-02-28', completed: false }
        ]
      },
      {
        department: 'Training',
        title: 'Training Review Meeting - February 2026',
        points_discussed: [
          'Employee engagement initiatives: Drawing competition for employees\' children (Republic Day theme)',
          'Short video creation for Employee Awareness',
          'Branch team contests for team motivation',
          'Potluck lunch at corporate office',
          'Leader boards for healthy competitions',
          'Monthly Initiatives – Employee Awareness'
        ],
        decisions: commonDecisions.slice(),
        action_items: [
          { who: 'Shivakumar', what: 'Prepare Yearly Training Calendar with Budget (designation-wise)', deadline: '2026-02-28', completed: false },
          { who: 'Shivakumar', what: 'Conduct Knowledge Test / Quiz Competitions for Field Team at District & Regional levels with attractive prizes', deadline: '2026-02-28', completed: false }
        ]
      },
      {
        department: 'IT and Admin',
        title: 'IT and Admin Review Meeting - February 2026',
        points_discussed: [
          'Branch-wise Admin & IT asset details and asset values',
          'Office & accommodation buildings',
          'Printing, stationery & related expenses',
          'CCTV details',
          'Major Focus: Asset tracking – computers, laptops, tabs, and other devices'
        ],
        decisions: commonDecisions.slice(),
        action_items: [
          { who: 'Nandakishore', what: 'Admin & IT team visit branches, coordinate with branch teams, and collect accurate asset data using Trackolap', deadline: '2026-02-28', completed: false }
        ]
      },
      {
        department: 'NMSPL',
        title: 'NMSPL Portfolio / Collection Review - February 2026',
        points_discussed: [
          'Overall portfolio overview',
          'Manpower review',
          'Collection efficiency – Regular, SMA & NPA (branch-wise, account-wise & amount-wise)',
          'Legal cases and improvement areas',
          'Feb 2026 action plan',
          'Introduction of Club Rewards: HR Club, CEO Club & MD Club',
          'JFM One-Day Trip for individuals and families based on collection performance'
        ],
        decisions: commonDecisions.slice(),
        action_items: [
          { who: 'Kotragouda', what: 'Revise and present data on NPA activation & closure, Regular collection, fully paid & partially paid customers', deadline: '2026-02-28', completed: false },
          { who: 'Kotragouda', what: 'Target Rs 2.5 Cr collection from NPA pool', deadline: '2026-02-28', completed: false },
          { who: 'Kotragouda', what: 'Increase daily demand collection to 99.5%', deadline: '2026-02-28', completed: false },
          { who: 'Kotragouda', what: 'Implement Leaders board concept in NMSPL', deadline: '2026-02-28', completed: false },
          { who: 'Kotragouda', what: 'Tele-calling through DOEs for NLPL/NMSPL outstanding at NLPL branch locations', deadline: '2026-02-28', completed: false },
          { who: 'Kotragouda', what: 'Complete legal hiring in Tamil Nadu', deadline: '2026-02-28', completed: false },
          { who: 'Kotragouda', what: 'Conduct feasibility study on SHG lending in Mysore Region and branch merging for branches with <500 accounts', deadline: '2026-02-28', completed: false },
          { who: 'Kotragouda', what: 'Shift the Branch Assets from MP, AP & TS branches', deadline: '2026-02-28', completed: false }
        ]
      },
      {
        department: 'Ops',
        title: 'Operations Review Meeting - February 2026',
        points_discussed: [
          'Team structure',
          'Login vs Disbursement',
          'Digital Collections',
          'Insurance',
          'Collection process',
          'Secured loans'
        ],
        decisions: commonDecisions.slice(),
        action_items: [
          { who: 'Anitha M.L.', what: 'In-depth Digital payment data analysis', deadline: '2026-02-28', completed: false },
          { who: 'Anitha M.L.', what: 'Insurance TAT analysis', deadline: '2026-02-28', completed: false },
          { who: 'Anitha M.L.', what: 'Collection reporting – T+1 basis', deadline: '2026-02-28', completed: false },
          { who: 'Anitha M.L.', what: 'Secured loan reporting to be product-wise and entity-wise', deadline: '2026-02-28', completed: false }
        ]
      },
      {
        department: 'Audit',
        title: 'Audit Review Meeting - February 2026',
        points_discussed: [
          'Audit Process review',
          'Internal Audit team structure and Team Members',
          'Branch Audit coverage, and sampling Audits',
          'Fraud cases and related analysis',
          'Major audit observations, including Ombudsman and grievance-related issues'
        ],
        decisions: commonDecisions.slice(),
        action_items: [
          { who: 'Veeresh', what: 'Auditors to visit NPA customers who have not been contacted by the branch team', deadline: '2026-02-28', completed: false },
          { who: 'Veeresh', what: 'Take appropriate disciplinary action on employees involved in fraud who are still active in the system', deadline: '2026-02-28', completed: false },
          { who: 'Veeresh', what: 'Obtain detailed data on fraud amounts in OD accounts', deadline: '2026-02-28', completed: false },
          { who: 'Veeresh', what: 'Review the e-stamp paper process', deadline: '2026-02-28', completed: false },
          { who: 'Veeresh', what: 'Address the fake document uploads', deadline: '2026-02-28', completed: false },
          { who: 'Veeresh', what: 'Fix Nominee mismatches and incorrect customer name entries', deadline: '2026-02-28', completed: false },
          { who: 'Veeresh', what: 'Create an Advance Collection Policy', deadline: '2026-02-28', completed: false },
          { who: 'Veeresh', what: 'Implement and monitor Early Warning Signals (EWS) for risk identification', deadline: '2026-02-28', completed: false }
        ]
      }
    ];

    var created = 0, skipped = 0;
    for (var i = 0; i < deptData.length; i++) {
      var dd = deptData[i];
      // Check for duplicate department+month
      var dup = allMeetings.some(function(mtg) {
        if (mtg.department !== dd.department) return false;
        if (!mtg.date) return false;
        var md = new Date(mtg.date + 'T00:00:00');
        return md.getFullYear() === 2026 && md.getMonth() === 1; // Feb 2026
      });
      if (dup) { skipped++; continue; }

      var rec = {
        meeting_id: genId(),
        title: dd.title,
        date: date,
        attendees: commonAttendees,
        points_discussed: dd.points_discussed,
        decisions: dd.decisions,
        action_items: dd.action_items,
        user_id: currentUser.id,
        department: dd.department,
        status: 'draft'
      };
      var r = await sb.from(TABLE).insert([rec]).select().single();
      if (r.error) { toast('Error creating ' + dd.department + ': ' + r.error.message, 'error'); }
      else { created++; }
    }

    await refreshList();
    toast('Imported ' + created + ' meetings' + (skipped ? ' (' + skipped + ' skipped — already exist)' : ''), 'success');
  }
  window.importReviewMeeting = importReviewMeeting;

  // ---- Init ----
  function wireStatic(){
    // Auth
    var gb=$('#google-login-btn'); if(gb) gb.onclick=signInGoogle;
    var gb2=$('#login-gate-btn'); if(gb2) gb2.onclick=signInGoogle;
    var lo=$('#logout-btn'); if(lo) lo.onclick=signOut;
    var db=$('#my-dashboard-btn'); if(db) db.onclick=function(){ currentMeeting=null; $$('.meeting-item').forEach(function(e){e.classList.remove('active');}); renderDashboard(); };

    // New meeting
    var nb=$('#new-meeting-btn'); if(nb) nb.onclick=openModal;
    // Import review meeting
    var ib=$('#import-review-btn'); if(ib) ib.onclick=async function(){ if(!confirm('Import the 9-Feb-2026 Review Meeting data for all 6 departments?')) return; ib.disabled=true; ib.textContent='Importing...'; await importReviewMeeting(); ib.disabled=false; ib.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>Import 9-Feb Review Meeting'; };
    var cb=$('#modal-close-btn'); if(cb) cb.onclick=closeModal;
    var cn=$('#modal-cancel-btn'); if(cn) cn.onclick=closeModal;
    var ov=$('#meeting-modal-overlay'); if(ov) ov.onclick=function(e){ if(e.target===ov) closeModal(); };

    var fm=$('#meeting-form');
    if(fm) fm.onsubmit=async function(e){
      e.preventDefault();
      var dept=($('#meeting-department')||{}).value||'';
      var t=($('#meeting-title')||{}).value||'', d=($('#meeting-date')||{}).value||'', a=($('#meeting-attendees')||{}).value||'';
      if(!t.trim()){toast('Enter a title','error');return;}
      // Check for duplicate department+month
      if(dept && d) {
        var dateObj = new Date(d + 'T00:00:00');
        var ym = dateObj.getFullYear() + '-' + String(dateObj.getMonth()+1).padStart(2,'0');
        var monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        var monthYear = monthNames[dateObj.getMonth()] + ' ' + dateObj.getFullYear();
        var dup = allMeetings.some(function(mtg) {
          if (mtg.department !== dept) return false;
          if (!mtg.date) return false;
          var md = new Date(mtg.date + 'T00:00:00');
          var mym = md.getFullYear() + '-' + String(md.getMonth()+1).padStart(2,'0');
          return mym === ym;
        });
        if (dup) { toast('A meeting already exists for ' + dept + ' in ' + monthYear, 'error'); return; }
      }
      var att=a.split(',').map(function(s){return s.trim();}).filter(Boolean);
      var m=await createMeeting(t.trim(),d,att,dept);
      if(m){ currentMeeting=m; renderMeeting(m); await refreshList(); closeModal(); }
    };

    // Search
    var si=$('#search-meetings'); if(si) si.oninput=function(){ filterList(si.value.trim()); };

    // Sidebar toggle
    var st=$('#sidebar-toggle'), sb2=$('#sidebar');
    if(st&&sb2) st.onclick=function(){ sb2.classList.toggle('open'); };
  }

  document.addEventListener('DOMContentLoaded', async function(){
    initDarkMode();
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
      if(u.data && u.data.user){
        currentUser=u.data.user;
        var storedDept = localStorage.getItem('meeting_dept');
        if (storedDept) { currentDept = storedDept; }
        updateAuthUI();
        await refreshList();
        showView('empty');
        if (!currentDept) { showDeptModal(); }
      }
      else showView('login');
    } else {
      showView('login');
    }

    // Auth listener
    sb.auth.onAuthStateChange(async function(ev,session){
      if(ev==='SIGNED_IN'&&session){
        var u=await sb.auth.getUser();
        if(u.data&&u.data.user){
          currentUser=u.data.user;
          var storedDept = localStorage.getItem('meeting_dept');
          if (storedDept) { currentDept = storedDept; }
          updateAuthUI();
          await refreshList();
          showView('empty');
          if (!currentDept) { showDeptModal(); }
        }
      } else if(ev==='SIGNED_OUT'){
        currentUser=null; currentDept=null; updateAuthUI(); showView('login');
      }
    });
  });
})();
