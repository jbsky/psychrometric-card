// What the legend remembers must follow the sensor, not its position in the list --
// auto_discover changes both the order and the length.
const { loadCard, memoryStorage, check, done } = require('./harness');

const V2 = 'psychro-card-visibility-v2';
const V3 = 'psychro-card-visibility-v3';

function card(Card, names) {
  const c = Object.create(Card.prototype);
  c._config = {
    sensors: names.map((n) => ({
      name: n,
      temperature: 'sensor.' + n + '_temperature',
      humidity: 'sensor.' + n + '_humidity',
    })),
  };
  c._resetVisibility();
  return c;
}
const hidden = (c) => c._config.sensors.filter((s, i) => c._visibility[i] === false).map((s) => s.name);

// Nothing stored yet
let Card = loadCard(memoryStorage());
check('fresh install hides nothing', hidden(card(Card, ['lounge', 'garage', 'fridge'])), []);

// Carry-over from the positional format: index 2 was hidden, which was the fridge
let store = memoryStorage({ [V2]: JSON.stringify({ 0: true, 1: true, 2: false }) });
Card = loadCard(store);
check('migrates v2 by position, once', hidden(card(Card, ['lounge', 'garage', 'fridge'])), ['fridge']);
check('and rewrites it keyed by entity',
  Object.keys(JSON.parse(store.data[V3])).sort(),
  ['sensor.fridge_temperature', 'sensor.garage_temperature', 'sensor.lounge_temperature']);

// The point of the exercise
check('reordered list: the fridge stays hidden', hidden(card(Card, ['fridge', 'lounge', 'garage'])), ['fridge']);
check('longer list: still the fridge',
  hidden(card(Card, ['bedroom', 'fridge', 'lounge', 'garage', 'freezer'])), ['fridge']);
check('and position 2 is no longer hidden by itself', hidden(card(Card, ['a', 'b', 'c'])), []);

// Two cards share this key: neither may wipe the other
store = memoryStorage();
Card = loadCard(store);
const a = card(Card, ['lounge', 'garage']);
a._visibility[0] = false;
a._saveVisibility();
const b = card(Card, ['cellar', 'attic']);
b._visibility[1] = false;
b._saveVisibility();
check('a second card merges instead of replacing',
  Object.keys(JSON.parse(store.data[V3])).sort(),
  ['sensor.attic_temperature', 'sensor.cellar_temperature',
   'sensor.garage_temperature', 'sensor.lounge_temperature']);
check('first card reads back its own', hidden(card(Card, ['lounge', 'garage'])), ['lounge']);
check('second card reads back its own', hidden(card(Card, ['cellar', 'attic'])), ['attic']);

// Private browsing can make localStorage throw on access, not just return null
Card = loadCard({
  getItem: () => { throw new Error('denied'); },
  setItem: () => { throw new Error('denied'); },
  removeItem: () => { throw new Error('denied'); },
});
check('storage that throws is survivable', hidden(card(Card, ['x', 'y'])), []);

done('visibility');
