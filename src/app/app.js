import Fuse from './assets/fuse.mjs';

// ─── 身分驗證 ───────────────────────────────────────────────
const AUTH = {
  CREATOR: {
    hash: '7858b5c12a547409fd80f4920ca09f59a2ebe87d64e6f55e1237311499eed094',
    label: '至高無上的造物主本人',
    key: 'vb_creator_session',
    remember: true,
  },
  WORM: {
    hash: 'f747870ae666c39b589f577856a0f7198b3b81269cb0326de86d8046f2cf72db',
    label: '我是一隻小淫蟲',
    key: 'vb_worm_session',
    remember: false,
  },
  SESSION_DURATION: 10 * 60 * 1000,
};

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function saveSession(role) {
  const payload = JSON.stringify({ role, ts: Date.now() });
  if (role === 'CREATOR') localStorage.setItem(AUTH.CREATOR.key, payload);
  else sessionStorage.setItem(AUTH.WORM.key, payload);
}

function loadSession() {
  try {
    const raw = localStorage.getItem(AUTH.CREATOR.key);
    if (raw) {
      const { role, ts } = JSON.parse(raw);
      if (Date.now() - ts < AUTH.SESSION_DURATION) return role;
      localStorage.removeItem(AUTH.CREATOR.key);
    }
  } catch {}
  try {
    const raw = sessionStorage.getItem(AUTH.WORM.key);
    if (raw) {
      const { role, ts } = JSON.parse(raw);
      if (Date.now() - ts < AUTH.SESSION_DURATION) return role;
      sessionStorage.removeItem(AUTH.WORM.key);
    }
  } catch {}
  return null;
}

function clearSession() {
  localStorage.removeItem(AUTH.CREATOR.key);
  sessionStorage.removeItem(AUTH.WORM.key);
}

function keepSessionAlive() {
  setInterval(() => { const r = loadSession(); if (r) saveSession(r); }, 60 * 1000);
}

function showLoginScreen() {
  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.id = 'loginBackdrop';
    backdrop.innerHTML = `
      <div class="login-box">
        <div class="login-title">⚡ 請選擇您的身分</div>
        <div class="login-roles">
          <label class="role-option">
            <input type="radio" name="role" value="CREATOR" />
            <span>👑 至高無上的造物主本人</span>
          </label>
          <label class="role-option">
            <input type="radio" name="role" value="WORM" checked />
            <span>🐛 我是一隻小淫蟲</span>
          </label>
        </div>
        <div class="login-pw-wrap">
          <input id="loginPw" type="password" placeholder="請輸入密碼..." autocomplete="off" />
        </div>
        <div id="loginError" class="login-error"></div>
        <button id="loginBtn" class="login-btn">進入</button>
      </div>
    `;
    document.body.appendChild(backdrop);
    const pwInput = backdrop.querySelector('#loginPw');
    const errEl = backdrop.querySelector('#loginError');
    const btn = backdrop.querySelector('#loginBtn');
    async function attempt() {
      const role = backdrop.querySelector('input[name="role"]:checked')?.value;
      const pw = pwInput.value;
      if (!pw) { errEl.textContent = '請輸入密碼'; return; }
      const hashed = await sha256(pw);
      const expected = role === 'CREATOR' ? AUTH.CREATOR.hash : AUTH.WORM.hash;
      if (hashed === expected) {
        saveSession(role);
        backdrop.remove();
        resolve(role);
      } else {
        errEl.textContent = '密碼錯誤，請再試一次';
        pwInput.value = '';
        pwInput.focus();
      }
    }
    btn.addEventListener('click', attempt);
    pwInput.addEventListener('keydown', e => { if (e.key === 'Enter') attempt(); });
  });
}

// ─── 主狀態 ─────────────────────────────────────────────────
const state = {
  items: [], filtered: [],
  role: null,
  previewSpeed: Number(localStorage.getItem('previewSpeed') || 13),
  recent: JSON.parse(localStorage.getItem('recentViews') || '[]'),
  favorites: JSON.parse(localStorage.getItem('favorites') || '[]'),
  collections: JSON.parse(localStorage.getItem('collections') || '[]'),
};

function isCreator() { return state.role === 'CREATOR'; }

