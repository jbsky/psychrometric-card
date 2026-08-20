# Psychrometric Card for Home Assistant

A custom Lovelace card that displays an interactive psychrometric (Mollier) diagram with live Home Assistant temperature and humidity sensor data.

![Psychrometric Chart](https://raw.githubusercontent.com/jbsky/psychrometric-card/main/docs/screenshot.png)

## Features

- Real-time psychrometric diagram with sensor data points
- Interactive legend with click-to-toggle visibility per sensor
- Quick filter buttons: Show All / Hide All / Indoor / Outdoor
- Two-point comparison: click two sensors to see the difference between them
- Comfort zone visualization
- Relative humidity curves (10% to 100%)
- Enthalpy lines
- Dew point temperature display
- Follows the Home Assistant theme: the canvas paints no background of its own, so a glass
  or translucent theme shows through, and text follows `--primary-text-color`
- Fully responsive (desktop, tablet, mobile)
- High-DPI / Retina display support
- Visibility state persisted in localStorage

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
| `sensors` | list | required | List of sensor configurations |

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

## Credits

Based on psychrometric calculations from [Psychrometrique](https://github.com/jbsky/Psychrometrique).

## License

MIT
