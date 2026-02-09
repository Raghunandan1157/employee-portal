(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  var supabaseClient = null;
  var currentMeeting = null;
  var currentUser = null;
  var allMeetings = [];
  var TABLE = 'meeting_minute';

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function generateMeetingId() {
    var now = new Date();
    var yyyy = now.getFullYear();
    var mm = String(now.getMonth() + 1).padStart(2, '0');
    var dd = String(now.getDate()).padStart(2, '0');
    var rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    return 'MTG-' + yyyy + mm + dd + '-' + rand;
  }

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return document.querySelectorAll(sel); }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function escapeAttr(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  // ---------------------------------------------------------------------------
  // Toast notifications
  // ---------------------------------------------------------------------------

  function showToast(message, type) {
    type = type || 'info';
    var container = $('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    var toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    if (type === 'success') toast.style.background = '#16a34a';
    else if (type === 'error') toast.style.background = '#dc2626';
    else toast.style.background = '#2563eb';
    container.appendChild(toast);
    requestAnimationFrame(function () { toast.classList.add('show'); });
    setTimeout(function () {
      toast.classList.remove('show');
      setTimeout(function () { toast.remove(); }, 300);
    }, 3000);
  }

  // ---------------------------------------------------------------------------
  // View switching
  // ---------------------------------------------------------------------------

  function showView(name) {
    var empty = $('#empty-state');
    var meeting = $('#current-meeting');
    var dashboard = $('#dashboard-view');
    if (empty) empty.style.display = name === 'empty' ? 'flex' : 'none';
    if (meeting) meeting.style.display = name === 'meeting' ? 'block' : 'none';
    if (dashboard) dashboard.style.display = name === 'dashboard' ? 'block' : 'none';
  }

  // ---------------------------------------------------------------------------
  // Supabase connection
  // ---------------------------------------------------------------------------

  function initSupabase(url, key) {
    if (!url || !key) {
      showToast('Provide both Supabase URL and anon key.', 'error');
      return false;
    }
    try {
      supabaseClient = window.supabase.createClient(url, key);
      var status = $('#connection-status');
      if (status) {
        status.textContent = 'Connected';
        status.classList.add('connected');
      }
      $('#auth-section').style.display = 'flex';
      showToast('Connected to Supabase!', 'success');
      checkExistingSession();
      return true;
    } catch (err) {
      showToast('Connection failed: ' + err.message, 'error');
      return false;
    }
  }

  function ensureConnected() {
    if (!supabaseClient) {
      showToast('Connect to Supabase first.', 'error');
      return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Google Auth via Supabase
  // ---------------------------------------------------------------------------

  async function signInWithGoogle() {
    if (!ensureConnected()) return;
    var redirectUrl = window.location.origin + window.location.pathname;
    var result = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectUrl }
    });
    if (result.error) {
      showToast('Login failed: ' + result.error.message, 'error');
    }
  }

  async function signOut() {
    if (!supabaseClient) return;
    await supabaseClient.auth.signOut();
    currentUser = null;
    updateAuthUI();
    showView('empty');
    showToast('Signed out.', 'success');
  }

  async function checkExistingSession() {
    if (!supabaseClient) return;
    var result = await supabaseClient.auth.getSession();
    if (result.data && result.data.session) {
      var userRes = await supabaseClient.auth.getUser();
      if (userRes.data && userRes.data.user) {
        currentUser = userRes.data.user;
        updateAuthUI();
        await refreshMeetingsList();
      }
    }
    // Listen for auth changes (handles the redirect back from Google)
    supabaseClient.auth.onAuthStateChange(async function (event, session) {
      if (event === 'SIGNED_IN' && session) {
        var userRes = await supabaseClient.auth.getUser();
        if (userRes.data && userRes.data.user) {
          currentUser = userRes.data.user;
          updateAuthUI();
          await refreshMeetingsList();
        }
      } else if (event === 'SIGNED_OUT') {
        currentUser = null;
        updateAuthUI();
      }
    });
  }

  function updateAuthUI() {
    var loginBtn = $('#google-login-btn');
    var profileEl = $('#user-profile');
    if (!currentUser) {
      if (loginBtn) loginBtn.style.display = 'inline-flex';
      if (profileEl) profileEl.style.display = 'none';
      return;
    }
    if (loginBtn) loginBtn.style.display = 'none';
    if (profileEl) profileEl.style.display = 'flex';
    var meta = currentUser.user_metadata || {};
    var avatar = $('#user-avatar');
    var name = $('#user-name');
    if (avatar) avatar.src = meta.avatar_url || meta.picture || '';
    if (name) name.textContent = meta.full_name || meta.name || currentUser.email || '';
  }

  function getUserDisplayName() {
    if (!currentUser) return '';
    var meta = currentUser.user_metadata || {};
    return meta.full_name || meta.name || currentUser.email || '';
  }

  function getUserEmail() {
    if (!currentUser) return '';
    return currentUser.email || '';
  }

  // ---------------------------------------------------------------------------
  // CRUD operations
  // ---------------------------------------------------------------------------

  async function createMeeting(title, date, attendees) {
    if (!ensureConnected()) return null;
    var record = {
      meeting_id: generateMeetingId(),
      title: title,
      date: date,
      attendees: attendees,
      points_discussed: [],
      decisions: [],
      action_items: [],
      user_id: currentUser ? currentUser.id : null
    };
    var res = await supabaseClient.from(TABLE).insert([record]).select().single();
    if (res.error) {
      showToast('Error creating meeting: ' + res.error.message, 'error');
      return null;
    }
    showToast('Meeting created!', 'success');
    return res.data;
  }

  async function loadMeetings() {
    if (!ensureConnected()) return [];
    var res = await supabaseClient.from(TABLE).select('*').order('date', { ascending: false });
    if (res.error) {
      showToast('Error loading meetings: ' + res.error.message, 'error');
      return [];
    }
    return res.data || [];
  }

  async function loadMeeting(id) {
    if (!ensureConnected()) return null;
    var res = await supabaseClient.from(TABLE).select('*').eq('id', id).single();
    if (res.error) {
      showToast('Error: ' + res.error.message, 'error');
      return null;
    }
    return res.data;
  }

  async function updateMeeting(id, fields) {
    if (!ensureConnected()) return null;
    fields.updated_at = new Date().toISOString();
    var res = await supabaseClient.from(TABLE).update(fields).eq('id', id).select().single();
    if (res.error) {
      showToast('Save error: ' + res.error.message, 'error');
      return null;
    }
    return res.data;
  }

  async function deleteMeeting(id) {
    if (!ensureConnected()) return false;
    var res = await supabaseClient.from(TABLE).delete().eq('id', id);
    if (res.error) {
      showToast('Delete error: ' + res.error.message, 'error');
      return false;
    }
    showToast('Meeting deleted.', 'success');
    return true;
  }

  // ---------------------------------------------------------------------------
  // Auto-save
  // ---------------------------------------------------------------------------

  async function collectAndSave() {
    if (!currentMeeting || !supabaseClient) return;

    var title = $('#edit-meeting-title');
    var date = $('#edit-meeting-date');
    var attendees = $('#edit-meeting-attendees');

    var points = [];
    $$('#points-list .point-input').forEach(function (el) {
      if (el.value.trim()) points.push(el.value.trim());
    });

    var decisions = [];
    $$('#decisions-list .decision-input').forEach(function (el) {
      if (el.value.trim()) decisions.push(el.value.trim());
    });

    var actionItems = [];
    $$('#action-items-list .action-item-row').forEach(function (row) {
      var who = row.querySelector('.action-who');
      var what = row.querySelector('.action-what');
      var deadline = row.querySelector('.action-deadline');
      if (who && what && (who.value.trim() || what.value.trim())) {
        actionItems.push({
          who: who.value.trim(),
          what: what.value.trim(),
          deadline: deadline ? deadline.value : ''
        });
      }
    });

    var updateFields = {
      points_discussed: points,
      decisions: decisions,
      action_items: actionItems
    };

    if (title && title.value.trim()) updateFields.title = title.value.trim();
    if (date && date.value) updateFields.date = date.value;
    if (attendees) {
      updateFields.attendees = attendees.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    }

    var updated = await updateMeeting(currentMeeting.id, updateFields);
    if (updated) {
      currentMeeting = updated;
      showToast('Saved.', 'success');
      await refreshMeetingsList();
    }
  }

  var autoSaveTimer = null;
  function scheduleAutoSave() {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(collectAndSave, 1500);
  }

  // ---------------------------------------------------------------------------
  // Render meetings list (sidebar)
  // ---------------------------------------------------------------------------

  function renderMeetingsList(meetings) {
    var list = $('#meetings-list');
    if (!list) return;
    list.innerHTML = '';
    if (!meetings.length) {
      list.innerHTML = '<li class="meetings-list__empty">No meetings yet. Create one!</li>';
      return;
    }
    meetings.forEach(function (m) {
      var li = document.createElement('li');
      li.className = 'meeting-item' + (currentMeeting && currentMeeting.id === m.id ? ' active' : '');
      li.dataset.id = m.id;
      li.innerHTML =
        '<div class="meeting-item-title">' + escapeHtml(m.title) + '</div>' +
        '<div class="meeting-item-meta">' + escapeHtml(m.meeting_id) + ' &middot; ' + escapeHtml(m.date) + '</div>';
      li.addEventListener('click', function () { openMeeting(m.id); });
      list.appendChild(li);
    });
  }

  async function refreshMeetingsList() {
    allMeetings = await loadMeetings();
    renderMeetingsList(allMeetings);
  }

  // ---------------------------------------------------------------------------
  // Search meetings
  // ---------------------------------------------------------------------------

  function filterMeetings(query) {
    if (!query) { renderMeetingsList(allMeetings); return; }
    var q = query.toLowerCase();
    var filtered = allMeetings.filter(function (m) {
      return (m.title && m.title.toLowerCase().includes(q)) ||
        (m.meeting_id && m.meeting_id.toLowerCase().includes(q)) ||
        (m.date && m.date.includes(q));
    });
    renderMeetingsList(filtered);
  }

  // ---------------------------------------------------------------------------
  // Render current meeting
  // ---------------------------------------------------------------------------

  function renderCurrentMeeting(meeting) {
    var el = $('#current-meeting');
    if (!el || !meeting) return;

    var attendeesStr = Array.isArray(meeting.attendees) ? meeting.attendees.join(', ') : meeting.attendees || '';

    var h = '';
    // Header
    h += '<div class="meeting-view-header">';
    h += '  <div>';
    h += '    <input type="text" id="edit-meeting-title" class="meeting-title-edit" value="' + escapeAttr(meeting.title) + '" style="font-size:1.5rem;font-weight:700;border:none;background:transparent;width:100%;padding:0;font-family:inherit;color:var(--color-text);letter-spacing:-0.025em;">';
    h += '    <span class="meeting-id-badge">' + escapeHtml(meeting.meeting_id) + '</span>';
    h += '  </div>';
    h += '  <div class="header-actions">';
    h += '    <button id="download-pdf-btn" class="btn btn--outline" title="Download PDF">';
    h += '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    h += '      PDF';
    h += '    </button>';
    h += '    <button id="save-meeting-btn" class="btn btn--primary">Save</button>';
    h += '    <button id="delete-meeting-btn" class="btn btn--danger">Delete</button>';
    h += '  </div>';
    h += '</div>';

    // Meta
    h += '<div class="meeting-meta-info">';
    h += '  <div><strong>Date:</strong> <input type="date" id="edit-meeting-date" value="' + escapeAttr(meeting.date || '') + '" style="font-family:inherit;font-size:0.875rem;border:1px solid var(--color-border);border-radius:4px;padding:4px 8px;"></div>';
    h += '  <div><strong>Attendees:</strong> <input type="text" id="edit-meeting-attendees" value="' + escapeAttr(attendeesStr) + '" placeholder="Alice, Bob" style="font-family:inherit;font-size:0.875rem;border:1px solid var(--color-border);border-radius:4px;padding:4px 8px;min-width:200px;"></div>';
    h += '</div>';

    // Points Discussed
    h += '<section class="section">';
    h += '  <h3><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg> Points Discussed</h3>';
    h += '  <div id="points-list">';
    (meeting.points_discussed || []).forEach(function (p, i) { h += pointRowHtml(p, i); });
    h += '  </div>';
    h += '  <button type="button" class="btn-add" id="add-point-btn">+ Add Point</button>';
    h += '</section>';

    // Decisions
    h += '<section class="section">';
    h += '  <h3><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Decisions</h3>';
    h += '  <div id="decisions-list">';
    (meeting.decisions || []).forEach(function (d, i) { h += decisionRowHtml(d, i); });
    h += '  </div>';
    h += '  <button type="button" class="btn-add" id="add-decision-btn">+ Add Decision</button>';
    h += '</section>';

    // Action Items
    h += '<section class="section">';
    h += '  <h3><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg> Action Items</h3>';
    h += '  <div id="action-items-list">';
    (meeting.action_items || []).forEach(function (a, i) { h += actionRowHtml(a, i); });
    h += '  </div>';
    h += '  <button type="button" class="btn-add" id="add-action-btn">+ Add Action Item</button>';
    h += '</section>';

    el.innerHTML = h;
    showView('meeting');
    wireCurrentMeetingEvents();
  }

  function pointRowHtml(value, idx) {
    return '<div class="list-row" data-index="' + idx + '">' +
      '<input type="text" class="point-input" placeholder="Discussion point..." value="' + escapeAttr(value) + '">' +
      '<button type="button" class="btn-icon remove-btn" title="Remove">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</button></div>';
  }

  function decisionRowHtml(value, idx) {
    return '<div class="list-row" data-index="' + idx + '">' +
      '<input type="text" class="decision-input" placeholder="Decision..." value="' + escapeAttr(value) + '">' +
      '<button type="button" class="btn-icon remove-btn" title="Remove">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</button></div>';
  }

  function actionRowHtml(item, idx) {
    item = item || {};
    return '<div class="list-row action-item-row" data-index="' + idx + '">' +
      '<input type="text" class="action-what" placeholder="Action item..." value="' + escapeAttr(item.what || '') + '">' +
      '<input type="text" class="action-who" placeholder="Assigned to" value="' + escapeAttr(item.who || '') + '">' +
      '<input type="date" class="action-deadline" value="' + escapeAttr(item.deadline || '') + '">' +
      '<button type="button" class="btn-icon remove-btn" title="Remove">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</button></div>';
  }

  // ---------------------------------------------------------------------------
  // Wire dynamic events on current meeting
  // ---------------------------------------------------------------------------

  function wireCurrentMeetingEvents() {
    var saveBtn = $('#save-meeting-btn');
    if (saveBtn) saveBtn.addEventListener('click', function (e) { e.preventDefault(); collectAndSave(); });

    var pdfBtn = $('#download-pdf-btn');
    if (pdfBtn) pdfBtn.addEventListener('click', downloadPdf);

    var delBtn = $('#delete-meeting-btn');
    if (delBtn) delBtn.addEventListener('click', async function () {
      if (!currentMeeting) return;
      if (!confirm('Delete this meeting permanently?')) return;
      var ok = await deleteMeeting(currentMeeting.id);
      if (ok) {
        currentMeeting = null;
        showView('empty');
        await refreshMeetingsList();
      }
    });

    var addPointBtn = $('#add-point-btn');
    if (addPointBtn) addPointBtn.addEventListener('click', function () {
      var list = $('#points-list');
      if (!list) return;
      var idx = list.querySelectorAll('.list-row').length;
      list.insertAdjacentHTML('beforeend', pointRowHtml('', idx));
      wireRemoveButtons();
      wireAutoSaveInputs();
      list.querySelector('.list-row:last-child .point-input').focus();
    });

    var addDecisionBtn = $('#add-decision-btn');
    if (addDecisionBtn) addDecisionBtn.addEventListener('click', function () {
      var list = $('#decisions-list');
      if (!list) return;
      var idx = list.querySelectorAll('.list-row').length;
      list.insertAdjacentHTML('beforeend', decisionRowHtml('', idx));
      wireRemoveButtons();
      wireAutoSaveInputs();
      list.querySelector('.list-row:last-child .decision-input').focus();
    });

    var addActionBtn = $('#add-action-btn');
    if (addActionBtn) addActionBtn.addEventListener('click', function () {
      var list = $('#action-items-list');
      if (!list) return;
      var idx = list.querySelectorAll('.action-item-row').length;
      list.insertAdjacentHTML('beforeend', actionRowHtml({}, idx));
      wireRemoveButtons();
      wireAutoSaveInputs();
      list.querySelector('.action-item-row:last-child .action-what').focus();
    });

    wireRemoveButtons();
    wireAutoSaveInputs();
  }

  function wireRemoveButtons() {
    $$('#current-meeting .remove-btn').forEach(function (btn) {
      btn.onclick = function () {
        btn.closest('.list-row').remove();
        scheduleAutoSave();
      };
    });
  }

  function wireAutoSaveInputs() {
    $$('#current-meeting input').forEach(function (input) {
      input.oninput = scheduleAutoSave;
    });
  }

  // ---------------------------------------------------------------------------
  // Open meeting
  // ---------------------------------------------------------------------------

  async function openMeeting(id) {
    var meeting = await loadMeeting(id);
    if (!meeting) return;
    currentMeeting = meeting;
    renderCurrentMeeting(meeting);
    // highlight in sidebar
    $$('.meeting-item').forEach(function (el) {
      el.classList.toggle('active', el.dataset.id === String(id));
    });
  }

  // ---------------------------------------------------------------------------
  // PDF generation
  // ---------------------------------------------------------------------------

  function downloadPdf() {
    if (!currentMeeting) { showToast('No meeting selected.', 'error'); return; }
    var jsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    if (!jsPDF) { showToast('jsPDF not loaded.', 'error'); return; }

    var doc = new jsPDF();
    var y = 20;
    var margin = 20;
    var pageW = doc.internal.pageSize.getWidth();
    var maxW = pageW - margin * 2;

    function check(needed) { if (y + needed > 270) { doc.addPage(); y = 20; } }

    doc.setFontSize(20);
    doc.setFont(undefined, 'bold');
    doc.text(currentMeeting.title || 'Untitled', margin, y);
    y += 10;

    doc.setFontSize(11);
    doc.setFont(undefined, 'normal');
    doc.text('ID: ' + currentMeeting.meeting_id, margin, y); y += 6;
    doc.text('Date: ' + (currentMeeting.date || 'N/A'), margin, y); y += 6;
    var att = Array.isArray(currentMeeting.attendees) ? currentMeeting.attendees.join(', ') : currentMeeting.attendees || '';
    doc.text('Attendees: ' + att, margin, y, { maxWidth: maxW }); y += 10;

    doc.setDrawColor(200);
    doc.line(margin, y, pageW - margin, y); y += 8;

    // Points
    doc.setFontSize(14); doc.setFont(undefined, 'bold');
    doc.text('Points Discussed', margin, y); y += 8;
    doc.setFontSize(11); doc.setFont(undefined, 'normal');
    (currentMeeting.points_discussed || []).forEach(function (p, i) {
      check(8);
      var lines = doc.splitTextToSize((i + 1) + '. ' + p, maxW);
      doc.text(lines, margin, y); y += lines.length * 6;
    });
    y += 6;

    // Decisions
    check(16);
    doc.setFontSize(14); doc.setFont(undefined, 'bold');
    doc.text('Decisions', margin, y); y += 8;
    doc.setFontSize(11); doc.setFont(undefined, 'normal');
    (currentMeeting.decisions || []).forEach(function (d, i) {
      check(8);
      var lines = doc.splitTextToSize((i + 1) + '. ' + d, maxW);
      doc.text(lines, margin, y); y += lines.length * 6;
    });
    y += 6;

    // Action Items
    check(16);
    doc.setFontSize(14); doc.setFont(undefined, 'bold');
    doc.text('Action Items', margin, y); y += 8;
    doc.setFontSize(11); doc.setFont(undefined, 'normal');
    (currentMeeting.action_items || []).forEach(function (a, i) {
      check(14);
      var line = (i + 1) + '. [' + (a.who || '?') + '] ' + (a.what || '') + (a.deadline ? '  (Due: ' + a.deadline + ')' : '');
      var lines = doc.splitTextToSize(line, maxW);
      doc.text(lines, margin, y); y += lines.length * 6;
    });

    doc.save((currentMeeting.meeting_id || 'meeting') + '.pdf');
    showToast('PDF downloaded.', 'success');
  }

  // ---------------------------------------------------------------------------
  // Dashboard: My meetings & my action items
  // ---------------------------------------------------------------------------

  function renderDashboard() {
    var el = $('#dashboard-view');
    if (!el) return;

    var userName = getUserDisplayName();
    var userEmail = getUserEmail();

    // Find meetings where user is in attendees
    var myMeetings = allMeetings.filter(function (m) {
      var atts = Array.isArray(m.attendees) ? m.attendees : [];
      return atts.some(function (a) {
        var lower = a.toLowerCase();
        return lower === userEmail.toLowerCase() ||
          lower === userName.toLowerCase() ||
          (userName && lower.includes(userName.split(' ')[0].toLowerCase()));
      }) || (m.user_id && currentUser && m.user_id === currentUser.id);
    });

    // Collect action items assigned to the user across all meetings
    var myActions = [];
    allMeetings.forEach(function (m) {
      (m.action_items || []).forEach(function (a) {
        if (!a.who) return;
        var whoLower = a.who.toLowerCase();
        if (whoLower === userEmail.toLowerCase() ||
          whoLower === userName.toLowerCase() ||
          (userName && whoLower.includes(userName.split(' ')[0].toLowerCase()))) {
          myActions.push({ meeting: m, action: a });
        }
      });
    });

    // Sort actions by deadline
    myActions.sort(function (a, b) {
      var da = a.action.deadline || '9999';
      var db = b.action.deadline || '9999';
      return da.localeCompare(db);
    });

    var h = '';
    h += '<div class="dashboard-header">';
    h += '  <h2>My Dashboard</h2>';
    h += '  <p>Welcome back, ' + escapeHtml(userName || userEmail) + '</p>';
    h += '</div>';

    // My Action Items
    h += '<div class="dashboard-section">';
    h += '  <h3><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg> My Action Items (' + myActions.length + ')</h3>';
    if (myActions.length === 0) {
      h += '<p class="empty-dashboard-msg">No action items assigned to you.</p>';
    } else {
      myActions.forEach(function (entry) {
        var a = entry.action;
        var m = entry.meeting;
        var badgeClass = 'future';
        var badgeText = a.deadline || 'No deadline';
        if (a.deadline) {
          var today = new Date().toISOString().slice(0, 10);
          if (a.deadline < today) { badgeClass = 'overdue'; badgeText = 'Overdue: ' + a.deadline; }
          else if (a.deadline <= new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)) { badgeClass = 'upcoming'; badgeText = 'Due: ' + a.deadline; }
          else { badgeText = 'Due: ' + a.deadline; }
        }
        h += '<div class="dashboard-card">';
        h += '  <div class="action-item-card">';
        h += '    <div class="action-details">';
        h += '      <div class="action-task-text">' + escapeHtml(a.what) + '</div>';
        h += '      <div class="action-from-meeting">From: ' + escapeHtml(m.title) + ' (' + escapeHtml(m.meeting_id) + ')</div>';
        h += '    </div>';
        h += '    <span class="deadline-badge ' + badgeClass + '">' + escapeHtml(badgeText) + '</span>';
        h += '  </div>';
        h += '</div>';
      });
    }
    h += '</div>';

    // My Meetings
    h += '<div class="dashboard-section">';
    h += '  <h3><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> My Meetings (' + myMeetings.length + ')</h3>';
    if (myMeetings.length === 0) {
      h += '<p class="empty-dashboard-msg">No meetings found for your account.</p>';
    } else {
      myMeetings.forEach(function (m) {
        h += '<div class="dashboard-card" style="cursor:pointer;" data-meeting-id="' + m.id + '">';
        h += '  <div class="dashboard-card-title">' + escapeHtml(m.title) + '</div>';
        h += '  <div class="dashboard-card-meta">' + escapeHtml(m.meeting_id) + ' &middot; ' + escapeHtml(m.date) + ' &middot; ' + (Array.isArray(m.attendees) ? m.attendees.length : 0) + ' attendees</div>';
        h += '</div>';
      });
    }
    h += '</div>';

    el.innerHTML = h;
    showView('dashboard');

    // Wire meeting card clicks
    el.querySelectorAll('[data-meeting-id]').forEach(function (card) {
      card.addEventListener('click', function () {
        openMeeting(parseInt(card.dataset.meetingId));
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Modal
  // ---------------------------------------------------------------------------

  function openModal() {
    var overlay = $('#meeting-modal-overlay');
    if (overlay) overlay.style.display = 'flex';
    var dateInput = $('#meeting-date');
    if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);
    var titleInput = $('#meeting-title');
    if (titleInput) { titleInput.value = ''; titleInput.focus(); }
    var attInput = $('#meeting-attendees');
    if (attInput) attInput.value = currentUser ? getUserDisplayName() : '';
  }

  function closeModal() {
    var overlay = $('#meeting-modal-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  // ---------------------------------------------------------------------------
  // Static event wiring
  // ---------------------------------------------------------------------------

  function wireStaticEvents() {
    // Connect to Supabase
    var connectBtn = $('#connect-btn');
    if (connectBtn) {
      connectBtn.addEventListener('click', async function () {
        var url = ($('#supabase-url') || {}).value || '';
        var key = ($('#supabase-key') || {}).value || '';
        var ok = initSupabase(url.trim(), key.trim());
        if (ok) {
          connectBtn.textContent = 'Connected';
          connectBtn.disabled = true;
          // Persist credentials in localStorage
          try {
            localStorage.setItem('sb_url', url.trim());
            localStorage.setItem('sb_key', key.trim());
          } catch (e) { /* ignore */ }
          await refreshMeetingsList();
        }
      });
    }

    // Google login
    var googleBtn = $('#google-login-btn');
    if (googleBtn) googleBtn.addEventListener('click', signInWithGoogle);

    // Logout
    var logoutBtn = $('#logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', signOut);

    // My Dashboard
    var dashBtn = $('#my-dashboard-btn');
    if (dashBtn) dashBtn.addEventListener('click', function () {
      currentMeeting = null;
      $$('.meeting-item').forEach(function (el) { el.classList.remove('active'); });
      renderDashboard();
    });

    // New Meeting button
    var newBtn = $('#new-meeting-btn');
    if (newBtn) newBtn.addEventListener('click', openModal);

    // Modal close / cancel
    var closeBtn = $('#modal-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    var cancelBtn = $('#modal-cancel-btn');
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    // Close modal on overlay click
    var overlay = $('#meeting-modal-overlay');
    if (overlay) overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeModal();
    });

    // Meeting form submit
    var form = $('#meeting-form');
    if (form) {
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        if (!ensureConnected()) return;
        var title = ($('#meeting-title') || {}).value || '';
        var date = ($('#meeting-date') || {}).value || '';
        var attsRaw = ($('#meeting-attendees') || {}).value || '';
        if (!title.trim()) { showToast('Enter a meeting title.', 'error'); return; }
        var attendees = attsRaw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        var meeting = await createMeeting(title.trim(), date, attendees);
        if (meeting) {
          currentMeeting = meeting;
          renderCurrentMeeting(meeting);
          await refreshMeetingsList();
          closeModal();
        }
      });
    }

    // Search
    var searchInput = $('#search-meetings');
    if (searchInput) {
      searchInput.addEventListener('input', function () { filterMeetings(searchInput.value.trim()); });
    }

    // Mobile sidebar toggle
    var sidebarToggle = $('#sidebar-toggle');
    var sidebar = $('#sidebar');
    if (sidebarToggle && sidebar) {
      sidebarToggle.addEventListener('click', function () {
        sidebar.classList.toggle('open');
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Auto-restore connection
  // ---------------------------------------------------------------------------

  function autoRestore() {
    try {
      var url = localStorage.getItem('sb_url');
      var key = localStorage.getItem('sb_key');
      if (url && key) {
        var urlInput = $('#supabase-url');
        var keyInput = $('#supabase-key');
        if (urlInput) urlInput.value = url;
        if (keyInput) keyInput.value = key;
        var ok = initSupabase(url, key);
        if (ok) {
          var connectBtn = $('#connect-btn');
          if (connectBtn) { connectBtn.textContent = 'Connected'; connectBtn.disabled = true; }
          refreshMeetingsList();
        }
      }
    } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // Initialise
  // ---------------------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    wireStaticEvents();
    showView('empty');
    autoRestore();
  });
})();
