async function encrypt(text, seconds) {
  const k = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', k, 'AES-GCM', false, ['encrypt']);
  const payload = JSON.stringify({ t: text, s: seconds });   // viewing time is inside the encrypted payload
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(payload)));
  return { data: toB64(iv) + '.' + toB64(ct), key: toB64u(k) };
}
$('tx').addEventListener('input', () => $('ct').textContent = $('tx').value.length + ' / 20000');
$('mk').onclick = async () => {
  const text = $('tx').value; $('er').textContent = '';
  if (!text.trim()) { $('er').textContent = 'Please enter a note.'; return; }
  $('mk').disabled = true;
  try {
    const { data, key } = await encrypt(text, +$('vt').value);
    const r = await api('/api/notes', 'POST', { data, expire: +$('ex').value, password: $('pw').value });
    if (!r.ok) { $('er').textContent = r.data.error || 'Something went wrong, please try again.'; return; }
    $('lk').value = location.origin + '/n/' + r.data.id + '#' + key;
    $('form').hidden = true; $('res').hidden = false;
    $('tx').value = ''; $('pw').value = ''; $('ct').textContent = '0 / 20000';
  } finally { $('mk').disabled = false; }
};
$('cp').onclick = async () => { $('lk').select(); try { await navigator.clipboard.writeText($('lk').value); } catch (e) { document.execCommand('copy'); } $('cp').textContent = 'Copied'; };
$('nw').onclick = () => { $('lk').value = ''; $('cp').textContent = 'Copy'; $('res').hidden = true; $('form').hidden = false; };
