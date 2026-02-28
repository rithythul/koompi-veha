// koompi-mepl dashboard — app.js
// Vanilla JS, no build tools

const API = '';  // same origin

// ── State ───────────────────────────────────────────────────────────────

let currentPage = 'boards';
let boards = [];
let groups = [];
let media = [];
let playlists = [];
let schedules = [];

// ── Utilities ───────────────────────────────────────────────────────────

async function api(path, options = {}) {
    const url = API + path;
    const defaults = {
        headers: { 'Content-Type': 'application/json' },
    };
    // Don't set Content-Type for FormData (multipart)
    if (options.body instanceof FormData) {
        delete defaults.headers;
    }
    const res = await fetch(url, { ...defaults, ...options });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `HTTP ${res.status}`);
    }
    if (res.status === 204) return null;
    const ct = res.headers.get('Content-Type') || '';
    if (ct.includes('application/json')) {
        return res.json();
    }
    return null;
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(dateStr) {
    if (!dateStr) return '--';
    const d = new Date(dateStr.replace(' ', 'T') + (dateStr.includes('Z') || dateStr.includes('+') ? '' : 'Z'));
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ── Safe DOM helpers ────────────────────────────────────────────────────
// All dynamic rendering uses these helpers to build DOM nodes safely.
// Data from the API is always escaped via escapeHtml() or set via textContent.

function setContent(elementId, htmlStr) {
    // Used for rendering templates where all interpolated values have
    // already been escaped with escapeHtml(). This is an internal admin
    // dashboard; all data originates from our own API.
    const el = document.getElementById(elementId);
    if (el) el.innerHTML = htmlStr;
}

// ── Toast notifications ─────────────────────────────────────────────────

function showToast(message, type) {
    type = type || 'info';
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(function() {
        toast.style.animation = 'toast-out 0.3s ease-in forwards';
        setTimeout(function() { toast.remove(); }, 300);
    }, 3000);
}

// ── Modal ───────────────────────────────────────────────────────────────

function showModal(title, contentHtml, onClose) {
    const container = document.getElementById('modal-container');

    // Build modal DOM
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'modal-overlay';

    const content = document.createElement('div');
    content.className = 'modal-content';

    const header = document.createElement('div');
    header.className = 'flex items-center justify-between mb-4';

    const titleEl = document.createElement('h3');
    titleEl.className = 'text-lg font-semibold text-white';
    titleEl.textContent = title;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'text-slate-400 hover:text-white transition-colors p-1';
    closeBtn.id = 'modal-close-btn';
    closeBtn.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>';

    header.appendChild(titleEl);
    header.appendChild(closeBtn);

    const body = document.createElement('div');
    body.id = 'modal-body';
    // contentHtml is built from our own templates with escaped values
    body.innerHTML = contentHtml;

    content.appendChild(header);
    content.appendChild(body);
    overlay.appendChild(content);

    container.innerHTML = '';
    container.appendChild(overlay);

    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', function(e) {
        if (e.target.id === 'modal-overlay') closeModal();
    });
    if (onClose) {
        container._onClose = onClose;
    }
}

function closeModal() {
    const container = document.getElementById('modal-container');
    if (container._onClose) {
        container._onClose();
        container._onClose = null;
    }
    container.innerHTML = '';
}

// ── Navigation ──────────────────────────────────────────────────────────

function navigateTo(page) {
    currentPage = page;

    // Update sidebar
    document.querySelectorAll('.nav-item').forEach(function(el) {
        el.classList.toggle('active', el.dataset.page === page);
    });

    // Update page title
    var titles = { boards: 'Boards', media: 'Media Library', playlists: 'Playlists', schedules: 'Schedules' };
    document.getElementById('page-title').textContent = titles[page] || page;

    // Show/hide pages
    document.querySelectorAll('.page-content').forEach(function(el) { el.classList.add('hidden'); });
    document.getElementById('page-' + page).classList.remove('hidden');

    // Update header actions
    updateHeaderActions(page);

    // Load data
    switch (page) {
        case 'boards': loadBoards(); break;
        case 'media': loadMedia(); break;
        case 'playlists': loadPlaylists(); break;
        case 'schedules': loadSchedules(); break;
    }
}

function updateHeaderActions(page) {
    var container = document.getElementById('header-actions');
    container.innerHTML = '';

    var btn = document.createElement('button');
    btn.className = 'px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors';

    switch (page) {
        case 'boards':
            btn.textContent = '+ New Board';
            btn.addEventListener('click', showCreateBoardModal);
            container.appendChild(btn);
            break;
        case 'media':
            btn.textContent = '+ Upload Media';
            btn.addEventListener('click', showUploadMediaModal);
            container.appendChild(btn);
            break;
        case 'playlists':
            btn.textContent = '+ New Playlist';
            btn.addEventListener('click', function() { showPlaylistModal(); });
            container.appendChild(btn);
            break;
        case 'schedules':
            btn.textContent = '+ New Schedule';
            btn.addEventListener('click', showScheduleModal);
            container.appendChild(btn);
            break;
    }
}

// ── Boards ──────────────────────────────────────────────────────────────

