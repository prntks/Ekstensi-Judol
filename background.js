// Background script untuk handle messages
chrome.runtime.onInstalled.addListener(() => {
    console.log('Radar Judi Detector Extension Installed');
    
    // Initialize storage
    chrome.storage.local.get(['logs'], (result) => {
        if (!result.logs) {
            chrome.storage.local.set({ logs: [] });
        }
    });
});

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "scanCompleted") {
        chrome.runtime.sendMessage(message).catch(() => {
            // Popup is not open, that's okay
        });
    }
    
    sendResponse({ received: true });
    return true;
});