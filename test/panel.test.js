// The sensor list folds away under the chart, and stays how it was left.
const { loadCard, memoryStorage, check, done } = require('./harness');

const KEY = 'psychro-card-panel';

function panelOpen(store) {
  const Card = loadCard(store);
  return Object.create(Card.prototype)._loadPanelOpen();
}

check('nothing stored yet: open, so a first visit shows what the card holds',
  panelOpen(memoryStorage()), true);
check('closed on purpose: stays closed',
  panelOpen(memoryStorage({ [KEY]: 'closed' })), false);
check('opened again: stays open',
  panelOpen(memoryStorage({ [KEY]: 'open' })), true);
check('anything else in the slot is not "closed", so it opens',
  panelOpen(memoryStorage({ [KEY]: 'rubbish' })), true);

// A card in a sandboxed frame has no storage at all: it must still render.
const throws = {
  getItem() { throw new Error('denied'); },
  setItem() { throw new Error('denied'); },
  removeItem() { throw new Error('denied'); },
};
check('storage that throws is survivable', panelOpen(throws), true);

done('panel');
