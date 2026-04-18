// =====================================================
// CONFIGURATION
// =====================================================
const DEFAULT_WISP = window.SITE_CONFIG?.defaultWisp ?? "wss://military.marincareers.org/wisp/";
const WISP_SERVERS = [{ name: "Default Wisp", url: "wss://military.marincareers.org/wisp/" }];
const BOOT_TIMEOUT_MS = 8000;
const SCRAMJET_SCRIPT_URLS = [
    "https://cdn.jsdelivr.net/gh/Destroyed12121/Staticsj@main/JS/scramjet.all.js",
    "https://fastly.jsdelivr.net/gh/Destroyed12121/Staticsj@main/JS/scramjet.all.js"
];
const BARE_MUX_IMPORT_URLS = [
    "./vendor/bare-mux/index.mjs",
    "https://cdn.jsdelivr.net/npm/@mercuryworkshop/bare-mux/dist/index.mjs",
    "https://unpkg.com/@mercuryworkshop/bare-mux/dist/index.mjs",
    "https://esm.sh/@mercuryworkshop/bare-mux"
];

const memoryStorage = {};
function storageGetItem(key) {
    try {
        const value = localStorage.getItem(key);
        return value ?? memoryStorage[key] ?? null;
    } catch {
        return memoryStorage[key] ?? null;
    }
}

function storageSetItem(key, value) {
    memoryStorage[key] = value;
    try {
        localStorage.setItem(key, value);
    } catch {}
}

if (!storageGetItem("proxServer")) {
    storageSetItem("proxServer", DEFAULT_WISP);
}

function showFatalBootError(message, detail = "") {
    const root = document.getElementById("app");
    if (!root) return;
    root.innerHTML = `
        <div class="message-container" style="display:flex; position:fixed; inset:0;">
            <div class="message-content">
                <h1><i class="fa-solid fa-triangle-exclamation"></i> Startup Error</h1>
                <p>${message}</p>
                ${detail ? `<p style="margin-top:8px;word-break:break-word;opacity:.85;">${detail}</p>` : ""}
                <button onclick="location.reload()" style="margin-top:12px;padding:8px 14px;cursor:pointer;">Reload</button>
            </div>
        </div>`;
}

