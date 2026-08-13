import re
with open('src/backend/types.ts', 'r') as f:
    text = f.read()

text = text.replace('  spot: number;', '  spot?: number;')
text = text.replace('  broken_level: number;', '  broken_level?: number;')
text = text.replace('  wall_above: number;', '  wall_above?: number;')
text = text.replace('  wall_below: number;', '  wall_below?: number;')
text = text.replace('  option_type: \'CE\' | \'PE\' | \'NONE\';', '  option_type?: \'CE\' | \'PE\' | \'NONE\';')
text = text.replace('  strike: number;', '  strike?: number;')

with open('src/backend/types.ts', 'w') as f:
    f.write(text)
