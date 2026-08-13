import re
with open('src/backend/strategy-engine.ts', 'r') as f:
    text = f.read()

text = text.replace('      spotEntry: spot,\n      spotInvalidation: 0,\n      spotTarget1: 0,\n      spotTarget2: 0,\n      optionEntry: 0,\n      optionStoploss: 0,\n      optionTarget1: 0,\n      optionTarget2: 0,', '      spot_entry: spot,\n      spot_invalidation: 0,\n      spot_target1: 0,\n      spot_target2: 0,\n      option_entry: 0,\n      option_stoploss: 0,\n      option_target1: 0,\n      option_target2: 0,')

with open('src/backend/strategy-engine.ts', 'w') as f:
    f.write(text)