function initializeFallbackBrowser(reason = "") {
    const root = document.getElementById("app");
    if (!root) return;
    root.innerHTML = `
        <div class="browser-container">
            <div class="flex nav" style="padding:12px; gap:8px;">
                <input class="bar" id="fallback-address" autocomplete="off" placeholder="Enter URL or search query">
                <button id="fallback-go" title="Go"><i class="fa-solid fa-arrow-right"></i></button>
                <button id="fallback-open" title="Open in new tab"><i class="fa-solid fa-up-right-from-square"></i></button>
            </div>
            <div class="iframe-container" style="position:relative;">
                <div class="message-container" style="display:flex; position:absolute; inset:0; z-index:2; background:rgba(2,11,18,.92);" id="fallback-banner">
                    <div class="message-content">
                        <h1><i class="fa-solid fa-shield"></i> Fallback Mode</h1>
                        <p>Proxy scripts were blocked, so direct browsing mode was loaded to avoid a blank screen.</p>
                        ${reason ? `<p style="opacity:.85; margin-top:8px;">${reason}</p>` : ""}
                        <button id="dismiss-fallback" style="margin-top:12px;padding:8px 14px;cursor:pointer;">Continue</button>
                    </div>
                </div>
                <iframe id="fallback-frame" src="NT.html" style="position:absolute; inset:0; width:100%; height:100%; border:none;"></iframe>
            </div>
        </div>`;

    const parseInput = (raw) => {
        const input = (raw || "").trim();
        if (!input) return "";
        if (/^https?:\/\//i.test(input)) return input;
        return (input.includes('.') && !input.includes(' '))
            ? `https://${input}`
            : `https://search.brave.com/search?q=${encodeURIComponent(input)}`;
    };

    const run = () => {
        const value = parseInput(document.getElementById("fallback-address").value);
        if (!value) return;
        document.getElementById("fallback-frame").src = value;
    };

    document.getElementById("fallback-go").onclick = run;
    document.getElementById("fallback-open").onclick = () => {
        const value = parseInput(document.getElementById("fallback-address").value);
        if (value) window.open(value, "_blank", "noopener,noreferrer");
    };
    document.getElementById("fallback-address").onkeyup = (e) => e.key === "Enter" && run();
    document.getElementById("dismiss-fallback").onclick = () => {
        const banner = document.getElementById("fallback-banner");
        if (banner) banner.remove();
    };
}

async function loadExternalScript(urls) {
    for (const url of urls) {
        try {
            await new Promise((resolve, reject) => {
                const script = document.createElement("script");
                script.src = url;
                script.async = true;
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
            return true;
        } catch {}
    }
    return false;
}

async function ensureBareMuxLoaded() {
    if (window.BareMux?.BareMuxConnection) return window.BareMux;
    for (const url of BARE_MUX_IMPORT_URLS) {
        try {
            const mod = await import(url);
            if (mod?.BareMuxConnection) {
                window.BareMux = mod;
                return mod;
            }
        } catch {}
    }
    return null;
}

window.addEventListener('error', (event) => {
    showFatalBootError("Something crashed while starting the browser.", event?.error?.message || event?.message || "");
});

window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason?.message || String(event?.reason || "");
    showFatalBootError("A startup task failed before the page could load.", reason);
});

function getAllWispServers() {
    const customWisps = getStoredWisps();
    return [...WISP_SERVERS, ...customWisps];
}

// =====================================================
// BULLETPROOF HEALTH & ERROR HANDLING
// =====================================================
async function pingWispServer(url, timeout = 2000) {
    return new Promise((resolve) => {
        const start = Date.now();
        try {
            const ws = new WebSocket(url);
            const timer = setTimeout(() => {
                try { ws.close(); } catch {}
                resolve({ url, success: false, latency: null });
            }, timeout);
            ws.onopen = () => { clearTimeout(timer); ws.close(); resolve({ url, success: true, latency: Date.now() - start }); };
            ws.onerror = () => { clearTimeout(timer); ws.close(); resolve({ url, success: false, latency: null }); };
        } catch { resolve({ url, success: false, latency: null }); }
    });
}

async function findBestWispServer(servers, currentUrl) {
    if (!servers || servers.length === 0) return currentUrl;
    const results = await Promise.all(servers.map(s => pingWispServer(s.url, 2000)));
    const working = results.filter(r => r.success).sort((a, b) => a.latency - b.latency);
    return working.length > 0 ? working[0].url : currentUrl || servers[0]?.url;
}

async function initializeWithBestServer() {
    const autoswitch = storageGetItem('wispAutoswitch') !== 'false';
    const allServers = getAllWispServers();
    if (!autoswitch || allServers.length <= 1) return;

    const currentUrl = storageGetItem("proxServer") || DEFAULT_WISP;
    const currentCheck = await pingWispServer(currentUrl, 2000);
    
    if (!currentCheck.success) {
        console.log("Current server dead. Finding best server...");
        const best = await findBestWispServer(allServers, currentUrl);
        if (best && best !== currentUrl) {
            storageSetItem("proxServer", best);
            notify('info', 'Auto-switched', 'Switched to a faster proxy server.');
        }
    }
}

// =====================================================
// BROWSER STATE
// =====================================================
let BareMux = window.BareMux ?? null;
let sharedScramjet = null;
let sharedConnection = null;
let sharedConnectionReady = false;
let scramjetInitAttempts = 0;
let tabs = [];
let activeTabId = null;
let nextTabId = 1;

const getBasePath = () => {
    const basePath = location.pathname.replace(/[^/]*$/, '');
    return basePath.endsWith('/') ? basePath : basePath + '/';
};
const getStoredWisps = () => { try { return JSON.parse(storageGetItem('customWisps') ?? '[]'); } catch { return []; } };
const getActiveTab = () => tabs.find(t => t.id === activeTabId);
const notify = (type, title, message) => { if (typeof Notify !== 'undefined') Notify[type](title, message); };
const isNewTabUrl = (url = "") => url.includes("NT.html");

// =====================================================
// INITIALIZATION (With Auto-Nuke for Corruption)
// =====================================================
async function getSharedScramjet() {
    if (sharedScramjet) return sharedScramjet;
    if (typeof $scramjetLoadController !== 'function') {
        await loadExternalScript(SCRAMJET_SCRIPT_URLS);
    }
    if (typeof $scramjetLoadController !== 'function') {
        throw new Error("Scramjet loader script was blocked or did not load.");
    }
    const { ScramjetController } = $scramjetLoadController();
    
    sharedScramjet = new ScramjetController({
        prefix: getBasePath() + "scramjet/",
        files: {
            wasm: "https://cdn.jsdelivr.net/gh/Destroyed12121/Staticsj@main/JS/scramjet.wasm.wasm",
            all: "https://cdn.jsdelivr.net/gh/Destroyed12121/Staticsj@main/JS/scramjet.all.js",
            sync: "https://cdn.jsdelivr.net/gh/Destroyed12121/Staticsj@main/JS/scramjet.sync.js"
        }
    });
    
    try {
        await sharedScramjet.init();
    } catch (err) {
        scramjetInitAttempts += 1;
        if (scramjetInitAttempts <= 1) {
            console.warn('Scramjet cache corrupted. Auto-nuking IndexedDB...', err);
            try {
                ['scramjet-data', 'scrambase', 'ScramjetData'].forEach(db => indexedDB.deleteDatabase(db));
            } catch (e) {}
            sharedScramjet = null;
            return getSharedScramjet(); // One retry after cache nuke
        }
        throw new Error("Failed to initialize Scramjet after retry.");
    }
    scramjetInitAttempts = 0;
    return sharedScramjet;
}

async function getSharedConnection() {
    if (sharedConnectionReady) return sharedConnection;
    BareMux = await ensureBareMuxLoaded();
    if (!BareMux?.BareMuxConnection) throw new Error("BareMux script was blocked or did not load.");
    const wispUrl = storageGetItem("proxServer") ?? DEFAULT_WISP;
    sharedConnection = new BareMux.BareMuxConnection(getBasePath() + "bareworker.js");
    
    await sharedConnection.setTransport(
        "https://cdn.jsdelivr.net/gh/Sea-Math/sail@main/libcurl/index.mjs",
        [{ wisp: wispUrl }]
    );
    sharedConnectionReady = true;
    return sharedConnection;
}

// Check if SW is alive before navigating
async function ensureServiceWorker() {
    if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) {
            console.warn("Service Worker asleep! Reloading window to wake it up...");
            window.location.reload();
        }
    }
}

