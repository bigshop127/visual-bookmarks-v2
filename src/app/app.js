import Fuse from './assets/fuse.mjs';

const state = {
  items: [], filtered: [],
  previewSpeed: Number(localStorage.getItem('previewSpeed') || 22),
  recent: JSON.parse(localStorage.getItem('recentViews') || '[]'),
  favorites: JSON.parse(localStorage.getItem('favorites') || '[]'),
};

window.trackView = (id) => {
  state.recent = [id, ...state.recent.filter(x => x !== id)].slice(0, 20);
  localStorage.setItem('recentViews', JSON.stringify(state.recent));
};

window.toggleFav = (e, id) => {
  e.preventDefault();
  if (state.favorites.includes(id)) state.favorites = state.favorites.filter(x => x !== id);
  else state.favorites.push(id);
  localStorage.setItem('favorites', JSON.stringify(state.favorites));
  e.target.classList.toggle('active');
};

async function loadAllItems() {
  const manifest = await (await fetch('./data/build-manifest.json')).json();
  const results = [];
  for (let i = 1; i <= manifest.shardCount; i++) {
    const res = await fetch(`./data/shards/items-${i}.json`);
    if (res.ok) results.push(...await res.json());
  }
  return results;
}

function createCard(item) {
  const isFav = state.favorites.includes(item.id) ? 'active' : '';
  const coverClass = item.coverImage.includes('/screenshots/') ? 'card-cover long' : 'card-cover';
  return `
    <a class="card" href="${item.finalUrl}" target="_blank" onclick="trackView('${item.id}')" style="--preview-duration:${state.previewSpeed}s; --preview-shift:-22%;">
      <button class="btn-fav ${isFav}" onclick="toggleFav(event, '${item.id}')">❤</button>
      <div class="card-cover-wrap">
        <img class="${coverClass}" src="${item.coverImage}" loading="lazy" />
        <div class="card-overlay"></div>
      </div>
      <div class="card-body">
        <h3 class="title">${item.title}</h3>
        <div class="meta">${item.domain}</div>
      </div>
    </a>
  `;
}

function render(items) {
  const root = document.querySelector('#grid');
  root.innerHTML = items.slice(0, 20).map(createCard).join('');
  if (items.length > 20) setTimeout(() => root.insertAdjacentHTML('beforeend', items.slice(20).map(createCard).join('')), 50);
}

function initSidebar(items) {
  // 左側資料夾
  const folders = [...new Set(items.map(i => i.folderPath[0]).filter(Boolean))];
  const folderHtml = `<li class="active" data-folder="all">全部</li>` + 
    folders.map(f => `<li data-folder="${f}">${f}</li>`).join('');
  document.querySelector('#folderList').innerHTML = folderHtml;

  document.querySelector('#folderList').addEventListener('click', e => {
    if(e.target.tagName !== 'LI') return;
    document.querySelectorAll('#folderList li, #actionList li').forEach(el => el.classList.remove('active'));
    e.target.classList.add('active');
    const folder = e.target.dataset.folder;
    state.filtered = folder === 'all' ? items : items.filter(i => i.folderPath[0] === folder);
    render(state.filtered);
  });

  // 右側功能
  document.querySelector('#actionList').addEventListener('click', e => {
    if(e.target.tagName !== 'LI') return;
    document.querySelectorAll('#folderList li, #actionList li').forEach(el => el.classList.remove('active'));
    e.target.classList.add('active');
    
    const action = e.target.dataset.action;
    if (action === 'recent') {
      const recentItems = state.recent.map(id => items.find(i => i.id === id)).filter(Boolean);
      render(recentItems);
    } else if (action === 'favorite') {
      const favItems = state.favorites.map(id => items.find(i => i.id === id)).filter(Boolean);
      render(favItems);
    } else if (action === 'random') {
      const randomItems = [...items].sort(() => 0.5 - Math.random()).slice(0, 5);
      render(randomItems);
    }
  });
}

function wireSearch(items) {
  const fuse = new Fuse(items, { keys: ['title', 'domain'], threshold: 0.35 });
  document.querySelector('#searchInput').addEventListener('input', e => {
    const val = e.target.value.trim();
    render(val ? fuse.search(val).map(r => r.item) : items);
  });
}

async function main() {
  state.items = await loadAllItems();
  state.filtered = state.items;
  initSidebar(state.items);
  render(state.items);
  wireSearch(state.items);
}
main();