function saveCollections() {
  localStorage.setItem('collections', JSON.stringify(state.collections));
}

// ─── 標題清理 ────────────────────────────────────────────────
function cleanTitle(raw) {
  if (!raw) return raw;
  // 有單引號/書名號包住的內容 → 只保留引號內文字
  const quoted = raw.match(/['''「」『』](.+?)['''「」『』]/);
  if (quoted) return quoted[1].trim();
  // 移除禁漫常見前後綴
  let t = raw
    .replace(/^PHOTOS\s*[-–]\s*Search Results For\s*/i, '')
    .replace(/\s*[-–]\s*禁漫天堂\s*$/i, '')
    .replace(/^Search Results For\s*/i, '')
    .trim();
  return t || raw;
}

// ─── Toast ───────────────────────────────────────────────────
function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'vb-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2500);
}

// ─── 全域事件 ────────────────────────────────────────────────
window.trackView = (id) => {
  state.recent = [id, ...state.recent.filter(x => x !== id)].slice(0, 20);
  localStorage.setItem('recentViews', JSON.stringify(state.recent));
};

window.toggleFav = (e, id) => {
  e.preventDefault();
  e.stopPropagation();
  if (!isCreator()) { showToast('此功能僅限造物主使用'); return; }
  if (state.favorites.includes(id)) state.favorites = state.favorites.filter(x => x !== id);
  else state.favorites.push(id);
  localStorage.setItem('favorites', JSON.stringify(state.favorites));
  e.target.classList.toggle('active');
};

window.openColPicker = (e, id) => {
  e.preventDefault();
  e.stopPropagation();
  if (!isCreator()) { showToast('此功能僅限造物主使用'); return; }
  showColPicker(e.currentTarget, id);
};

// ─── 收藏夾 Picker ───────────────────────────────────────────
function showColPicker(anchor, itemId) {
  document.querySelector('.col-picker')?.remove();

  const picker = document.createElement('div');
  picker.className = 'col-picker';

  function renderPickerHTML() {
    const rows = state.collections.length
      ? state.collections.map(col => {
          const inCol = col.items.includes(itemId);
          return `<div class="col-row ${inCol ? 'in-col' : ''}" data-col-id="${col.id}">
            <span>${col.name}</span>
            <span class="col-badge">${inCol ? '✓' : '+'}</span>
          </div>`;
        }).join('')
      : `<div class="col-empty">尚無收藏夾，請先新增</div>`;
    return `
      <div class="col-picker-inner">
        <div class="col-picker-head">
          <span>加入收藏夾</span>
          <button class="col-picker-close">✕</button>
        </div>
        <div class="col-rows">${rows}</div>
        <div class="col-picker-foot">
          <input class="col-name-input" placeholder="新收藏夾名稱..." />
          <button class="col-add-btn">新增</button>
        </div>
      </div>`;
  }

  function rebind() {
    picker.innerHTML = renderPickerHTML();

    picker.querySelector('.col-picker-close').addEventListener('click', () => picker.remove());

    picker.querySelector('.col-rows').addEventListener('click', e => {
      const row = e.target.closest('.col-row');
      if (!row) return;
      const col = state.collections.find(c => c.id === row.dataset.colId);
      if (!col) return;
      if (col.items.includes(itemId)) {
        col.items = col.items.filter(x => x !== itemId);
        showToast(`已從「${col.name}」移除`);
      } else {
        col.items.push(itemId);
        showToast(`已加入「${col.name}」`);
      }
      saveCollections();
      updateSidebarCollections();
      rebind();
    });

    picker.querySelector('.col-add-btn').addEventListener('click', () => {
      const input = picker.querySelector('.col-name-input');
      const name = input.value.trim();
      if (!name) { showToast('請輸入收藏夾名稱'); return; }
      state.collections.push({ id: `col_${Date.now()}`, name, items: [itemId] });
      saveCollections();
      showToast(`已建立「${name}」並加入`);
      updateSidebarCollections();
      rebind();
    });

    picker.querySelector('.col-name-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') picker.querySelector('.col-add-btn').click();
    });
  }

  rebind();
  document.body.appendChild(picker);

  // 定位在按鈕下方
  const rect = anchor.getBoundingClientRect();
  picker.style.top = `${rect.bottom + 6 + window.scrollY}px`;
  picker.style.left = `${Math.min(rect.left, window.innerWidth - 240)}px`;

  // 點外面關閉
  setTimeout(() => {
    document.addEventListener('click', function outside(ev) {
      if (!picker.contains(ev.target)) {
        picker.remove();
        document.removeEventListener('click', outside);
      }
    });
  }, 0);
}

