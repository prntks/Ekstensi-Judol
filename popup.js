let currentFilter = 'all';
let isScanning = false;
let logs = [];
let activeReports = new Map(); // Track aktif report
let scanProgress = { current: 0, total: 0 };

// Update status UI
function updateStatus(text, type = 'idle') {
    const statusText = document.getElementById('statusText');
    const statusDot = document.getElementById('statusDot');
    
    if (statusText) statusText.textContent = text;
    if (statusDot) {
        statusDot.className = 'status-dot';
        if (type === 'scanning') statusDot.classList.add('scanning');
        if (type === 'error') statusDot.classList.add('error');
    }
}

// Show/hide loading overlay
function showLoading(text = 'Memproses...') {
    const overlay = document.getElementById('loadingOverlay');
    const loadingText = document.getElementById('loadingText');
    if (overlay && loadingText) {
        loadingText.textContent = text;
        overlay.classList.add('show');
    }
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.classList.remove('show');
}

// Show notification
function showNotification(message, type = 'success', duration = 3000) {
    const notification = document.getElementById('notification');
    const notificationText = document.getElementById('notificationText');
    
    if (!notification || !notificationText) return;
    
    notificationText.textContent = message;
    notification.className = 'notification';
    notification.classList.add(type);
    
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);
    
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            notification.className = 'notification';
        }, 300);
    }, duration);
}

// Update progress bar
function updateProgressBar(progress) {
    const progressFill = document.getElementById('progressFill');
    if (progressFill) {
        const percentage = Math.min(100, Math.max(0, progress));
        progressFill.style.width = `${percentage}%`;
    }
}

// Format confidence dengan 2 desimal
function formatConfidence(confidence) {
    const num = parseFloat(confidence);
    if (isNaN(num)) return '0.00%';
    return num.toFixed(2) + '%';
}

// Load data dari storage
function loadLogs() {
    chrome.storage.local.get(['logs'], (result) => {
        logs = result.logs || [];
        updateUI();
    });
}

// Update semua UI
function updateUI() {
    updateStats();
    renderLogs();
    updateLogCount();
}

// Update statistik
function updateStats() {
    const spamLogs = logs.filter(l => l.label === 'SPAM JUDI');
    const safeLogs = logs.filter(l => l.label !== 'SPAM JUDI');
    const reportedLogs = logs.filter(l => l.reported === true);
    
    const totalCount = document.getElementById('totalCount');
    const spamCount = document.getElementById('spamCount');
    const safeCount = document.getElementById('safeCount');
    const reportedCount = document.getElementById('reportedCount');
    
    if (totalCount) totalCount.textContent = logs.length;
    if (spamCount) spamCount.textContent = spamLogs.length;
    if (safeCount) safeCount.textContent = safeLogs.length;
    if (reportedCount) reportedCount.textContent = reportedLogs.length;
}

// Update jumlah log
function updateLogCount() {
    const logCount = document.getElementById('logCount');
    if (logCount) {
        const filteredLogs = filterLogs(logs);
        logCount.textContent = `${filteredLogs.length} items`;
    }
}

// Filter logs berdasarkan pilihan
function filterLogs(logs) {
    switch(currentFilter) {
        case 'spam':
            return logs.filter(l => l.label === 'SPAM JUDI');
        case 'safe':
            return logs.filter(l => l.label !== 'SPAM JUDI');
        case 'reported':
            return logs.filter(l => l.reported === true);
        default:
            return logs;
    }
}

