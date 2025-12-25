const DEBUG_PREFIX = "[RADAR-DEBUG]";

function logDebug(message, color = "#3498db") {
    console.log(`%c${DEBUG_PREFIX} ${message}`, `color: ${color}; font-weight: bold;`);
}

// ========== GLOBAL VARIABLES ==========
let reportQueue = [];
let isReporting = false;
let currentReportStep = 0;
let currentReportData = null;

// ========== UTILITY FUNCTIONS ==========
function getCommentUsername(node) {
    const selectors = [
        '#author-text > span',
        '#author-text span:first-child',
        'ytd-comment-view-model #author-text span',
        '#author-text',
        'a#author-text',
        '[id="author-text"]',
        'yt-formatted-string#author-text',
        'ytd-comment-renderer #author-text',
        '#header-author yt-formatted-string'
    ];
    
    for (const selector of selectors) {
        try {
            const element = node.querySelector(selector);
            if (element) {
                let username = element.innerText || element.textContent || '';
                username = username.trim();
                
                if (username) {
                    username = username.replace(/^@/, '').replace(/\s+/g, ' ');
                    return username.substring(0, 30);
                }
            }
        } catch (e) {
            continue;
        }
    }
    
    return 'Anonymous';
}

function getCommentUniqueId(node) {
    if (node.id && node.id.includes('comment')) {
        return node.id;
    }
    
    const dataAttrs = ['data-comment-id', 'data-target', 'data-aid', 'data-id'];
    for (const attr of dataAttrs) {
        const value = node.getAttribute(attr);
        if (value && value.length > 5) {
            return value;
        }
    }
    
    const linkElements = node.querySelectorAll('a[href*="comment"]');
    for (let link of linkElements) {
        if (link.href) {
            const match = link.href.match(/comment=([^&]+)/);
            if (match && match[1]) {
                return match[1];
            }
        }
    }
    
    const rect = node.getBoundingClientRect();
    const textElement = node.querySelector('#content-text, #content, #comment-content, ytd-expander');
    const text = textElement?.innerText || textElement?.textContent || '';
    const username = getCommentUsername(node);
    
    const uniqueStr = `${username}_${text.substring(0, 20)}_${Math.floor(rect.top)}_${Math.floor(rect.left)}`;
    return `comment_${simpleHash(uniqueStr)}`;
}

function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
}

function saveToPopup(data) {
    chrome.storage.local.get(['logs'], (result) => {
        const logs = result.logs || [];
        
        const isDuplicate = logs.some(log => log.commentId === data.commentId);
        
        if (!isDuplicate) {
            const newLog = {
                id: Date.now(),
                commentId: data.commentId,
                text: data.comment,
                label: data.label,
                confidence: data.confidence,
                user: data.username,
                videoId: data.videoId,
                timestamp: new Date().toLocaleTimeString(),
                date: new Date().toLocaleDateString(),
                reported: false,
                nodeRect: data.nodeRect,
                pageYOffset: window.pageYOffset
            };
            
            logs.unshift(newLog);
            
            if (logs.length > 200) {
                logs.length = 200;
            }
            
            chrome.storage.local.set({ logs: logs });
        }
    });
}

// ========== QUEUE MANAGEMENT ==========
function addToReportQueue(commentData) {
    // Cek apakah sudah ada di queue
    const exists = reportQueue.some(item => item.commentId === commentData.commentId);
    if (!exists) {
        reportQueue.push({
            ...commentData,
            status: 'pending',
            attempts: 0,
            addedAt: Date.now()
        });
        logDebug(`📝 Ditambahkan ke antrian: @${commentData.username}`, "#3498db");
        logDebug(`📊 Antrian saat ini: ${reportQueue.length} komentar`, "#3498db");
        
        // Mulai proses queue jika belum berjalan
        if (!isReporting) {
            processReportQueue();
        }
    }
}

