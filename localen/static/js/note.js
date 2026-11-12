const nid = location.pathname.split('/').pop(), key = location.hash.slice(1);
const show = x => ['ld', 'ask', 'out', 'dead'].forEach(i => $(i).hidden = i !== x);
const dead = msg => { if (msg) $('dm').textContent = msg; show('dead'); };

// ---- viewer state ----
const W = 680, P = 28, LH = 28, FS = 18, dpr = Math.min(window.devicePixelRatio || 1, 2);
const cv = $('cv'), cx = cv.getContext('2d');
let vkey = null, ip = '', lines = [], secs = 0, left = 0, hid = false, active = false, tick = null, lastLog = {};

(async function boot() {
  let kb = null; try { kb = fromB64(key); } catch (e) {}
  if (!kb || kb.length !== 16) return dead('The link is missing or has a wrong decryption key');
  const r = await api(`/api/n/${nid}/info`);
  if (!r.ok) return dead();
  $('pwb').hidden = !r.data.pw; show('ask');
})();

$('rd').onclick = async () => {
  $('er').textContent = ''; $('rd').disabled = true;
  const r = await api(`/api/n/${nid}/read`, 'POST', { password: $('pw').value });
  if (!r.ok) {
    $('rd').disabled = false;
    if (r.status === 401) { $('er').textContent = r.data.error; return; }
    return dead(r.data.gone ? r.data.error : undefined);
  }
  let text;
  try {
    const [a, b] = r.data.data.split('.');
    const k = await crypto.subtle.importKey('raw', fromB64(key), 'AES-GCM', false, ['decrypt']);
    const plain = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(a) }, k, fromB64(b)));
    try { const o = JSON.parse(plain); text = o.t; secs = o.s | 0; } catch (e) { text = plain; }
  } catch (e) { return dead('Could not decrypt the note (wrong key). The note has been destroyed'); }
  vkey = r.data.key; ip = r.data.ip; left = secs; hid = false; active = true;
  history.replaceState(null, '', location.pathname);
  show('out'); layout(text); text = ''; render();
  $('cd').textContent = secs ? left + 's' : '';
  tick = setInterval(() => {
    if (secs) { left--; $('cd').textContent = Math.max(left, 0) + 's'; if (left <= 0) return endView('Viewing time is over. This note has been destroyed.', 'Viewing time ended'); }
    render();
  }, 1000);
};

// ---- text is drawn on a canvas (nothing selectable in the page) ----
function wrap(p, max) {
  const out = []; let l = '';
  for (const w of p.split(' ')) {
    const t = l ? l + ' ' + w : w;
    if (cx.measureText(t).width <= max) { l = t; continue; }
    if (l) { out.push(l); l = ''; }
    if (cx.measureText(w).width <= max) { l = w; continue; }
    for (const ch of w) { if (l && cx.measureText(l + ch).width > max) { out.push(l); l = ''; } l += ch; }
  }
  out.push(l); return out;
}
function layout(text) {
  cx.font = FS + 'px sans-serif'; lines = [];
  text.split('\n').forEach(p => lines.push(...(p ? wrap(p, W - 2 * P) : [''])));
}
function render() {
  const h = Math.max(240, lines.length * LH + 2 * P);
  cv.width = W * dpr; cv.height = h * dpr; cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, W, h);
  if (hid || !active) return;
  cx.fillStyle = '#111'; cx.font = FS + 'px sans-serif'; cx.textBaseline = 'top';
  lines.forEach((l, i) => cx.fillText(l, P, P + i * LH));
  // moving watermark: reader IP + time + note id (deters and traces leaks)
  cx.save(); cx.rotate(-0.35); cx.fillStyle = 'rgba(0,0,0,0.09)'; cx.font = '600 13px sans-serif';
  const s = `${ip} · ${new Date().toLocaleTimeString('en-GB')} · ${nid.slice(0, 6)}`, sw = cx.measureText(s).width + 40, off = Math.floor(Date.now() / 1000) % 60;
  for (let y = -W, r = 0; y < h + W; y += 46, r++) for (let x = -W + (r % 2 ? 60 : 0) - off; x < W * 1.5; x += sw) cx.fillText(s, x, y);
  cx.restore();
}

// ---- protection ----
function log(ev) {
  if (!active) return; const t = Date.now();
  if (lastLog[ev] && t - lastLog[ev] < 2000) return; lastLog[ev] = t;
  api(`/api/n/${nid}/event`, 'POST', { key: vkey, ev, warn: 1 });
}
function hide(why) { if (!active) return; hid = true; $('cover').hidden = false; render(); log(why); }
function endView(msg, why) {
  log(why); active = false; clearInterval(tick); lines = []; render(); dead(msg);
}
$('cover').onclick = () => { if (document.hasFocus()) { hid = false; $('cover').hidden = true; render(); } };
document.addEventListener('visibilitychange', () => { if (document.hidden) hide('Switched tab or minimised the window'); });
window.addEventListener('blur', () => hide('Window lost focus (possible screenshot tool)'));
window.addEventListener('beforeprint', () => hide('Print attempted'));
['copy', 'cut', 'contextmenu'].forEach(t => document.addEventListener(t, e => { if (active) { e.preventDefault(); log('Blocked: ' + t); } }));
['selectstart', 'dragstart'].forEach(t => document.addEventListener(t, e => { if (active) e.preventDefault(); }));
document.addEventListener('keydown', e => {
  if (!active) return;
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  const shot = k === 'printscreen' || (e.metaKey && e.shiftKey && ['3', '4', '5', 's'].includes(k)) || (e.metaKey && e.shiftKey && ['#', '$', '%'].includes(e.key));
  if (shot) { e.preventDefault(); wipeClipboard(); hide('Screenshot shortcut pressed: ' + e.key); return; }
  if (k === 'f12' || (mod && ['c', 'x', 'a', 's', 'p', 'u', 'f'].includes(k)) || (mod && e.shiftKey && ['i', 'j', 'c', 's'].includes(k))) {
    e.preventDefault(); log('Blocked key: ' + (mod ? 'Ctrl/Cmd+' : '') + (e.shiftKey ? 'Shift+' : '') + e.key);
  }
});
document.addEventListener('keyup', e => { if (active && e.key === 'PrintScreen') { wipeClipboard(); hide('Screenshot key pressed (PrintScreen)'); } });
function wipeClipboard() { try { navigator.clipboard.writeText(' '); } catch (e) {} }
