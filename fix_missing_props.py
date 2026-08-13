import re

with open('src/backend/strategy-engine.ts', 'r') as f:
    text = f.read()

# fix createNoTrade
replacement = """      spot: spot,
      broken_level: 0,
      wall_above: 0,
      wall_below: 0,
      option_type: 'NONE',
      strike: 0,"""

text = text.replace("      spot_entry: spot,", f"{replacement}\n      spot_entry: spot,")

# fix mapToPublicDecision
# Wait, let's just make them optional in types.ts! It is easier.