async function processReportQueue() {
    if (isReporting || reportQueue.length === 0) {
        return;
    }
    
    isReporting = true;
    
    while (reportQueue.length > 0) {
        const commentData = reportQueue[0];
        
        if (commentData.status === 'completed') {
            reportQueue.shift();
            continue;
        }
        
        logDebug(`🚀 Memproses antrian #1: @${commentData.username}`, "#e67e22");
        
        // Update status
        commentData.status = 'processing';
        currentReportData = commentData;
        
        // Proses report - HANYA BUKA MENU REPORT
        const success = await openReportMenuOnly(commentData);
        
        if (success) {
            commentData.status = 'menu_opened';
            logDebug(`✅ Menu report dibuka untuk: @${commentData.username}`, "#2ecc71");
            logDebug(`👤 Silakan pilih opsi report secara manual`, "#f39c12");
            
            // Tidak otomatis melanjutkan - tunggu user memilih manual
            // Simpan status bahwa kita sedang menunggu user
            
            // Kirim notifikasi ke popup
            chrome.runtime.sendMessage({
                action: "reportMenuOpened",
                data: {
                    commentId: commentData.commentId,
                    username: commentData.username,
                    text: commentData.text,
                    step: 'menu_opened'
                }
            }).catch(() => {});
            
            // Keluar dari loop - tunggu user menyelesaikan manual
            break;
            
        } else {
            commentData.status = 'failed';
            logDebug(`❌ Gagal membuka menu report: @${commentData.username}`, "#ff4757");
            
            // Hapus dari queue
            reportQueue.shift();
            currentReportData = null;
        }
    }
    
    isReporting = false;
}

// ========== OPEN REPORT MENU ONLY (MANUAL SELECTION) ==========
async function openReportMenuOnly(commentData) {
    try {
        logDebug(`🔍 Mencari komentar untuk: @${commentData.username}`, "#3498db");
        
        // 1. Temukan node komentar
        const node = await findCommentNode(commentData);
        if (!node) {
            logDebug("❌ Komentar tidak ditemukan di halaman", "#ff4757");
            return false;
        }
        
        // 2. Scroll ke komentar
        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await delay(1000);
        
        // 3. Highlight komentar dengan warna biru (sedang diproses)
        highlightComment(node, "#3498db");
        
        // 4. Cari dan klik tombol menu (titik tiga)
        const menuButton = await findMenuButton(node);
        if (!menuButton) {
            logDebug("❌ Tombol menu tidak ditemukan", "#ff4757");
            return false;
        }
        
        menuButton.click();
        logDebug("✅ Tombol menu diklik", "#2ecc71");
        await delay(1500);
        
        // 5. Cari dan klik opsi "Laporkan" di menu dropdown
        const reportMenuItem = await findReportMenuItem();
        if (!reportMenuItem) {
            logDebug("❌ Opsi 'Laporkan' tidak ditemukan", "#ff4757");
            return false;
        }
        
        reportMenuItem.click();
        logDebug("✅ Opsi 'Laporkan' diklik", "#2ecc71");
        
        // 6. Tunggu dialog report muncul
        await delay(2000);
        
        // 7. Beri petunjuk visual bahwa dialog sudah terbuka
        const dialog = document.querySelector('tp-yt-paper-dialog, ytd-report-service-dialog-renderer');
        if (dialog) {
            // Tambahkan border pada dialog untuk indikasi
            dialog.style.border = '3px solid #f39c12';
            dialog.style.borderRadius = '8px';
            
            logDebug("📋 Dialog report terbuka", "#f39c12");
            logDebug("👉 Silakan pilih alasan report secara manual", "#f39c12");
            logDebug("👉 Setelah selesai, klik tombol 'REPORT' di popup lagi", "#f39c12");
            
            // Tampilkan instruksi di halaman
            showInstructionOverlay("Pilih alasan report secara manual di dialog YouTube");
        }
        
        return true;
        
    } catch (error) {
        logDebug(`❌ Error membuka menu report: ${error.message}`, "#ff4757");
        return false;
    }
}

