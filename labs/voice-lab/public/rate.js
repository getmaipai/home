// Adds a simple rating to every voice block on a listening page, and one button that prints the result to send back.
const blocks = [...document.querySelectorAll('section.m')].filter((s) => !/sample voice|original voice/i.test(s.querySelector('h2')?.textContent || ''));
const choices = [['human', 'Could be a person'], ['close', 'Close, but I can tell'], ['robotic', 'Robotic'], ['bad', 'Bad or broken']];
const page = location.pathname.split('/').pop();
let saved = {}; try { saved = JSON.parse(localStorage.getItem('rate:' + page) || '{}'); } catch {}
blocks.forEach((s, i) => {
  const name = s.querySelector('h2').textContent.trim();
  const box = document.createElement('div'); box.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px 16px;margin:8px 0 2px';
  box.innerHTML = choices.map(([v, label]) => `<label style="flex-direction:row;align-items:center;gap:6px;color:var(--fg)"><input type="radio" name="r${i}" value="${v}" ${saved[name] === v ? 'checked' : ''}> ${label}</label>`).join('');
  box.addEventListener('change', (e) => { saved[name] = e.target.value; try { localStorage.setItem('rate:' + page, JSON.stringify(saved)); } catch {} });
  s.appendChild(box);
});
const wrap = document.createElement('div');
wrap.innerHTML = '<p class="note">Rate each voice above. You do not have to play every line: one or two is enough. Skip any you did not listen to.</p><p><button class="primary" id="rateShow">Show my ratings</button></p><div id="rateOut" style="font-size:16px;font-weight:600;white-space:pre-line;user-select:all"></div>';
document.querySelector('main').appendChild(wrap);
document.querySelector('#rateShow').onclick = () => {
  const groups = {}; for (const [name, v] of Object.entries(saved)) (groups[v] ||= []).push(name.replace(/\s*\(.*\)$/, ''));
  const out = choices.filter(([v]) => groups[v]).map(([v, label]) => label + ': ' + groups[v].join(', ')).join('\n');
  document.querySelector('#rateOut').textContent = out ? 'Copy this and send it to me:\n' + out : 'Nothing rated yet.';
};
