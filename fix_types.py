import re
with open('src/backend/types.ts', 'r') as f:
    text = f.read()
if 'instrumentKey?: string;' not in text:
    text = text.replace('option_target2?: number;', 'option_target2?: number;\n  instrumentKey?: string;')
with open('src/backend/types.ts', 'w') as f:
    f.write(text)

with open('src/backend/strategy-engine.ts', 'r') as f:
    text = f.read()

# Remove the 'prices: { ... },' block from createNoTrade
pattern = r'prices:\s*\{[^\}]*\},\s*'
text = re.sub(pattern, '', text)
with open('src/backend/strategy-engine.ts', 'w') as f:
    f.write(text)