// ========== FIND COMMENT NODE ==========
async function findCommentNode(commentData) {
    // Coba berbagai cara untuk menemukan komentar
    const selectors = [
        `[data-radar-id="${commentData.commentId}"]`,
        `[data-comment-id="${commentData.commentId}"]`,
        `#${commentData.commentId}`,
        `[id*="${commentData.commentId}"]`
    ];
    
    // Coba berdasarkan ID
    for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (node) {
            logDebug(`✅ Komentar ditemukan via ID: ${selector}`, "#2ecc71");
            return node;
        }
    }
    
    // Cari berdasarkan username dan teks
    const allComments = document.querySelectorAll('ytd-comment-thread-renderer, ytd-comment-renderer');
    for (let node of allComments) {
        if (!node.offsetParent) continue;
        
        const username = getCommentUsername(node);
        const textElement = node.querySelector('#content-text, #content, ytd-expander');
        const text = textElement?.innerText || textElement?.textContent || '';
        
        // Cocokkan username dan sebagian teks
        const searchText = commentData.text?.substring(0, 50) || '';
        if (username === commentData.username && text.includes(searchText)) {
            logDebug(`✅ Komentar ditemukan via username & text match`, "#2ecc71");
            return node;
        }
    }
    
    return null;
}

// ========== FIND MENU BUTTON ==========
async function findMenuButton(node) {
    const menuSelectors = [
        'button[aria-label*="More actions"]',
        'button[aria-label*="Lainnya"]',
        'button[aria-label*="menu"]',
        'yt-icon-button[aria-label*="More"]',
        '#menu button',
        'ytd-menu-renderer button',
        'button[aria-haspopup="menu"]',
        '.ytd-comment-action-buttons-renderer button',
        'button[aria-label*="Tindakan lainnya"]'
    ];
    
    // Cari di node
    for (const selector of menuSelectors) {
        const button = node.querySelector(selector);
        if (button && button.offsetParent) {
            return button;
        }
    }
    
    // Cari di parent node (3 level)
    let parent = node.parentElement;
    for (let i = 0; i < 3; i++) {
        if (!parent) break;
        for (const selector of menuSelectors) {
            const button = parent.querySelector(selector);
            if (button && button.offsetParent) {
                return button;
            }
        }
        parent = parent.parentElement;
    }
    
    return null;
}

// ========== FIND REPORT MENU ITEM ==========
async function findReportMenuItem() {
    // Cari semua item di dropdown menu
    const menuItems = document.querySelectorAll('tp-yt-paper-item, ytd-menu-service-item-renderer');
    
    for (let item of menuItems) {
        const text = (item.innerText || item.textContent || '').trim();
        if (text.includes('Laporkan') || text.includes('Report')) {
            return item;
        }
    }
    
    return null;
}

// ========== HELPER FUNCTIONS ==========
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function highlightComment(node, color) {
    const originalBorder = node.style.border;
    const originalBoxShadow = node.style.boxShadow;
    
    node.style.border = `3px solid ${color}`;
    node.style.boxShadow = `0 0 15px ${color}80`;
    node.style.transition = 'all 0.3s ease';
    
    // Simpan referensi untuk nanti dihapus
    node.dataset.radarHighlight = color;
    
    // Auto remove setelah 10 detik
    setTimeout(() => {
        if (node.dataset.radarHighlight === color) {
            node.style.border = originalBorder;
            node.style.boxShadow = originalBoxShadow;
            delete node.dataset.radarHighlight;
        }
    }, 10000);
}

