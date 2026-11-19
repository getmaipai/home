// Word-button ratings for every voice block on a listening page, and one button that prints the result to send back.
// Scale: Unacceptable (0), Bad (1), OK (2), Great (3), Perfect (4). Not rated means not listened to.
const blocks = [...document.querySelectorAll('section.m')].filter((s) => !/sample voice|original voice/i.test(s.querySelector('h2')?.textContent || ''));
const labels = ['Unacceptable', 'Bad', 'OK', 'Great', 'Perfect'];
const page = location.pathname.split('/').pop();
let saved = {}; try { saved = JSON.parse(localStorage.getItem('words:' + page) || '{}'); } catch {}
const style = document.createElement('style');
style.textContent = '.rate{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 2px}.rate button{padding:8px 12px;border-radius:10px;font-size:15px}.rate button.on{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:700}';
document.head.appendChild(style);
blocks.forEach((s) => {
  const name = s.querySelector('h2').textContent.trim();
  const box = document.createElement('div'); box.className = 'rate';
  box.innerHTML = labels.map((label, v) => `<button data-v="${v}">${label}</button>`).join('');
  const paint = () => [...box.querySelectorAll('button')].forEach((b) => b.classList.toggle('on', saved[name] === +b.dataset.v));
  box.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; const v = +b.dataset.v; if (saved[name] === v) delete saved[name]; else saved[name] = v; try { localStorage.setItem('words:' + page, JSON.stringify(saved)); } catch {} paint(); });
  s.appendChild(box); paint();
});
const wrap = document.createElement('div');
wrap.innerHTML = '<p class="note">Tap one word under each voice you listened to. Tap it again to clear it. One or two lines per voice is enough. Leave the ones you skipped alone.</p><p><button class="primary" id="rateShow">Show my ratings</button></p><div id="rateOut" style="font-size:16px;font-weight:600;white-space:pre-line;user-select:all"></div>';
document.querySelector('main').appendChild(wrap);
document.querySelector('#rateShow').onclick = () => {
  const rows = Object.entries(saved).sort((a, b) => b[1] - a[1]).map(([name, v]) => labels[v] + ': ' + name.replace(/\s*\(.*\)$/, ''));
  document.querySelector('#rateOut').textContent = rows.length ? 'Copy this and send it to me:\n' + rows.join('\n') : 'Nothing rated yet.';
};