async function loadBoards() {
    var loading = document.getElementById('boards-loading');
    var content = document.getElementById('boards-content');
    var empty = document.getElementById('boards-empty');
    var tbody = document.getElementById('boards-table-body');

    loading.classList.remove('hidden');
    content.classList.add('hidden');

    try {
        var results = await Promise.all([
            api('/api/boards'),
            api('/api/groups'),
        ]);
        boards = results[0];
        groups = results[1];

        loading.classList.add('hidden');
        content.classList.remove('hidden');

        if (boards.length === 0) {
            empty.classList.remove('hidden');
            tbody.closest('table').classList.add('hidden');
            return;
        }

        empty.classList.add('hidden');
        tbody.closest('table').classList.remove('hidden');

        var groupMap = {};
        groups.forEach(function(g) { groupMap[g.id] = g.name; });

        tbody.innerHTML = '';
        boards.forEach(function(b) {
            var tr = document.createElement('tr');
            tr.className = 'border-b border-slate-800/50 cursor-pointer';
            tr.addEventListener('click', function() { showBoardDetail(b.id); });

            var tdName = document.createElement('td');
            tdName.className = 'py-3 pr-4 font-medium text-white';
            tdName.textContent = b.name;

            var tdStatus = document.createElement('td');
            tdStatus.className = 'py-3 pr-4';
            var badge = document.createElement('span');
            badge.className = 'badge ' + (b.status === 'online' ? 'badge-online' : 'badge-offline');
            badge.textContent = b.status;
            tdStatus.appendChild(badge);

            var tdGroup = document.createElement('td');
            tdGroup.className = 'py-3 pr-4 text-slate-400';
            tdGroup.textContent = b.group_id ? (groupMap[b.group_id] || b.group_id) : '--';

            var tdSeen = document.createElement('td');
            tdSeen.className = 'py-3 pr-4 text-slate-400';
            tdSeen.textContent = formatDate(b.last_seen);

            var tdActions = document.createElement('td');
            tdActions.className = 'py-3 text-right';
            tdActions.addEventListener('click', function(e) { e.stopPropagation(); });

            var actionsDiv = document.createElement('div');
            actionsDiv.className = 'flex items-center justify-end gap-1';

            var cmds = [
                { label: 'Play', cls: 'bg-green-600/20 text-green-400 hover:bg-green-600/30' },
                { label: 'Pause', cls: 'bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/30' },
                { label: 'Stop', cls: 'bg-red-600/20 text-red-400 hover:bg-red-600/30' },
                { label: 'Next', cls: 'bg-blue-600/20 text-blue-400 hover:bg-blue-600/30' },
            ];
            cmds.forEach(function(cmd) {
                var cbtn = document.createElement('button');
                cbtn.className = 'cmd-btn ' + cmd.cls;
                cbtn.textContent = cmd.label;
                cbtn.title = cmd.label;
                cbtn.addEventListener('click', function() { sendBoardCmd(b.id, cmd.label); });
                actionsDiv.appendChild(cbtn);
            });
            tdActions.appendChild(actionsDiv);

            tr.appendChild(tdName);
            tr.appendChild(tdStatus);
            tr.appendChild(tdGroup);
            tr.appendChild(tdSeen);
            tr.appendChild(tdActions);
            tbody.appendChild(tr);
        });
    } catch (err) {
        loading.classList.add('hidden');
        content.classList.remove('hidden');
        showToast('Failed to load boards: ' + err.message, 'error');
    }
}

async function sendBoardCmd(boardId, cmdType) {
    try {
        // PlayerCommand uses { type: "...", data: ... } tagged format
        var command = { type: cmdType };
        await api('/api/boards/' + boardId + '/command', {
            method: 'POST',
            body: JSON.stringify({ command: command }),
        });
        showToast('Sent ' + cmdType + ' to board', 'success');
    } catch (err) {
        showToast('Command failed: ' + err.message, 'error');
    }
}

