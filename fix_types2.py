import re
with open('src/backend/types.ts', 'r') as f:
    text = f.read()

text = text.replace('  option_target2?: number;\n}', '  option_target2?: number;\n  instrumentKey?: string;\n}')

with open('src/backend/types.ts', 'w') as f:
    f.write(text)
