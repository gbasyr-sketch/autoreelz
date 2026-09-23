"""Lossless WOFF2 packaging of the existing licensed Manrope TTFs.
One-off tooling: python3 -m venv tmp/stage-6-font-tools
  tmp/stage-6-font-tools/bin/pip install fonttools==4.60.1 brotli==1.1.0
  tmp/stage-6-font-tools/bin/python scripts/compress-fonts.py
TTFs remain the source; no subsetting or glyph/design changes.
"""
from pathlib import Path
from fontTools.ttLib import TTFont
import json
root = Path(__file__).resolve().parents[1]
results = []
for path in sorted((root / 'public/fonts').glob('manrope-*.ttf')):
    source = TTFont(path, recalcTimestamp=False)
    source.flavor = 'woff2'
    output = path.with_suffix('.woff2')
    source.save(output)
    decoded = TTFont(output, recalcTimestamp=False)
    original = TTFont(path, recalcTimestamp=False)
    assert decoded.getBestCmap() == original.getBestCmap()
    assert decoded['hmtx'].metrics == original['hmtx'].metrics
    assert decoded.getGlyphOrder() == original.getGlyphOrder()
    for glyph in original.getGlyphOrder():
        assert decoded['glyf'][glyph].getCoordinates(decoded['glyf']) == original['glyf'][glyph].getCoordinates(original['glyf'])
    for codepoint in (0x0410, 0x0430, 0x0401, 0x0451, 0x20BD):
        assert codepoint in decoded.getBestCmap(), hex(codepoint)
    results.append({'source': path.name, 'sourceBytes': path.stat().st_size,
                    'output': output.name, 'outputBytes': output.stat().st_size,
                    'glyphCount': len(decoded.getGlyphOrder()), 'sameCmapMetricsAndOutlines': True})
report = root / 'artifacts/stage-6/font-compression.json'
report.parent.mkdir(parents=True, exist_ok=True)
report.write_text(json.dumps({'fontTools':'4.60.1','brotli':'1.1.0','files':results}, indent=2) + '\n')
print(json.dumps(results, indent=2))