function showBoardDetail(boardId) {
    var board = boards.find(function(b) { return b.id === boardId; });
    if (!board) return;

    var groupMap = {};
    groups.forEach(function(g) { groupMap[g.id] = g.name; });

    var html = '<div class="space-y-4">'
        + '<div class="grid grid-cols-2 gap-4 text-sm">'
        + '<div><p class="text-slate-500 text-xs uppercase tracking-wider mb-1">Board ID</p>'
        + '<p class="text-slate-200 font-mono text-xs break-all">' + escapeHtml(board.id) + '</p></div>'
        + '<div><p class="text-slate-500 text-xs uppercase tracking-wider mb-1">Name</p>'
        + '<p class="text-white">' + escapeHtml(board.name) + '</p></div>'
        + '<div><p class="text-slate-500 text-xs uppercase tracking-wider mb-1">Status</p>'
        + '<span class="badge ' + (board.status === 'online' ? 'badge-online' : 'badge-offline') + '">' + escapeHtml(board.status) + '</span></div>'
        + '<div><p class="text-slate-500 text-xs uppercase tracking-wider mb-1">Group</p>'
        + '<p class="text-slate-200">' + (board.group_id ? escapeHtml(groupMap[board.group_id] || board.group_id) : '--') + '</p></div>'
        + '<div><p class="text-slate-500 text-xs uppercase tracking-wider mb-1">Last Seen</p>'
        + '<p class="text-slate-200">' + escapeHtml(formatDate(board.last_seen)) + '</p></div>'
        + '<div><p class="text-slate-500 text-xs uppercase tracking-wider mb-1">Created</p>'
        + '<p class="text-slate-200">' + escapeHtml(formatDate(board.created_at)) + '</p></div>'
        + '</div>'
        + '<div class="border-t border-slate-700 pt-4">'
        + '<p class="text-sm font-medium text-white mb-3">Commands</p>'
        + '<div id="board-detail-cmds" class="flex flex-wrap gap-2"></div>'
        + '</div></div>';

    showModal('Board: ' + board.name, html);

    // Attach command buttons via DOM
    var cmdsDiv = document.getElementById('board-detail-cmds');
    var cmdList = [
        { label: 'Play', cls: 'bg-green-600 text-white hover:bg-green-700' },
        { label: 'Pause', cls: 'bg-yellow-600 text-white hover:bg-yellow-700' },
        { label: 'Resume', cls: 'bg-blue-600 text-white hover:bg-blue-700' },
        { label: 'Stop', cls: 'bg-red-600 text-white hover:bg-red-700' },
        { label: 'Next', cls: 'bg-slate-600 text-white hover:bg-slate-700' },
        { label: 'Previous', cls: 'bg-slate-600 text-white hover:bg-slate-700' },
        { label: 'GetStatus', cls: 'bg-slate-600 text-white hover:bg-slate-700' },
    ];
    cmdList.forEach(function(cmd) {
        var btn = document.createElement('button');
        btn.className = 'cmd-btn ' + cmd.cls + ' px-4 py-2 text-sm';
        btn.textContent = cmd.label;
        btn.addEventListener('click', function() {
            sendBoardCmd(board.id, cmd.label);
            closeModal();
        });
        cmdsDiv.appendChild(btn);
    });
}

function showCreateBoardModal() {
    var groupOptions = groups.map(function(g) {
        return '<option value="' + escapeHtml(g.id) + '">' + escapeHtml(g.name) + '</option>';
    }).join('');

    var html = '<form id="create-board-form" class="space-y-4">'
        + '<div><label class="block text-sm text-slate-400 mb-1">Board Name</label>'
        + '<input type="text" name="name" required placeholder="e.g. Lobby Display" '
        + 'class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"></div>'
        + '<div><label class="block text-sm text-slate-400 mb-1">Group (optional)</label>'
        + '<select name="group_id" class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">'
        + '<option value="">No group</option>' + groupOptions + '</select></div>'
        + '<div class="border-t border-slate-700 pt-4">'
        + '<label class="block text-sm text-slate-400 mb-1">Or create a new group</label>'
        + '<div class="flex gap-2">'
        + '<input type="text" id="new-group-name" placeholder="New group name" '
        + 'class="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">'
        + '<button type="button" id="create-group-btn" class="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg transition-colors">Create</button>'
        + '</div></div>'
        + '<div class="flex justify-end gap-3 pt-2">'
        + '<button type="button" id="cancel-board-btn" class="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>'
        + '<button type="submit" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">Create Board</button>'
        + '</div></form>';

    showModal('New Board', html);

    document.getElementById('cancel-board-btn').addEventListener('click', closeModal);
    document.getElementById('create-group-btn').addEventListener('click', createGroupInline);

    document.getElementById('create-board-form').addEventListener('submit', async function(e) {
        e.preventDefault();
        var fd = new FormData(e.target);
        var body = { name: fd.get('name') };
        var gid = fd.get('group_id');
        if (gid) body.group_id = gid;

        try {
            await api('/api/boards', { method: 'POST', body: JSON.stringify(body) });
            showToast('Board created', 'success');
            closeModal();
            loadBoards();
        } catch (err) {
            showToast('Failed to create board: ' + err.message, 'error');
        }
    });
}

async function createGroupInline() {
    var input = document.getElementById('new-group-name');
    var name = input.value.trim();
    if (!name) return;

    try {
        var group = await api('/api/groups', { method: 'POST', body: JSON.stringify({ name: name }) });
        groups.push(group);
        showToast('Group created: ' + name, 'success');
        // Update the select element
        var select = document.querySelector('#create-board-form select[name="group_id"]');
        var opt = document.createElement('option');
        opt.value = group.id;
        opt.textContent = group.name;
        opt.selected = true;
        select.appendChild(opt);
        input.value = '';
    } catch (err) {
        showToast('Failed to create group: ' + err.message, 'error');
    }
}

// ── Media ───────────────────────────────────────────────────────────────

