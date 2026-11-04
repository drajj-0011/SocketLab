import { useEffect, useState } from 'react'
import serverSource from '../server/main.cpp?raw'
import cmakeSource from '../CMakeLists.txt?raw'
import readmeSource from '../README.md?raw'
import './index.css'

type RouteKey = 'health' | 'time' | 'echo' | 'missing'
type Result = { status: number; statusText: string; body: string; duration: number; size: number }

const routes: Record<RouteKey, { method: 'GET' | 'POST'; path: string; label: string }> = {
  health: { method: 'GET', path: '/api/health', label: 'Server health' },
  time: { method: 'GET', path: '/api/time', label: 'Current time' },
  echo: { method: 'POST', path: '/api/echo', label: 'Echo a message' },
  missing: { method: 'GET', path: '/api/unknown', label: 'Try a 404' },
}

const files = [
  { name: 'main.cpp', language: 'C++', source: serverSource },
  { name: 'CMakeLists.txt', language: 'CMake', source: cmakeSource },
  { name: 'README.md', language: 'Markdown', source: readmeSource },
]

function ArrowIcon({ diagonal = false }: { diagonal?: boolean }) {
  return diagonal ? (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 19 19 5M7 5h12v12" /></svg>
  ) : (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12h16m-7-7 7 7-7 7" /></svg>
  )
}

function CopyIcon({ checked = false }: { checked?: boolean }) {
  return checked ? (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
  ) : (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>
  )
}

function Logo() {
  return <a className="brand" href="#top" aria-label="Socketlab home"><span className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></span><span>socketlab<span className="brand-period">.</span></span></a>
}

