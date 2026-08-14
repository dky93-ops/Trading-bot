import re

with open('src/backend/strategy-engine.ts', 'r') as f:
    text = f.read()

pattern = r'if \(this\.getNearestExpiry\) expiry = await this\.getNearestExpiry\(index\);\n\s*const chain = await this\.getOptionChain\(index, expiry\);'
replacement = """const upstoxInstrumentKey = index === 'NIFTY' ? 'NSE_INDEX|Nifty 50' : index;
         if (this.getNearestExpiry) expiry = await this.getNearestExpiry(upstoxInstrumentKey);
         const chain = await this.getOptionChain(upstoxInstrumentKey, expiry);"""

text = re.sub(pattern, replacement, text)

with open('src/backend/strategy-engine.ts', 'w') as f:
    f.write(text)
