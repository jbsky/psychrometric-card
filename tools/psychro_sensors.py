#!/usr/bin/env python3
"""Regenerate the psychrometric template sensors from the entity registry.

The card finds its own temperature/humidity pairs (auto_discover); these sensors did not,
so adding a thermometer to the house gave it a point on the chart but no recorded absolute
humidity, dew point or enthalpy. This closes that gap: same pairing rule, same source of
truth, run whenever the registry changes.

It reads the card's own configuration out of .storage/lovelace.lovelace -- its exclusions
and its hand-written entries -- so the two can never disagree about which pairs exist.

Runs inside the Home Assistant container (shell_command), where python3 and /config both
live. Writes only when something changed, and says so on stdout: the automation reloads
the template integration on "changed" and does nothing otherwise.

    python3 /config/scripts/psychro_sensors.py [--config /config] [--dry-run]
"""

import argparse
import json
import os
import re
import sys
import unicodedata

CARD_TYPE = "psychrometric-card"
OUT_NAME = "template/psychro.yaml"

# Kept in step with dist/psychrometric-card.js -- both sides must agree on what a pair is.
QUANTITY_WORDS = re.compile(
    r"^(temperature|temperatures|temp|humidite|humidity|hum|rh|sensor)$", re.I)
LABEL_NOISE = re.compile(
    r"^[\s\-_]*(thermom[èe]tre|thermometer|hygrom[èe]tre|capteur|sonde|sensor"
    r"|temp[ée]rature|temp|humidit[ée]|humidity)[\s\-_]+"
    r"|[\s\-_]+(temp[ée]rature|temp|humidit[ée]|humidity)[\s\-_]*$", re.I)
OUTDOOR_HINT = re.compile(
    r"ext[ée]rieur|outdoor|jardin|garden|balcon|terrasse|dehors|outside", re.I)
MAX_LABEL = 32

HEADER = """# Psychrometrics -- generated, do not edit.
#
# Written by scripts/psychro_sensors.py from the entity registry and the psychrometric
# card's own configuration. Formulas live in custom_templates/psychrometrics.jinja.
# Editing this file by hand loses the edit at the next registry change.
"""


def load(config_dir, name):
    with open(os.path.join(config_dir, ".storage", name), encoding="utf-8") as fh:
        return json.load(fh)["data"]


def card_config(config_dir):
    """The psychrometric card as configured in the dashboard, or None."""
    try:
        data = load(config_dir, "lovelace.lovelace")
    except (OSError, KeyError, ValueError):
        return None
    for view in data.get("config", {}).get("views", []):
        for card in view.get("cards") or []:
            if CARD_TYPE in str(card.get("type", "")):
                return card
    return None


def slug(text):
    plain = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", plain.lower())).strip("_")


def strip_noise(text):
    out, prev = (text or "").strip(), None
    while out != prev:
        prev = out
        out = LABEL_NOISE.sub("", out).strip()
    return out


def discover(config_dir, options):
    """Pair temperature and humidity sensors: same device first, then same signature."""
    entities = {e["entity_id"]: e for e in load(config_dir, "core.entity_registry")["entities"]}
    devices = {d["id"]: d for d in load(config_dir, "core.device_registry")["devices"]}
    areas = {a["id"]: a for a in load(config_dir, "core.area_registry")["areas"]}

    def device_class(e):
        return e.get("device_class") or e.get("original_device_class")

    def area_of(e):
        if e.get("area_id"):
            return e["area_id"]
        dev = devices.get(e.get("device_id") or "")
        return dev.get("area_id") if dev else None

    def area_name(aid):
        return (areas.get(aid or "") or {}).get("name") or aid or ""

    exclude = [x.lower() for x in options.get("exclude") or []]
    want_areas = options.get("area") or options.get("areas")
    want_areas = [str(a).lower() for a in want_areas] if want_areas else None

    def keep(e):
        if e.get("disabled_by") or e.get("hidden_by") or e.get("entity_category"):
            return False
        if any(x in e["entity_id"].lower() for x in exclude):
            return False
        if want_areas is not None:
            aid = area_of(e)
            if str(aid).lower() not in want_areas and area_name(aid).lower() not in want_areas:
                return False
        return True

    def of_class(dc):
        return [e for e in entities.values()
                if e["entity_id"].startswith("sensor.") and device_class(e) == dc and keep(e)]

    temps, hums = of_class("temperature"), of_class("humidity")

    def signature(entity_id):
        words = entity_id.split(".", 1)[1].split("_")
        return "_".join(sorted(w for w in words if not QUANTITY_WORDS.match(w)))

    taken, pairs = set(), []
    for t in temps:                                   # same device: unambiguous
        did = t.get("device_id")
        if not did:
            continue
        match = next((h for h in hums
                      if h.get("device_id") == did and h["entity_id"] not in taken), None)
        if match:
            taken.add(match["entity_id"])
            pairs.append((t, match))
    paired = {t["entity_id"] for t, _ in pairs}
    for t in temps:                                   # same signature, only if unique
        if t["entity_id"] in paired:
            continue
        sig = signature(t["entity_id"])
        if not sig:
            continue
        cands = [h for h in hums
                 if h["entity_id"] not in taken and signature(h["entity_id"]) == sig]
        if len(cands) == 1:
            taken.add(cands[0]["entity_id"])
            pairs.append((t, cands[0]))

    def label(t):
        dev = devices.get(t.get("device_id") or "")
        for candidate in (t.get("name"), t.get("original_name") if not dev else None,
                          (dev.get("name_by_user") or dev.get("name")) if dev else None,
                          t.get("original_name")):
            cleaned = strip_noise(candidate or "")
            if cleaned and len(cleaned) <= MAX_LABEL:
                return cleaned
        words = [w for w in t["entity_id"].split(".", 1)[1].split("_")
                 if not QUANTITY_WORDS.match(w)]
        return " ".join(words).capitalize()

    out = []
    for t, h in pairs:
        hint = area_name(area_of(t)) + " " + t["entity_id"]
        out.append({
            "name": label(t),
            "temperature": t["entity_id"],
            "humidity": h["entity_id"],
            "outdoor": bool(OUTDOOR_HINT.search(hint)),
        })
    return sorted(out, key=lambda s: s["name"].lower())


