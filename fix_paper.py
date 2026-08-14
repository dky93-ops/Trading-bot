import re

with open('src/backend/upstox-service.ts', 'r') as f:
    text = f.read()

# Remove isPaperTradingOnly method completely
text = re.sub(r'\s*private isPaperTradingOnly\(\): boolean \{[^}]+\}\n', '', text)

# Replace checks
text = text.replace('!this.isPaperTradingOnly() || ', '')
text = text.replace('this.isPaperTradingOnly() && ', '')

# In init()
#    if (!this.isPaperTradingOnly()) {
#      this.state.apiError =
#        'Blocked: set PAPER_TRADING_ONLY=true. Live trading is disabled.';
#    } else if (!this.hasBrokerCredentials()) {
pattern_init = r'if \(!this\.isPaperTradingOnly\(\)\) \{[^}]+\}\s*else if \(!this\.hasBrokerCredentials\(\)\) \{'
text = re.sub(pattern_init, 'if (!this.hasBrokerCredentials()) {', text)

# Remove liveOrdersEnabled: false and paperTradingOnly: this.isPaperTradingOnly()
text = re.sub(r'\s*paperTradingOnly:\s*this\.isPaperTradingOnly\(\),', '', text)
text = re.sub(r'\s*liveOrdersEnabled:\s*false,', '', text)

# Replace paperOnly &&
text = text.replace('const paperOnly = this.isPaperTradingOnly();\n', '')
text = text.replace('paperOnly &&', '')

with open('src/backend/upstox-service.ts', 'w') as f:
    f.write(text)

with open('server.ts', 'r') as f:
    server_text = f.read()

server_text = re.sub(r'\s*paperTradingOnly: upstoxService\.getPublicSettings\(\)\.paperTradingOnly,', '', server_text)
server_text = re.sub(r'upstoxService\.getPublicSettings\(\)\.paperTradingOnly\n\s*\?\s*\(upstoxService\.getState\(\)\.isConnected \? \'healthy\' : \'degraded\'\)\n\s*:\s*\'blocked\'', 'upstoxService.getState().isConnected ? \'healthy\' : \'degraded\'', server_text)
server_text = re.sub(r'status:\s*upstoxService\.getPublicSettings\(\)\.paperTradingOnly[^,]+,', 'status: upstoxService.getState().isConnected ? \'healthy\' : \'degraded\',', server_text)

with open('server.ts', 'w') as f:
    f.write(server_text)

with open('.env.example', 'r') as f:
    env_text = f.read()
env_text = env_text.replace('PAPER_TRADING_ONLY=true\n', '')
with open('.env.example', 'w') as f:
    f.write(env_text)