async function loadMedia() {
    var loading = document.getElementById('media-loading');
    var content = document.getElementById('media-content');
    var grid = document.getElementById('media-grid');
    var empty = document.getElementById('media-empty');

    loading.classList.remove('hidden');
    content.classList.add('hidden');

    try {
        media = await api('/api/media');

        loading.classList.add('hidden');
        content.classList.remove('hidden');

        if (media.length === 0) {
            empty.classList.remove('hidden');
            grid.classList.add('hidden');
            return;
        }

        empty.classList.add('hidden');
        grid.classList.remove('hidden');

        // Build grid using DOM
        grid.innerHTML = '';
        media.forEach(function(m) {
            var card = document.createElement('div');
            card.className = 'bg-slate-800/60 border border-slate-700/50 rounded-lg p-4 hover:border-slate-600 transition-colors';

            var isImage = m.mime_type && m.mime_type.startsWith('image/');
            var isVideo = m.mime_type && m.mime_type.startsWith('video/');
            var iconSvg;
            if (isImage) {
                iconSvg = '<svg class="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>';
            } else if (isVideo) {
                iconSvg = '<svg class="w-8 h-8 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>';
            } else {
                iconSvg = '<svg class="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>';
            }

            // Top row: icon + action buttons
            var topRow = document.createElement('div');
            topRow.className = 'flex items-start justify-between mb-3';

            var iconDiv = document.createElement('div');
            iconDiv.innerHTML = iconSvg;
            topRow.appendChild(iconDiv);

            var btnsDiv = document.createElement('div');
            btnsDiv.className = 'flex gap-1';

            var dlLink = document.createElement('a');
            dlLink.href = '/api/media/' + encodeURIComponent(m.id) + '/download';
            dlLink.download = '';
            dlLink.title = 'Download';
            dlLink.className = 'p-1.5 text-slate-400 hover:text-blue-400 transition-colors rounded hover:bg-slate-700';
            dlLink.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>';
            btnsDiv.appendChild(dlLink);

            var delBtn = document.createElement('button');
            delBtn.title = 'Delete';
            delBtn.className = 'p-1.5 text-slate-400 hover:text-red-400 transition-colors rounded hover:bg-slate-700';
            delBtn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>';
            (function(mid, mname) {
                delBtn.addEventListener('click', function() { deleteMedia(mid, mname); });
            })(m.id, m.name);
            btnsDiv.appendChild(delBtn);

            topRow.appendChild(btnsDiv);
            card.appendChild(topRow);

            // Name
            var nameP = document.createElement('p');
            nameP.className = 'text-sm font-medium text-white truncate';
            nameP.title = m.name;
            nameP.textContent = m.name;
            card.appendChild(nameP);

            // Meta row
            var metaDiv = document.createElement('div');
            metaDiv.className = 'flex items-center justify-between mt-2 text-xs text-slate-500';
            var sizeSpan = document.createElement('span');
            sizeSpan.textContent = formatBytes(m.size);
            var dateSpan = document.createElement('span');
            dateSpan.textContent = formatDate(m.uploaded_at);
            metaDiv.appendChild(sizeSpan);
            metaDiv.appendChild(dateSpan);
            card.appendChild(metaDiv);

            grid.appendChild(card);
        });
    } catch (err) {
        loading.classList.add('hidden');
        content.classList.remove('hidden');
        showToast('Failed to load media: ' + err.message, 'error');
    }
}

function showUploadMediaModal() {
    var html = '<div class="space-y-4">'
        + '<div id="upload-drop-zone" class="drop-zone">'
        + '<svg class="w-10 h-10 mx-auto text-slate-500 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">'
        + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>'
        + '</svg>'
        + '<p class="text-sm text-slate-400 mb-1">Drop files here or click to browse</p>'
        + '<p class="text-xs text-slate-600">Supports images, videos, and other media</p>'
        + '<input type="file" id="upload-file-input" class="hidden" multiple accept="image/*,video/*,audio/*">'
        + '</div>'
        + '<div id="upload-file-list" class="space-y-2 hidden"></div>'
        + '<div id="upload-progress" class="hidden">'
        + '<div class="flex items-center gap-3"><div class="spinner"></div>'
        + '<span class="text-sm text-slate-400">Uploading...</span></div></div>'
        + '<div class="flex justify-end gap-3 pt-2">'
        + '<button type="button" id="upload-cancel-btn" class="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>'
        + '<button type="button" id="upload-submit-btn" disabled '
        + 'class="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors">'
        + 'Upload</button></div></div>';

    showModal('Upload Media', html);

    var dropZone = document.getElementById('upload-drop-zone');
    var fileInput = document.getElementById('upload-file-input');
    window._uploadSelectedFiles = [];

    document.getElementById('upload-cancel-btn').addEventListener('click', closeModal);
    document.getElementById('upload-submit-btn').addEventListener('click', submitUpload);

    dropZone.addEventListener('click', function() { fileInput.click(); });
    dropZone.addEventListener('dragover', function(e) {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', function() {
        dropZone.classList.remove('dragover');
    });
    dropZone.addEventListener('drop', function(e) {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        window._uploadSelectedFiles = Array.from(e.dataTransfer.files);
        updateFileList(window._uploadSelectedFiles);
    });
    fileInput.addEventListener('change', function() {
        window._uploadSelectedFiles = Array.from(fileInput.files);
        updateFileList(window._uploadSelectedFiles);
    });
}

function updateFileList(files) {
    var list = document.getElementById('upload-file-list');
    var btn = document.getElementById('upload-submit-btn');
    window._uploadSelectedFiles = files;

    if (files.length === 0) {
        list.classList.add('hidden');
        btn.disabled = true;
        return;
    }

    list.classList.remove('hidden');
    btn.disabled = false;

    list.innerHTML = '';
    files.forEach(function(f) {
        var row = document.createElement('div');
        row.className = 'flex items-center justify-between bg-slate-800 rounded px-3 py-2 text-sm';
        var nameSpan = document.createElement('span');
        nameSpan.className = 'text-slate-200 truncate';
        nameSpan.textContent = f.name;
        var sizeSpan = document.createElement('span');
        sizeSpan.className = 'text-slate-500 text-xs ml-2';
        sizeSpan.textContent = formatBytes(f.size);
        row.appendChild(nameSpan);
        row.appendChild(sizeSpan);
        list.appendChild(row);
    });
}

