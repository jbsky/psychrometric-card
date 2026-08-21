// auto_discover has to be right about which two entities belong together, and honest when
// it cannot tell. The fixture is invented, but every case in it was met in a real registry.
const { loadCard, memoryStorage, check, done } = require('./harness');

const LONG_DEVICE = 'Meteo-France forecast for city Somewhere - Some Region (13) - FR';

function state(dc, friendly) {
  return { attributes: { device_class: dc, friendly_name: friendly } };
}

const hass = {
  areas: {
    living: { name: 'Living room' },
    garden: { name: 'Garden' },
    garage: { name: 'Garage' },
  },
  devices: {
    dev_lounge: { name: 'Lounge sensor', area_id: 'living' },
    dev_gateway: { name: 'Gateway', area_id: 'living' },
    dev_weather: { name: LONG_DEVICE, area_id: 'garden' },
    dev_freezer: { name: 'Freezer', area_id: 'garage' },
    dev_old: { name: 'Retired probe', area_id: 'living' },
  },
  entities: {
    'sensor.lounge_temperature': { device_id: 'dev_lounge' },
    'sensor.lounge_humidity': { device_id: 'dev_lounge' },
    // no device: only the entity_id says these two belong together
    'sensor.temperature_hallway': {},
    'sensor.humidity_hallway': {},
    // two candidates share a signature -- ambiguous, so no pair at all
    'sensor.temperature_shed': {},
    'sensor.humidity_shed': {},
    'sensor.shed_humidity': {},
    // a device reporting on itself, not on a room
    'sensor.gateway_temperature': { device_id: 'dev_gateway', entity_category: 'diagnostic' },
    'sensor.gateway_humidity': { device_id: 'dev_gateway', entity_category: 'diagnostic' },
    'sensor.old_temperature': { device_id: 'dev_old', disabled_by: 'user' },
    'sensor.old_humidity': { device_id: 'dev_old', disabled_by: 'user' },
    'sensor.spare_temperature': { device_id: 'dev_old', hidden: true },
    'sensor.spare_humidity': { device_id: 'dev_old', hidden: true },
    'sensor.weather_temperature': { device_id: 'dev_weather' },
    'sensor.weather_humidity': { device_id: 'dev_weather' },
    'sensor.freezer_temperature': { device_id: 'dev_freezer' },
    'sensor.freezer_humidity': { device_id: 'dev_freezer' },
    'sensor.terrasse_temperature': {},
    'sensor.terrasse_humidity': {},
    'sensor.boiler_temperature': {},          // no humidity anywhere: not a pair
  },
  states: {
    'sensor.lounge_temperature': state('temperature', 'Lounge Temperature'),
    'sensor.lounge_humidity': state('humidity', 'Lounge Humidity'),
    'sensor.temperature_hallway': state('temperature', 'Hallway Temperature'),
    'sensor.humidity_hallway': state('humidity', 'Hallway Humidity'),
    'sensor.temperature_shed': state('temperature', 'Shed Temperature'),
    'sensor.humidity_shed': state('humidity', 'Shed Humidity'),
    'sensor.shed_humidity': state('humidity', 'Shed RH'),
    'sensor.gateway_temperature': state('temperature', 'Gateway Temperature'),
    'sensor.gateway_humidity': state('humidity', 'Gateway Humidity'),
    'sensor.old_temperature': state('temperature', 'Retired probe Temperature'),
    'sensor.old_humidity': state('humidity', 'Retired probe Humidity'),
    'sensor.spare_temperature': state('temperature', 'Spare Temperature'),
    'sensor.spare_humidity': state('humidity', 'Spare Humidity'),
    'sensor.weather_temperature': state('temperature', LONG_DEVICE + ' Somewhere Temperature'),
    'sensor.weather_humidity': state('humidity', LONG_DEVICE + ' Somewhere Humidity'),
    'sensor.freezer_temperature': state('temperature', 'Freezer Temperature'),
    'sensor.freezer_humidity': state('humidity', 'Freezer Humidity'),
    'sensor.terrasse_temperature': state('temperature', 'Terrasse Temperature'),
    'sensor.terrasse_humidity': state('humidity', 'Terrasse Humidity'),
    'sensor.boiler_temperature': state('temperature', 'Boiler Temperature'),
  },
};

const Card = loadCard(memoryStorage());

function discover(options, declared) {
  const c = Object.create(Card.prototype);
  c._hass = hass;
  c._config = { sensors: declared || [], auto_discover: c._discoveryOptions(options) };
  return c._discoverSensors();
}
const names = (res) => res.map((s) => s.name);
const ids = (res) => res.map((s) => s.temperature);

check('pairs by device, then by signature',
  ids(discover(true)),
  ['sensor.freezer_temperature', 'sensor.temperature_hallway', 'sensor.lounge_temperature',
   'sensor.terrasse_temperature', 'sensor.weather_temperature']);

check('an ambiguous signature yields nothing',
  ids(discover(true)).filter((id) => id.indexOf('shed') !== -1), []);
check('a temperature with no counterpart is skipped',
  ids(discover(true)).indexOf('sensor.boiler_temperature'), -1);
check('diagnostic, disabled and hidden entities are skipped',
  ids(discover(true)).filter((id) => /gateway|old|spare/.test(id)), []);

check('a device named after a sentence falls back to the entity_id',
  names(discover(true)), ['Freezer', 'Hallway', 'Lounge', 'Terrasse', 'Weather']);


check('area filters by name or id',
  names(discover({ area: ['Living room', 'garage'] })), ['Freezer', 'Lounge']);
check('exclude drops matching entity_ids',
  names(discover({ exclude: ['freezer', 'weather'] })), ['Hallway', 'Lounge', 'Terrasse']);

// The merge lives in the hass setter: declared pairs win, discovery only adds.
const c = Object.create(Card.prototype);
c._config = {
  sensors: [{ name: 'My lounge', temperature: 'sensor.lounge_temperature', humidity: 'sensor.lounge_humidity' }],
  auto_discover: c._discoveryOptions(true),
};
c._initialized = true;      // skip the DOM build
c._legendBuilt = false;     // and the redraw
c._discovered = false;
c.hass = hass;
check('a declared pair is kept, not duplicated',
  c._config.sensors.map((s) => s.name),
  ['My lounge', 'Freezer', 'Hallway', 'Terrasse', 'Weather']);

done('discovery');
