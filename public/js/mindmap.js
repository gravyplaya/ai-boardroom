/**
 * mindmap.js — Upgraded neural map with search, filters, glow, and file drawer
 */

let graphInstance = null;

export async function initMindMap() {
  const container = document.getElementById('mindmap-container');
  if (!container) return;

  const drawer = document.getElementById('mindmapDrawer');
  const drawerTitle = document.getElementById('mindmapDrawerTitle');
  const drawerContent = document.getElementById('mindmapDrawerContent');
  const drawerClose = document.getElementById('mindmapDrawerClose');
  const searchInput = document.getElementById('mindmapSearch');
  const filterSelect = document.getElementById('mindmapFilter');
  const fitBtn = document.getElementById('mindmapFit');
  const statsEl = document.getElementById('mindmapStats');

  function closeDrawer() {
    if (!drawer) return;
    drawer.setAttribute('hidden', '');
    if (drawerTitle) drawerTitle.textContent = 'File';
    if (drawerContent) drawerContent.textContent = '';
  }

  async function openVaultFile(nodeId) {
    if (!drawer || !drawerTitle || !drawerContent) return;
    const rel = String(nodeId || '');
    if (!rel.startsWith('obsidian_vault/')) return;
    const vaultPath = rel.replace(/^obsidian_vault\//, '');
    drawer.removeAttribute('hidden');
    drawerTitle.textContent = vaultPath;
    drawerContent.textContent = 'Loading…';
    try {
      const headers = window.__boardroomSettings?.getProviderKeysHeader?.() || {};
      const url = `/api/vault/${encodeURIComponent(vaultPath).replace(/%2F/g, '/')}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error('Not found');
      const data = await res.json();
      drawerContent.textContent = data.content || '';
    } catch {
      drawerContent.textContent = `Failed to load: ${vaultPath}`;
    }
  }

  drawerClose?.addEventListener('click', closeDrawer);
  closeDrawer();

  container.innerHTML = '';
  const loading = document.createElement('div');
  loading.className = 'mindmap-loading';
  loading.textContent = 'Mapping neural network…';
  container.appendChild(loading);

  const GROUP_META = {
    0: { label: 'Hub', color: '#22d3ee' },
    1: { label: 'Core', color: '#60a5fa' },
    2: { label: 'Memory', color: '#a78bfa' },
    3: { label: 'Backend', color: '#34d399' },
    4: { label: 'Frontend', color: '#fbbf24' },
  };

  try {
    const res = await fetch('/api/vault/mindmap');
    const gData = await res.json();
    loading.remove();

    let fullData = gData;
    if (statsEl) {
      statsEl.textContent = `${gData.nodes?.length || 0} nodes · ${gData.links?.length || 0} links`;
    }

    const Graph = ForceGraph()(container)
      .graphData(gData)
      .backgroundColor('rgba(0,0,0,0)')
      .nodeId('id')
      .nodeLabel((n) => `${n.name}${n.isDir ? ' (folder)' : ''}`)
      .nodeVal((node) => (node.group === 0 ? 14 : node.isDir ? 8 : 4))
      .linkWidth(1)
      .linkDirectionalParticles(2)
      .linkDirectionalParticleSpeed(0.004)
      .linkDirectionalParticleWidth(1.6)
      .linkColor(() => 'rgba(148,163,184,0.25)')
      .onNodeClick((node) => {
        if (!node || node.isDir) return;
        if (typeof node.id === 'string' && node.id.startsWith('obsidian_vault/') && node.id.endsWith('.md')) {
          openVaultFile(node.id);
        }
      })
      .nodeCanvasObject((node, ctx, globalScale) => {
        const meta = GROUP_META[node.group] || GROUP_META[1];
        const r = node.group === 0 ? 8 : node.isDir ? 5.5 : 3.5;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fillStyle = meta.color;
        ctx.shadowBlur = 14;
        ctx.shadowColor = meta.color;
        ctx.fill();
        ctx.shadowBlur = 0;
        if (globalScale > 0.7) {
          const fontSize = Math.max(10 / globalScale, 2.5);
          ctx.font = `500 ${fontSize}px Inter, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillStyle = 'rgba(226,232,240,0.9)';
          ctx.fillText(node.name, node.x, node.y + r + 2);
        }
      })
      .onNodeHover((node) => {
        container.style.cursor = node ? 'pointer' : 'grab';
      });

    Graph.d3Force('charge').strength(-160);
    Graph.d3Force('link').distance(48);
    graphInstance = Graph;

    setTimeout(() => Graph.zoomToFit(500, 60), 700);

    function applyFilters() {
      const q = (searchInput?.value || '').toLowerCase().trim();
      const filter = filterSelect?.value || 'all';
      const nodes = (fullData.nodes || []).filter((n) => {
        if (filter !== 'all' && String(n.group) !== filter) return false;
        if (q && !String(n.name).toLowerCase().includes(q) && !String(n.id).toLowerCase().includes(q)) return false;
        return true;
      });
      const ids = new Set(nodes.map((n) => n.id));
      const links = (fullData.links || []).filter((l) => {
        const s = typeof l.source === 'object' ? l.source.id : l.source;
        const t = typeof l.target === 'object' ? l.target.id : l.target;
        return ids.has(s) && ids.has(t);
      });
      Graph.graphData({ nodes, links });
      if (statsEl) statsEl.textContent = `${nodes.length} nodes · ${links.length} links`;
    }

    searchInput?.addEventListener('input', applyFilters);
    filterSelect?.addEventListener('change', applyFilters);
    fitBtn?.addEventListener('click', () => Graph.zoomToFit(400, 50));
  } catch (error) {
    console.error('Failed to load mindmap', error);
    loading.textContent = 'Error loading Mind Map.';
  }
}