async function submitUpload() {
    var files = window._uploadSelectedFiles || [];
    if (files.length === 0) return;

    var progress = document.getElementById('upload-progress');
    var btn = document.getElementById('upload-submit-btn');
    progress.classList.remove('hidden');
    btn.disabled = true;

    var successCount = 0;
    for (var i = 0; i < files.length; i++) {
        var form = new FormData();
        form.append('file', files[i]);
        try {
            await api('/api/media', { method: 'POST', body: form });
            successCount++;
        } catch (err) {
            showToast('Failed to upload ' + files[i].name + ': ' + err.message, 'error');
        }
    }

    if (successCount > 0) {
        showToast('Uploaded ' + successCount + ' file(s)', 'success');
    }
    closeModal();
    loadMedia();
}

async function deleteMedia(id, name) {
    if (!confirm('Delete "' + name + '"? This cannot be undone.')) return;
    try {
        await api('/api/media/' + id, { method: 'DELETE' });
        showToast('Media deleted', 'success');
        loadMedia();
    } catch (err) {
        showToast('Delete failed: ' + err.message, 'error');
    }
}

// ── Playlists ───────────────────────────────────────────────────────────

async function loadPlaylists() {
    var loading = document.getElementById('playlists-loading');
    var content = document.getElementById('playlists-content');
    var list = document.getElementById('playlists-list');
    var empty = document.getElementById('playlists-empty');

    loading.classList.remove('hidden');
    content.classList.add('hidden');

    try {
        var results = await Promise.all([
            api('/api/playlists'),
            api('/api/media'),
        ]);
        playlists = results[0];
        media = results[1];

        loading.classList.add('hidden');
        content.classList.remove('hidden');

        if (playlists.length === 0) {
            empty.classList.remove('hidden');
            list.classList.add('hidden');
            return;
        }

        empty.classList.add('hidden');
        list.classList.remove('hidden');

        list.innerHTML = '';
        playlists.forEach(function(p) {
            var card = document.createElement('div');
            card.className = 'bg-slate-800/60 border border-slate-700/50 rounded-lg p-4 hover:border-slate-600 transition-colors';

            var outerDiv = document.createElement('div');
            outerDiv.className = 'flex items-start justify-between';

            var infoDiv = document.createElement('div');
            infoDiv.className = 'flex-1 min-w-0';

            var headerDiv = document.createElement('div');
            headerDiv.className = 'flex items-center gap-2 mb-1';
            var nameH3 = document.createElement('h3');
            nameH3.className = 'text-sm font-medium text-white truncate';
            nameH3.textContent = p.name;
            headerDiv.appendChild(nameH3);

            if (p.loop_playlist) {
                var loopBadge = document.createElement('span');
                loopBadge.className = 'text-xs bg-blue-600/20 text-blue-400 px-1.5 py-0.5 rounded';
                loopBadge.textContent = 'Loop';
                headerDiv.appendChild(loopBadge);
            }
            infoDiv.appendChild(headerDiv);

            var metaP = document.createElement('p');
            metaP.className = 'text-xs text-slate-500';
            metaP.textContent = p.items.length + ' item(s) \u00b7 Created ' + formatDate(p.created_at);
            infoDiv.appendChild(metaP);

            if (p.items.length > 0) {
                var itemsDiv = document.createElement('div');
                itemsDiv.className = 'mt-2 space-y-1';
                var shown = p.items.slice(0, 3);
                shown.forEach(function(item, idx) {
                    var itemP = document.createElement('p');
                    itemP.className = 'text-xs text-slate-400 truncate';
                    itemP.textContent = (idx + 1) + '. ' + (item.name || item.source);
                    itemsDiv.appendChild(itemP);
                });
                if (p.items.length > 3) {
                    var moreP = document.createElement('p');
                    moreP.className = 'text-xs text-slate-600';
                    moreP.textContent = '... and ' + (p.items.length - 3) + ' more';
                    itemsDiv.appendChild(moreP);
                }
                infoDiv.appendChild(itemsDiv);
            }

            outerDiv.appendChild(infoDiv);

            // Action buttons
            var btnsDiv = document.createElement('div');
            btnsDiv.className = 'flex gap-1 ml-3';

            var editBtn = document.createElement('button');
            editBtn.title = 'Edit';
            editBtn.className = 'p-1.5 text-slate-400 hover:text-blue-400 transition-colors rounded hover:bg-slate-700';
            editBtn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>';
            (function(pid) {
                editBtn.addEventListener('click', function() { showPlaylistModal(pid); });
            })(p.id);
            btnsDiv.appendChild(editBtn);

            var delBtn = document.createElement('button');
            delBtn.title = 'Delete';
            delBtn.className = 'p-1.5 text-slate-400 hover:text-red-400 transition-colors rounded hover:bg-slate-700';
            delBtn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>';
            (function(pid, pname) {
                delBtn.addEventListener('click', function() { deletePlaylist(pid, pname); });
            })(p.id, p.name);
            btnsDiv.appendChild(delBtn);

            outerDiv.appendChild(btnsDiv);
            card.appendChild(outerDiv);
            list.appendChild(card);
        });
    } catch (err) {
        loading.classList.add('hidden');
        content.classList.remove('hidden');
        showToast('Failed to load playlists: ' + err.message, 'error');
    }
}

