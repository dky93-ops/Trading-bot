import re

with open('src/backend/upstox-service.ts', 'r') as f:
    text = f.read()

# Replace getNearestExpiry
pattern = r'axios\.get\(`https://api\.upstox\.com/v2/option/contract\?instrument_key=\$\{encodeURIComponent\(instrumentKey\)\}`,\s*\{'
replacement = """axios.get(`https://api.upstox.com/v2/option/contract`, {
        params: { instrument_key: instrumentKey },
"""
text = re.sub(pattern, replacement, text)

with open('src/backend/upstox-service.ts', 'w') as f:
    f.write(text)