def render(pairs, labels, macros, suffixes):
    """One template sensor block, three sensors per pair.

    unique_id comes from the temperature entity, never from the display name: a device
    renamed in the UI must not orphan its history and create three fresh entities.
    """
    lines = [HEADER, "- sensor:"]
    for p in pairs:
        base = slug(re.sub(r"_temperature$", "", p["temperature"].split(".", 1)[1]))
        t, h = p["temperature"], p["humidity"]
        both = "{{ has_value('%s') and has_value('%s') }}" % (t, h)
        common = [
            "      state_class: measurement",
            '      availability: "%s"' % both,
        ]
        lines += [
            '    - name: "%s %s"' % (p["name"], labels[0]),
            "      unique_id: psychro_%s_%s" % (base, suffixes[0]),
            '      unit_of_measurement: "g/kg"',
        ] + common + [
            "      state: >",
            "        {%% from 'psychrometrics.jinja' import %s %%}" % macros[0],
            "        {{ %s(states('%s') | float, states('%s') | float) }}" % (macros[0], t, h),
            '    - name: "%s %s"' % (p["name"], labels[1]),
            "      unique_id: psychro_%s_%s" % (base, suffixes[1]),
            '      unit_of_measurement: "°C"',
            "      device_class: temperature",
            "      state_class: measurement",
            "      # Magnus-Tetens only holds from 0 to 60 C: outside it the sensor reports",
            "      # unavailable rather than a plausible-looking number (freezers, fridges).",
            "      availability: >",
            "        {{ has_value('%s') and has_value('%s')" % (t, h),
            "           and 0 <= states('%s') | float(-99) <= 60 }}" % t,
            "      state: >",
            "        {%% from 'psychrometrics.jinja' import %s %%}" % macros[1],
            "        {{ %s(states('%s') | float, states('%s') | float) }}" % (macros[1], t, h),
            '    - name: "%s %s"' % (p["name"], labels[2]),
            "      unique_id: psychro_%s_%s" % (base, suffixes[2]),
            '      unit_of_measurement: "kJ/kg"',
        ] + common + [
            "      state: >",
            "        {%% from 'psychrometrics.jinja' import %s %%}" % macros[2],
            "        {{ %s(states('%s') | float, states('%s') | float) }}" % (macros[2], t, h),
        ]
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="/config")
    ap.add_argument("--out", default=None)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--labels", default="absolute humidity,dew point,enthalpy",
                    help="suffixes appended to each sensor name")
    ap.add_argument("--macros", default="absolute_humidity,dew_point,enthalpy",
                    help="macro names in custom_templates/psychrometrics.jinja")
    ap.add_argument("--suffixes", default="absolute_humidity,dew_point,enthalpy",
                    help="unique_id suffixes; changing these renames every entity")
    args = ap.parse_args()
    labels = [x.strip() for x in args.labels.split(",")]
    macros = [x.strip() for x in args.macros.split(",")]
    suffixes = [x.strip() for x in args.suffixes.split(",")]
    if not (len(labels) == len(macros) == len(suffixes) == 3):
        sys.exit("--labels, --macros and --suffixes each need three comma-separated values")

    card = card_config(args.config)
    if card is None:
        print("unchanged: no psychrometric card in the dashboard", file=sys.stderr)
        return 0
    auto = card.get("auto_discover")
    options = {} if auto is True else (auto or {})

    declared = list(card.get("sensors") or [])
    pairs = declared[:]
    if auto:
        known = {s.get("temperature") for s in declared}
        pairs += [p for p in discover(args.config, options) if p["temperature"] not in known]

    body = render([{"name": p.get("name") or p["temperature"],
                    "temperature": p["temperature"], "humidity": p["humidity"]}
                   for p in pairs], labels, macros, suffixes)

    path = args.out or os.path.join(args.config, OUT_NAME)
    old = None
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            old = fh.read()
    if old == body:
        print("unchanged: %d pairs" % len(pairs))
        return 0
    if args.dry_run:
        print("changed (dry run): %d pairs" % len(pairs))
        return 0
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(body)
    print("changed: %d pairs, %d sensors" % (len(pairs), len(pairs) * 3))
    return 0


if __name__ == "__main__":
    sys.exit(main())