async function initializeBrowser() {
    const root = document.getElementById("app");
    root.innerHTML = `
        <div class="browser-container">
            <div class="flex tabs" id="tabs-container"></div>
            <div class="flex nav">
                <button id="back-btn" title="Back"><i class="fa-solid fa-chevron-left"></i></button>
                <button id="fwd-btn" title="Forward"><i class="fa-solid fa-chevron-right"></i></button>
                <button id="reload-btn" title="Reload"><i class="fa-solid fa-rotate-right"></i></button>
                <div class="address-wrapper">
                    <input class="bar" id="address-bar" autocomplete="off" placeholder="Search or enter URL">
                    <button id="home-btn-nav" title="Home"><i class="fa-solid fa-house"></i></button>
                </div>
                <button id="devtools-btn" title="DevTools"><i class="fa-solid fa-code"></i></button>
                <button id="wisp-settings-btn" title="Proxy Settings"><i class="fa-solid fa-gear"></i></button>
            </div>
            <div class="loading-bar-container"><div class="loading-bar" id="loading-bar"></div></div>
            <div class="iframe-container" id="iframe-container">
                <div id="loading" class="message-container" style="display: none;">
                    <div class="message-content">
                        <div class="spinner"></div>
                        <h1 id="loading-title">Connecting</h1>
                        <p id="loading-url">Initializing proxy...</p>
                        <button id="skip-btn">Skip</button>
                    </div>
                </div>
                <div id="error" class="message-container" style="display: none;">
                    <div class="message-content">
                        <h1><i class="fa-solid fa-triangle-exclamation"></i> Connection Failed</h1>
                        <p id="error-message">The proxy failed to load this page. It may be blocked or the server is down.</p>
                        <button id="retry-error-btn" style="margin-top: 15px; padding: 8px 16px; cursor: pointer;">Try Again</button>
                    </div>
                </div>
            </div>
        </div>`;

    document.getElementById('back-btn').onclick = () => getActiveTab()?.frame.back();
    document.getElementById('fwd-btn').onclick = () => getActiveTab()?.frame.forward();
    document.getElementById('reload-btn').onclick = () => getActiveTab()?.frame.reload();
    document.getElementById('home-btn-nav').onclick = () => window.location.href = '../index.html';
    document.getElementById('devtools-btn').onclick = toggleDevTools;
    document.getElementById('wisp-settings-btn').onclick = openSettings;
    
    document.getElementById('skip-btn').onclick = () => {
        const tab = getActiveTab();
        if (tab) { tab.loading = false; showIframeLoading(false); }
    };
    
    document.getElementById('retry-error-btn').onclick = () => {
        document.getElementById("error").style.display = "none";
        getActiveTab()?.frame.reload();
    };

    const addrBar = document.getElementById('address-bar');
    addrBar.onkeyup = (e) => e.key === 'Enter' && handleSubmit();
    addrBar.onfocus = () => addrBar.select();

    window.addEventListener('message', (e) => { if (e.data?.type === 'navigate') handleSubmit(e.data.url); });

    createTab(true);
    if (window.location.hash) {
        handleSubmit(decodeURIComponent(window.location.hash.substring(1)));
        history.replaceState(null, null, location.pathname);
    }
}

