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
    var ap=$('#add-point-btn'); if(ap) ap.onclick=function(){ var l=$('#points-list'); if(!l) return; l.insertAdjacentHTML('beforeend',rowHtml('point-input','Discussion point...','',l.querySelectorAll('.list-row').length)); wireRemove(); wireInputs(); l.querySelector('.list-row:last-child .point-input').focus(); };
    var ad=$('#add-decision-btn'); if(ad) ad.onclick=function(){ var l=$('#decisions-list'); if(!l) return; l.insertAdjacentHTML('beforeend',rowHtml('decision-input','Decision...','',l.querySelectorAll('.list-row').length)); wireRemove(); wireInputs(); l.querySelector('.list-row:last-child .decision-input').focus(); };
    var aa=$('#add-action-btn'); if(aa) aa.onclick=function(){ var l=$('#action-items-list'); if(!l) return; l.insertAdjacentHTML('beforeend',actionHtml({},l.querySelectorAll('.action-item-row').length)); wireRemove(); wireInputs(); l.querySelector('.action-item-row:last-child .action-what').focus(); };
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
    var today=new Date().toISOString().slice(0,10);
    var threeDays=new Date(Date.now()+3*864e5).toISOString().slice(0,10);
    var sevenDays=new Date(Date.now()+7*864e5).toISOString().slice(0,10);

    var myMeetings=allMeetings.filter(function(m){
      var a=Array.isArray(m.attendees)?m.attendees:[];
      return a.some(function(x){ var l=x.toLowerCase(); return l===ue.toLowerCase()||l===un.toLowerCase()||(un&&l.includes(un.split(' ')[0].toLowerCase())); })||(m.user_id&&currentUser&&m.user_id===currentUser.id);
    });

    var myActions=[], allPoints=[], allDecisions=[];
    allMeetings.forEach(function(m){
      (m.action_items||[]).forEach(function(a){ if(!a.who) return; var w=a.who.toLowerCase(); if(w===ue.toLowerCase()||w===un.toLowerCase()||(un&&w.includes(un.split(' ')[0].toLowerCase()))) myActions.push({meeting:m,action:a}); });
      (m.points_discussed||[]).forEach(function(p){ if(p) allPoints.push({meeting:m,text:p}); });
      (m.decisions||[]).forEach(function(d){ if(d) allDecisions.push({meeting:m,text:d}); });
    });
    myActions.sort(function(a,b){ return (a.action.deadline||'9999').localeCompare(b.action.deadline||'9999'); });

    var overdue=myActions.filter(function(e){ return e.action.deadline&&e.action.deadline<today; });
    var upcoming=myActions.filter(function(e){ return e.action.deadline&&e.action.deadline>=today&&e.action.deadline<=sevenDays; });
    var totalPoints=0, totalDecisions=0;
    myMeetings.forEach(function(m){ totalPoints+=(m.points_discussed||[]).length; totalDecisions+=(m.decisions||[]).length; });

    var h='';

    // Header
    h+='<div class="dash-header">';
    h+='<div class="dash-header-text"><h2>My Dashboard</h2><p>Welcome back, '+esc(un||ue)+'</p></div>';
    h+='</div>';

    // Stats grid
    h+='<div class="dash-stats-grid">';
    h+='<div class="dash-stat-card"><div class="dash-stat-icon dash-stat-icon--pri"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div><div class="dash-stat-info"><div class="dash-stat-num">'+myMeetings.length+'</div><div class="dash-stat-label">Meetings</div></div></div>';
    h+='<div class="dash-stat-card"><div class="dash-stat-icon dash-stat-icon--amber"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg></div><div class="dash-stat-info"><div class="dash-stat-num">'+myActions.length+'</div><div class="dash-stat-label">Action Items</div></div></div>';
    h+='<div class="dash-stat-card'+(overdue.length?' dash-stat-card--alert':'')+'"><div class="dash-stat-icon dash-stat-icon--red"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div><div class="dash-stat-info"><div class="dash-stat-num">'+overdue.length+'</div><div class="dash-stat-label">Overdue</div></div></div>';
    h+='<div class="dash-stat-card"><div class="dash-stat-icon dash-stat-icon--green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></div><div class="dash-stat-info"><div class="dash-stat-num">'+totalDecisions+'</div><div class="dash-stat-label">Decisions</div></div></div>';
    h+='</div>';

    // Overdue + Upcoming (urgent section)
    if(overdue.length){
      h+='<div class="dash-section dash-section--urgent"><h3><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>Overdue Items ('+overdue.length+')</h3>';
      overdue.forEach(function(e){
        var a=e.action, m=e.meeting;
        h+='<div class="dash-card dash-card--overdue"><div class="action-item-card"><div class="action-details"><div class="action-task-text">'+esc(a.what)+'</div><div class="action-from-meeting">From: '+esc(m.title)+'</div></div><span class="deadline-badge overdue">Overdue: '+esc(a.deadline)+'</span></div></div>';
      });
      h+='</div>';
    }

    // Upcoming deadlines
    if(upcoming.length){
      h+='<div class="dash-section"><h3><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>Due This Week ('+upcoming.length+')</h3>';
      upcoming.forEach(function(e){
        var a=e.action, m=e.meeting;
        var bc=a.deadline<=threeDays?'upcoming':'future';
        h+='<div class="dash-card"><div class="action-item-card"><div class="action-details"><div class="action-task-text">'+esc(a.what)+'</div><div class="action-from-meeting">From: '+esc(m.title)+'</div></div><span class="deadline-badge '+bc+'">Due: '+esc(a.deadline)+'</span></div></div>';
      });
      h+='</div>';
    }

    // All Action Items
    h+='<div class="dash-section"><h3><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>All My Action Items ('+myActions.length+')</h3>';
    if(!myActions.length) h+='<p class="empty-dash-msg">No action items assigned to you.</p>';
    else myActions.forEach(function(e){
      var a=e.action, m=e.meeting, bc='future', bt=a.deadline||'No deadline';
      if(a.deadline){ if(a.deadline<today){bc='overdue';bt='Overdue: '+a.deadline;} else if(a.deadline<=threeDays){bc='upcoming';bt='Due: '+a.deadline;} else bt='Due: '+a.deadline; }
      h+='<div class="dash-card" data-meeting-id="'+m.id+'"><div class="action-item-card"><div class="action-details"><div class="action-task-text">'+esc(a.what)+'</div><div class="action-from-meeting">From: '+esc(m.title)+' &middot; '+esc(m.meeting_id)+'</div></div><span class="deadline-badge '+bc+'">'+esc(bt)+'</span></div></div>';
    });
    h+='</div>';

    // Key Decisions to Remember
    if(allDecisions.length){
      var recentDecs=allDecisions.slice(0,8);
      h+='<div class="dash-section"><h3><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>Key Decisions to Remember ('+allDecisions.length+')</h3>';
      h+='<div class="dash-notes-grid">';
      recentDecs.forEach(function(d){
        h+='<div class="dash-note-card"><div class="dash-note-text">'+esc(d.text)+'</div><div class="dash-note-from">'+esc(d.meeting.title)+' &middot; '+esc(d.meeting.date)+'</div></div>';
      });
      h+='</div></div>';
    }

    // Important Points
    if(allPoints.length){
      var recentPts=allPoints.slice(0,8);
      h+='<div class="dash-section"><h3><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>Important Notes ('+allPoints.length+')</h3>';
      h+='<div class="dash-notes-grid">';
      recentPts.forEach(function(p){
        h+='<div class="dash-note-card dash-note-card--point"><div class="dash-note-text">'+esc(p.text)+'</div><div class="dash-note-from">'+esc(p.meeting.title)+' &middot; '+esc(p.meeting.date)+'</div></div>';
      });
      h+='</div></div>';
    }

    // My Meetings
    h+='<div class="dash-section"><h3><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>My Meetings ('+myMeetings.length+')</h3>';
    if(!myMeetings.length) h+='<p class="empty-dash-msg">No meetings found.</p>';
    else {
      h+='<div class="dash-meetings-grid">';
      myMeetings.forEach(function(m){
        var pts=(m.points_discussed||[]).length, decs=(m.decisions||[]).length, acts=(m.action_items||[]).length;
        h+='<div class="dash-meeting-card" data-meeting-id="'+m.id+'">';
        h+='<div class="dash-meeting-title">'+esc(m.title)+'</div>';
        h+='<div class="dash-meeting-id">'+esc(m.meeting_id)+'</div>';
        h+='<div class="dash-meeting-date">'+esc(m.date)+'</div>';
        h+='<div class="dash-meeting-stats">';
        h+='<span class="dash-meeting-stat">'+pts+' points</span>';
        h+='<span class="dash-meeting-stat">'+decs+' decisions</span>';
        h+='<span class="dash-meeting-stat">'+acts+' actions</span>';
        h+='</div>';
        var att=Array.isArray(m.attendees)?m.attendees:[];
        if(att.length){
          h+='<div class="dash-meeting-attendees">';
          att.slice(0,4).forEach(function(a){ h+='<span class="dash-attendee-chip">'+esc(a)+'</span>'; });
          if(att.length>4) h+='<span class="dash-attendee-chip dash-attendee-more">+'+String(att.length-4)+'</span>';
          h+='</div>';
        }
        h+='</div>';
      });
      h+='</div>';
    }
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
