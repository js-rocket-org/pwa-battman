

// --- Configuration & Constants ---
// Easily adjust HUD drift speed for burn-in protection:
// 0.2 = very subtle, slow drift | 0.5 = moderate | 1.0+ = faster motion
const BURN_IN_SPEED = 0.5;

// --- DOM Elements ---
const mainView = document.getElementById('main-view');
const dischargeView = document.getElementById('discharge-view');
const dischargeCard = document.querySelector('.discharge-overlay-content');
const domLevel = document.getElementById('battery-level');
const domPercentage = document.getElementById('battery-percentage');
const domCharging = document.getElementById('charging-icon');
const fallbackControls = document.getElementById('ios-fallback-controls');
const slider = document.getElementById('battery-slider');
const toggleCharge = document.getElementById('charging-toggle');
const refreshBtn = document.getElementById('refresh-btn');
const statusMsg = document.getElementById('update-status');

const targetInput = document.getElementById('target-percent');
const startDischargeBtn = document.getElementById('start-discharge-btn');
const stopDischargeBtn = document.getElementById('stop-discharge-btn');
const dischargeCurrent = document.getElementById('discharge-current');
const dischargeTarget = document.getElementById('discharge-target');
const canvas = document.getElementById('drain-canvas');
const ctx = canvas.getContext('2d');

document.getElementById('version-display').textContent = `v${appVersion}`;

// --- State Variables ---
let currentBatteryLevel = 75;
let isChargingStatus = false;
let isDischarging = false;
let targetPercentage = 50;
let wakeLock = null;
let animationFrameId = null;
let audioCtx = null;
let swRegistration = null;

// Anti-burn-in drift position and directional velocity vectors
let hudOffset = { x: 0, y: 0 };
let hudVelocity = { vx: BURN_IN_SPEED, vy: BURN_IN_SPEED };

// --- Battery Status Management ---

function updateBatteryUI(percent, isCharging) {
    currentBatteryLevel = Math.max(0, Math.min(100, Math.round(percent)));
    isChargingStatus = Boolean(isCharging);

    domLevel.style.width = `${currentBatteryLevel}%`;
    domPercentage.textContent = `${currentBatteryLevel}%`;
    domCharging.style.display = isChargingStatus ? 'inline-block' : 'none';

    dischargeCurrent.textContent = `${currentBatteryLevel}%`;

    domLevel.classList.remove('level-high', 'level-med', 'level-low');
    if (currentBatteryLevel > 50) {
        domLevel.classList.add('level-high');
    } else if (currentBatteryLevel > 20) {
        domLevel.classList.add('level-med');
    } else {
        domLevel.classList.add('level-low');
    }

    if (isDischarging && currentBatteryLevel <= targetPercentage) {
        stopDischarge(true);
    }
}

async function initBattery() {
    if ('getBattery' in navigator) {
        try {
            const battery = await navigator.getBattery();
            const update = () => updateBatteryUI(battery.level * 100, battery.charging);
            update();
            battery.addEventListener('levelchange', update);
            battery.addEventListener('chargingchange', update);
        } catch (e) {
            setupFallback();
        }
    } else {
        setupFallback();
    }
}

function setupFallback() {
    fallbackControls.style.display = 'block';
    const update = () => updateBatteryUI(slider.value, toggleCharge.checked);
    slider.addEventListener('input', update);
    toggleCharge.addEventListener('change', update);
    updateBatteryUI(slider.value, false);
}

// --- Screen Wake Lock API ---

async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => {
                wakeLock = null;
            });
        } catch (err) {
            console.warn('Wake Lock request failed:', err);
        }
    }
}

function releaseWakeLock() {
    if (wakeLock) {
        wakeLock.release().catch(() => {});
        wakeLock = null;
    }
}

document.addEventListener('visibilitychange', () => {
    if (isDischarging && document.visibilityState === 'visible') {
        requestWakeLock();
    }
});

// --- Audio Feedback (Web Audio API Synthesizer) ---

function initAudioContext() {
    if (!audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
            audioCtx = new AudioContextClass();
        }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

function playCompletionBeeps() {
    initAudioContext();
    if (!audioCtx) return;

    const baseTime = audioCtx.currentTime;
    const beeps = [880, 880, 1174.66]; // A5, A5, D6 frequencies

    beeps.forEach((freq, index) => {
        const startTime = baseTime + (index * 0.18);
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, startTime);

        gain.gain.setValueAtTime(0.2, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.14);

        osc.connect(gain);
        gain.connect(audioCtx.destination);

        osc.start(startTime);
        osc.stop(startTime + 0.14);
    });
}

// --- Fullscreen Animation & Anti-Burn-In Engine ---

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);

let particles = [];
const NUM_PARTICLES = 60;

function initParticles() {
    resizeCanvas();
    particles = [];
    for (let i = 0; i < NUM_PARTICLES; i++) {
        particles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            vx: (Math.random() - 0.5) * 6,
            vy: (Math.random() - 0.5) * 6,
            radius: Math.random() * 3 + 1,
            color: Math.random() > 0.5 ? '#f59e0b' : '#ef4444'
        });
    }
}

