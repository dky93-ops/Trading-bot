import re
with open('src/backend/types.ts', 'r') as f:
    text = f.read()

text = text.replace('  signals: EngineDecision[];', '  signals: any[];')

with open('src/backend/types.ts', 'w') as f:
    f.write(text)