// =====================================================
// BULLETPROOF TAB MANAGEMENT
// =====================================================
function createTab(makeActive = true) {
    const frame = sharedScramjet.createFrame();
    const tab = {
        id: nextTabId++,
        title: "New Tab",
        url: "NT.html",
        frame,
        loading: false,
        favicon: null,
        timeoutTracker: null
    };

    frame.frame.src = "NT.html";

    frame.addEventListener("urlchange", (e) => {
        tab.url = e.url;
        tab.loading = true;
        document.getElementById("error").style.display = "none";

        if (tab.id === activeTabId) showIframeLoading(true, tab.url);

        try {
            const urlObj = new URL(e.url);
            tab.title = urlObj.hostname;
            tab.favicon = `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
        } catch {
            tab.title = "Browsing";
            tab.favicon = null;
        }
        
        updateTabsUI();
        updateAddressBar();
        updateLoadingBar(tab, 10);

        // Kill Switch: If it takes longer than 15 seconds, assume proxy failure.
        clearTimeout(tab.timeoutTracker);
        tab.timeoutTracker = setTimeout(() => {
            if (tab.loading && tab.id === activeTabId && tab.url && !isNewTabUrl(tab.url)) {
                showIframeLoading(false);
                document.getElementById("error").style.display = "flex";
                document.getElementById("error-message").textContent = "Connection Timed Out. The server took too long to respond.";
                tab.loading = false;
                updateLoadingBar(tab, 100);
            }
        }, 15000);
    });

    frame.frame.addEventListener('load', () => {
        tab.loading = false;
        clearTimeout(tab.timeoutTracker);

        if (tab.id === activeTabId) showIframeLoading(false);

        // --- BULLETPROOF BLANK PAGE DETECTOR ---
        let isBlank = false;
        try {
            const frameDoc = frame.frame.contentDocument || frame.frame.contentWindow.document;
            if (frameDoc && frameDoc.body && frameDoc.body.innerHTML.trim() === "" && tab.url && !isNewTabUrl(tab.url)) {
                isBlank = true;
            }
        } catch (e) {
            // Cross-origin error means it actually loaded successfully!
            isBlank = false; 
        }

        if (isBlank && tab.id === activeTabId) {
            document.getElementById("error").style.display = "flex";
            document.getElementById("error-message").textContent = "The server returned an empty page. The site might be blocking proxies.";
        } else if (tab.id === activeTabId) {
            document.getElementById("error").style.display = "none";
        }
        // ---------------------------------------

        try { const title = frame.frame.contentWindow.document.title; if (title) tab.title = title; } catch {}

        if (isNewTabUrl(frame.frame.contentWindow.location.href)) {
            tab.title = "New Tab"; tab.url = ""; tab.favicon = null;
        }

        updateTabsUI();
        updateAddressBar();
        updateLoadingBar(tab, 100);
    });

    tabs.push(tab);
    document.getElementById("iframe-container").appendChild(frame.frame);
    if (makeActive) switchTab(tab.id);
    return tab;
}

function showIframeLoading(show, url = '') {
    const loader = document.getElementById("loading");
    if (!loader) return;
    loader.style.display = show ? "flex" : "none";
    getActiveTab()?.frame.frame.classList.toggle('loading', show);
    if (show) {
        document.getElementById("loading-title").textContent = "Connecting";
        document.getElementById("loading-url").textContent = url || "Loading content...";
        document.getElementById("skip-btn").style.display = 'none';
        setTimeout(() => { if (document.getElementById("skip-btn")) document.getElementById("skip-btn").style.display = 'inline-block'; }, 3000);
    }
}

function switchTab(tabId) {
    activeTabId = tabId;
    const tab = getActiveTab();
    tabs.forEach(t => t.frame.frame.classList.toggle("hidden", t.id !== tabId));
    
    // Clear error UI when switching tabs
    document.getElementById("error").style.display = "none";

    if (tab) showIframeLoading(tab.loading, tab.url);
    updateTabsUI();
    updateAddressBar();
}

function closeTab(tabId) {
    const idx = tabs.findIndex(t => t.id === tabId);
    if (idx === -1) return;
    const tab = tabs[idx];
    clearTimeout(tab.timeoutTracker);
    if (tab.frame?.frame) { tab.frame.frame.src = 'about:blank'; tab.frame.frame.remove(); }
    tabs.splice(idx, 1);
    if (activeTabId === tabId) {
        if (tabs.length > 0) switchTab(tabs[Math.max(0, idx - 1)].id);
        else window.location.reload();
    } else { updateTabsUI(); }
}

function updateTabsUI() {
    const container = document.getElementById("tabs-container");
    container.innerHTML = "";
    tabs.forEach(tab => {
        const el = document.createElement("div");
        el.className = `tab ${tab.id === activeTabId ? "active" : ""}`;
        const iconHtml = tab.loading ? `<div class="tab-spinner"></div>` : tab.favicon ? `<img src="${tab.favicon}" class="tab-favicon" onerror="this.style.display='none'">` : '';
        el.innerHTML = `${iconHtml}<span class="tab-title">${tab.title}</span><span class="tab-close">&times;</span>`;
        el.onclick = () => switchTab(tab.id);
        el.querySelector(".tab-close").onclick = (e) => { e.stopPropagation(); closeTab(tab.id); };
        container.appendChild(el);
    });
    const newBtn = document.createElement("button");
    newBtn.className = "new-tab"; newBtn.innerHTML = "<i class='fa-solid fa-plus'></i>";
    newBtn.onclick = () => createTab(true);
    container.appendChild(newBtn);
}

function updateAddressBar() {
    const bar = document.getElementById("address-bar");
    const tab = getActiveTab();
    if (bar && tab) bar.value = (tab.url && !isNewTabUrl(tab.url)) ? tab.url : "";
}

async function handleSubmit(url) {
    await ensureServiceWorker(); // Check SW before sending request
    const tab = getActiveTab();
    let input = url ?? document.getElementById("address-bar").value.trim();
    if (!input) return;

    if (!input.startsWith('http')) {
        input = input.includes('.') && !input.includes(' ') 
            ? `https://${input}` : `https://search.brave.com/search?q=${encodeURIComponent(input)}`;
    }
    
    document.getElementById("error").style.display = "none";
    tab.loading = true;
    showIframeLoading(true, input);
    updateLoadingBar(tab, 10);
    tab.frame.go(input);
}

function updateLoadingBar(tab, percent) {
    if (tab.id !== activeTabId) return;
    const bar = document.getElementById("loading-bar");
    bar.style.width = percent + "%";
    bar.style.opacity = percent === 100 ? "0" : "1";
    if (percent === 100) setTimeout(() => { bar.style.width = "0%"; }, 200);
}

// =====================================================
// SETTINGS UI
// =====================================================
function openSettings() {
    const modal = document.getElementById('wisp-settings-modal');
    modal.classList.remove('hidden');
    document.getElementById('close-wisp-modal').onclick = () => modal.classList.add('hidden');
    document.getElementById('save-custom-wisp').onclick = saveCustomWisp;
    modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };
    renderServerList();
}

function renderServerList() {
    const list = document.getElementById('server-list');
    list.innerHTML = '';
    const currentUrl = storageGetItem('proxServer') ?? DEFAULT_WISP;
    const allWisps = [...WISP_SERVERS, ...getStoredWisps()];

    allWisps.forEach((server, index) => {
        const isActive = server.url === currentUrl;
        const isCustom = index >= WISP_SERVERS.length;
        const item = document.createElement('div');
        item.className = `wisp-option ${isActive ? 'active' : ''}`;
        const deleteBtn = isCustom ? `<button class="delete-wisp-btn" onclick="event.stopPropagation(); deleteCustomWisp('${server.url}')"><i class="fa-solid fa-trash"></i></button>` : '';
        item.innerHTML = `
            <div class="wisp-option-header">
                <div class="wisp-option-name">${server.name} ${isActive ? '<i class="fa-solid fa-check" style="margin-left:8px; font-size: 0.7em; color: var(--accent);"></i>' : ''}</div>
                <div class="server-status"><span class="ping-text">...</span><div class="status-indicator"></div>${deleteBtn}</div>
            </div>
            <div class="wisp-option-url">${server.url}</div>
        `;
        item.onclick = () => setWisp(server.url);
        list.appendChild(item);
        checkServerHealth(server.url, item);
    });

    const isAutoswitch = storageGetItem('wispAutoswitch') !== 'false';
    const toggleContainer = document.createElement('div');
    toggleContainer.className = 'wisp-option';
    toggleContainer.style.cssText = 'margin-top: 10px; cursor: default;';
    toggleContainer.innerHTML = `<div class="wisp-option-header" style="justify-content: space-between;"><div class="wisp-option-name"><i class="fa-solid fa-rotate" style="margin-right:8px"></i> Auto-switch on failure</div><div class="toggle-switch ${isAutoswitch ? 'active' : ''}" id="autoswitch-toggle"><div class="toggle-knob"></div></div></div>`;
    toggleContainer.onclick = () => {
        const newState = !isAutoswitch;
        storageSetItem('wispAutoswitch', String(newState));
        document.getElementById('autoswitch-toggle').classList.toggle('active', newState);
        navigator.serviceWorker.controller?.postMessage({ type: 'config', autoswitch: newState });
    };
    list.appendChild(toggleContainer);
}

function saveCustomWisp() {
    const input = document.getElementById('custom-wisp-input');
    const url = input.value.trim();
    if (!url) return;
    if (!url.startsWith('ws://') && !url.startsWith('wss://')) return notify('error', 'Invalid URL', 'URL must start with wss:// or ws://');
    
    const customWisps = getStoredWisps();
    if (customWisps.some(w => w.url === url) || WISP_SERVERS.some(w => w.url === url)) return notify('warning', 'Already Exists', 'Server already exists.');
    
    customWisps.push({ name: `Custom ${customWisps.length + 1}`, url });
    storageSetItem('customWisps', JSON.stringify(customWisps));
    setWisp(url);
    input.value = '';
}

window.deleteCustomWisp = function (urlToDelete) {
    if (!confirm("Remove this server?")) return;
    storageSetItem('customWisps', JSON.stringify(getStoredWisps().filter(w => w.url !== urlToDelete)));
    if (storageGetItem('proxServer') === urlToDelete) setWisp(DEFAULT_WISP); else renderServerList();
};

async function checkServerHealth(url, element) {
    const dot = element.querySelector('.status-indicator');
    const text = element.querySelector('.ping-text');
    const res = await pingWispServer(url, 2000);
    if (res.success) {
        dot.classList.add('status-success');
        text.textContent = `${res.latency}ms`;
    } else {
        dot.classList.add('status-error');
        text.textContent = "Offline";
    }
}

function setWisp(url) {
    storageSetItem('proxServer', url);
    navigator.serviceWorker.controller?.postMessage({ type: 'config', wispurl: url });
    setTimeout(() => location.reload(), 600);
}

function toggleDevTools() {
    const win = getActiveTab()?.frame.frame.contentWindow;
    if (!win) return;
    if (win.eruda) { win.eruda.show(); return; }
    const script = win.document.createElement('script');
    script.src = "https://cdn.jsdelivr.net/npm/eruda";
    script.onload = () => { win.eruda.init(); win.eruda.show(); };
    win.document.body.appendChild(script);
}

function withTimeout(taskPromise, ms, label) {
    return Promise.race([
        taskPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms.`)), ms))
    ]);
}

function renderFatalError(message) {
    const root = document.getElementById("app");
    if (!root) return;
    root.innerHTML = `
        <div class="message-container" style="display:flex;">
            <div class="message-content">
                <h1><i class="fa-solid fa-triangle-exclamation"></i> Startup Failed</h1>
                <p>${message}</p>
                <button onclick="location.reload()" style="margin-top:12px;padding:8px 14px;cursor:pointer;">Reload</button>
            </div>
        </div>`;
}

// =====================================================
// MASTER BOOT SEQUENCE
// =====================================================
document.addEventListener('DOMContentLoaded', async function () {
    let bootFinished = false;
    const bootWatchdog = setTimeout(() => {
        if (!bootFinished) {
            showFatalBootError("Startup timed out. Your network/account may be blocking required scripts.", "If this is a school-managed device, ask for access to jsdelivr.net and cdnjs.cloudflare.com.");
        }
    }, BOOT_TIMEOUT_MS);

    try {
        await withTimeout(initializeWithBestServer(), 5000, "Server check");
        await withTimeout(getSharedScramjet(), 10000, "Scramjet initialization");
        await withTimeout(getSharedConnection(), 10000, "Proxy connection initialization");

        if ('serviceWorker' in navigator) {
            const reg = await withTimeout(
                navigator.serviceWorker.register(getBasePath() + 'sw.js', { scope: getBasePath() }),
                8000,
                "Service worker registration"
            );
            await withTimeout(navigator.serviceWorker.ready, 8000, "Service worker ready");
            
            const swConfig = {
                type: "config",
                wispurl: storageGetItem("proxServer") ?? DEFAULT_WISP,
                servers: getAllWispServers(),
                autoswitch: storageGetItem('wispAutoswitch') !== 'false'
            };

            const sendConfig = () => {
                const sw = reg.active || navigator.serviceWorker.controller;
                if (sw) sw.postMessage(swConfig);
            };
            sendConfig();
            setTimeout(sendConfig, 1000); // Failsafe SW ping
        }
        await initializeBrowser();
        bootFinished = true;
        clearTimeout(bootWatchdog);
    } catch (err) {
        bootFinished = true;
        clearTimeout(bootWatchdog);
        console.error("Initialization error:", err);
        initializeFallbackBrowser(err?.message || "");
    }
});