// ─── 資料載入 ───────────────────────────────────────────────
async function loadAllItems() {
  const manifest = await (await fetch('./data/build-manifest.json')).json();
  const results = [];
  for (let i = 1; i <= manifest.shardCount; i++) {
    const res = await fetch(`./data/shards/items-${i}.json`);
    if (res.ok) results.push(...await res.json());
  }
  return results;
}

// ─── 卡片渲染 ───────────────────────────────────────────────
function createCard(item) {
  const isFav = state.favorites.includes(item.id) ? 'active' : '';
  const isScreenshot = item.coverImage.includes('/screenshots/');
  const displayTitle = cleanTitle(item.title);

  return `
    <a class="card" href="${item.finalUrl}" target="_blank" onclick="trackView('${item.id}')" style="--preview-duration:${state.previewSpeed}s; --preview-shift:-22%;">
      <button class="btn-fav ${isFav}" onclick="toggleFav(event, '${item.id}')">❤</button>
      <button class="btn-collect" onclick="openColPicker(event, '${item.id}')">＋</button>
      <div class="card-cover-wrap">
        <img class="card-cover${isScreenshot ? ' screenshot-cover' : ''}"
             src="${item.coverImage}"
             loading="lazy"
             ${isScreenshot ? 'data-crop="380"' : ''} />
        <div class="card-overlay"></div>
      </div>
      <div class="card-body">
        <h3 class="title">${displayTitle}</h3>
        <div class="meta">${item.domain}</div>
      </div>
    </a>
  `;
}

function applyCropOffsets() {
  document.querySelectorAll('img.screenshot-cover[data-crop]').forEach(img => {
    const cropPx = parseInt(img.dataset.crop);
    const originalWidth = 1280;
    const apply = () => {
      const w = img.offsetWidth;
      if (!w) return;
      img.style.marginTop = `-${cropPx * (w / originalWidth)}px`;
    };
    if (img.complete && img.naturalWidth) apply();
    else img.addEventListener('load', apply, { once: true });
  });
}

function render(items) {
  const root = document.querySelector('#grid');
  root.innerHTML = items.slice(0, 20).map(createCard).join('');
  setTimeout(applyCropOffsets, 50);
  if (items.length > 20) {
    setTimeout(() => {
      root.insertAdjacentHTML('beforeend', items.slice(20).map(createCard).join(''));
      applyCropOffsets();
    }, 80);
  }
}

// ─── 側欄收藏夾同步 ─────────────────────────────────────────
function updateSidebarCollections() {
  const list = document.querySelector('#folderList');
  if (!list) return;
  list.querySelectorAll('li[data-type="collection"]').forEach(el => el.remove());

  state.collections.forEach(col => {
    const li = document.createElement('li');
    li.dataset.type = 'collection';
    li.dataset.colId = col.id;
    li.style.cursor = 'pointer';
    li.innerHTML = `
      <span class="col-li-name">📁 ${col.name}</span>
      <span class="col-count">${col.items.length}</span>
      ${isCreator() ? `<button class="btn-del-col" title="刪除收藏夾">✕</button>` : ''}
    `;
    li.addEventListener('click', e => {
      if (e.target.classList.contains('btn-del-col')) return;
      document.querySelectorAll('#folderList li, #actionList li').forEach(el => el.classList.remove('active'));
      li.classList.add('active');
      const colItems = col.items.map(id => state.items.find(i => i.id === id)).filter(Boolean);
      render(colItems);
    });
    if (isCreator()) {
      li.querySelector('.btn-del-col')?.addEventListener('click', e => {
        e.stopPropagation();
        if (!confirm(`確定要刪除收藏夾「${col.name}」嗎？`)) return;
        state.collections = state.collections.filter(c => c.id !== col.id);
        saveCollections();
        updateSidebarCollections();
        showToast(`已刪除「${col.name}」`);
      });
    }
    list.appendChild(li);
  });
}