// Render logs ke UI
function renderLogs() {
    const logBody = document.getElementById('logBody');
    if (!logBody) return;
    
    const filteredLogs = filterLogs(logs);
    
    if (filteredLogs.length === 0) {
        logBody.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📋</div>
                <div class="empty-text">
                    ${logs.length === 0 ? 
                        'Belum ada data komentar.<br>Klik "SCAN" untuk memulai deteksi.' :
                        `Tidak ada data untuk filter "${currentFilter}".<br>Coba filter lain.`
                    }
                </div>
            </div>
        `;
        return;
    }
    
    const logItems = filteredLogs.map(log => {
        const shortText = log.text.length > 150 ? 
            log.text.substring(0, 150) + '...' : log.text;
        const isSpam = log.label === 'SPAM JUDI';
        const confidenceFormatted = formatConfidence(log.confidence);
        
        // Cek apakah report sedang diproses
        const isProcessing = activeReports.has(log.commentId);
        
        return `
            <div class="log-item" data-log-id="${log.id}" data-comment-id="${log.commentId}">
                <div class="log-user">
                    <span class="username" title="@${log.user || 'Anonymous'}">@${log.user || 'Anonymous'}</span>
                    <span class="timestamp">${log.timestamp}</span>
                </div>
                <div class="comment-text" title="${log.text.replace(/"/g, '&quot;')}">${shortText}</div>
                <div class="log-footer">
                    <div class="badge ${isSpam ? 'spam' : 'safe'}">
                        ${isSpam ? '🚨 JUDI' : '✅ AMAN'}
                        <span style="margin-left: 5px; font-size: 10px;">${confidenceFormatted}</span>
                    </div>
                    ${isSpam ? `
                        <button class="report-btn 
                            ${log.reported ? 'reported' : ''} 
                            ${isProcessing ? 'processing' : ''}"
                            data-comment-id="${log.commentId}"
                            data-comment-text="${log.text.replace(/"/g, '&quot;')}"
                            data-username="${log.user}"
                            data-confidence="${log.confidence}"
                            ${log.reported || isProcessing ? 'disabled' : ''}
                            title="${log.reported ? 'Telah dilaporkan' : isProcessing ? 'Sedang diproses' : 'Klik untuk melaporkan'}">
                            ${log.reported ? '✅ DILAPORKAN' : isProcessing ? '🔄 PROSES...' : '🚨 REPORT'}
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
    
    logBody.innerHTML = logItems;
    
    // Tambahkan event listener untuk tombol report
    document.querySelectorAll('.report-btn:not(.reported):not(.processing)').forEach(btn => {
        btn.addEventListener('click', handleManualReport);
    });
}

// Handle manual report dengan validasi
function handleManualReport(event) {
    const button = event.target;
    const commentId = button.getAttribute('data-comment-id');
    const commentText = button.getAttribute('data-comment-text');
    const username = button.getAttribute('data-username');
    const confidence = button.getAttribute('data-confidence');
    
    // Cek apakah sudah ada report aktif untuk comment ini
    if (activeReports.has(commentId)) {
        showNotification('Report sedang diproses...', 'warning', 2000);
        return;
    }
    
    // Cari data log lengkap
    const logData = logs.find(log => log.commentId === commentId);
    
    if (!logData) {
        showNotification('❌ Data komentar tidak ditemukan', 'error', 3000);
        return;
    }
    
    // Tandai sebagai sedang diproses
    activeReports.set(commentId, {
        button: button,
        startTime: Date.now(),
        attempts: 0
    });
    
    // Update UI
    button.disabled = true;
    button.classList.add('processing');
    button.textContent = '🔄 PROSES...';
    button.title = 'Sedang melaporkan...';
    
    showNotification('⏳ Memulai proses report...', 'info', 2000);
    
    // Kirim ke content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].url.includes('youtube.com')) {
            chrome.tabs.sendMessage(tabs[0].id, {
                action: "manualReport",
                commentData: {
                    commentId: commentId,
                    text: commentText,
                    username: username,
                    confidence: confidence,
                    timestamp: Date.now()
                }
            }, (response) => {
                if (chrome.runtime.lastError) {
                    handleReportError(commentId, 'Gagal terhubung ke halaman');
                } else if (response && response.status === "report_started") {
                    // Mulai monitor proses report
                    monitorReportProgress(commentId, logData);
                } else {
                    handleReportError(commentId, 'Gagal memulai report');
                }
            });
        } else {
            handleReportError(commentId, 'Buka halaman YouTube terlebih dahulu');
        }
    });
}

// Monitor progress report
function monitorReportProgress(commentId, logData) {
    const reportData = activeReports.get(commentId);
    if (!reportData) return;
    
    reportData.attempts++;
    
    // Timeout setelah 30 detik
    if (reportData.attempts > 6) { // 6 * 5 detik = 30 detik
        handleReportError(commentId, 'Timeout - proses report terlalu lama');
        return;
    }
    
    // Cek status report setiap 5 detik
    setTimeout(() => {
        if (!activeReports.has(commentId)) return; // Sudah selesai
        
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    action: "checkReportStatus",
                    commentId: commentId
                }, (response) => {
                    if (chrome.runtime.lastError || !response || !response.reported) {
                        // Belum selesai, coba lagi
                        monitorReportProgress(commentId, logData);
                    } else {
                        // Report selesai
                        handleReportSuccess(commentId, logData);
                    }
                });
            } else {
                handleReportError(commentId, 'Tab tidak ditemukan');
            }
        });
    }, 5000);
}

// Handle report success
function handleReportSuccess(commentId, logData) {
    const reportData = activeReports.get(commentId);
    if (!reportData) return;
    
    // Update storage
    chrome.storage.local.get(['logs'], (result) => {
        const updatedLogs = result.logs.map(log => {
            if (log.commentId === commentId) {
                return { ...log, reported: true, reportedAt: new Date().toISOString() };
            }
            return log;
        });
        
        chrome.storage.local.set({ logs: updatedLogs }, () => {
            logs = updatedLogs;
            
            // Update UI
            if (reportData.button) {
                reportData.button.disabled = true;
                reportData.button.classList.remove('processing');
                reportData.button.classList.add('reported');
                reportData.button.textContent = '✅ DILAPORKAN';
                reportData.button.title = 'Telah dilaporkan';
            }
            
            // Hapus dari active reports
            activeReports.delete(commentId);
            
            // Update statistik
            updateStats();
            
            // Show success notification
            showNotification('✅ Komentar berhasil dilaporkan!', 'success', 3000);
            
            // Play success sound (optional)
            try {
                const audio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEAQB8AAEAfAAABAAgAZGF0YQ');
                // Audio kosong, bisa diganti dengan sound effect
            } catch(e) {}
        });
    });
}

// Handle report error
function handleReportError(commentId, errorMessage) {
    const reportData = activeReports.get(commentId);
    if (!reportData) return;
    
    // Reset button
    if (reportData.button) {
        reportData.button.disabled = false;
        reportData.button.classList.remove('processing');
        reportData.button.textContent = '🚨 REPORT';
        reportData.button.title = 'Klik untuk melaporkan';
    }
    
    // Hapus dari active reports
    activeReports.delete(commentId);
    
    // Show error notification
    showNotification(`❌ ${errorMessage}`, 'error', 4000);
    
    // Update UI
    updateUI();
}

// Start scan
function startScan() {
    if (isScanning) {
        showNotification('⚠️ Scanning sedang berjalan', 'warning', 2000);
        return;
    }
    
    isScanning = true;
    updateStatus('Memulai scanning...', 'scanning');
    showLoading('Memindai komentar...');
    
    const scanBtn = document.getElementById('scanBtn');
    if (scanBtn) {
        scanBtn.disabled = true;
        scanBtn.textContent = '🔄 SCANNING';
    }
    
    // Reset progress
    scanProgress = { current: 0, total: 0 };
    updateProgressBar(0);
    
    // Clear previous logs sebelum scan baru (opsional)
    chrome.storage.local.set({ logs: [] }, () => {
        logs = [];
        updateUI();
        
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0] && tabs[0].url.includes('youtube.com')) {
                chrome.tabs.sendMessage(tabs[0].id, { action: "forceScan" }, (response) => {
                    if (chrome.runtime.lastError) {
                        showNotification('⚠️ Reload halaman YouTube terlebih dahulu!', 'error', 3000);
                        resetScanButton();
                        hideLoading();
                    } else {
                        // Set timeout untuk reset button
                        setTimeout(() => {
                            resetScanButton();
                            hideLoading();
                        }, 45000); // 45 detik timeout
                    }
                });
            } else {
                showNotification('⚠️ Buka halaman YouTube terlebih dahulu!', 'error', 3000);
                resetScanButton();
                hideLoading();
            }
        });
    });
}

// Reset scan button
function resetScanButton() {
    isScanning = false;
    const scanBtn = document.getElementById('scanBtn');
    if (scanBtn) {
        scanBtn.disabled = false;
        scanBtn.textContent = '🔍 SCAN';
    }
    updateStatus('Siap untuk scanning', 'idle');
    hideLoading();
    loadLogs();
}

// Clear all data
function clearData() {
    if (confirm('Hapus semua data deteksi?')) {
        showLoading('Menghapus data...');
        chrome.storage.local.set({ logs: [] }, () => {
            logs = [];
            activeReports.clear();
            updateUI();
            hideLoading();
            showNotification('✅ Data berhasil dihapus!', 'success', 3000);
        });
    }
}

// Reset extension (reload page dan clear state)
function resetExtension() {
    if (confirm('Reset extension? Halaman YouTube akan direload dan semua state akan direset.')) {
        showLoading('Mereset extension...');
        
        // Clear active reports
        activeReports.clear();
        
        // Reload current tab
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.reload(tabs[0].id, {}, () => {
                    setTimeout(() => {
                        hideLoading();
                        showNotification('✅ Extension telah direset', 'success', 3000);
                        
                        // Close popup setelah 2 detik
                        setTimeout(() => {
                            window.close();
                        }, 2000);
                    }, 2000);
                });
            } else {
                hideLoading();
                showNotification('❌ Tidak ada tab aktif', 'error', 3000);
            }
        });
    }
}

// Check content script status
function checkContentScriptStatus() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].url.includes('youtube.com')) {
            chrome.tabs.sendMessage(tabs[0].id, { action: "ping" }, (response) => {
                if (chrome.runtime.lastError) {
                    updateStatus('⚠️ Reload halaman YouTube', 'error');
                    const scanBtn = document.getElementById('scanBtn');
                    if (scanBtn) scanBtn.disabled = true;
                } else {
                    updateStatus('✅ Terhubung ke halaman', 'idle');
                    const scanBtn = document.getElementById('scanBtn');
                    if (scanBtn) scanBtn.disabled = false;
                }
            });
        } else {
            updateStatus('⚠️ Buka halaman YouTube', 'error');
            const scanBtn = document.getElementById('scanBtn');
            if (scanBtn) scanBtn.disabled = true;
        }
    });
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Load initial data
    loadLogs();
    
    // Setup event listeners
    const scanBtn = document.getElementById('scanBtn');
    const clearBtn = document.getElementById('clearBtn');
    const resetBtn = document.getElementById('resetBtn');
    
    if (scanBtn) scanBtn.addEventListener('click', startScan);
    if (clearBtn) clearBtn.addEventListener('click', clearData);
    if (resetBtn) resetBtn.addEventListener('click', resetExtension);
    
    // Filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentFilter = e.target.getAttribute('data-filter');
            updateUI();
        });
    });
    
    // Check content script status
    checkContentScriptStatus();
    
    // Listen for messages from content script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === "scanCompleted") {
            console.log('Scan completed:', message.data);
            
            // Reset button
            resetScanButton();
            
            // Show notification
            if (message.data.spamFound > 0) {
                showNotification(`✅ Scan selesai! Ditemukan ${message.data.spamFound} spam judi.`, 'success', 4000);
            } else {
                showNotification('✅ Scan selesai! Tidak ditemukan spam judi.', 'success', 3000);
            }
            
            // Reload logs
            loadLogs();
        }
        else if (message.action === "scanProgress") {
            // Update progress bar
            if (message.data.total > 0) {
                const progress = (message.data.scanned / message.data.total) * 100;
                updateProgressBar(progress);
                
                // Update status text
                updateStatus(`Scanning: ${message.data.scanned}/${message.data.total} komentar`, 'scanning');
            }
        }
        else if (message.action === "reportCompleted") {
            // Handle report completion from content script
            if (message.data && message.data.commentId) {
                const logData = logs.find(log => log.commentId === message.data.commentId);
                if (logData) {
                    handleReportSuccess(message.data.commentId, logData);
                }
            }
        }
        
        sendResponse({ received: true });
        return true;
    });
    
    // Auto-refresh logs every 2 seconds when popup is open
    const refreshInterval = setInterval(loadLogs, 2000);
    
    // Clear interval when popup closes
    window.addEventListener('unload', () => {
        clearInterval(refreshInterval);
        // Clean up active reports
        activeReports.clear();
    });
});