function showInstructionOverlay(message) {
    // Hapus overlay sebelumnya jika ada
    const existingOverlay = document.getElementById('radar-instruction-overlay');
    if (existingOverlay) {
        existingOverlay.remove();
    }
    
    // Buat overlay baru
    const overlay = document.createElement('div');
    overlay.id = 'radar-instruction-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #f39c12, #e67e22);
        color: white;
        padding: 15px 20px;
        border-radius: 10px;
        z-index: 999999;
        max-width: 350px;
        box-shadow: 0 5px 20px rgba(0,0,0,0.3);
        font-family: Arial, sans-serif;
        font-size: 14px;
        animation: slideIn 0.5s ease;
    `;
    
    overlay.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
            <span style="font-size: 20px;">📋</span>
            <strong style="font-size: 16px;">Instruksi Report Manual</strong>
        </div>
        <div style="margin-bottom: 10px;">${message}</div>
        <div style="font-size: 12px; opacity: 0.9;">
            <strong>Langkah-langkah:</strong>
            <ol style="margin: 5px 0; padding-left: 20px;">
                <li>Pilih alasan report di dialog YouTube</li>
                <li>Klik tombol "Laporkan" di dialog</li>
                <li>Tunggu konfirmasi selesai</li>
                <li>Klik tombol "REPORT" di popup untuk komentar berikutnya</li>
            </ol>
        </div>
        <button id="close-instruction" style="
            background: rgba(255,255,255,0.2);
            border: 1px solid white;
            color: white;
            padding: 5px 15px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 12px;
            margin-top: 5px;
        ">Tutup</button>
    `;
    
    document.body.appendChild(overlay);
    
    // Tambahkan animasi
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
    `;
    document.head.appendChild(style);
    
    // Tombol tutup
    overlay.querySelector('#close-instruction').addEventListener('click', () => {
        overlay.remove();
    });
    
    // Auto close setelah 30 detik
    setTimeout(() => {
        if (overlay.parentNode) {
            overlay.style.opacity = '0';
            overlay.style.transition = 'opacity 0.5s ease';
            setTimeout(() => overlay.remove(), 500);
        }
    }, 30000);
}

// ========== COMPLETE CURRENT REPORT ==========
function completeCurrentReport() {
    if (!currentReportData) return;
    
    logDebug(`✅ Menyelesaikan report untuk: @${currentReportData.username}`, "#2ecc71");
    
    // Update status di queue
    const index = reportQueue.findIndex(item => item.commentId === currentReportData.commentId);
    if (index !== -1) {
        reportQueue[index].status = 'completed';
        reportQueue[index].completedAt = Date.now();
    }
    
    // Update storage
    updateReportStatusInStorage(currentReportData.commentId, true);
    
    // Hapus highlight
    const node = document.querySelector(`[data-radar-id="${currentReportData.commentId}"]`);
    if (node) {
        node.style.border = '';
        node.style.boxShadow = '';
        delete node.dataset.radarHighlight;
    }
    
    // Hapus overlay instruksi
    const overlay = document.getElementById('radar-instruction-overlay');
    if (overlay) overlay.remove();
    
    // Hapus border dari dialog
    const dialog = document.querySelector('tp-yt-paper-dialog, ytd-report-service-dialog-renderer');
    if (dialog) {
        dialog.style.border = '';
        dialog.style.borderRadius = '';
    }
    
    currentReportData = null;
    
    // Lanjutkan queue
    setTimeout(() => {
        processReportQueue();
    }, 1000);
}

// ========== UPDATE STORAGE ==========
function updateReportStatusInStorage(commentId, reported) {
    chrome.storage.local.get(['logs'], (result) => {
        const logs = result.logs || [];
        const updatedLogs = logs.map(log => {
            if (log.commentId === commentId) {
                return {
                    ...log,
                    reported: reported,
                    reportedAt: new Date().toISOString()
                };
            }
            return log;
        });
        chrome.storage.local.set({ logs: updatedLogs });
    });
}

// ========== MONITOR REPORT DIALOG ==========
function monitorReportDialog() {
    // Observasi perubahan DOM untuk mendeteksi ketika user menyelesaikan report
    const observer = new MutationObserver((mutations) => {
        // Cek apakah ada dialog report yang terbuka
        const reportDialog = document.querySelector('tp-yt-paper-dialog, ytd-report-service-dialog-renderer');
        
        if (!reportDialog) {
            // Dialog report ditutup - mungkin user sudah selesai
            if (currentReportData) {
                // Cek apakah ada dialog konfirmasi yang muncul
                const confirmationDialog = document.querySelector('tp-yt-paper-dialog[aria-label*="reported"], ytd-report-service-dialog-renderer');
                
                if (!confirmationDialog) {
                    // Dialog report ditutup tanpa konfirmasi
                    logDebug("⚠️ Dialog report ditutup", "#f39c12");
                }
            }
        }
    });
    
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

// ========== SCAN FUNCTIONS ==========
async function processAllComments() {
    logDebug("🔍 Memulai scanning...", "#3498db");
    
    const videoId = new URLSearchParams(window.location.search).get('v');
    const commentSelectors = [
        'ytd-comment-thread-renderer',
        'ytd-comment-renderer',
        '#contents ytd-comment-thread-renderer'
    ];
    
    let allNodes = [];
    for (const selector of commentSelectors) {
        const nodes = document.querySelectorAll(selector);
        if (nodes.length > 0) {
            nodes.forEach(node => {
                if (!allNodes.includes(node)) {
                    allNodes.push(node);
                }
            });
        }
    }
    
    logDebug(`📊 Ditemukan ${allNodes.length} komentar`, "#3498db");
    
    let spamCount = 0;
    let scannedCount = 0;
    
    for (let node of allNodes) {
        if (!node.offsetParent) continue;
        
        const textElement = node.querySelector('#content-text, #content, ytd-expander');
        const text = textElement?.innerText || textElement?.textContent || '';
        if (!text || text.trim().length < 2) continue;
        
        const username = getCommentUsername(node);
        const commentId = getCommentUniqueId(node);
        
        if (node.dataset.scanned) continue;
        node.dataset.scanned = "true";
        scannedCount++;
        
        // Simpan radar ID untuk pencarian nanti
        node.setAttribute('data-radar-id', commentId);
        
        try {
            const response = await fetch('http://127.0.0.1:5000/predict', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    comment: text, 
                    videoId, 
                    username: username 
                })
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            
            saveToPopup({
                commentId: commentId,
                comment: text.substring(0, 500),
                label: data.label || "SAFE",
                confidence: data.confidence || 0,
                videoId: videoId,
                username: username,
                nodeRect: node.getBoundingClientRect()
            });
            
            if (data.label === 'SPAM JUDI') {
                spamCount++;
                highlightSpamComment(node, data.confidence, commentId);
            }
            
            await delay(100);
            
        } catch (err) {
            console.debug(`Error processing comment: ${err.message}`);
        }
    }
    
    logDebug(`✅ Scan selesai: ${scannedCount} discan, ${spamCount} spam`, "#2ecc71");
    
    chrome.runtime.sendMessage({
        action: "scanCompleted",
        data: {
            totalScanned: scannedCount,
            spamFound: spamCount,
            totalComments: allNodes.length
        }
    }).catch(() => {});
}

function highlightSpamComment(node, confidence, commentId) {
    // Tambahkan badge spam
    const badge = document.createElement('div');
    badge.className = 'radar-spam-badge';
    badge.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 16px;">⚠️</span>
            <div>
                <strong>SPAM JUDI (${confidence}%)</strong><br>
                <small style="opacity: 0.8;">Klik REPORT di popup</small>
            </div>
        </div>
    `;
    
    badge.style.cssText = `
        background: linear-gradient(135deg, #ff4757, #ff3838);
        color: white;
        padding: 10px 14px;
        border-radius: 8px;
        font-size: 12px;
        margin: 10px 0;
        border: 2px solid #ff6b81;
        box-shadow: 0 3px 10px rgba(255, 71, 87, 0.3);
        position: relative;
        z-index: 1000;
    `;
    
    const contentContainer = node.querySelector('#content, #content-text')?.parentElement || node;
    if (contentContainer) {
        contentContainer.appendChild(badge);
    }
    
    node.style.border = "2px solid #ff4757";
    node.style.borderRadius = "8px";
    node.style.padding = "10px";
    node.style.margin = "5px 0";
    node.style.background = "rgba(255, 71, 87, 0.05)";
}