// ─── 側欄初始化 ─────────────────────────────────────────────
function initSidebar(items) {
  const folders = [...new Set(items.map(i => i.folderPath[0]).filter(Boolean))];
  const folderHtml = `<li class="active" data-folder="all">全部</li>` +
    folders.map(f => `<li data-folder="${f}">${f}</li>`).join('');
  document.querySelector('#folderList').innerHTML = folderHtml;

  document.querySelector('#folderList').addEventListener('click', e => {
    const li = e.target.closest('li[data-folder]');
    if (!li) return;
    document.querySelectorAll('#folderList li, #actionList li').forEach(el => el.classList.remove('active'));
    li.classList.add('active');
    const folder = li.dataset.folder;
    state.filtered = folder === 'all' ? items : items.filter(i => i.folderPath[0] === folder);
    render(state.filtered);
  });

  document.querySelector('#actionList').addEventListener('click', e => {
    if (e.target.tagName !== 'LI') return;
    document.querySelectorAll('#folderList li, #actionList li').forEach(el => el.classList.remove('active'));
    e.target.classList.add('active');
    const action = e.target.dataset.action;
    if (action === 'recent') {
      render(state.recent.map(id => items.find(i => i.id === id)).filter(Boolean));
    } else if (action === 'favorite') {
      if (!isCreator()) { showToast('此功能僅限造物主使用'); return; }
      render(state.favorites.map(id => items.find(i => i.id === id)).filter(Boolean));
    } else if (action === 'random') {
      render([...items].sort(() => 0.5 - Math.random()).slice(0, 5));
    }
  });

  // 新增收藏夾
  document.querySelector('#btnAddCollection').addEventListener('click', () => {
    if (!isCreator()) { showToast('此功能僅限造物主使用'); return; }
    const name = prompt('請輸入新收藏夾名稱：');
    if (!name?.trim()) return;
    state.collections.push({ id: `col_${Date.now()}`, name: name.trim(), items: [] });
    saveCollections();
    updateSidebarCollections();
    showToast(`已建立收藏夾「${name.trim()}」`);
  });

  updateSidebarCollections();

  // 造物主登出按鈕
  if (isCreator()) {
    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'btn-logout';
    logoutBtn.textContent = '登出';
    logoutBtn.addEventListener('click', () => { clearSession(); location.reload(); });
    document.querySelector('.sidebar').appendChild(logoutBtn);
  }

  // 角色標示
  const roleTag = document.createElement('div');
  roleTag.className = 'role-tag';
  roleTag.textContent = isCreator() ? '👑 造物主' : '🐛 小淫蟲';
  document.querySelector('.toolbar').prepend(roleTag);
}

// ─── 速度滑桿 ────────────────────────────────────────────────
function wireSpeedSlider() {
  const slider = document.querySelector('#previewSpeed');
  if (!slider) return;
  slider.min = 10;
  slider.max = 16;
  slider.step = 1;
  slider.value = state.previewSpeed;
  slider.addEventListener('input', e => {
    state.previewSpeed = Number(e.target.value);
    localStorage.setItem('previewSpeed', state.previewSpeed);
    document.querySelectorAll('.card').forEach(card => {
      card.style.setProperty('--preview-duration', `${state.previewSpeed}s`);
    });
  });
}

// ─── 搜尋 ────────────────────────────────────────────────────
function wireSearch(items) {
  const fuse = new Fuse(items, { keys: ['title', 'domain'], threshold: 0.35 });
  document.querySelector('#searchInput').addEventListener('input', e => {
    const val = e.target.value.trim();
    render(val ? fuse.search(val).map(r => r.item) : items);
  });
}

// ─── 入口 ────────────────────────────────────────────────────
async function main() {
  state.role = loadSession();
  if (!state.role) state.role = await showLoginScreen();
  keepSessionAlive();
  state.items = await loadAllItems();
  state.filtered = state.items;
  initSidebar(state.items);
  render(state.items);
  wireSearch(state.items);
  wireSpeedSlider();
}

main();