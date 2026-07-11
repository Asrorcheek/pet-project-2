#!/usr/bin/env python3
"""Return direct product-image candidates from the DDGS image index."""

import json
import sys
from urllib.parse import urlparse

from ddgs import DDGS


def is_http_url(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        return urlparse(value).scheme in {"http", "https"}
    except ValueError:
        return False


def main() -> int:
    query = sys.argv[1].strip() if len(sys.argv) > 1 else ""
    limit = min(max(int(sys.argv[2]), 1), 20) if len(sys.argv) > 2 else 8
    if not query:
        print("[]")
        return 0

    results = []
    for item in DDGS().images(query, safesearch="on", max_results=limit):
        image_url = item.get("image")
        source_url = item.get("url")
        if not is_http_url(image_url) or not is_http_url(source_url):
            continue
        results.append(
            {
                "title": str(item.get("title") or ""),
                "image": image_url,
                "url": source_url,
                "source": str(item.get("source") or ""),
                "width": item.get("width"),
                "height": item.get("height"),
            }
        )

    print(json.dumps(results, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
