// Bump this version string when deploying changes to verify updates/downgrades
const APP_VERSION = 'v1.0.2';

document.addEventListener('DOMContentLoaded', () => {
    const fillEl = document.getElementById('battery-level-fill');
    const percentageEl = document.getElementById('percentage-text');
    const chargingEl = document.getElementById('charging-status');
    const sourceEl = document.getElementById('api-source');
    const platformNote = document.getElementById('platform-note');
    const versionEl = document.getElementById('app-version');
    const fallbackContainer = document.getElementById('fallback-control');
    const sliderEl = document.getElementById('battery-slider');
    const refreshBtn = document.getElementById('refresh-btn');

    // Display version on UI
    if (versionEl) {
        versionEl.textContent = APP_VERSION;
    }

    function updateUI(level, charging) {
        const percentage = Math.round(level * 100);
        fillEl.style.height = `${percentage}%`;
        percentageEl.textContent = `${percentage}%`;

        if (charging) {
            fillEl.style.backgroundColor = '#34c759'; // Green charging state
            chargingEl.textContent = 'Charging ⚡';
        } else {
            chargingEl.textContent = 'Discharging 🔋';
            if (percentage <= 20) {
                fillEl.style.backgroundColor = '#ff3b30'; // Red low battery
            } else if (percentage <= 40) {
                fillEl.style.backgroundColor = '#ffcc00'; // Yellow medium state
            } else {
                fillEl.style.backgroundColor = '#007aff'; // Blue normal state
            }
        }
    }

    // Native Battery API check (Supported natively on Android/Chrome/Edge)
    if ('getBattery' in navigator) {
        platformNote.textContent = 'Running on Android / Chromium (Native Battery API)';
        sourceEl.textContent = 'Native API';

        navigator.getBattery().then(battery => {
            updateUI(battery.level, battery.charging);

            battery.addEventListener('levelchange', () => {
                updateUI(battery.level, battery.charging);
            });
            battery.addEventListener('chargingchange', () => {
                updateUI(battery.level, battery.charging);
            });
        });
    } else {
        // iOS Safari restriction fallback (iOS restricts hardware battery access for privacy reasons)
        platformNote.textContent = 'iOS / Safari (Interactive Simulation Mode)';
        sourceEl.textContent = 'Simulation Fallback';
        fallbackContainer.style.display = 'block';

        updateUI(sliderEl.value / 100, false);

        sliderEl.addEventListener('input', (e) => {
            const val = e.target.value / 100;
            updateUI(val, false);
        });
    }

    // Manual Refresh / Force Update / Downgrade Handler
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            refreshBtn.textContent = 'Syncing...';
            try {
                // Clear all browser caches stored by the service worker
                if ('caches' in window) {
                    const cacheNames = await caches.keys();
                    await Promise.all(cacheNames.map(name => caches.delete(name)));
                }
                // Unregister any active service workers so they fetch fresh files immediately
                if ('serviceWorker' in navigator) {
                    const registrations = await navigator.serviceWorker.getRegistrations();
                    await Promise.all(registrations.map(reg => reg.unregister()));
                }
            } catch (err) {
                console.error('Error cleaning caches or service workers:', err);
            } finally {
                // Force reload the page completely from the network server (bypassing cache)
                window.location.reload(true);
            }
        });
    }
});
