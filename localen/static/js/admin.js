let notes = [], open = new Set(), events = {}, delId = null;
async function load() {
  const r = await api('/api/admin/notes');
  if (r.status === 403) { $('app').hidden = true; $('denied').hidden = false; return; }
  $('app').hidden = false; notes = r.data.notes || [];
  for (const id of open) { const e = await api(`/api/admin/notes/${id}/events`); if (e.ok) events[id] = e.data.events; }
  draw();
}
function draw() {
  const n = s => notes.filter(x => x.state === s).length;
  $('st').innerHTML = [['Total', notes.length], ['Unread', n('Unread')], ['Read', n('Read')], ['Expired / destroyed', n('Expired') + n('Destroyed')]]
    .map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');
  $('list').innerHTML = notes.map(x => {
    const live = x.state === 'Unread';
    return `<div class="item"><div class="head" data-a="tg" data-i="${x.id}">
      <span class="badge ${live ? 'live' : ''}"><i></i>${esc(x.state)}</span><span class="id">${x.id.slice(0, 8)}</span><span class="when">${fmt(x.created)}</span></div>
      ${open.has(x.id) ? `<div class="detail"><dl class="kv">
        <dt>Created by</dt><dd>${esc(x.cip)} · ${device(x.cua)}</dd>
        <dt>Expires</dt><dd>${fmt(x.expires)}</dd>
        <dt>Page views</dt><dd>${x.views}${x.fails ? ` · <span class="err">${x.fails} wrong password${x.fails > 1 ? 's' : ''}</span>` : ''}</dd>
        ${x.read_at ? `<dt>Read at</dt><dd>${fmt(x.read_at)}</dd><dt>Read by</dt><dd>${esc(x.rip)} · ${device(x.rua)}</dd>` : ''}
        </dl><div class="log">${(events[x.id] || []).map(e => `<div class="${e.warn ? 'w' : ''}">${fmt(e.ts)} · ${esc(e.ip)} · ${device(e.ua)} · ${esc(e.ev)}</div>`).join('') || '<div>No activity yet.</div>'}</div>
        <div style="margin-top:12px"><button class="btn danger sm" data-a="del" data-i="${x.id}">${delId === x.id ? 'Click again to delete' : 'Delete note'}</button></div></div>` : ''}</div>`;
  }).join('') || '<div class="empty">No notes yet.</div>';
}
$('list').onclick = async e => {
  const b = e.target.closest('[data-a]'); if (!b) return; const id = b.dataset.i;
  if (b.dataset.a === 'tg') { open.has(id) ? open.delete(id) : open.add(id); return load(); }
  if (b.dataset.a === 'del') {
    if (delId !== id) { delId = id; return draw(); }
    await api('/api/admin/notes/' + id, 'DELETE'); delId = null; open.delete(id); load();
  }
};
$('rf').onclick = load;
$('cu').onclick = async () => { await api('/api/admin/cleanup', 'POST'); load(); };
load(); setInterval(load, 5000);
