// koompi-dooh dashboard — app.js
// Vanilla JS, no build tools
//
// Security note: This is an internal admin dashboard. All dynamic values
// are escaped via escapeHtml() or set via textContent/DOM APIs.
// innerHTML is used only for static HTML form templates with pre-escaped values
// and static SVG icon strings.

const API = '';

let currentPage = 'boards';
let currentUser = null;
let boards = [], groups = [], zones = [], media = [], playlists = [];
let schedules = [], advertisers = [], campaigns = [], bookings = [];

async function api(path, options = {}) {
    const url = API + path;
    const defaults = { headers: { 'Content-Type': 'application/json' } };
    if (options.body instanceof FormData) delete defaults.headers;
    const res = await fetch(url, { ...defaults, ...options });
    if (res.status === 401) { showLoginOverlay(); throw new Error('Authentication required'); }
    if (!res.ok) { const text = await res.text().catch(() => ''); throw new Error(text || 'HTTP ' + res.status); }
    if (res.status === 204) return null;
    const ct = res.headers.get('Content-Type') || '';
    if (ct.includes('application/json')) return res.json();
    return null;
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
function formatDate(dateStr) {
    if (!dateStr) return '--';
    const d = new Date(dateStr.replace(' ', 'T') + (dateStr.includes('Z') || dateStr.includes('+') ? '' : 'Z'));
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function formatDateShort(s) { return s ? s.substring(0, 10) : '--'; }
function escapeHtml(str) { if (!str) return ''; const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

const inputCls = 'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500';
const btnPrimary = 'px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors';
const btnCancel = 'px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors';

function field(label, name, type, value, extra) {
    return '<div><label class="block text-sm text-slate-400 mb-1">' + escapeHtml(label) + '</label>'
        + '<input type="' + type + '" name="' + name + '" value="' + escapeHtml(value || '') + '" ' + (extra||'')
        + ' class="' + inputCls + '"></div>';
}
function selectField(label, name, options, sel, extra) {
    return '<div><label class="block text-sm text-slate-400 mb-1">' + escapeHtml(label) + '</label>'
        + '<select name="' + name + '" ' + (extra||'') + ' class="' + inputCls + '">' + options + '</select></div>';
}

var ICON = {
    edit: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>',
    del: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>',
    dl: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>',
    up: '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/></svg>',
    down: '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>',
    close: '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>',
    image: '<svg class="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>',
    video: '<svg class="w-8 h-8 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>',
    file: '<svg class="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>',
    upload: '<svg class="w-10 h-10 mx-auto text-slate-500 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg>',
};
function iconBtn(key, cls, title) { var b = document.createElement('button'); b.className = cls; b.title = title||''; b.innerHTML = ICON[key]; return b; }

function showToast(message, type) {
    type = type || 'info';
    var container = document.getElementById('toast-container');
    var toast = document.createElement('div'); toast.className = 'toast toast-' + type; toast.textContent = message;
    container.appendChild(toast);
    setTimeout(function() { toast.style.animation = 'toast-out 0.3s ease-in forwards'; setTimeout(function() { toast.remove(); }, 300); }, 3000);
}

function showModal(title, contentHtml, onClose) {
    var container = document.getElementById('modal-container');
    var overlay = document.createElement('div'); overlay.className = 'modal-overlay'; overlay.id = 'modal-overlay';
    var content = document.createElement('div'); content.className = 'modal-content';
    var header = document.createElement('div'); header.className = 'flex items-center justify-between mb-4';
    var titleEl = document.createElement('h3'); titleEl.className = 'text-lg font-semibold text-white'; titleEl.textContent = title;
    var closeBtn = document.createElement('button'); closeBtn.className = 'text-slate-400 hover:text-white transition-colors p-1';
    closeBtn.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>';
    header.appendChild(titleEl); header.appendChild(closeBtn);
    var body = document.createElement('div'); body.id = 'modal-body';
    body.innerHTML = contentHtml;
    content.appendChild(header); content.appendChild(body); overlay.appendChild(content);
    container.textContent = ''; container.appendChild(overlay);
    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal(); });
    if (onClose) container._onClose = onClose;
}
function closeModal() { var c = document.getElementById('modal-container'); if (c._onClose) { c._onClose(); c._onClose = null; } c.textContent = ''; }

function renderPagination(containerId, total, page, perPage, onPageChange) {
    var container = document.getElementById(containerId); if (!container) return;
    var totalPages = Math.ceil(total / perPage);
    if (totalPages <= 1) { container.textContent = ''; return; }
    container.textContent = '';
    var w = document.createElement('div'); w.className = 'flex items-center justify-between text-sm mt-4';
    var info = document.createElement('span'); info.className = 'text-slate-500';
    info.textContent = 'Showing ' + ((page-1)*perPage+1) + '-' + Math.min(page*perPage,total) + ' of ' + total;
    w.appendChild(info);
    var btns = document.createElement('div'); btns.className = 'flex gap-1';
    if (page > 1) { var p = document.createElement('button'); p.className = 'px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded'; p.textContent = 'Prev'; p.addEventListener('click', function(){onPageChange(page-1);}); btns.appendChild(p); }
    for (var i = Math.max(1,page-2); i <= Math.min(totalPages,page+2); i++) {
        var b = document.createElement('button'); b.className = 'px-3 py-1 rounded ' + (i===page?'bg-blue-600 text-white':'bg-slate-800 hover:bg-slate-700 text-slate-300');
        b.textContent = i; (function(n){b.addEventListener('click',function(){onPageChange(n);});})(i); btns.appendChild(b);
    }
    if (page < totalPages) { var n = document.createElement('button'); n.className = 'px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded'; n.textContent = 'Next'; n.addEventListener('click', function(){onPageChange(page+1);}); btns.appendChild(n); }
    w.appendChild(btns); container.appendChild(w);
}

function showLoginOverlay() { currentUser = null; document.getElementById('login-overlay').classList.remove('hidden'); document.getElementById('app-layout').classList.add('hidden'); }
function showApp() { document.getElementById('login-overlay').classList.add('hidden'); document.getElementById('app-layout').classList.remove('hidden'); if (currentUser) document.getElementById('current-user').textContent = currentUser.username; }
async function checkAuth() { try { currentUser = await api('/api/auth/me'); showApp(); navigateTo('boards'); } catch(e) { showLoginOverlay(); } }
async function handleLogin(e) {
    e.preventDefault(); var form = e.target; var err = document.getElementById('login-error');
    try {
        var res = await fetch(API+'/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:form.username.value, password:form.password.value}) });
        if (!res.ok) { var t = await res.text().catch(function(){return '';}); throw new Error(t||'Login failed'); }
        currentUser = await res.json(); err.classList.add('hidden'); form.reset(); showApp(); navigateTo('boards');
    } catch(ex) { err.textContent = ex.message||'Login failed'; err.classList.remove('hidden'); }
}
async function handleLogout() { try { await fetch(API+'/api/auth/logout',{method:'POST'}); } catch(e){} showLoginOverlay(); }

var PAGE_TITLES = { boards:'Boards', zones:'Zones', media:'Media Library', playlists:'Playlists', schedules:'Schedules', advertisers:'Advertisers', campaigns:'Campaigns', bookings:'Bookings', playlogs:'Play Logs' };
function navigateTo(page) {
    currentPage = page;
    document.querySelectorAll('.nav-item').forEach(function(el){ el.classList.toggle('active', el.dataset.page===page); });
    document.getElementById('page-title').textContent = PAGE_TITLES[page]||page;
    document.querySelectorAll('.page-content').forEach(function(el){ el.classList.add('hidden'); });
    var pe = document.getElementById('page-'+page); if (pe) pe.classList.remove('hidden');
    updateHeaderActions(page);
    switch(page){ case 'boards':loadBoards();break; case 'zones':loadZones();break; case 'media':loadMedia();break; case 'playlists':loadPlaylists();break; case 'schedules':loadSchedules();break; case 'advertisers':loadAdvertisers();break; case 'campaigns':loadCampaigns();break; case 'bookings':loadBookings();break; case 'playlogs':loadPlayLogs();break; }
}
function updateHeaderActions(page) {
    var c = document.getElementById('header-actions'); c.textContent = '';
    var btn = document.createElement('button'); btn.className = 'px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors';
    var a = { boards:['+ New Board',showCreateBoardModal], zones:['+ New Zone',function(){showZoneModal();}], media:['+ Upload Media',showUploadMediaModal], playlists:['+ New Playlist',function(){showPlaylistModal();}], schedules:['+ New Schedule',showScheduleModal], advertisers:['+ New Advertiser',function(){showAdvertiserModal();}], campaigns:['+ New Campaign',function(){showCampaignModal();}], bookings:['+ New Booking',function(){showBookingModal();}] };
    if (a[page]) { btn.textContent = a[page][0]; btn.addEventListener('click', a[page][1]); c.appendChild(btn); }
}

var boardsPage = 1;
async function loadBoards(page) {
    page = page||1; boardsPage = page;
    var ld = document.getElementById('boards-loading'), ct = document.getElementById('boards-content'), em = document.getElementById('boards-empty'), tb = document.getElementById('boards-table-body');
    ld.classList.remove('hidden'); ct.classList.add('hidden');
    try {
        var r = await Promise.all([api('/api/boards?page='+page+'&per_page=25'), api('/api/zones')]);
        boards = r[0].data; var total = r[0].total; zones = r[1];
        ld.classList.add('hidden'); ct.classList.remove('hidden');
        if (!boards.length && page===1) { em.classList.remove('hidden'); tb.closest('table').classList.add('hidden'); document.getElementById('boards-pagination').textContent=''; return; }
        em.classList.add('hidden'); tb.closest('table').classList.remove('hidden');
        var zm = {}; zones.forEach(function(z){zm[z.id]=z.name;});
        tb.textContent = '';
        boards.forEach(function(b) {
            var tr = document.createElement('tr'); tr.className = 'border-b border-slate-800/50 cursor-pointer';
            tr.addEventListener('click', function(){showBoardDetail(b.id);});
            var mkTd = function(t,c){var d=document.createElement('td');d.className=c;d.textContent=t;return d;};
            tr.appendChild(mkTd(b.name,'py-3 pr-4 font-medium text-white'));
            var st = document.createElement('td'); st.className='py-3 pr-4'; var bg = document.createElement('span'); bg.className='badge '+(b.status==='online'?'badge-online':'badge-offline'); bg.textContent=b.status; st.appendChild(bg); tr.appendChild(st);
            tr.appendChild(mkTd(b.zone_id?(zm[b.zone_id]||'--'):'--','py-3 pr-4 text-slate-400'));
            tr.appendChild(mkTd(b.sell_mode||'--','py-3 pr-4 text-slate-400'));
            tr.appendChild(mkTd((b.screen_width&&b.screen_height)?b.screen_width+'x'+b.screen_height:'--','py-3 pr-4 text-slate-400 font-mono text-xs'));
            tr.appendChild(mkTd(formatDate(b.last_seen),'py-3 pr-4 text-slate-400'));
            var ta = document.createElement('td'); ta.className='py-3 text-right'; ta.addEventListener('click',function(e){e.stopPropagation();});
            var ad = document.createElement('div'); ad.className='flex items-center justify-end gap-1';
            var eb = iconBtn('edit','p-1.5 text-slate-400 hover:text-blue-400 transition-colors rounded hover:bg-slate-700','Edit');
            (function(id){eb.addEventListener('click',function(){showEditBoardModal(id);});})(b.id); ad.appendChild(eb);
            [{l:'Play',c:'bg-green-600/20 text-green-400 hover:bg-green-600/30'},{l:'Pause',c:'bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/30'},{l:'Stop',c:'bg-red-600/20 text-red-400 hover:bg-red-600/30'}].forEach(function(cmd){
                var cb = document.createElement('button'); cb.className='cmd-btn '+cmd.c; cb.textContent=cmd.l;
                cb.addEventListener('click',function(){sendBoardCmd(b.id,cmd.l);}); ad.appendChild(cb);
            });
            ta.appendChild(ad); tr.appendChild(ta); tb.appendChild(tr);
        });
        renderPagination('boards-pagination', total, page, 25, loadBoards);
    } catch(err) { ld.classList.add('hidden'); ct.classList.remove('hidden'); showToast('Failed to load boards: '+err.message,'error'); }
}
async function sendBoardCmd(id,cmd) { try { await api('/api/boards/'+id+'/command',{method:'POST',body:JSON.stringify({command:{type:cmd}})}); showToast('Sent '+cmd,'success'); } catch(e){showToast('Failed: '+e.message,'error');} }

function showBoardDetail(boardId) {
    var board = boards.find(function(b){return b.id===boardId;}); if (!board) return;
    var zm = {}; zones.forEach(function(z){zm[z.id]=z.name;});
    var html = '<div class="space-y-4"><div class="grid grid-cols-2 gap-4 text-sm">'
        +'<div><p class="text-slate-500 text-xs uppercase tracking-wider mb-1">Board ID</p><p class="text-slate-200 font-mono text-xs break-all">'+escapeHtml(board.id)+'</p></div>'
        +'<div><p class="text-slate-500 text-xs uppercase tracking-wider mb-1">Name</p><p class="text-white">'+escapeHtml(board.name)+'</p></div>'
        +'<div><p class="text-slate-500 text-xs uppercase tracking-wider mb-1">Status</p><span class="badge '+(board.status==='online'?'badge-online':'badge-offline')+'">'+escapeHtml(board.status)+'</span></div>'
        +'<div><p class="text-slate-500 text-xs uppercase tracking-wider mb-1">Zone</p><p class="text-slate-200">'+(board.zone_id?escapeHtml(zm[board.zone_id]||'--'):'--')+'</p></div>'
        +'<div><p class="text-slate-500 text-xs uppercase tracking-wider mb-1">Resolution</p><p class="text-slate-200">'+((board.screen_width&&board.screen_height)?board.screen_width+'x'+board.screen_height:'--')+'</p></div>'
        +'<div><p class="text-slate-500 text-xs uppercase tracking-wider mb-1">Sell Mode</p><p class="text-slate-200">'+escapeHtml(board.sell_mode||'--')+'</p></div>'
        +'<div><p class="text-slate-500 text-xs uppercase tracking-wider mb-1">Type</p><p class="text-slate-200">'+escapeHtml(board.board_type||'--')+'</p></div>'
        +'<div><p class="text-slate-500 text-xs uppercase tracking-wider mb-1">Address</p><p class="text-slate-200">'+escapeHtml(board.address||'--')+'</p></div>'
        +'</div><div class="border-t border-slate-700 pt-4"><p class="text-sm font-medium text-white mb-3">Commands</p><div id="board-detail-cmds" class="flex flex-wrap gap-2"></div></div></div>';
    showModal('Board: '+board.name, html);
    var cd = document.getElementById('board-detail-cmds');
    ['Play','Pause','Resume','Stop','Next','Previous'].forEach(function(l){ var c=l==='Play'?'bg-green-600 hover:bg-green-700':l==='Stop'?'bg-red-600 hover:bg-red-700':'bg-slate-600 hover:bg-slate-700'; var b=document.createElement('button'); b.className='cmd-btn '+c+' text-white px-4 py-2 text-sm'; b.textContent=l; b.addEventListener('click',function(){sendBoardCmd(board.id,l);closeModal();}); cd.appendChild(b); });
}

function showCreateBoardModal() {
    var zo = '<option value="">No zone</option>'+zones.map(function(z){return '<option value="'+escapeHtml(z.id)+'">'+escapeHtml(z.name)+'</option>';}).join('');
    var html = '<form id="create-board-form" class="space-y-4">'+field('Board Name','name','text','','required placeholder="e.g. Lobby Display"')+selectField('Zone','zone_id',zo)+'<div class="grid grid-cols-2 gap-4">'+field('Screen Width','screen_width','number','','placeholder="1920"')+field('Screen Height','screen_height','number','','placeholder="1080"')+'</div>'+selectField('Sell Mode','sell_mode','<option value="">Not set</option><option value="loop">Loop</option><option value="slot">Slot</option><option value="exclusive">Exclusive</option>')+'<div class="flex justify-end gap-3 pt-2"><button type="button" id="cancel-board-btn" class="'+btnCancel+'">Cancel</button><button type="submit" class="'+btnPrimary+'">Create Board</button></div></form>';
    showModal('New Board', html);
    document.getElementById('cancel-board-btn').addEventListener('click', closeModal);
    document.getElementById('create-board-form').addEventListener('submit', async function(e) {
        e.preventDefault(); var fd = new FormData(e.target); var body = {name:fd.get('name')};
        if(fd.get('zone_id'))body.zone_id=fd.get('zone_id'); if(fd.get('screen_width'))body.screen_width=parseInt(fd.get('screen_width')); if(fd.get('screen_height'))body.screen_height=parseInt(fd.get('screen_height')); if(fd.get('sell_mode'))body.sell_mode=fd.get('sell_mode');
        try { await api('/api/boards',{method:'POST',body:JSON.stringify(body)}); showToast('Board created','success'); closeModal(); loadBoards(); } catch(e){showToast('Failed: '+e.message,'error');}
    });
}

function showEditBoardModal(boardId) {
    var board = boards.find(function(b){return b.id===boardId;}); if(!board) return;
    var zo = '<option value="">No zone</option>'+zones.map(function(z){return '<option value="'+escapeHtml(z.id)+'"'+(board.zone_id===z.id?' selected':'')+'>'+escapeHtml(z.name)+'</option>';}).join('');
    var so = ['','loop','slot','exclusive'].map(function(m){return '<option value="'+m+'"'+((board.sell_mode||'')===m?' selected':'')+'>'+(m||'Not set')+'</option>';}).join('');
    var oo = ['','landscape','portrait'].map(function(o){return '<option value="'+o+'"'+((board.orientation||'')===o?' selected':'')+'>'+(o||'Not set')+'</option>';}).join('');
    var html = '<form id="edit-board-form" class="space-y-4">'+field('Board Name','name','text',board.name,'required')+selectField('Zone','zone_id',zo)+'<div class="grid grid-cols-2 gap-4">'+field('Screen Width','screen_width','number',board.screen_width||'')+field('Screen Height','screen_height','number',board.screen_height||'')+'</div>'+selectField('Sell Mode','sell_mode',so)+selectField('Orientation','orientation',oo)+field('Board Type','board_type','text',board.board_type||'','placeholder="e.g. LED, LCD"')+field('Address','address','text',board.address||'')+'<div class="grid grid-cols-2 gap-4">'+field('Operating Start','operating_hours_start','time',board.operating_hours_start||'')+field('Operating End','operating_hours_end','time',board.operating_hours_end||'')+'</div><div class="flex justify-end gap-3 pt-2"><button type="button" id="cancel-edit-board" class="'+btnCancel+'">Cancel</button><button type="submit" class="'+btnPrimary+'">Save Changes</button></div></form>';
    showModal('Edit Board: '+board.name, html);
    document.getElementById('cancel-edit-board').addEventListener('click', closeModal);
    document.getElementById('edit-board-form').addEventListener('submit', async function(e) {
        e.preventDefault(); var fd = new FormData(e.target);
        var body = {name:fd.get('name'),zone_id:fd.get('zone_id')||null,screen_width:fd.get('screen_width')?parseInt(fd.get('screen_width')):null,screen_height:fd.get('screen_height')?parseInt(fd.get('screen_height')):null,sell_mode:fd.get('sell_mode')||null,orientation:fd.get('orientation')||null,board_type:fd.get('board_type')||null,address:fd.get('address')||null,operating_hours_start:fd.get('operating_hours_start')||null,operating_hours_end:fd.get('operating_hours_end')||null};
        try { await api('/api/boards/'+boardId,{method:'PUT',body:JSON.stringify(body)}); showToast('Board updated','success'); closeModal(); loadBoards(boardsPage); } catch(e){showToast('Failed: '+e.message,'error');}
    });
}

async function loadZones() {
    var ld=document.getElementById('zones-loading'),ct=document.getElementById('zones-content'),em=document.getElementById('zones-empty'),tb=document.getElementById('zones-table-body');
    ld.classList.remove('hidden'); ct.classList.add('hidden');
    try {
        zones = await api('/api/zones');
        ld.classList.add('hidden'); ct.classList.remove('hidden');
        if(!zones.length){em.classList.remove('hidden');tb.closest('table').classList.add('hidden');return;}
        em.classList.add('hidden'); tb.closest('table').classList.remove('hidden');
        var zm={}; zones.forEach(function(z){zm[z.id]=z.name;});
        tb.textContent='';
        zones.forEach(function(z){
            var tr=document.createElement('tr');tr.className='border-b border-slate-800/50';
            var mkTd=function(t,c){var d=document.createElement('td');d.className=c;d.textContent=t;return d;};
            tr.appendChild(mkTd(z.name,'py-3 pr-4 font-medium text-white'));
            tr.appendChild(mkTd(z.zone_type,'py-3 pr-4 text-slate-400'));
            tr.appendChild(mkTd(z.parent_id?(zm[z.parent_id]||z.parent_id):'--','py-3 pr-4 text-slate-400'));
            var ta=document.createElement('td');ta.className='py-3 text-right';var ad=document.createElement('div');ad.className='flex items-center justify-end gap-1';
            var eb=iconBtn('edit','p-1.5 text-slate-400 hover:text-blue-400 transition-colors rounded hover:bg-slate-700','Edit');(function(id){eb.addEventListener('click',function(){showZoneModal(id);});})(z.id);
            var db=iconBtn('del','p-1.5 text-slate-400 hover:text-red-400 transition-colors rounded hover:bg-slate-700','Delete');(function(id,n){db.addEventListener('click',function(){deleteZone(id,n);});})(z.id,z.name);
            ad.appendChild(eb);ad.appendChild(db);ta.appendChild(ad);tr.appendChild(ta);tb.appendChild(tr);
        });
    } catch(e){ld.classList.add('hidden');ct.classList.remove('hidden');showToast('Failed: '+e.message,'error');}
}
function showZoneModal(editId) {
    var ex = editId?zones.find(function(z){return z.id===editId;}):null;
    var po='<option value="">No parent</option>'+zones.filter(function(z){return !editId||z.id!==editId;}).map(function(z){return '<option value="'+escapeHtml(z.id)+'"'+(ex&&ex.parent_id===z.id?' selected':'')+'>'+escapeHtml(z.name)+'</option>';}).join('');
    var tv=ex?ex.zone_type:'city'; var to=['country','region','city','district','custom'].map(function(t){return '<option value="'+t+'"'+(tv===t?' selected':'')+'>'+t+'</option>';}).join('');
    var html='<form id="zone-form" class="space-y-4">'+field('Zone Name','name','text',ex?ex.name:'','required placeholder="e.g. Phnom Penh"')+selectField('Type','zone_type',to)+selectField('Parent Zone','parent_id',po)+'<div class="flex justify-end gap-3 pt-2"><button type="button" id="cancel-zone-btn" class="'+btnCancel+'">Cancel</button><button type="submit" class="'+btnPrimary+'">'+(ex?'Save':'Create Zone')+'</button></div></form>';
    showModal(ex?'Edit Zone':'New Zone', html);
    document.getElementById('cancel-zone-btn').addEventListener('click', closeModal);
    document.getElementById('zone-form').addEventListener('submit', async function(e){
        e.preventDefault(); var fd=new FormData(e.target); var body={name:fd.get('name'),zone_type:fd.get('zone_type'),parent_id:fd.get('parent_id')||null};
        try { if(ex){await api('/api/zones/'+ex.id,{method:'PUT',body:JSON.stringify(body)});showToast('Zone updated','success');}else{await api('/api/zones',{method:'POST',body:JSON.stringify(body)});showToast('Zone created','success');} closeModal();loadZones(); } catch(e){showToast('Failed: '+e.message,'error');}
    });
}
async function deleteZone(id,name){if(!confirm('Delete zone "'+name+'"?'))return;try{await api('/api/zones/'+id,{method:'DELETE'});showToast('Zone deleted','success');loadZones();}catch(e){showToast('Failed: '+e.message,'error');}}

async function loadMedia() {
    var ld=document.getElementById('media-loading'),ct=document.getElementById('media-content'),gr=document.getElementById('media-grid'),em=document.getElementById('media-empty');
    ld.classList.remove('hidden');ct.classList.add('hidden');
    try {
        var r=await api('/api/media?per_page=100'); media=r.data;
        ld.classList.add('hidden');ct.classList.remove('hidden');
        if(!media.length){em.classList.remove('hidden');gr.classList.add('hidden');return;}
        em.classList.add('hidden');gr.classList.remove('hidden');gr.textContent='';
        media.forEach(function(m){
            var card=document.createElement('div');card.className='bg-slate-800/60 border border-slate-700/50 rounded-lg p-4 hover:border-slate-600 transition-colors';
            var isImg=m.mime_type&&m.mime_type.startsWith('image/'),isVid=m.mime_type&&m.mime_type.startsWith('video/');
            var top=document.createElement('div');top.className='flex items-start justify-between mb-3';
            var ic=document.createElement('div');ic.innerHTML=isImg?ICON.image:isVid?ICON.video:ICON.file;top.appendChild(ic);
            var bs=document.createElement('div');bs.className='flex gap-1';
            var dl=document.createElement('a');dl.href='/api/media/'+encodeURIComponent(m.id)+'/download';dl.download='';dl.title='Download';dl.className='p-1.5 text-slate-400 hover:text-blue-400 transition-colors rounded hover:bg-slate-700';dl.innerHTML=ICON.dl;bs.appendChild(dl);
            var db=iconBtn('del','p-1.5 text-slate-400 hover:text-red-400 transition-colors rounded hover:bg-slate-700','Delete');
            (function(id,n){db.addEventListener('click',function(){deleteMedia(id,n);});})(m.id,m.name);bs.appendChild(db);
            top.appendChild(bs);card.appendChild(top);
            var np=document.createElement('p');np.className='text-sm font-medium text-white truncate';np.title=m.name;np.textContent=m.name;card.appendChild(np);
            var md=document.createElement('div');md.className='flex items-center justify-between mt-2 text-xs text-slate-500';
            var ss=document.createElement('span');ss.textContent=formatBytes(m.size);var ds=document.createElement('span');ds.textContent=formatDate(m.uploaded_at);
            md.appendChild(ss);md.appendChild(ds);card.appendChild(md);gr.appendChild(card);
        });
    } catch(e){ld.classList.add('hidden');ct.classList.remove('hidden');showToast('Failed: '+e.message,'error');}
}
function showUploadMediaModal() {
    var html='<div class="space-y-4"><div id="upload-drop-zone" class="drop-zone">'+ICON.upload+'<p class="text-sm text-slate-400 mb-1">Drop files here or click to browse</p><p class="text-xs text-slate-600">Images, videos, and other media</p><input type="file" id="upload-file-input" class="hidden" multiple accept="image/*,video/*,audio/*"></div><div id="upload-file-list" class="space-y-2 hidden"></div><div id="upload-progress" class="hidden"><div class="flex items-center gap-3"><div class="spinner"></div><span class="text-sm text-slate-400">Uploading...</span></div></div><div class="flex justify-end gap-3 pt-2"><button type="button" id="upload-cancel-btn" class="'+btnCancel+'">Cancel</button><button type="button" id="upload-submit-btn" disabled class="'+btnPrimary+' disabled:opacity-40 disabled:cursor-not-allowed">Upload</button></div></div>';
    showModal('Upload Media',html);
    var dz=document.getElementById('upload-drop-zone'),fi=document.getElementById('upload-file-input');window._uploadSelectedFiles=[];
    document.getElementById('upload-cancel-btn').addEventListener('click',closeModal);
    document.getElementById('upload-submit-btn').addEventListener('click',submitUpload);
    dz.addEventListener('click',function(){fi.click();});
    dz.addEventListener('dragover',function(e){e.preventDefault();dz.classList.add('dragover');});
    dz.addEventListener('dragleave',function(){dz.classList.remove('dragover');});
    dz.addEventListener('drop',function(e){e.preventDefault();dz.classList.remove('dragover');window._uploadSelectedFiles=Array.from(e.dataTransfer.files);updateFileList(window._uploadSelectedFiles);});
    fi.addEventListener('change',function(){window._uploadSelectedFiles=Array.from(fi.files);updateFileList(window._uploadSelectedFiles);});
}
function updateFileList(files){var l=document.getElementById('upload-file-list'),b=document.getElementById('upload-submit-btn');if(!files.length){l.classList.add('hidden');b.disabled=true;return;}l.classList.remove('hidden');b.disabled=false;l.textContent='';files.forEach(function(f){var r=document.createElement('div');r.className='flex items-center justify-between bg-slate-800 rounded px-3 py-2 text-sm';var n=document.createElement('span');n.className='text-slate-200 truncate';n.textContent=f.name;var s=document.createElement('span');s.className='text-slate-500 text-xs ml-2';s.textContent=formatBytes(f.size);r.appendChild(n);r.appendChild(s);l.appendChild(r);});}
async function submitUpload(){var files=window._uploadSelectedFiles||[];if(!files.length)return;document.getElementById('upload-progress').classList.remove('hidden');document.getElementById('upload-submit-btn').disabled=true;var ok=0;for(var i=0;i<files.length;i++){var fd=new FormData();fd.append('file',files[i]);try{await api('/api/media',{method:'POST',body:fd});ok++;}catch(e){showToast('Failed: '+files[i].name,'error');}}if(ok>0)showToast('Uploaded '+ok+' file(s)','success');closeModal();loadMedia();}
async function deleteMedia(id,name){if(!confirm('Delete "'+name+'"?'))return;try{await api('/api/media/'+id,{method:'DELETE'});showToast('Media deleted','success');loadMedia();}catch(e){showToast('Failed: '+e.message,'error');}}

async function loadPlaylists() {
    var ld=document.getElementById('playlists-loading'),ct=document.getElementById('playlists-content'),ls=document.getElementById('playlists-list'),em=document.getElementById('playlists-empty');
    ld.classList.remove('hidden');ct.classList.add('hidden');
    try {
        var r=await Promise.all([api('/api/playlists?per_page=100'),api('/api/media?per_page=200')]);playlists=r[0].data;media=r[1].data;
        ld.classList.add('hidden');ct.classList.remove('hidden');
        if(!playlists.length){em.classList.remove('hidden');ls.classList.add('hidden');return;}
        em.classList.add('hidden');ls.classList.remove('hidden');ls.textContent='';
        playlists.forEach(function(p){
            var card=document.createElement('div');card.className='bg-slate-800/60 border border-slate-700/50 rounded-lg p-4 hover:border-slate-600 transition-colors';
            var outer=document.createElement('div');outer.className='flex items-start justify-between';
            var info=document.createElement('div');info.className='flex-1 min-w-0';
            var hdr=document.createElement('div');hdr.className='flex items-center gap-2 mb-1';var nh=document.createElement('h3');nh.className='text-sm font-medium text-white truncate';nh.textContent=p.name;hdr.appendChild(nh);
            if(p.loop_playlist){var lb=document.createElement('span');lb.className='text-xs bg-blue-600/20 text-blue-400 px-1.5 py-0.5 rounded';lb.textContent='Loop';hdr.appendChild(lb);}
            info.appendChild(hdr);var mt=document.createElement('p');mt.className='text-xs text-slate-500';mt.textContent=p.items.length+' item(s)';info.appendChild(mt);outer.appendChild(info);
            var bs=document.createElement('div');bs.className='flex gap-1 ml-3';
            var eb=iconBtn('edit','p-1.5 text-slate-400 hover:text-blue-400 transition-colors rounded hover:bg-slate-700','Edit');(function(id){eb.addEventListener('click',function(){showPlaylistModal(id);});})(p.id);bs.appendChild(eb);
            var db=iconBtn('del','p-1.5 text-slate-400 hover:text-red-400 transition-colors rounded hover:bg-slate-700','Delete');(function(id,n){db.addEventListener('click',function(){deletePlaylist(id,n);});})(p.id,p.name);bs.appendChild(db);
            outer.appendChild(bs);card.appendChild(outer);ls.appendChild(card);
        });
    } catch(e){ld.classList.add('hidden');ct.classList.remove('hidden');showToast('Failed: '+e.message,'error');}
}
function showPlaylistModal(editId) {
    var ex=editId?playlists.find(function(p){return p.id===editId;}):null;
    var mo=media.map(function(m){return '<option value="'+escapeHtml(m.id)+'" data-name="'+escapeHtml(m.name)+'" data-source="/api/media/'+escapeHtml(m.id)+'/download">'+escapeHtml(m.name)+' ('+formatBytes(m.size)+')</option>';}).join('');
    var html='<form id="playlist-form" class="space-y-4">'+field('Playlist Name','name','text',ex?ex.name:'','required placeholder="e.g. Morning Rotation"')+'<div><label class="flex items-center gap-2 text-sm text-slate-400 cursor-pointer"><input type="checkbox" name="loop_playlist" '+(ex&&ex.loop_playlist?'checked':'')+' class="rounded bg-slate-800 border-slate-600 text-blue-600"> Loop playlist</label></div><div><label class="block text-sm text-slate-400 mb-1">Add Media Item</label><div class="flex gap-2"><select id="playlist-media-select" class="'+inputCls+' flex-1"><option value="">Select media...</option>'+mo+'</select><input type="number" id="playlist-item-duration" placeholder="Dur (s)" min="1" class="w-24 '+inputCls+'"><button type="button" id="add-playlist-item-btn" class="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg transition-colors">Add</button></div></div><div><label class="block text-sm text-slate-400 mb-2">Items</label><div id="playlist-items-list" class="space-y-2 min-h-[2rem]"></div></div><div class="flex justify-end gap-3 pt-2"><button type="button" id="cancel-playlist-btn" class="'+btnCancel+'">Cancel</button><button type="submit" class="'+btnPrimary+'">'+(ex?'Save':'Create Playlist')+'</button></div></form>';
    showModal(ex?'Edit Playlist':'New Playlist',html);
    window._playlistItems=(ex?ex.items:[]).map(function(i){return{source:i.source,name:i.name||null,duration:i.duration||null};});
    renderPlaylistItems();
    document.getElementById('cancel-playlist-btn').addEventListener('click',closeModal);
    document.getElementById('add-playlist-item-btn').addEventListener('click',addPlaylistItem);
    document.getElementById('playlist-form').addEventListener('submit',async function(e){
        e.preventDefault();var fd=new FormData(e.target);var body={name:fd.get('name'),items:window._playlistItems,loop_playlist:!!fd.get('loop_playlist')};
        try{if(ex){await api('/api/playlists/'+ex.id,{method:'PUT',body:JSON.stringify(body)});showToast('Playlist updated','success');}else{await api('/api/playlists',{method:'POST',body:JSON.stringify(body)});showToast('Playlist created','success');}closeModal();loadPlaylists();}catch(e){showToast('Failed: '+e.message,'error');}
    });
}
function addPlaylistItem(){var s=document.getElementById('playlist-media-select'),d=document.getElementById('playlist-item-duration');if(!s.value)return;var o=s.options[s.selectedIndex];var ds=parseInt(d.value);window._playlistItems.push({source:o.dataset.source||s.value,name:o.dataset.name||o.textContent,duration:ds>0?{secs:ds,nanos:0}:null});renderPlaylistItems();s.value='';d.value='';}
function removePlaylistItem(i){window._playlistItems.splice(i,1);renderPlaylistItems();}
function movePlaylistItem(i,dir){var items=window._playlistItems;var j=i+dir;if(j<0||j>=items.length)return;var t=items[i];items[i]=items[j];items[j]=t;renderPlaylistItems();}
function renderPlaylistItems(){
    var l=document.getElementById('playlist-items-list'),items=window._playlistItems;l.textContent='';
    if(!items.length){var p=document.createElement('p');p.className='text-xs text-slate-600';p.textContent='No items added';l.appendChild(p);return;}
    items.forEach(function(item,i){
        var r=document.createElement('div');r.className='flex items-center gap-2 bg-slate-800 rounded-lg px-3 py-2 text-sm';
        var n=document.createElement('span');n.className='text-slate-500 font-mono text-xs w-5';n.textContent=(i+1)+'.';r.appendChild(n);
        var ns=document.createElement('span');ns.className='flex-1 text-slate-200 truncate';ns.textContent=item.name||item.source;r.appendChild(ns);
        var ds=document.createElement('span');ds.className='text-xs text-slate-500';ds.textContent=item.duration?item.duration.secs+'s':'auto';r.appendChild(ds);
        var u=document.createElement('button');u.type='button';u.className='p-0.5 text-slate-500 hover:text-white';u.innerHTML=ICON.up;(function(idx){u.addEventListener('click',function(){movePlaylistItem(idx,-1);});})(i);r.appendChild(u);
        var d=document.createElement('button');d.type='button';d.className='p-0.5 text-slate-500 hover:text-white';d.innerHTML=ICON.down;(function(idx){d.addEventListener('click',function(){movePlaylistItem(idx,1);});})(i);r.appendChild(d);
        var x=document.createElement('button');x.type='button';x.className='p-0.5 text-slate-500 hover:text-red-400';x.innerHTML=ICON.close;(function(idx){x.addEventListener('click',function(){removePlaylistItem(idx);});})(i);r.appendChild(x);
        l.appendChild(r);
    });
}
async function deletePlaylist(id,name){if(!confirm('Delete playlist "'+name+'"?'))return;try{await api('/api/playlists/'+id,{method:'DELETE'});showToast('Playlist deleted','success');loadPlaylists();}catch(e){showToast('Failed: '+e.message,'error');}}

async function loadSchedules() {
    var ld=document.getElementById('schedules-loading'),ct=document.getElementById('schedules-content'),em=document.getElementById('schedules-empty'),tb=document.getElementById('schedules-table-body');
    ld.classList.remove('hidden');ct.classList.add('hidden');
    try {
        var r=await Promise.all([api('/api/schedules?per_page=100'),api('/api/boards?per_page=200'),api('/api/groups'),api('/api/playlists?per_page=200')]);
        schedules=r[0].data;boards=r[1].data;groups=r[2];playlists=r[3].data;
        ld.classList.add('hidden');ct.classList.remove('hidden');
        if(!schedules.length){em.classList.remove('hidden');tb.closest('table').classList.add('hidden');return;}
        em.classList.add('hidden');tb.closest('table').classList.remove('hidden');
        var bm={},gm={},pm={};boards.forEach(function(b){bm[b.id]=b.name;});groups.forEach(function(g){gm[g.id]=g.name;});playlists.forEach(function(p){pm[p.id]=p.name;});
        var dn=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        tb.textContent='';
        schedules.forEach(function(s){
            var tr=document.createElement('tr');tr.className='border-b border-slate-800/50';
            var tgt=s.board_id?'Board: '+(bm[s.board_id]||s.board_id):s.group_id?'Group: '+(gm[s.group_id]||s.group_id):'--';
            var mkTd=function(t,c){var d=document.createElement('td');d.className=c;d.textContent=t;return d;};
            tr.appendChild(mkTd(tgt,'py-3 pr-4 text-white'));tr.appendChild(mkTd(pm[s.playlist_id]||s.playlist_id,'py-3 pr-4 text-slate-300'));
            tr.appendChild(mkTd((s.start_time||'any')+' - '+(s.end_time||'any'),'py-3 pr-4 text-slate-400 font-mono text-xs'));
            var days=s.days_of_week?s.days_of_week.split(',').map(function(d){return dn[parseInt(d.trim())]||d;}).join(', '):'All';
            tr.appendChild(mkTd(days,'py-3 pr-4 text-slate-400 text-xs'));tr.appendChild(mkTd(s.priority,'py-3 pr-4 text-slate-400'));
            var ta=document.createElement('td');ta.className='py-3 text-right';var dl=iconBtn('del','p-1.5 text-slate-400 hover:text-red-400 transition-colors rounded hover:bg-slate-700','Delete');(function(id){dl.addEventListener('click',function(){deleteSchedule(id);});})(s.id);ta.appendChild(dl);tr.appendChild(ta);tb.appendChild(tr);
        });
    } catch(e){ld.classList.add('hidden');ct.classList.remove('hidden');showToast('Failed: '+e.message,'error');}
}
function showScheduleModal() {
    var bo=boards.map(function(b){return '<option value="'+escapeHtml(b.id)+'">'+escapeHtml(b.name)+'</option>';}).join('');
    var go=groups.map(function(g){return '<option value="'+escapeHtml(g.id)+'">'+escapeHtml(g.name)+'</option>';}).join('');
    var po=playlists.map(function(p){return '<option value="'+escapeHtml(p.id)+'">'+escapeHtml(p.name)+'</option>';}).join('');
    var da=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];var dc=da.map(function(n,i){return '<label class="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer"><input type="checkbox" name="day_'+i+'" value="'+i+'" checked class="rounded bg-slate-800 border-slate-600 text-blue-600"> '+n+'</label>';}).join('');
    var html='<form id="schedule-form" class="space-y-4">'+selectField('Target Type','target_type','<option value="board">Board</option><option value="group">Group</option>')+'<div id="schedule-target-board">'+selectField('Board','board_id','<option value="">Select board...</option>'+bo)+'</div><div id="schedule-target-group" class="hidden">'+selectField('Group','group_id','<option value="">Select group...</option>'+go)+'</div>'+selectField('Playlist','playlist_id','<option value="">Select playlist...</option>'+po,'','required')+'<div class="grid grid-cols-2 gap-4">'+field('Start Time','start_time','time','')+field('End Time','end_time','time','')+'</div><div><label class="block text-sm text-slate-400 mb-2">Days</label><div class="flex flex-wrap gap-3">'+dc+'</div></div>'+field('Priority','priority','number','0','min="0" max="100"')+'<div class="flex justify-end gap-3 pt-2"><button type="button" id="cancel-schedule-btn" class="'+btnCancel+'">Cancel</button><button type="submit" class="'+btnPrimary+'">Create Schedule</button></div></form>';
    showModal('New Schedule',html);
    document.getElementById('cancel-schedule-btn').addEventListener('click',closeModal);
    var ts=document.querySelector('#schedule-form select[name="target_type"]');if(ts)ts.addEventListener('change',function(){document.getElementById('schedule-target-board').classList.toggle('hidden',this.value!=='board');document.getElementById('schedule-target-group').classList.toggle('hidden',this.value!=='group');});
    document.getElementById('schedule-form').addEventListener('submit',async function(e){
        e.preventDefault();var fd=new FormData(e.target);var tt=fd.get('target_type');var days=[];for(var i=0;i<7;i++){if(fd.get('day_'+i))days.push(i);}
        var body={playlist_id:fd.get('playlist_id'),start_time:fd.get('start_time')||null,end_time:fd.get('end_time')||null,days_of_week:days.join(','),priority:parseInt(fd.get('priority'))||0};
        if(tt==='board')body.board_id=fd.get('board_id')||null;else body.group_id=fd.get('group_id')||null;
        try{await api('/api/schedules',{method:'POST',body:JSON.stringify(body)});showToast('Schedule created','success');closeModal();loadSchedules();}catch(e){showToast('Failed: '+e.message,'error');}
    });
}
async function deleteSchedule(id){if(!confirm('Delete this schedule?'))return;try{await api('/api/schedules/'+id,{method:'DELETE'});showToast('Schedule deleted','success');loadSchedules();}catch(e){showToast('Failed: '+e.message,'error');}}

async function loadAdvertisers() {
    var ld=document.getElementById('advertisers-loading'),ct=document.getElementById('advertisers-content'),em=document.getElementById('advertisers-empty'),tb=document.getElementById('advertisers-table-body');
    ld.classList.remove('hidden');ct.classList.add('hidden');
    try {
        var r=await api('/api/advertisers?per_page=100');advertisers=r.data;
        ld.classList.add('hidden');ct.classList.remove('hidden');
        if(!advertisers.length){em.classList.remove('hidden');tb.closest('table').classList.add('hidden');return;}
        em.classList.add('hidden');tb.closest('table').classList.remove('hidden');tb.textContent='';
        advertisers.forEach(function(a){
            var tr=document.createElement('tr');tr.className='border-b border-slate-800/50';
            var mkTd=function(t,c){var d=document.createElement('td');d.className=c;d.textContent=t;return d;};
            tr.appendChild(mkTd(a.name,'py-3 pr-4 font-medium text-white'));tr.appendChild(mkTd(a.contact_name||'--','py-3 pr-4 text-slate-400'));tr.appendChild(mkTd(a.contact_email||'--','py-3 pr-4 text-slate-400'));
            var ty=document.createElement('td');ty.className='py-3 pr-4';var bg=document.createElement('span');bg.className='badge '+(a.is_house?'badge-offline':'badge-online');bg.textContent=a.is_house?'House':'External';ty.appendChild(bg);tr.appendChild(ty);
            var ta=document.createElement('td');ta.className='py-3 text-right';var ad=document.createElement('div');ad.className='flex items-center justify-end gap-1';
            var eb=iconBtn('edit','p-1.5 text-slate-400 hover:text-blue-400 transition-colors rounded hover:bg-slate-700','Edit');(function(id){eb.addEventListener('click',function(){showAdvertiserModal(id);});})(a.id);
            var db=iconBtn('del','p-1.5 text-slate-400 hover:text-red-400 transition-colors rounded hover:bg-slate-700','Delete');(function(id,n){db.addEventListener('click',function(){deleteAdvertiser(id,n);});})(a.id,a.name);
            ad.appendChild(eb);ad.appendChild(db);ta.appendChild(ad);tr.appendChild(ta);tb.appendChild(tr);
        });
    } catch(e){ld.classList.add('hidden');ct.classList.remove('hidden');showToast('Failed: '+e.message,'error');}
}
function showAdvertiserModal(editId) {
    var ex=editId?advertisers.find(function(a){return a.id===editId;}):null;
    var html='<form id="advertiser-form" class="space-y-4">'+field('Company Name','name','text',ex?ex.name:'','required placeholder="e.g. Coca-Cola"')+field('Contact Name','contact_name','text',ex?ex.contact_name||'':'')+field('Contact Email','contact_email','email',ex?ex.contact_email||'':'')+field('Contact Phone','contact_phone','text',ex?ex.contact_phone||'':'')+'<div><label class="flex items-center gap-2 text-sm text-slate-400 cursor-pointer"><input type="checkbox" name="is_house" '+(ex&&ex.is_house?'checked':'')+' class="rounded bg-slate-800 border-slate-600 text-blue-600"> House advertiser (internal)</label></div><div><label class="block text-sm text-slate-400 mb-1">Notes</label><textarea name="notes" rows="2" class="'+inputCls+'">'+escapeHtml(ex?ex.notes||'':'')+'</textarea></div><div class="flex justify-end gap-3 pt-2"><button type="button" id="cancel-adv-btn" class="'+btnCancel+'">Cancel</button><button type="submit" class="'+btnPrimary+'">'+(ex?'Save':'Create')+'</button></div></form>';
    showModal(ex?'Edit Advertiser':'New Advertiser',html);
    document.getElementById('cancel-adv-btn').addEventListener('click',closeModal);
    document.getElementById('advertiser-form').addEventListener('submit',async function(e){
        e.preventDefault();var fd=new FormData(e.target);var body={name:fd.get('name'),contact_name:fd.get('contact_name')||null,contact_email:fd.get('contact_email')||null,contact_phone:fd.get('contact_phone')||null,is_house:!!fd.get('is_house'),notes:fd.get('notes')||null};
        try{if(ex){await api('/api/advertisers/'+ex.id,{method:'PUT',body:JSON.stringify(body)});showToast('Advertiser updated','success');}else{await api('/api/advertisers',{method:'POST',body:JSON.stringify(body)});showToast('Advertiser created','success');}closeModal();loadAdvertisers();}catch(e){showToast('Failed: '+e.message,'error');}
    });
}
async function deleteAdvertiser(id,name){if(!confirm('Delete advertiser "'+name+'"?'))return;try{await api('/api/advertisers/'+id,{method:'DELETE'});showToast('Advertiser deleted','success');loadAdvertisers();}catch(e){showToast('Failed: '+e.message,'error');}}

async function loadCampaigns() {
    var ld=document.getElementById('campaigns-loading'),ct=document.getElementById('campaigns-content'),em=document.getElementById('campaigns-empty'),tb=document.getElementById('campaigns-table-body');
    ld.classList.remove('hidden');ct.classList.add('hidden');
    try {
        var r=await Promise.all([api('/api/campaigns?per_page=100'),api('/api/advertisers?per_page=200')]);campaigns=r[0].data;advertisers=r[1].data;
        ld.classList.add('hidden');ct.classList.remove('hidden');
        if(!campaigns.length){em.classList.remove('hidden');tb.closest('table').classList.add('hidden');return;}
        em.classList.add('hidden');tb.closest('table').classList.remove('hidden');
        var am={};advertisers.forEach(function(a){am[a.id]=a.name;});tb.textContent='';
        campaigns.forEach(function(c){
            var tr=document.createElement('tr');tr.className='border-b border-slate-800/50';var mkTd=function(t,cl){var d=document.createElement('td');d.className=cl;d.textContent=t;return d;};
            tr.appendChild(mkTd(c.name,'py-3 pr-4 font-medium text-white'));tr.appendChild(mkTd(am[c.advertiser_id]||c.advertiser_id,'py-3 pr-4 text-slate-400'));
            var st=document.createElement('td');st.className='py-3 pr-4';var bg=document.createElement('span');bg.className='badge '+(c.status==='active'?'badge-online':c.status==='paused'?'bg-yellow-500/15 text-yellow-400':'badge-offline');bg.textContent=c.status;st.appendChild(bg);tr.appendChild(st);
            tr.appendChild(mkTd(formatDateShort(c.start_date)+' - '+formatDateShort(c.end_date),'py-3 pr-4 text-slate-400 text-xs'));
            var ta=document.createElement('td');ta.className='py-3 text-right';var ad=document.createElement('div');ad.className='flex items-center justify-end gap-1';
            if(c.status!=='active'){var ab=document.createElement('button');ab.className='cmd-btn bg-green-600/20 text-green-400 hover:bg-green-600/30';ab.textContent='Activate';(function(id){ab.addEventListener('click',function(){campaignAction(id,'activate');});})(c.id);ad.appendChild(ab);}
            if(c.status==='active'){var pb=document.createElement('button');pb.className='cmd-btn bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/30';pb.textContent='Pause';(function(id){pb.addEventListener('click',function(){campaignAction(id,'pause');});})(c.id);ad.appendChild(pb);}
            var eb=iconBtn('edit','p-1.5 text-slate-400 hover:text-blue-400 transition-colors rounded hover:bg-slate-700','Edit');(function(id){eb.addEventListener('click',function(){showCampaignModal(id);});})(c.id);
            var db=iconBtn('del','p-1.5 text-slate-400 hover:text-red-400 transition-colors rounded hover:bg-slate-700','Delete');(function(id,n){db.addEventListener('click',function(){deleteCampaign(id,n);});})(c.id,c.name);
            ad.appendChild(eb);ad.appendChild(db);ta.appendChild(ad);tr.appendChild(ta);tb.appendChild(tr);
        });
    } catch(e){ld.classList.add('hidden');ct.classList.remove('hidden');showToast('Failed: '+e.message,'error');}
}
async function campaignAction(id,action){try{await api('/api/campaigns/'+id+'/'+action,{method:'POST'});showToast('Campaign '+action+'d','success');loadCampaigns();}catch(e){showToast('Failed: '+e.message,'error');}}
function showCampaignModal(editId) {
    var ex=editId?campaigns.find(function(c){return c.id===editId;}):null;
    var ao='<option value="">Select advertiser...</option>'+advertisers.map(function(a){return '<option value="'+escapeHtml(a.id)+'"'+(ex&&ex.advertiser_id===a.id?' selected':'')+'>'+escapeHtml(a.name)+'</option>';}).join('');
    var html='<form id="campaign-form" class="space-y-4">'+field('Campaign Name','name','text',ex?ex.name:'','required')+selectField('Advertiser','advertiser_id',ao,'','required')+'<div class="grid grid-cols-2 gap-4">'+field('Start Date','start_date','date',ex?ex.start_date:'','required')+field('End Date','end_date','date',ex?ex.end_date:'','required')+'</div><div><label class="block text-sm text-slate-400 mb-1">Notes</label><textarea name="notes" rows="2" class="'+inputCls+'">'+escapeHtml(ex?ex.notes||'':'')+'</textarea></div><div class="flex justify-end gap-3 pt-2"><button type="button" id="cancel-camp-btn" class="'+btnCancel+'">Cancel</button><button type="submit" class="'+btnPrimary+'">'+(ex?'Save':'Create')+'</button></div></form>';
    showModal(ex?'Edit Campaign':'New Campaign',html);
    document.getElementById('cancel-camp-btn').addEventListener('click',closeModal);
    document.getElementById('campaign-form').addEventListener('submit',async function(e){
        e.preventDefault();var fd=new FormData(e.target);var body={name:fd.get('name'),advertiser_id:fd.get('advertiser_id'),start_date:fd.get('start_date'),end_date:fd.get('end_date'),notes:fd.get('notes')||null};
        try{if(ex){await api('/api/campaigns/'+ex.id,{method:'PUT',body:JSON.stringify(body)});showToast('Campaign updated','success');}else{await api('/api/campaigns',{method:'POST',body:JSON.stringify(body)});showToast('Campaign created','success');}closeModal();loadCampaigns();}catch(e){showToast('Failed: '+e.message,'error');}
    });
}
async function deleteCampaign(id,name){if(!confirm('Delete campaign "'+name+'"?'))return;try{await api('/api/campaigns/'+id,{method:'DELETE'});showToast('Campaign deleted','success');loadCampaigns();}catch(e){showToast('Failed: '+e.message,'error');}}

async function loadBookings() {
    var ld=document.getElementById('bookings-loading'),ct=document.getElementById('bookings-content'),em=document.getElementById('bookings-empty'),tb=document.getElementById('bookings-table-body');
    ld.classList.remove('hidden');ct.classList.add('hidden');
    try {
        var r=await Promise.all([api('/api/bookings?per_page=100'),api('/api/campaigns?per_page=200'),api('/api/boards?per_page=200'),api('/api/zones')]);
        bookings=r[0].data;campaigns=r[1].data;boards=r[2].data;zones=r[3];
        ld.classList.add('hidden');ct.classList.remove('hidden');
        if(!bookings.length){em.classList.remove('hidden');tb.closest('table').classList.add('hidden');return;}
        em.classList.add('hidden');tb.closest('table').classList.remove('hidden');
        var cm={},bm={},zm={};campaigns.forEach(function(c){cm[c.id]=c.name;});boards.forEach(function(b){bm[b.id]=b.name;});zones.forEach(function(z){zm[z.id]=z.name;});
        tb.textContent='';
        bookings.forEach(function(bk){
            var tr=document.createElement('tr');tr.className='border-b border-slate-800/50';var mkTd=function(t,c){var d=document.createElement('td');d.className=c;d.textContent=t;return d;};
            tr.appendChild(mkTd(cm[bk.campaign_id]||bk.campaign_id,'py-3 pr-4 font-medium text-white'));
            tr.appendChild(mkTd(bk.booking_type,'py-3 pr-4 text-slate-400'));
            var tn=bk.target_type==='board'?(bm[bk.target_id]||bk.target_id):bk.target_type==='zone'?(zm[bk.target_id]||bk.target_id):bk.target_id;
            tr.appendChild(mkTd(bk.target_type+': '+tn,'py-3 pr-4 text-slate-400'));
            tr.appendChild(mkTd(formatDateShort(bk.start_date)+' - '+formatDateShort(bk.end_date),'py-3 pr-4 text-slate-400 text-xs'));
            var st=document.createElement('td');st.className='py-3 pr-4';var bg=document.createElement('span');bg.className='badge '+(bk.status==='confirmed'?'badge-online':bk.status==='pending'?'bg-yellow-500/15 text-yellow-400':'badge-offline');bg.textContent=bk.status;st.appendChild(bg);tr.appendChild(st);
            var ta=document.createElement('td');ta.className='py-3 text-right';var ad=document.createElement('div');ad.className='flex items-center justify-end gap-1';
            var eb=iconBtn('edit','p-1.5 text-slate-400 hover:text-blue-400 transition-colors rounded hover:bg-slate-700','Edit');(function(id){eb.addEventListener('click',function(){showBookingModal(id);});})(bk.id);
            var db=iconBtn('del','p-1.5 text-slate-400 hover:text-red-400 transition-colors rounded hover:bg-slate-700','Delete');(function(id){db.addEventListener('click',function(){deleteBooking(id);});})(bk.id);
            ad.appendChild(eb);ad.appendChild(db);ta.appendChild(ad);tr.appendChild(ta);tb.appendChild(tr);
        });
    } catch(e){ld.classList.add('hidden');ct.classList.remove('hidden');showToast('Failed: '+e.message,'error');}
}
function showBookingModal(editId) {
    var ex=editId?bookings.find(function(b){return b.id===editId;}):null;
    var co='<option value="">Select campaign...</option>'+campaigns.map(function(c){return '<option value="'+escapeHtml(c.id)+'"'+(ex&&ex.campaign_id===c.id?' selected':'')+'>'+escapeHtml(c.name)+'</option>';}).join('');
    var tto=['board','zone'].map(function(t){return '<option value="'+t+'"'+(ex&&ex.target_type===t?' selected':'')+'>'+t+'</option>';}).join('');
    var bo=boards.map(function(b){return '<option value="'+escapeHtml(b.id)+'"'+(ex&&ex.target_id===b.id?' selected':'')+'>'+escapeHtml(b.name)+'</option>';}).join('');
    var zo=zones.map(function(z){return '<option value="'+escapeHtml(z.id)+'"'+(ex&&ex.target_id===z.id?' selected':'')+'>'+escapeHtml(z.name)+'</option>';}).join('');
    var so=['pending','confirmed','cancelled','completed'].map(function(s){return '<option value="'+s+'"'+(ex&&ex.status===s?' selected':'')+'>'+s+'</option>';}).join('');
    var bto=['guaranteed','preemptible','filler'].map(function(t){return '<option value="'+t+'"'+(ex&&ex.booking_type===t?' selected':'')+'>'+t+'</option>';}).join('');
    var da=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];var ed=ex&&ex.days_of_week?ex.days_of_week.split(',').map(function(d){return d.trim();}):['0','1','2','3','4','5','6'];
    var dc=da.map(function(n,i){return '<label class="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer"><input type="checkbox" name="day_'+i+'" value="'+i+'"'+(ed.indexOf(String(i))>=0?' checked':'')+' class="rounded bg-slate-800 border-slate-600 text-blue-600"> '+n+'</label>';}).join('');
    var html='<form id="booking-form" class="space-y-4">'+selectField('Campaign','campaign_id',co,'','required')+selectField('Booking Type','booking_type',bto)+selectField('Target Type','target_type',tto)+'<div id="booking-target-board">'+selectField('Board','target_board','<option value="">Select...</option>'+bo)+'</div><div id="booking-target-zone" class="hidden">'+selectField('Zone','target_zone','<option value="">Select...</option>'+zo)+'</div><div class="grid grid-cols-2 gap-4">'+field('Start Date','start_date','date',ex?ex.start_date:'','required')+field('End Date','end_date','date',ex?ex.end_date:'','required')+'</div><div class="grid grid-cols-2 gap-4">'+field('Start Time','start_time','time',ex?ex.start_time||'':'')+field('End Time','end_time','time',ex?ex.end_time||':'':'')+'</div><div><label class="block text-sm text-slate-400 mb-2">Days</label><div class="flex flex-wrap gap-3">'+dc+'</div></div><div class="grid grid-cols-3 gap-4">'+field('Slot Duration (s)','slot_duration_secs','number',ex?ex.slot_duration_secs:'15','min="1"')+field('Slots/Loop','slots_per_loop','number',ex?ex.slots_per_loop:'1','min="1"')+field('Priority','priority','number',ex?ex.priority:'0','min="0"')+'</div>'+selectField('Status','status',so)+'<div class="flex justify-end gap-3 pt-2"><button type="button" id="cancel-bk-btn" class="'+btnCancel+'">Cancel</button><button type="submit" class="'+btnPrimary+'">'+(ex?'Save':'Create')+'</button></div></form>';
    showModal(ex?'Edit Booking':'New Booking',html);
    document.getElementById('cancel-bk-btn').addEventListener('click',closeModal);
    var ts=document.querySelector('#booking-form select[name="target_type"]');
    function ut(){document.getElementById('booking-target-board').classList.toggle('hidden',ts.value!=='board');document.getElementById('booking-target-zone').classList.toggle('hidden',ts.value!=='zone');}
    ts.addEventListener('change',ut);if(ex&&ex.target_type==='zone')ut();
    document.getElementById('booking-form').addEventListener('submit',async function(e){
        e.preventDefault();var fd=new FormData(e.target);var tt=fd.get('target_type');var days=[];for(var i=0;i<7;i++){if(fd.get('day_'+i))days.push(i);}
        var body={campaign_id:fd.get('campaign_id'),booking_type:fd.get('booking_type'),target_type:tt,target_id:tt==='board'?fd.get('target_board'):fd.get('target_zone'),start_date:fd.get('start_date'),end_date:fd.get('end_date'),start_time:fd.get('start_time')||null,end_time:fd.get('end_time')||null,days_of_week:days.join(','),slot_duration_secs:parseInt(fd.get('slot_duration_secs'))||15,slots_per_loop:parseInt(fd.get('slots_per_loop'))||1,priority:parseInt(fd.get('priority'))||0,status:fd.get('status')};
        try{if(ex){await api('/api/bookings/'+ex.id,{method:'PUT',body:JSON.stringify(body)});showToast('Booking updated','success');}else{await api('/api/bookings',{method:'POST',body:JSON.stringify(body)});showToast('Booking created','success');}closeModal();loadBookings();}catch(e){showToast('Failed: '+e.message,'error');}
    });
}
async function deleteBooking(id){if(!confirm('Delete this booking?'))return;try{await api('/api/bookings/'+id,{method:'DELETE'});showToast('Booking deleted','success');loadBookings();}catch(e){showToast('Failed: '+e.message,'error');}}

var playlogsPage=1;
async function loadPlayLogs(page) {
    page=page||1;playlogsPage=page;
    var ld=document.getElementById('playlogs-loading'),ct=document.getElementById('playlogs-content'),em=document.getElementById('playlogs-empty'),tb=document.getElementById('playlogs-table-body');
    ld.classList.remove('hidden');ct.classList.add('hidden');
    var sd=document.getElementById('playlogs-start-date').value,ed=document.getElementById('playlogs-end-date').value;
    var p='?page='+page+'&per_page=50';if(sd)p+='&start_date='+sd;if(ed)p+='&end_date='+ed;
    var sp='';if(sd)sp+=(sp?'&':'?')+'start_date='+sd;if(ed)sp+=(sp?'&':'?')+'end_date='+ed;
    try {
        var r=await Promise.all([api('/api/play-logs'+p),api('/api/play-logs/summary'+sp),api('/api/boards?per_page=200')]);
        var logs=r[0].data,total=r[0].total,summary=r[1];boards=r[2].data;
        ld.classList.add('hidden');ct.classList.remove('hidden');
        var sd2=document.getElementById('playlogs-summary');var tp=0,td=0,bs={};
        if(Array.isArray(summary)){summary.forEach(function(s){tp+=s.play_count;td+=s.total_duration_secs;bs[s.board_id]=true;});}
        sd2.textContent='';
        [{l:'Total Plays',v:tp},{l:'Total Duration',v:Math.round(td/60)+' min'},{l:'Active Boards',v:Object.keys(bs).length}].forEach(function(c){
            var card=document.createElement('div');card.className='bg-slate-800/60 border border-slate-700/50 rounded-lg p-4';
            var lb=document.createElement('p');lb.className='text-xs text-slate-500 uppercase tracking-wider';lb.textContent=c.l;
            var vl=document.createElement('p');vl.className='text-2xl font-bold text-white mt-1';vl.textContent=c.v;
            card.appendChild(lb);card.appendChild(vl);sd2.appendChild(card);
        });
        if(!logs.length){em.classList.remove('hidden');tb.closest('table').classList.add('hidden');document.getElementById('playlogs-pagination').textContent='';return;}
        em.classList.add('hidden');tb.closest('table').classList.remove('hidden');
        var bm={};boards.forEach(function(b){bm[b.id]=b.name;});tb.textContent='';
        logs.forEach(function(l){
            var tr=document.createElement('tr');tr.className='border-b border-slate-800/50';var mkTd=function(t,c){var d=document.createElement('td');d.className=c;d.textContent=t;return d;};
            tr.appendChild(mkTd(bm[l.board_id]||l.board_id,'py-3 pr-4 text-white'));
            tr.appendChild(mkTd(l.booking_id||'--','py-3 pr-4 text-slate-400 font-mono text-xs'));
            tr.appendChild(mkTd(formatDate(l.started_at),'py-3 pr-4 text-slate-400'));
            tr.appendChild(mkTd(l.duration_secs!=null?l.duration_secs+'s':'--','py-3 pr-4 text-slate-400'));
            var st=document.createElement('td');st.className='py-3 pr-4';var bg=document.createElement('span');bg.className='badge '+(l.status==='completed'?'badge-online':'badge-offline');bg.textContent=l.status;st.appendChild(bg);tr.appendChild(st);
            tb.appendChild(tr);
        });
        renderPagination('playlogs-pagination',total,page,50,loadPlayLogs);
    } catch(e){ld.classList.add('hidden');ct.classList.remove('hidden');showToast('Failed: '+e.message,'error');}
}

document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    checkAuth();
});