function updateHUDPosition() {
    if (!dischargeCard) return;

    const cardRect = dischargeCard.getBoundingClientRect();
    // Calculate allowable drift limits from center to prevent clipping off screen
    const maxOffsetX = Math.max(0, (window.innerWidth - cardRect.width) / 2 - 20);
    const maxOffsetY = Math.max(0, (window.innerHeight - cardRect.height) / 2 - 20);

    if (maxOffsetX > 0) {
        hudOffset.x += hudVelocity.vx;
        if (Math.abs(hudOffset.x) >= maxOffsetX) {
            hudOffset.x = Math.sign(hudOffset.x) * maxOffsetX;
            hudVelocity.vx *= -1;
        }
    } else {
        hudOffset.x = 0;
    }

    if (maxOffsetY > 0) {
        hudOffset.y += hudVelocity.vy;
        if (Math.abs(hudOffset.y) >= maxOffsetY) {
            hudOffset.y = Math.sign(hudOffset.y) * maxOffsetY;
            hudVelocity.vy *= -1;
        }
    } else {
        hudOffset.y = 0;
    }

    dischargeCard.style.transform = `translate3d(${hudOffset.x.toFixed(2)}px, ${hudOffset.y.toFixed(2)}px, 0)`;
}

function renderAnimation() {
    // 1. Transparent fade to allow background color cycling to shine through
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    // 2. Render and update particles
    for (let p of particles) {
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = p.color;
        ctx.fill();
        ctx.shadowBlur = 0;
    }

    // 3. Compute-heavy operations to maintain GPU/CPU activity
    for (let i = 0; i < 400; i++) {
        Math.atan2(Math.sin(i), Math.cos(i));
    }

    // 4. Update floating anti-burn-in HUD position
    updateHUDPosition();

    if (isDischarging) {
        animationFrameId = requestAnimationFrame(renderAnimation);
    }
}

// --- Discharge Mode Controller ---

function notifyServiceWorker(type) {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type });
    } else if (swRegistration && swRegistration.active) {
        swRegistration.active.postMessage({ type });
    }
}

function startDischarge() {
    const desired = parseInt(targetInput.value, 10);
    if (isNaN(desired) || desired < 1 || desired > 99) {
        alert('Please specify a target percentage between 1 and 99.');
        return;
    }

    if (desired >= currentBatteryLevel) {
        alert(`Target level (${desired}%) must be lower than current battery level (${currentBatteryLevel}%).`);
        return;
    }

    targetPercentage = desired;
    dischargeTarget.textContent = `${targetPercentage}%`;
    dischargeCurrent.textContent = `${currentBatteryLevel}%`;
    isDischarging = true;

    // Reset and randomize initial HUD drift angle
    hudOffset = { x: 0, y: 0 };
    hudVelocity = {
        vx: BURN_IN_SPEED * (Math.random() > 0.5 ? 1 : -1),
        vy: BURN_IN_SPEED * (Math.random() > 0.5 ? 1 : -1)
    };
    if (dischargeCard) {
        dischargeCard.style.transform = 'translate3d(0, 0, 0)';
    }

    initAudioContext();
    requestWakeLock();
    notifyServiceWorker('START_DRAIN');

    mainView.style.display = 'none';
    dischargeView.style.display = 'flex';
    dischargeView.classList.add('active-drain');

    initParticles();
    animationFrameId = requestAnimationFrame(renderAnimation);
}

function stopDischarge(reachedTarget = false) {
    isDischarging = false;

    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    releaseWakeLock();
    notifyServiceWorker('STOP_DRAIN');

    dischargeView.classList.remove('active-drain');
    dischargeView.style.display = 'none';
    mainView.style.display = 'flex';

    if (dischargeCard) {
        dischargeCard.style.transform = 'translate3d(0, 0, 0)';
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (reachedTarget) {
        playCompletionBeeps();
        setStatus(`Discharge completed! Target ${targetPercentage}% reached.`);
    }
}

startDischargeBtn.addEventListener('click', startDischarge);
stopDischargeBtn.addEventListener('click', () => stopDischarge(false));

// --- SW Registration & Upgrade / Downgrade Handling ---

function setStatus(msg) {
    statusMsg.textContent = msg;
    setTimeout(() => { if (statusMsg.textContent === msg) statusMsg.textContent = ''; }, 3500);
}

async function registerSW() {
    if ('serviceWorker' in navigator) {
        try {
            swRegistration = await navigator.serviceWorker.register(`sw.js?v=${Date.now()}`);
            navigator.serviceWorker.addEventListener('message', event => {
                if (event.data && event.data.type === 'VERSION_CHECK') {
                    const swVersion = event.data.version;
                    if (appVersion !== swVersion) {
                        setStatus('Version mismatch detected. Updating...');
                        performHardRefresh();
                    } else {
                        setStatus('App is up to date.');
                    }
                }
            });
        } catch (err) {
            console.error('Service Worker registration error:', err);
        }
    }
}

async function performHardRefresh() {
    refreshBtn.disabled = true;
    setStatus('Purging caches...');

    if ('caches' in window) {
        try {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map(name => caches.delete(name)));
        } catch (e) {
            console.error('Cache purge failed:', e);
        }
    }

    if ('serviceWorker' in navigator) {
        try {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (let reg of registrations) {
                await reg.unregister();
            }
        } catch (e) {
            console.error('SW unregistration failed:', e);
        }
    }

    setStatus('Reloading...');
    setTimeout(() => {
        const cleanUrl = window.location.origin + window.location.pathname;
        window.location.href = cleanUrl + '?refresh=' + Date.now();
    }, 400);
}

refreshBtn.addEventListener('click', () => {
    setStatus('Checking for updates...');
    if (swRegistration && swRegistration.active) {
        swRegistration.active.postMessage({ type: 'GET_VERSION' });
        swRegistration.update();
    } else {
        performHardRefresh();
    }
});

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    initBattery();
    registerSW();
});
