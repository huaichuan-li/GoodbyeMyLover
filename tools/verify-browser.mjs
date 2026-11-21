// Headless-Chrome CDP verification for the new GLB assets.
// Requires a Chrome started with --remote-debugging-port=9222.
// Node 22 provides a global WebSocket; no third-party dependency needed.
import fs from 'node:fs';

const CDP = 'http://127.0.0.1:9222';
const URL = process.env.GAME_URL || 'http://127.0.0.1:8080/';
const SHOT = process.env.SHOT_PATH || '/tmp/gameplay-verify.jpg';

async function getJSON(path) {
  const r = await fetch(CDP + path);
  if (!r.ok) throw new Error('CDP ' + path + ' -> ' + r.status);
  return r.json();
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', e => reject(e.error || new Error('ws error')));
  });
}

function makeCaller(ws) {
  let id = 0;
  const waiting = new Map();
  const events = [];
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiting.has(msg.id)) {
      const { resolve, reject } = waiting.get(msg.id);
      waiting.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method) events.push(msg);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const callId = ++id;
    waiting.set(callId, { resolve, reject });
    ws.send(JSON.stringify({ id: callId, method, params }));
  });
  return { send, events };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const evalJS = async (send, expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: false });
  if (r.exceptionDetails) return { error: r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '') };
  return r.result && r.result.value;
};

async function main() {
  const targets = await getJSON('/json');
  const page = targets.find(t => t.type === 'page');
  if (!page) throw new Error('no page target');
  const ws = await connect(page.webSocketDebuggerUrl);
  const { send, events } = makeCaller(ws);

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Network.enable');
  await send('Page.navigate', { url: URL });
  await sleep(9000);

  const titleState = await evalJS(send, 'window.G&&window.G.State?window.G.State.current:null');

  // Drive the game into PLAY with both players close together to inspect character models.
  await evalJS(send, `(function(){
    const G=window.G;
    G.Game.reset('debug');
    const w=G.Game.world;
    Object.assign(w.p1,{x:1100,y:490,floor:1});
    Object.assign(w.p2,{x:1250,y:490,floor:1});
    G.Game.onPress({code:'KeyY',owner:'p1'});
    G.Game.onPress({code:'GamepadA',owner:'p2',source:'gamepad'});
    G.Game.updateWheels(5);
    G.Game.onPress({code:'KeyY',owner:'p1'});
    G.Game.onPress({code:'GamepadA',owner:'p2',source:'gamepad'});
    w.p1.beam=G.Beam.effectiveBeam(null);
    w.p2.beam=G.Beam.effectiveBeam(null);
    return G.State.current;
  })()`);
  await sleep(2500);

  const playState = await evalJS(send, 'window.G&&window.G.State?window.G.State.current:null');
  const worldInfo = await evalJS(send, `(function(){
    const w=window.G.Game.world;
    if(!w)return null;
    return {
      floorCount:w.floorCount,
      allFloor1:w.entities.every(e=>e.floor===1),
      entityCount:w.entities.length,
      traitP1:w.p1.traits.join(','),
      traitP2:w.p2.traits.join(',')
    };
  })()`);

  // Capture a screenshot via CDP (avoids the MCP 10MiB canvas issue).
  const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70, captureBeyondViewport: false });
  fs.writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));

  const glbRequests = events
    .filter(e => e.method === 'Network.responseReceived' && /\.glb(\?|$)/.test(e.params.response.url))
    .map(e => ({ url: e.params.response.url.split('/').pop(), status: e.params.response.status }));
  const notFound = events
    .filter(e => e.method === 'Network.responseReceived' && e.params.response.status >= 400)
    .map(e => e.params.response.url);
  const consoleErrors = events
    .filter(e => e.method === 'Runtime.exceptionThrown' ||
      (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'))
    .map(e => {
      if (e.method === 'Runtime.exceptionThrown') return 'EXCEPTION: ' + (e.params.exceptionDetails.text || e.params.exceptionDetails.exception?.description || '');
      return 'CONSOLE: ' + e.params.args.map(a => a.value || a.description || '').join(' ');
    });

  console.log(JSON.stringify({ titleState, playState, worldInfo, glbRequests, notFound, consoleErrors, screenshot: SHOT }, null, 2));
  ws.close();
}

main().catch(err => { console.error(err); process.exit(1); });