function App() {
  const [selectedRoute, setSelectedRoute] = useState<RouteKey>('health')
  const [message, setMessage] = useState('Hello, sockets!')
  const [mode, setMode] = useState<'checking' | 'live' | 'demo'>('checking')
  const [result, setResult] = useState<Result>({ status: 200, statusText: 'OK', body: JSON.stringify({ status: 'ok', server: 'Socketlab', uptime_seconds: 42, requests: 1 }, null, 2), duration: 12, size: 76 })
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState<'curl' | 'source' | null>(null)
  const [activeFile, setActiveFile] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [platform, setPlatform] = useState<'windows' | 'unix'>(() => navigator.userAgent.includes('Windows') ? 'windows' : 'unix')

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/health', { signal: controller.signal })
      .then(async response => {
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Not the C++ server')
        const data = await response.json()
        if (data.server !== 'Socketlab') throw new Error('Not the C++ server')
        setMode('live')
        const body = JSON.stringify(data, null, 2)
        setResult({ status: 200, statusText: 'OK', body, duration: 12, size: new Blob([body]).size })
      })
      .catch(error => { if (error.name !== 'AbortError') setMode('demo') })
    return () => controller.abort()
  }, [])

  const current = routes[selectedRoute]

  function makeDemoResult(key: RouteKey, text: string): Result {
    let status = 200
    let statusText = 'OK'
    let data: object
    if (key === 'health') data = { status: 'ok', server: 'Socketlab', uptime_seconds: 42, requests: 2 }
    else if (key === 'time') data = { utc: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') }
    else if (key === 'echo') data = { message: text, bytes: new TextEncoder().encode(text).length }
    else { status = 404; statusText = 'Not Found'; data = { error: 'No route matches this path', status: 404 } }
    const body = JSON.stringify(data, null, 2)
    return { status, statusText, body, duration: Math.floor(8 + Math.random() * 17), size: new Blob([JSON.stringify(data)]).size }
  }

  async function sendRequest(key: RouteKey = selectedRoute) {
    if (loading) return
    setLoading(true)
    const route = routes[key]
    if (mode === 'live') {
      const started = performance.now()
      try {
        const response = await fetch(route.path, {
          method: route.method,
          ...(route.method === 'POST' ? { headers: { 'Content-Type': 'text/plain' }, body: message } : {}),
        })
        const raw = await response.text()
        let body = raw
        try { body = JSON.stringify(JSON.parse(raw), null, 2) } catch { /* Keep non-JSON responses readable. */ }
        setResult({ status: response.status, statusText: response.statusText, body, duration: Math.max(1, Math.round(performance.now() - started)), size: new Blob([raw]).size })
      } catch {
        setMode('demo')
        setResult(makeDemoResult(key, message))
      }
    } else {
      await new Promise(resolve => setTimeout(resolve, 380))
      setResult(makeDemoResult(key, message))
    }
    setLoading(false)
  }

  async function copy(text: string, target: 'curl' | 'source') {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(target)
      window.setTimeout(() => setCopied(null), 1800)
    } catch { /* Clipboard permissions vary by browser. */ }
  }

  const curl = `curl -i ${current.method === 'POST' ? "-X POST -H 'Content-Type: text/plain' -d '" + message.replace(/'/g, "'\\''") + "' " : ''}http://localhost:8080${current.path}`
  const sourceLines = files[activeFile].source.trimEnd().split('\n')
  const visibleLines = showAll ? sourceLines : sourceLines.slice(0, 34)

  return (
    <div id="top" className="site-shell">
      <header className="site-header">
        <div className="page-container header-inner">
          <Logo />
          <nav className={mobileOpen ? 'main-nav is-open' : 'main-nav'} aria-label="Main navigation">
            <a href="#overview" onClick={() => setMobileOpen(false)}>Overview</a>
            <a href="#playground" onClick={() => setMobileOpen(false)}>Playground</a>
            <a href="#architecture" onClick={() => setMobileOpen(false)}>How it works</a>
            <a href="#source" onClick={() => setMobileOpen(false)}>Source code</a>
          </nav>
          <a className="header-action" href="#source">Explore the code <ArrowIcon diagonal /></a>
          <button className="mobile-menu" type="button" aria-label={mobileOpen ? 'Close menu' : 'Open menu'} aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)}><span /><span /></button>
        </div>
      </header>

      <main>
        <section className="hero" id="overview">
          <div className="hero-grid" aria-hidden="true" /><div className="hero-glow" aria-hidden="true" />
          <div className="page-container hero-layout">
            <div className="hero-copy">
              <div className="eyebrow"><span className="eyebrow-line" /> C++17 / RAW SOCKETS / HTTP/1.1</div>
              <h1>socketlab<span>.</span></h1>
              <p className="hero-headline">The web server,<br /><em>stripped to the socket.</em></p>
              <p className="hero-description">A real HTTP server built from scratch in C++. No frameworks. No shortcuts. Just a TCP socket, a request, and a response.</p>
              <div className="hero-actions"><a href="#playground" className="button-primary">Try the playground <ArrowIcon diagonal /></a><a href="#architecture" className="button-text">See how it works <ArrowIcon /></a></div>
              <div className="hero-note"><span className="pulse-dot" /> OPEN SOURCE LEARNING PROJECT</div>
            </div>

            <div className="terminal-wrap" id="playground">
              <div className="terminal-topbar"><div className="window-dots"><i /><i /><i /></div><span>request playground</span><span className="terminal-top-icon">_ <span>□</span> ×</span></div>
              <div className="terminal-body">
                <div className="terminal-label-row"><span className="terminal-label">01 / COMPOSE REQUEST</span><span className="mode-indicator"><i className={mode === 'live' ? 'live' : ''} />{mode === 'live' ? 'LIVE SERVER' : mode === 'checking' ? 'CONNECTING' : 'DEMO MODE'}</span></div>
                <div className="request-line"><span className={current.method === 'POST' ? 'method post' : 'method'}>{current.method}</span><select aria-label="Choose endpoint" value={selectedRoute} onChange={event => setSelectedRoute(event.target.value as RouteKey)}>{Object.entries(routes).map(([key, route]) => <option key={key} value={key}>{route.path}</option>)}</select><span className="request-chevron">⌄</span></div>
                {selectedRoute === 'echo' && <label className="body-field">REQUEST BODY<textarea aria-label="Request body" value={message} onChange={event => setMessage(event.target.value)} maxLength={10000} spellCheck={false} /></label>}
                <div className="request-actions"><span>HTTP/1.1 <span className="request-separator">·</span> localhost:8080</span><button type="button" onClick={() => sendRequest()} disabled={loading || mode === 'checking'}>{loading ? 'Sending...' : 'Send request'} <ArrowIcon /></button></div>
                <div className="terminal-divider" />
                <div className="terminal-label-row response-heading"><span className="terminal-label">02 / SERVER RESPONSE</span><span className="response-time">{result.duration} ms <span>·</span> {result.size} B</span></div>
                <div className="response-status"><span className={result.status < 400 ? 'status-dot' : 'status-dot error-dot'} /> <strong>{result.status}</strong> {result.statusText} <span className="response-protocol">HTTP/1.1</span></div>
                <pre className="response-body"><code>{result.body}</code></pre>
                <div className="terminal-bottom"><span><span className="terminal-prompt">$</span> ready for next request<span className="cursor-block" /></span><button type="button" onClick={() => copy(curl, 'curl')} title="Copy cURL command"><CopyIcon checked={copied === 'curl'} /> {copied === 'curl' ? 'Copied' : 'Copy cURL'}</button></div>
              </div>
            </div>
          </div>
          <div className="page-container hero-foot"><span>BUILT TO UNDERSTAND WHAT'S UNDER THE HOOD</span><span>SCROLL TO EXPLORE <span className="down-arrow">↓</span></span></div>
        </section>

        <section className="architecture-section" id="architecture"><div className="page-container">
          <div className="section-heading"><div><span className="section-index">01 / THE IDEA</span><h2>From connection<br />to conversation<span className="accent">.</span></h2></div><p>Every time you open a website, a server does this dance. Socketlab makes every step visible.</p></div>
          <div className="steps">
            <div className="step"><span className="step-number">01</span><div className="step-icon"><span className="step-ring" /></div><h3>Open a socket</h3><p>Bind to a port and listen for incoming TCP connections.</p><span className="step-code">socket() → bind() → listen()</span></div>
            <div className="step"><span className="step-number">02</span><div className="step-icon"><span className="step-arrows">⇄</span></div><h3>Read the request</h3><p>Accept a client, parse its HTTP headers and read the body.</p><span className="step-code">accept() → recv()</span></div>
            <div className="step"><span className="step-number">03</span><div className="step-icon"><span className="step-braces">{'{ }'}</span></div><h3>Route & respond</h3><p>Match the path and build a proper HTTP response.</p><span className="step-code">HTTP/1.1 200 OK</span></div>
            <div className="step"><span className="step-number">04</span><div className="step-icon"><span className="step-close">×</span></div><h3>Close the loop</h3><p>Send every byte, close the connection, and wait again.</p><span className="step-code">send() → close()</span></div>
          </div>
        </div></section>

        <section className="routes-section" id="routes"><div className="page-container routes-layout">
          <div className="routes-intro"><span className="section-index">02 / THE ENDPOINTS</span><h2>Small surface.<br /><span>Real responses.</span></h2><p>Three working API routes, plus static file serving. Pick one and see exactly what comes back.</p><a href="#playground" className="inline-link">Test an endpoint <ArrowIcon diagonal /></a></div>
          <div className="routes-list">{(['health', 'time', 'echo'] as RouteKey[]).map((key, index) => <button className="route-row" key={key} type="button" onClick={() => { setSelectedRoute(key); document.getElementById('playground')?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }}><span className="route-index">0{index + 1}</span><span className={routes[key].method === 'POST' ? 'route-method post' : 'route-method'}>{routes[key].method}</span><span className="route-path">{routes[key].path}</span><span className="route-description">{routes[key].label}</span><ArrowIcon diagonal /></button>)}<div className="routes-footnote"><span className="tiny-square" /> Also serves your built frontend from the <code>dist/</code> directory.</div></div>
        </div></section>

        <section className="source-section" id="source"><div className="page-container">
          <div className="source-heading"><div><span className="section-index">03 / THE SOURCE</span><h2>No magic. <span>Just code.</span></h2><p>Everything is right here. Read it, run it, break it, make it yours.</p></div><div className="source-heading-side"><span>01 SERVER</span><span>03 API ROUTES</span><span>00 FRAMEWORKS</span></div></div>
          <div className="source-browser"><div className="source-toolbar"><div className="source-tabs" role="tablist" aria-label="Source files">{files.map((file, index) => <button type="button" role="tab" aria-selected={activeFile === index} className={activeFile === index ? 'active' : ''} key={file.name} onClick={() => { setActiveFile(index); setShowAll(false) }}>{file.name}</button>)}</div><button type="button" className="source-copy" onClick={() => copy(files[activeFile].source, 'source')}><CopyIcon checked={copied === 'source'} /> {copied === 'source' ? 'Copied' : 'Copy file'}</button></div>
            <div className="source-meta"><span><span className="file-dot" /> socketlab / {files[activeFile].name}</span><span>{files[activeFile].language} <span className="meta-separator">/</span> {sourceLines.length} lines</span></div>
            <div className="code-scroll" role="tabpanel"><pre>{visibleLines.map((line, index) => <span className="code-line" key={index}><span className="line-number">{index + 1}</span><span className="line-content">{line || ' '}</span></span>)}</pre></div>
            <button type="button" className="expand-code" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show less' : `Show all ${sourceLines.length} lines`} <span>{showAll ? '↑' : '↓'}</span></button>
          </div>
        </div></section>

        <section className="run-section" id="run"><div className="page-container run-layout"><div><span className="section-index">04 / RUN IT YOURSELF</span><h2>Build it. Run it.<br /><span>Understand it.</span></h2><p>All you need is a C++17 compiler and a little curiosity. Choose your operating system to get started.</p></div><div className="run-command"><div className="run-command-top"><span>TERMINAL</span><div className="platform-switch"><button className={platform === 'windows' ? 'active' : ''} type="button" onClick={() => setPlatform('windows')}>WINDOWS</button><button className={platform === 'unix' ? 'active' : ''} type="button" onClick={() => setPlatform('unix')}>LINUX / MAC</button></div></div><pre><span>{platform === 'windows' ? 'PS>' : '$'}</span> npm install<br /><span>{platform === 'windows' ? 'PS>' : '$'}</span> npm run build<br /><span>{platform === 'windows' ? 'PS>' : '$'}</span> g++ -std=c++17 -O2 server/main.cpp -o {platform === 'windows' ? 'socketlab.exe -lws2_32' : 'socketlab'}<br /><span>{platform === 'windows' ? 'PS>' : '$'}</span> {platform === 'windows' ? '.\\socketlab.exe' : './socketlab'} 8080</pre><div className="run-command-bottom">Listening on <strong>http://localhost:8080</strong><span className="cursor-block" /></div></div></div></section>
      </main>
      <footer className="site-footer"><div className="page-container footer-inner"><Logo /><span>BUILT FROM FIRST PRINCIPLES. MADE TO BE TAKEN APART.</span><a href="#top">Back to top ↑</a></div></footer>
    </div>
  )
}

export default App
