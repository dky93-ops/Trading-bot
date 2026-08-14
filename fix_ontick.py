import re

with open('src/backend/strategy-engine.ts', 'r') as f:
    text = f.read()

pattern = r'return decisions;\n\s*\}\n\s*private async evaluateIndex'
replacement = """    // Instead of just new decisions, return all active and recently closed signals so the frontend can display them properly
    const allSignals = [
      ...Array.from(this.activeSignals.values()),
      ...Array.from(this.history.values()).reverse()
    ].slice(0, 15);
    return allSignals;
  }
  private async evaluateIndex"""

text = re.sub(pattern, replacement, text)

# We also need to change the return type of onTick from EngineDecision[] to any[] or InternalSignal[]
text = text.replace('public async onTick(newState: AppState): Promise<EngineDecision[]> {', 'public async onTick(newState: AppState): Promise<any[]> {')

with open('src/backend/strategy-engine.ts', 'w') as f:
    f.write(text)
