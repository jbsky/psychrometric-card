# Psychrometric Card for Home Assistant

A custom Lovelace card that displays an interactive psychrometric (Mollier) diagram with live Home Assistant temperature and humidity sensor data.

![Psychrometric Chart](https://raw.githubusercontent.com/jbsky/psychrometric-card/main/docs/screenshot.png)

## Features

- Real-time psychrometric diagram with sensor data points
- Optional auto-discovery: pairs your temperature and humidity sensors by itself
- Interactive legend with click-to-toggle visibility per sensor
- Quick filter buttons: Show All / Hide All / Indoor / Outdoor
- Two-point comparison: click two sensors to see the difference between them
- Optional template sensors, so the computed values can be recorded and graphed
- Comfort zone visualization
- Relative humidity curves (10% to 100%)
- Enthalpy lines
- Dew point temperature display
- Follows the Home Assistant theme: the canvas paints no background of its own, so a glass
  or translucent theme shows through, and text follows `--primary-text-color`
- Fully responsive (desktop, tablet, mobile)
- High-DPI / Retina display support
- Visibility state remembered per sensor, so it survives the list changing

## Installation

### HACS (Recommended)

1. Open HACS in Home Assistant
2. Go to **Frontend** > **Custom repositories**
3. Add `https://github.com/jbsky/psychrometric-card` with category **Lovelace**
4. Click **Install**
5. Refresh your browser (Ctrl+Shift+R)

### Manual

1. Download `psychrometric-card.js` from the [latest release](https://github.com/jbsky/psychrometric-card/releases/latest)
2. Copy it to `/config/www/psychrometric-card.js`
3. Add the resource in **Settings > Dashboards > Resources**:
   - URL: `/local/psychrometric-card.js`
   - Type: JavaScript Module

## Configuration

Add the card to your dashboard:

```yaml
type: custom:psychrometric-card
dark_mode: true
temp_min: -5
temp_max: 45
humidity_max: 25
height: 500
sensors:
  - name: Living Room
    temperature: sensor.living_room_temperature
    humidity: sensor.living_room_humidity
    color: "#f44336"
  - name: Bedroom
    temperature: sensor.bedroom_temperature
    humidity: sensor.bedroom_humidity
    color: "#2196f3"
  - name: Outside
    temperature: sensor.outside_temperature
    humidity: sensor.outside_humidity
    color: "#4caf50"
    outdoor: true
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dark_mode` | boolean | `true` | Palette for a dark background (curves, labels, point halo) |
| `background` | string | `transparent` | Canvas background. Leave it alone to let the card's own background show through; set a CSS colour (e.g. `"#1c1c1e"`) to paint an opaque panel instead |
| `temp_min` | number | `-5` | Minimum temperature on X axis (C) |
| `temp_max` | number | `45` | Maximum temperature on X axis (C) |
| `humidity_max` | number | `25` | Maximum absolute humidity on Y axis (g/kg) |
| `height` | number | `450` | Chart height in pixels |
| `sensors` | list | required unless `auto_discover` | List of sensor configurations |
| `auto_discover` | boolean or map | — | Find the temperature/humidity pairs instead of listing them. See below |

### Auto-discovery

Listing every pair by hand gets old at the third bedroom. `auto_discover` lets the card do it:

```yaml
type: custom:psychrometric-card
auto_discover: true
```

It pairs sensors in two passes. First **by device**: two readings exposed by one device are
one probe, and that is unambiguous. Then **by signature** — the entity_id stripped of the
words that name the quantity, so `sensor.temperature_hallway` finds `sensor.humidity_hallway`
— and only when exactly one candidate matches, so an ambiguous house gets no pair rather
than a wrong one. Disabled, hidden and diagnostic entities are skipped, and so is any
temperature sensor with no humidity counterpart.

Filters, all optional:

```yaml
auto_discover:
  area: [living room, garage]     # area id or name; omit for every area
  exclude: [fridge, freezer]      # skipped if the entity_id contains this
  outdoor_area: [garden]          # what counts as outdoor for the Indoor/Outdoor buttons
```

Without `outdoor_area`, a pair is marked outdoor when its area or entity_id looks like it
(`outdoor`, `garden`, `terrace`, `exterieur`, `jardin`…). Set `outdoor_area: []` to switch
the guessing off. Note that this follows the area you actually assigned in Home Assistant:
a bedroom thermometer filed under *Outside* will be marked outdoor, correctly.

`sensors:` still works alongside it — entries you write by hand are kept, and discovery only
adds pairs whose temperature entity you have not already declared. Names come from the entity's friendly name, falling back to the device name and then to the
entity_id — whichever first fits a legend cell — with the words naming the instrument or the
quantity trimmed off both ends, so `Thermometer Alexandre` and `Temperature Hallway` become
`Alexandre` and `Hallway`.

The resolved list is printed to the browser console and left in
`window.__psychrometricCardSensors`, ready to paste into the generator below.

### Sensor Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | string | entity ID | Display name in legend |
| `temperature` | string | required | Temperature sensor entity ID |
| `humidity` | string | required | Relative humidity sensor entity ID |
| `color` | string | auto | Point color (hex) |
| `outdoor` | boolean | `false` | Mark as outdoor sensor (for filter button) |

## Theming

The card draws on a `<canvas>`, and a canvas cannot inherit a background: whatever it paints
covers the card underneath it. So it paints nothing by default, and the `<ha-card>` behind it
carries the theme background, glass and `backdrop-filter` included.

The chart text and grid read `--primary-text-color` from the theme, re-read on every draw, so a
theme change lands without rebuilding the card. `dark_mode` still picks the palette for
everything the theme has no opinion about: the humidity curves, the enthalpy lines and the halo
drawn around each point.

To go back to a solid panel, name a colour:

```yaml
type: custom:psychrometric-card
background: "#1c1c1e"
```

## Recording the computed values

The card works out absolute humidity, dew point and enthalpy to draw a point, then throws
them away on the next redraw. Nothing is recorded, so none of it can be graphed over time or
used in an automation — and a Lovelace card cannot create entities, that is an integration's
job.

What it can do is hand you the maths, and keep the result in step with the house on its own.
`tools/psychro_sensors.py` reads the entity registry and the card's own configuration —
the same exclusions, the same hand-written entries — pairs the sensors with the same rule
the card uses, and writes a template sensor file. Three sensors per pair, regenerated
whenever the registry changes, so a new thermometer gets its derived sensors without you
touching any YAML.

**1. Install the pieces.** Copy `custom_templates/psychrometrics.jinja` into
`<config>/custom_templates/` and `tools/psychro_sensors.py` into `<config>/scripts/`. HACS
only downloads the card itself, so take both from the repository or the release archive.

**2. Make the template config a directory**, so a generated file can live beside the one you
write by hand:

```yaml
# configuration.yaml
template: !include_dir_merge_list template/
```

Move whatever `template.yaml` held into `template/manual.yaml`; the script writes
`template/psychro.yaml` and never touches anything else.

**3. Wire the command and the automation:**

```yaml
# configuration.yaml
shell_command:
  psychro_sensors: python3 /config/scripts/psychro_sensors.py
```

```yaml
# automations.yaml
- id: psychro_sensors_sync
  alias: "Psychrometrics: regenerate the derived sensors"
  mode: restart          # the registry moves in bursts; each trigger restarts the wait
  max_exceeded: silent
  triggers:
    - trigger: homeassistant
      event: start
    - trigger: event
      event_type: entity_registry_updated
  actions:
    - delay: "00:00:30"
    - action: shell_command.psychro_sensors
      response_variable: result
    - condition: template
      value_template: "{{ 'changed' in (result.stdout | default('')) }}"
    - action: template.reload
```

The script prints `changed` or `unchanged` and only rewrites the file when something moved,
so an unrelated entity rename costs one run and no reload. Restart once for the new
`template:` layout and the `shell_command`, and it looks after itself from there.

You get `sensor.<name>_absolute_humidity` (g/kg), `sensor.<name>_dew_point` (°C) and
`sensor.<name>_enthalpy` (kJ/kg) per pair, each with `state_class: measurement` so they are
recorded as statistics. `unique_id` derives from the temperature entity, never from the
display name: renaming a device in the UI does not orphan its history.

Names, macro names and `unique_id` suffixes are all options — `--labels`, `--macros`,
`--suffixes` — for anyone whose sensors and macros are not in English. Changing `--suffixes`
renames every entity, so pick them once.

Dew point carries an availability guard on 0–60 °C, the range where Magnus-Tetens means
anything: a freezer reports `unavailable` rather than a plausible-looking number. Pressure is
taken as a constant 101325 Pa, exactly as the card does — at 300 m of altitude the absolute
humidity is off by around 3.5 %, and the macros take a `pressure` argument if that matters
to you.

The macros are checked against the card's own `PsychroCalc` over 2820 points (T −20…50 °C,
RH 5…100 %): identical values, identical dew-point validity domain.

## Understanding the Chart

The psychrometric chart displays the relationship between:
- **X axis**: Dry-bulb temperature (C)
- **Y axis**: Absolute humidity (g/kg of dry air)
- **Curves**: Relative humidity lines (10% to 100%)
- **Diagonal lines**: Enthalpy (kJ/kg)
- **Green zone**: Comfort zone (20-26C, 40-60% RH)

Each sensor appears as a colored dot on the chart, positioned according to its current temperature and relative humidity readings.

## Tips

- Use `panel` view type for full-width display
- The card works best with 4-16 sensors
- Outdoor sensors are useful for comparison with indoor conditions
- The comfort zone helps identify which rooms need attention

## Tests

The two heuristics that could quietly go wrong — which entities get paired, and what the
legend remembers — are covered by plain node scripts, no framework and no install:

```bash
node test/discovery.test.js
node test/visibility.test.js
```

## Credits

Based on psychrometric calculations from [Psychrometrique](https://github.com/jbsky/Psychrometrique).

## License

MIT
