import Fuse from './assets/fuse.mjs';

const state = {
  items: [],
  filtered: [],
  previewSpeed: Number(localStorage.getItem('previewSpeed') || 22)
};

async function loadAllItems() {
  const manifestRes = await fetch('./data/build-manifest.json');
  const manifest = await manifestRes.json();
  const shardCount = manifest.shardCount || 0;

  const results = [];
  for (let i = 1; i <= shardCount; i++) {
    const res = await fetch(`./data/shards/items-${i}.json`);
    if (res.ok) results.push(...await res.json());
  }
  return results;
}

function createCard(item) {
  const coverClass = item.coverImage.includes('/screenshots/') ? 'card-cover long' : 'card-cover';
  const badgeHtml = [item.sourceType, item.manualOverride ? 'Manual' : '', item.quarantine ? 'Quarantine' : '']
    .filter(Boolean)
    .map((value) => `<span class="badge">${value}</span>`)
    .join('');

  return `
    <a class="card" href="${item.finalUrl}" target="_blank" rel="noreferrer" style="--preview-duration:${state.previewSpeed}s; --preview-shift:-22%;">
      <div class="card-cover-wrap">
        <img class="${coverClass}" src="${item.coverImage}" alt="${item.title}" loading="lazy" />
        <div class="card-overlay"></div>
      </div>
      <div class="card-body">
        <div class="badges">${badgeHtml}</div>
        <h3 class="title">${item.title}</h3>
        <div class="meta">${item.domain}</div>
      </div>
    </a>
  `;
}

function render(items) {
  const root = document.querySelector('#grid');
  // 首屏極速渲染：先丟 20 張出來
  root.innerHTML = items.slice(0, 20).map(createCard).join('');
  
  // 剩餘的卡片非同步塞入，不卡死主執行緒
  if (items.length > 20) {
    setTimeout(() => {
      root.insertAdjacentHTML('beforeend', items.slice(20).map(createCard).join(''));
    }, 50);
  }
}

function wireSearch(items) {
  const fuse = new Fuse(items, {
    keys: [
      { name: 'title', weight: 0.5 },
      { name: 'description', weight: 0.2 },
      { name: 'domain', weight: 0.2 },
      { name: 'folderPath', weight: 0.1 }
    ],
    threshold: 0.35
  });

  const input = document.querySelector('#searchInput');
  input.addEventListener('input', (event) => {
    const value = event.target.value.trim();
    if (!value) {
      state.filtered = items;
      render(items);
      return;
    }
    state.filtered = fuse.search(value).map((r) => r.item);
    render(state.filtered);
  });
}

function wireControls() {
  const speedInput = document.querySelector('#previewSpeed');
  speedInput.value = state.previewSpeed;
  speedInput.addEventListener('input', (event) => {
    state.previewSpeed = Number(event.target.value);
    localStorage.setItem('previewSpeed', String(state.previewSpeed));
    // 直接更新 DOM 的預覽秒數
    document.querySelectorAll('.card').forEach(card => {
      card.style.setProperty('--preview-duration', `${state.previewSpeed}s`);
    });
  });
}

async function main() {
  state.items = await loadAllItems();
  state.filtered = state.items;
  render(state.items);
  wireSearch(state.items);
  wireControls();
}

main();