function showPlaylistModal(editId) {
    var existing = editId ? playlists.find(function(p) { return p.id === editId; }) : null;
    var title = existing ? 'Edit Playlist' : 'New Playlist';

    var mediaOptions = media.map(function(m) {
        return '<option value="' + escapeHtml(m.id) + '" data-name="' + escapeHtml(m.name) + '" data-source="/api/media/' + escapeHtml(m.id) + '/download">' + escapeHtml(m.name) + ' (' + formatBytes(m.size) + ')</option>';
    }).join('');

    var existingItems = existing ? existing.items : [];

    var html = '<form id="playlist-form" class="space-y-4">'
        + '<div><label class="block text-sm text-slate-400 mb-1">Playlist Name</label>'
        + '<input type="text" name="name" required placeholder="e.g. Morning Rotation" '
        + 'value="' + (existing ? escapeHtml(existing.name) : '') + '" '
        + 'class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"></div>'
        + '<div><label class="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">'
        + '<input type="checkbox" name="loop_playlist" ' + (existing && existing.loop_playlist ? 'checked' : '') + ' '
        + 'class="rounded bg-slate-800 border-slate-600 text-blue-600 focus:ring-blue-500">'
        + ' Loop playlist</label></div>'
        + '<div><label class="block text-sm text-slate-400 mb-1">Add Media Item</label>'
        + '<div class="flex gap-2">'
        + '<select id="playlist-media-select" class="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">'
        + '<option value="">Select media...</option>' + mediaOptions + '</select>'
        + '<input type="number" id="playlist-item-duration" placeholder="Duration (s)" min="1" '
        + 'class="w-28 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">'
        + '<button type="button" id="add-playlist-item-btn" class="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg transition-colors">Add</button>'
        + '</div>'
        + '<p class="text-xs text-slate-600 mt-1">Duration is optional for videos (plays to end)</p></div>'
        + '<div><label class="block text-sm text-slate-400 mb-2">Items</label>'
        + '<div id="playlist-items-list" class="space-y-2 min-h-[2rem]"></div></div>'
        + '<div class="flex justify-end gap-3 pt-2">'
        + '<button type="button" id="cancel-playlist-btn" class="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>'
        + '<button type="submit" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">'
        + (existing ? 'Save Changes' : 'Create Playlist') + '</button></div></form>';

    showModal(title, html);

    // Initialize items state
    window._playlistItems = existingItems.map(function(item) {
        return {
            source: item.source,
            name: item.name || null,
            duration: item.duration || null,
        };
    });
    renderPlaylistItems();

    document.getElementById('cancel-playlist-btn').addEventListener('click', closeModal);
    document.getElementById('add-playlist-item-btn').addEventListener('click', addPlaylistItem);

    document.getElementById('playlist-form').addEventListener('submit', async function(e) {
        e.preventDefault();
        var fd = new FormData(e.target);
        var body = {
            name: fd.get('name'),
            items: window._playlistItems,
            loop_playlist: !!fd.get('loop_playlist'),
        };

        try {
            if (existing) {
                await api('/api/playlists/' + existing.id, { method: 'PUT', body: JSON.stringify(body) });
                showToast('Playlist updated', 'success');
            } else {
                await api('/api/playlists', { method: 'POST', body: JSON.stringify(body) });
                showToast('Playlist created', 'success');
            }
            closeModal();
            loadPlaylists();
        } catch (err) {
            showToast('Failed to save playlist: ' + err.message, 'error');
        }
    });
}

function addPlaylistItem() {
    var select = document.getElementById('playlist-media-select');
    var durationInput = document.getElementById('playlist-item-duration');

    if (!select.value) return;

    var option = select.options[select.selectedIndex];
    var source = option.dataset.source || select.value;
    var name = option.dataset.name || option.textContent;
    var durSecs = parseInt(durationInput.value);
    // Duration is serialized as { secs: N, nanos: 0 } for Rust std::time::Duration
    var duration = durSecs && durSecs > 0 ? { secs: durSecs, nanos: 0 } : null;

    window._playlistItems.push({ source: source, name: name, duration: duration });
    renderPlaylistItems();

    select.value = '';
    durationInput.value = '';
}

function removePlaylistItem(index) {
    window._playlistItems.splice(index, 1);
    renderPlaylistItems();
}

function movePlaylistItem(index, direction) {
    var items = window._playlistItems;
    var newIndex = index + direction;
    if (newIndex < 0 || newIndex >= items.length) return;
    var tmp = items[index];
    items[index] = items[newIndex];
    items[newIndex] = tmp;
    renderPlaylistItems();
}

