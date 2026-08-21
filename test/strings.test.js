// The card speaks the language Home Assistant is set to, and English when it knows none.
const { loadInternal, check, done } = require('./harness');

const stringsFor = loadInternal('stringsFor');

check('English is what it falls back to', stringsFor('en').sensors, 'Sensors');
check('French is translated', stringsFor('fr').sensors, 'Capteurs');
check('a regional code reads as its language', stringsFor('fr-CA').show_all, 'Tout afficher');
check('an underscore works the same', stringsFor('fr_FR').show_all, 'Tout afficher');
check('a language nobody wrote falls back rather than blanking',
  stringsFor('sv').hide_all, 'Hide all');
check('no language at all is still English', stringsFor(undefined).comfort_zone, 'Comfort zone');

// Every language must answer to every key, or a label renders as "undefined".
const keys = Object.keys(stringsFor('en')).sort();
check('French answers to the same keys', Object.keys(stringsFor('fr')).sort(), keys);
check('and so does a fallback', Object.keys(stringsFor('sv')).sort(), keys);
check('nothing is left empty',
  keys.filter((k) => !stringsFor('fr')[k] || !stringsFor('en')[k]), []);

done('strings');
