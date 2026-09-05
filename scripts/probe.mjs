import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, extname } from 'node:path'
const payload = JSON.parse(await readFile('scripts/payload.json', 'utf8'))
const harness = `<!doctype html><html><head><meta charset="utf-8"/><link rel="stylesheet" href="./main.css"/>
<style>:root{--vscode-editor-background:#1f1f1f;--vscode-editor-foreground:#ccc;--vscode-editor-font-family:monospace;--vscode-diffEditor-insertedTextBackground:#2b5b3a66}</style>
</head><body class="vscode-dark"><div id="root"></div>
<script>const payload=${JSON.stringify(payload)};let s={};window.acquireVsCodeApi=()=>({postMessage:m=>{if(m.type==='ready')setTimeout(()=>window.postMessage({type:'review',payload},'*'),0)},setState:x=>{s=x},getState:()=>s})</script>
<script type="module" src="./main.js"></script></body></html>`
const types={'.js':'text/javascript','.css':'text/css','.map':'application/json'}
const server=createServer(async(req,res)=>{const url=(req.url??'/').split('?')[0]
 if(url.startsWith('/h')){res.writeHead(200,{'Content-Type':'text/html'});res.end(harness);return}
 try{const b=await readFile(join('dist/webview',url));res.writeHead(200,{'Content-Type':types[extname(url)]??'application/octet-stream'});res.end(b)}catch{res.writeHead(404);res.end()}})
await new Promise(r=>server.listen(4321,r))
const browser=await chromium.launch({args:['--no-sandbox']})
const page=await browser.newPage()
await page.goto('http://localhost:4321/h',{waitUntil:'networkidle'})
await page.waitForSelector('.gdr-file')
const info = await page.evaluate(() => {
  const sections=[...document.querySelectorAll('.gdr-file')]
  const server=sections.find(s=>s.textContent?.includes('src/server.ts'))
  const inserts=[...(server?.querySelectorAll('.diff-code-insert')??[])].slice(0,3)
  return inserts.map(td=>({ text: td.textContent, html: td.innerHTML.slice(0,400) }))
})
console.log(JSON.stringify(info,null,2))
await browser.close(); server.close()