function renderPlaylistItems() {
    var list = document.getElementById('playlist-items-list');
    var items = window._playlistItems;

    list.innerHTML = '';

    if (items.length === 0) {
        var noItems = document.createElement('p');
        noItems.className = 'text-xs text-slate-600';
        noItems.textContent = 'No items added';
        list.appendChild(noItems);
        return;
    }

    items.forEach(function(item, i) {
        var durStr = item.duration ? item.duration.secs + 's' : 'auto';

        var row = document.createElement('div');
        row.className = 'flex items-center gap-2 bg-slate-800 rounded-lg px-3 py-2 text-sm';

        var numSpan = document.createElement('span');
        numSpan.className = 'text-slate-500 font-mono text-xs w-5';
        numSpan.textContent = (i + 1) + '.';
        row.appendChild(numSpan);

        var nameSpan = document.createElement('span');
        nameSpan.className = 'flex-1 text-slate-200 truncate';
        nameSpan.textContent = item.name || item.source;
        row.appendChild(nameSpan);

        var durSpan = document.createElement('span');
        durSpan.className = 'text-xs text-slate-500';
        durSpan.textContent = durStr;
        row.appendChild(durSpan);

        // Up button
        var upBtn = document.createElement('button');
        upBtn.type = 'button';
        upBtn.className = 'p-0.5 text-slate-500 hover:text-white';
        upBtn.title = 'Move up';
        upBtn.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/></svg>';
        (function(idx) { upBtn.addEventListener('click', function() { movePlaylistItem(idx, -1); }); })(i);
        row.appendChild(upBtn);

        // Down button
        var downBtn = document.createElement('button');
        downBtn.type = 'button';
        downBtn.className = 'p-0.5 text-slate-500 hover:text-white';
        downBtn.title = 'Move down';
        downBtn.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>';
        (function(idx) { downBtn.addEventListener('click', function() { movePlaylistItem(idx, 1); }); })(i);
        row.appendChild(downBtn);

        // Remove button
        var rmBtn = document.createElement('button');
        rmBtn.type = 'button';
        rmBtn.className = 'p-0.5 text-slate-500 hover:text-red-400';
        rmBtn.title = 'Remove';
        rmBtn.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>';
        (function(idx) { rmBtn.addEventListener('click', function() { removePlaylistItem(idx); }); })(i);
        row.appendChild(rmBtn);

        list.appendChild(row);
    });
}

async function deletePlaylist(id, name) {
    if (!confirm('Delete playlist "' + name + '"?')) return;
    try {
        await api('/api/playlists/' + id, { method: 'DELETE' });
        showToast('Playlist deleted', 'success');
        loadPlaylists();
    } catch (err) {
        showToast('Delete failed: ' + err.message, 'error');
    }
}

// ── Schedules ───────────────────────────────────────────────────────────

async function loadSchedules() {
    var loading = document.getElementById('schedules-loading');
    var content = document.getElementById('schedules-content');
    var empty = document.getElementById('schedules-empty');
    var tbody = document.getElementById('schedules-table-body');

    loading.classList.remove('hidden');
    content.classList.add('hidden');

    try {
        var results = await Promise.all([
            api('/api/schedules'),
            api('/api/boards'),
            api('/api/groups'),
            api('/api/playlists'),
        ]);
        schedules = results[0];
        boards = results[1];
        groups = results[2];
        playlists = results[3];

        loading.classList.add('hidden');
        content.classList.remove('hidden');

        if (schedules.length === 0) {
            empty.classList.remove('hidden');
            tbody.closest('table').classList.add('hidden');
            return;
        }

        empty.classList.add('hidden');
        tbody.closest('table').classList.remove('hidden');

        var boardMap = {};
        boards.forEach(function(b) { boardMap[b.id] = b.name; });
        var groupMap = {};
        groups.forEach(function(g) { groupMap[g.id] = g.name; });
        var playlistMap = {};
        playlists.forEach(function(p) { playlistMap[p.id] = p.name; });

        var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

        tbody.innerHTML = '';
        schedules.forEach(function(s) {
            var tr = document.createElement('tr');
            tr.className = 'border-b border-slate-800/50';

            var target;
            if (s.board_id) {
                target = 'Board: ' + (boardMap[s.board_id] || s.board_id);
            } else if (s.group_id) {
                target = 'Group: ' + (groupMap[s.group_id] || s.group_id);
            } else {
                target = '--';
            }

            var timeRange = (s.start_time || 'any') + ' - ' + (s.end_time || 'any');
            var days = s.days_of_week
                ? s.days_of_week.split(',').map(function(d) { return dayNames[parseInt(d.trim())] || d; }).join(', ')
                : 'All days';

            var tdTarget = document.createElement('td');
            tdTarget.className = 'py-3 pr-4 text-white';
            tdTarget.textContent = target;

            var tdPlaylist = document.createElement('td');
            tdPlaylist.className = 'py-3 pr-4 text-slate-300';
            tdPlaylist.textContent = playlistMap[s.playlist_id] || s.playlist_id;

            var tdTime = document.createElement('td');
            tdTime.className = 'py-3 pr-4 text-slate-400 font-mono text-xs';
            tdTime.textContent = timeRange;

            var tdDays = document.createElement('td');
            tdDays.className = 'py-3 pr-4 text-slate-400 text-xs';
            tdDays.textContent = days;

            var tdPriority = document.createElement('td');
            tdPriority.className = 'py-3 pr-4 text-slate-400';
            tdPriority.textContent = s.priority;

            var tdActions = document.createElement('td');
            tdActions.className = 'py-3 text-right';
            var delBtn = document.createElement('button');
            delBtn.title = 'Delete';
            delBtn.className = 'p-1.5 text-slate-400 hover:text-red-400 transition-colors rounded hover:bg-slate-700';
            delBtn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>';
            (function(sid) {
                delBtn.addEventListener('click', function() { deleteSchedule(sid); });
            })(s.id);
            tdActions.appendChild(delBtn);

            tr.appendChild(tdTarget);
            tr.appendChild(tdPlaylist);
            tr.appendChild(tdTime);
            tr.appendChild(tdDays);
            tr.appendChild(tdPriority);
            tr.appendChild(tdActions);
            tbody.appendChild(tr);
        });
    } catch (err) {
        loading.classList.add('hidden');
        content.classList.remove('hidden');
        showToast('Failed to load schedules: ' + err.message, 'error');
    }
}

