import WebSocket from 'ws';
const ws = new WebSocket('ws://localhost:3000');
ws.on('open', () => {
  console.log("Connected");
});
ws.on('message', (data) => {
  console.log("Message:", JSON.parse(data.toString()));
  ws.close();
});
