import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, extname } from 'node:path'
const payload = JSON.parse(await readFile('scripts/payload.json', 'utf8'))
const vars = '--vscode-editor-background:#1f1f1f;--vscode-editor-foreground:#ccc;--vscode-editor-font-family:monospace;--vscode-editor-font-size:12.5px;--vscode-panel-border:#2b2b2b;--vscode-descriptionForeground:#9d9d9d;--vscode-diffEditor-insertedLineBackground:#1c3323;--vscode-diffEditor-removedLineBackground:#3a1d1d;--vscode-button-background:#0078d4;--vscode-button-foreground:#fff'
const harness = `<!doctype html><html><head><meta charset="utf-8"/><link rel="stylesheet" href="./main.css"/><style>:root{${vars}}html,body{height:100%}</style></head><body class="vscode-dark"><div id="root"></div>
<script>const payload=${JSON.stringify(payload)};let s={};window.acquireVsCodeApi=()=>({postMessage:m=>{if(m.type==='ready')setTimeout(()=>window.postMessage({type:'review',payload},'*'),0)},setState:x=>{s=x},getState:()=>s})</script>
<script type="module" src="./main.js"></script></body></html>`
const types={'.js':'text/javascript','.css':'text/css','.map':'application/json'}
const server=createServer(async(req,res)=>{const url=(req.url??'/').split('?')[0]
 if(url.startsWith('/h')){res.writeHead(200,{'Content-Type':'text/html'});res.end(harness);return}
 try{const b=await readFile(join('dist/webview',url));res.writeHead(200,{'Content-Type':types[extname(url)]??'application/octet-stream'});res.end(b)}catch{res.writeHead(404);res.end()}})
await new Promise(r=>server.listen(4323,r))
const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']})
const page=await browser.newPage({viewport:{width:1440,height:900}})
await page.goto('http://localhost:4323/h',{waitUntil:'networkidle'})
await page.waitForSelector('.gdr-file')
const probe = async (scrollTop) => page.evaluate((top) => {
  const main = document.querySelector('.gdr-main')
  main.scrollTop = top
  const first = document.querySelector('.gdr-chapter-sticky')
  const cell = document.querySelector('.gdr-chapter-summary')
  const mainTop = main.getBoundingClientRect().top
  return {
    scrollTop: main.scrollTop,
    stickyTopInView: Math.round(first.getBoundingClientRect().top - mainTop),
    cellHeight: Math.round(cell.getBoundingClientRect().height),
    stickyHeight: Math.round(first.getBoundingClientRect().height),
  }
}, scrollTop)
console.log('at rest      ', JSON.stringify(await probe(0)))
console.log('scrolled 300 ', JSON.stringify(await probe(300)))
console.log('scrolled 600 ', JSON.stringify(await probe(600)))
await browser.close(); server.close()
