import re

with open('src/backend/strategy-engine.ts', 'r') as f:
    text = f.read()

text = text.replace('private history:', 'public history:')

with open('src/backend/strategy-engine.ts', 'w') as f:
    f.write(text)
