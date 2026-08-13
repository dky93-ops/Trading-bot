import re
with open('src/backend/types.ts', 'r') as f:
    text = f.read()

text = text.replace('  fake_signal_filters_passed: string[];', '  fake_signal_filters_passed?: string[];')
text = text.replace('  fake_signal_filters_failed: string[];', '  fake_signal_filters_failed?: string[];')

with open('src/backend/types.ts', 'w') as f:
    f.write(text)