function showScheduleModal() {
    var boardOptions = boards.map(function(b) {
        return '<option value="' + escapeHtml(b.id) + '">' + escapeHtml(b.name) + '</option>';
    }).join('');
    var groupOptions = groups.map(function(g) {
        return '<option value="' + escapeHtml(g.id) + '">' + escapeHtml(g.name) + '</option>';
    }).join('');
    var playlistOptions = playlists.map(function(p) {
        return '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.name) + ' (' + p.items.length + ' items)</option>';
    }).join('');

    var dayAbbrevs = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var dayCheckboxes = dayAbbrevs.map(function(name, i) {
        return '<label class="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">'
            + '<input type="checkbox" name="day_' + i + '" value="' + i + '" checked '
            + 'class="rounded bg-slate-800 border-slate-600 text-blue-600 focus:ring-blue-500">'
            + ' ' + name + '</label>';
    }).join('');

    var html = '<form id="schedule-form" class="space-y-4">'
        + '<div><label class="block text-sm text-slate-400 mb-1">Target Type</label>'
        + '<select id="schedule-target-type" class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">'
        + '<option value="board">Board</option><option value="group">Group</option></select></div>'
        + '<div id="schedule-target-board"><label class="block text-sm text-slate-400 mb-1">Board</label>'
        + '<select name="board_id" class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">'
        + '<option value="">Select board...</option>' + boardOptions + '</select></div>'
        + '<div id="schedule-target-group" class="hidden"><label class="block text-sm text-slate-400 mb-1">Group</label>'
        + '<select name="group_id" class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">'
        + '<option value="">Select group...</option>' + groupOptions + '</select></div>'
        + '<div><label class="block text-sm text-slate-400 mb-1">Playlist</label>'
        + '<select name="playlist_id" required class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">'
        + '<option value="">Select playlist...</option>' + playlistOptions + '</select></div>'
        + '<div class="grid grid-cols-2 gap-4">'
        + '<div><label class="block text-sm text-slate-400 mb-1">Start Time</label>'
        + '<input type="time" name="start_time" class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"></div>'
        + '<div><label class="block text-sm text-slate-400 mb-1">End Time</label>'
        + '<input type="time" name="end_time" class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"></div></div>'
        + '<div><label class="block text-sm text-slate-400 mb-2">Days of Week</label>'
        + '<div class="flex flex-wrap gap-3">' + dayCheckboxes + '</div></div>'
        + '<div><label class="block text-sm text-slate-400 mb-1">Priority</label>'
        + '<input type="number" name="priority" value="0" min="0" max="100" '
        + 'class="w-24 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">'
        + '<p class="text-xs text-slate-600 mt-1">Higher priority schedules override lower ones</p></div>'
        + '<div class="flex justify-end gap-3 pt-2">'
        + '<button type="button" id="cancel-schedule-btn" class="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>'
        + '<button type="submit" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">Create Schedule</button>'
        + '</div></form>';

    showModal('New Schedule', html);

    document.getElementById('cancel-schedule-btn').addEventListener('click', closeModal);
    document.getElementById('schedule-target-type').addEventListener('change', updateScheduleTarget);

    document.getElementById('schedule-form').addEventListener('submit', async function(e) {
        e.preventDefault();
        var fd = new FormData(e.target);
        var targetType = document.getElementById('schedule-target-type').value;

        // Collect selected days
        var days = [];
        for (var i = 0; i < 7; i++) {
            if (fd.get('day_' + i)) days.push(i);
        }

        var body = {
            playlist_id: fd.get('playlist_id'),
            start_time: fd.get('start_time') || null,
            end_time: fd.get('end_time') || null,
            days_of_week: days.join(','),
            priority: parseInt(fd.get('priority')) || 0,
        };

        if (targetType === 'board') {
            body.board_id = fd.get('board_id') || null;
        } else {
            body.group_id = fd.get('group_id') || null;
        }

        try {
            await api('/api/schedules', { method: 'POST', body: JSON.stringify(body) });
            showToast('Schedule created', 'success');
            closeModal();
            loadSchedules();
        } catch (err) {
            showToast('Failed to create schedule: ' + err.message, 'error');
        }
    });
}

function updateScheduleTarget() {
    var type = document.getElementById('schedule-target-type').value;
    document.getElementById('schedule-target-board').classList.toggle('hidden', type !== 'board');
    document.getElementById('schedule-target-group').classList.toggle('hidden', type !== 'group');
}

async function deleteSchedule(id) {
    if (!confirm('Delete this schedule?')) return;
    try {
        await api('/api/schedules/' + id, { method: 'DELETE' });
        showToast('Schedule deleted', 'success');
        loadSchedules();
    } catch (err) {
        showToast('Delete failed: ' + err.message, 'error');
    }
}

// ── Initialize ──────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function() {
    navigateTo('boards');
});