// ========== MESSAGE LISTENER ==========
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    console.log("📩 Message received:", req);
    
    if (req.action === "forceScan") {
        processAllComments();
        sendResponse({ status: "scanning_started" });
    } 
    else if (req.action === "manualReport") {
        // Tambahkan ke antrian report
        addToReportQueue(req.commentData);
        sendResponse({ 
            status: "queued", 
            queuePosition: reportQueue.length,
            commentId: req.commentData.commentId 
        });
    }
    else if (req.action === "completeCurrentReport") {
        // User menyelesaikan report manual
        completeCurrentReport();
        sendResponse({ 
            status: "report_completed",
            nextInQueue: reportQueue.length > 0 ? reportQueue[0] : null
        });
    }
    else if (req.action === "cancelCurrentReport") {
        // User membatalkan report
        if (currentReportData) {
            logDebug(`❌ Report dibatalkan untuk: @${currentReportData.username}`, "#ff4757");
            
            // Hapus dari queue
            reportQueue = reportQueue.filter(item => item.commentId !== currentReportData.commentId);
            
            // Hapus highlight
            const node = document.querySelector(`[data-radar-id="${currentReportData.commentId}"]`);
            if (node) {
                node.style.border = '';
                node.style.boxShadow = '';
                delete node.dataset.radarHighlight;
            }
            
            // Hapus overlay
            const overlay = document.getElementById('radar-instruction-overlay');
            if (overlay) overlay.remove();
            
            currentReportData = null;
            
            // Lanjutkan queue
            setTimeout(() => {
                processReportQueue();
            }, 1000);
        }
        sendResponse({ status: "report_cancelled" });
    }
    else if (req.action === "getQueueStatus") {
        sendResponse({
            isReporting: isReporting,
            currentReport: currentReportData,
            queueLength: reportQueue.length,
            queue: reportQueue
        });
    }
    else if (req.action === "clearQueue") {
        reportQueue = [];
        isReporting = false;
        currentReportData = null;
        sendResponse({ status: "queue_cleared" });
    }
    else if (req.action === "ping") {
        sendResponse({
            status: "alive", 
            pageTitle: document.title,
            videoId: new URLSearchParams(window.location.search).get('v'),
            commentsCount: document.querySelectorAll('ytd-comment-thread-renderer, ytd-comment-renderer').length,
            currentReport: currentReportData ? {
                username: currentReportData.username,
                status: 'menu_opened'
            } : null
        });
    }
    
    return true;
});

// ========== INITIALIZATION ==========
function initialize() {
    logDebug("🚀 YouTube Comment Radar diinisialisasi", "#3498db");
    
    // Mulai scanning
    setTimeout(() => {
        processAllComments();
    }, 3000);
    
    // Mulai monitor dialog
    monitorReportDialog();
    
    // Periodic scan
    setInterval(() => {
        if (!isReporting && !currentReportData) {
            const unscanned = document.querySelectorAll('ytd-comment-thread-renderer:not([data-scanned])');
            if (unscanned.length > 0) {
                logDebug(`🔄 ${unscanned.length} komentar baru ditemukan`, "#3498db");
                processAllComments();
            }
        }
    }, 15000);
}

// Auto-start ketika halaman siap
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}

// Notify ready
setTimeout(() => {
    chrome.runtime.sendMessage({
        action: "contentScriptReady",
        data: { 
            pageTitle: document.title,
            url: window.location.href,
            timestamp: new Date().toISOString()
        }
    }).catch(() => {});
}, 2000);