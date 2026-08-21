// Loads the card in node. It is a browser custom element, so the few globals it touches
// on the way in are stubbed here; nothing else is faked -- the code under test is the
// file that ships.
const fs = require('fs');
const path = require('path');

function loadCard(store) {
  let Card = null;
  global.HTMLElement = class { attachShadow() { return {}; } };
  global.customElements = {
    define: (name, cls) => { if (name === 'psychrometric-card') Card = cls; },
    get: () => undefined,
  };
  global.window = { customCards: [] };
  global.ResizeObserver = class { observe() {} disconnect() {} };
  global.localStorage = store || {
    getItem: () => null, setItem: () => {}, removeItem: () => {},
  };
  const src = fs.readFileSync(path.join(__dirname, '..', 'dist', 'psychrometric-card.js'), 'utf8');
  new Function(src)();
  if (!Card) throw new Error('psychrometric-card was never defined');
  return Card;
}

function memoryStorage(initial) {
  const data = Object.assign({}, initial);
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
}

let failures = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log('%s %s%s', ok ? '  ok  ' : ' FAIL ', label,
    ok ? '' : '\n         got  ' + JSON.stringify(got) + '\n         want ' + JSON.stringify(want));
}

function done(title) {
  console.log(failures ? '\n' + title + ': ' + failures + ' failure(s)' : '\n' + title + ': all good');
  process.exit(failures ? 1 : 0);
}

module.exports = { loadCard, memoryStorage, check, done };
