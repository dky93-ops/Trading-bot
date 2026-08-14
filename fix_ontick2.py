import re

with open('src/backend/strategy-engine.ts', 'r') as f:
    text = f.read()

replacement = """      return [
        ...Array.from(this.activeSignals.values()),
        ...Array.from(this.history.values()).reverse()
      ].slice(0, 15);"""

text = text.replace('      return decisions;\n    }\n\n    // Manage active trades first', f"{replacement}\n    }}\n\n    // Manage active trades first")

with open('src/backend/strategy-engine.ts', 'w') as f:
    f.write(text)
