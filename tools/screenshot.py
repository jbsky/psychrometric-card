#!/usr/bin/env python3
"""Shoot docs/screenshot.png from tools/demo.html.

The README image is taken from invented sensors rather than from a running instance:
a screenshot of somebody's dashboard carries their room names, and nobody should have
to think about that before opening a pull request.

    python3 tools/screenshot.py [--out docs/screenshot.png]
"""

import argparse
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="docs/screenshot.png")
    parser.add_argument("--scale", type=int, default=2)
    options = parser.parse_args()

    out = ROOT / options.out
    out.parent.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(
            viewport={"width": 1000, "height": 700},
            device_scale_factor=options.scale,
        )
        page.goto((ROOT / "tools" / "demo.html").as_uri())
        card = page.locator("psychrometric-card")
        card.wait_for(state="visible")
        # The chart is drawn from a ResizeObserver callback, not from the first paint.
        page.wait_for_timeout(1200)
        card.screenshot(path=out)
        browser.close()

    print(out.relative_to(ROOT))


if __name__ == "__main__":
    main()
