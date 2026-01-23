/**
 * AutoResume Dashboard - Client Application
 * Connects to daemon via WebSocket for real-time updates
 */

class AutoResumeDashboard {
    constructor() {
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 2000;
        this.chart = null;
        this.sessions = new Map();
        this.startTime = Date.now();

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.initChart();
        this.connectWebSocket();
        this.startUpdateLoop();
        this.loadConfig();
    }

    // ===== WEBSOCKET CONNECTION =====
    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.hostname || 'localhost';
        const port = 8765; // Default WebSocket port

        try {
            this.ws = new WebSocket(`${protocol}//${host}:${port}`);

            this.ws.onopen = () => {
                console.log('WebSocket connected');
                this.reconnectAttempts = 0;
                this.updateConnectionStatus(true);
                this.showToast('Connected to daemon', 'success');
                this.requestStatus();
            };

            this.ws.onmessage = (event) => {
                this.handleMessage(JSON.parse(event.data));
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.updateConnectionStatus(false);
            };

            this.ws.onclose = () => {
                console.log('WebSocket disconnected');
                this.updateConnectionStatus(false);
                this.attemptReconnect();
            };
        } catch (error) {
            console.error('Failed to create WebSocket:', error);
            this.updateConnectionStatus(false);
            this.showToast('Failed to connect to daemon', 'error');
        }
    }

    attemptReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);

            console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

            setTimeout(() => {
                this.connectWebSocket();
            }, delay);
        } else {
            this.showToast('Unable to connect to daemon. Please check if it\'s running.', 'error');
        }
    }

    sendMessage(type, data = {}) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type, ...data }));
        } else {
            console.warn('WebSocket not connected');
            this.showToast('Not connected to daemon', 'warning');
        }
    }

    requestStatus() {
        this.sendMessage('status');
        this.sendMessage('config');
        this.sendMessage('analytics');
    }

    handleMessage(message) {
        console.log('Received message:', message);

        switch (message.type) {
            case 'status':
                this.updateSessions(message.sessions || []);
                this.updateStats(message.stats || {});
                break;

            case 'config':
                this.updateConfigForm(message.config || {});
                break;

            case 'analytics':
                this.updateChart(message.data || []);
                break;

            case 'session_update':
                this.updateSession(message.session);
                break;

            case 'rate_limit':
                this.handleRateLimit(message);
                break;

            case 'resume_success':
                this.handleResumeSuccess(message);
                break;

            case 'error':
                this.showToast(message.message || 'An error occurred', 'error');
                break;

            default:
                console.warn('Unknown message type:', message.type);
        }

        // Update last update timestamp
        document.getElementById('lastUpdate').textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
    }

    // ===== CONNECTION STATUS =====
    updateConnectionStatus(connected) {
        const statusEl = document.getElementById('connectionStatus');
        const statusDot = statusEl.querySelector('.status-dot');
        const statusText = statusEl.querySelector('.status-text');

        if (connected) {
            statusEl.classList.add('connected');
            statusText.textContent = 'Connected';
        } else {
            statusEl.classList.remove('connected');
            statusText.textContent = 'Disconnected';
        }
    }

    // ===== SESSION MANAGEMENT =====
    updateSessions(sessions) {
        const container = document.getElementById('sessionsGrid');

        if (!sessions || sessions.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="32" cy="32" r="30"/>
                        <path d="M32 16v16l8 8"/>
                    </svg>
                    <p>No active sessions detected</p>
                    <span>Start the daemon to monitor sessions</span>
                </div>
            `;
            return;
        }

        container.innerHTML = sessions.map(session => this.createSessionCard(session)).join('');
    }

    createSessionCard(session) {
        const { id, status, message, reset_time, detected } = session;
        const statusClass = detected ? 'rate-limited' : 'ok';
        const badgeClass = detected ? 'error' : 'ok';
        const badgeText = detected ? 'Rate Limited' : 'Active';

        let countdown = '';
        if (detected && reset_time) {
            const resetDate = new Date(reset_time);
            const now = new Date();
            const remaining = resetDate - now;

            if (remaining > 0) {
                countdown = `
                    <div class="session-countdown" data-reset="${reset_time}">
                        ${this.formatTimeRemaining(remaining)}
                    </div>
                `;
            }
        }

        return `
            <div class="session-card ${statusClass}" data-session-id="${id}">
                <div class="session-header">
                    <div class="session-title">Session ${id}</div>
                    <span class="session-badge ${badgeClass}">${badgeText}</span>
                </div>
                <div class="session-info">
                    <div>${message || 'No status message'}</div>
                    ${reset_time ? `<div>Resets: ${new Date(reset_time).toLocaleString()}</div>` : ''}
                </div>
                ${countdown}
                ${detected ? `
                    <div class="session-actions">
                        <button class="btn btn-small btn-primary" onclick="dashboard.resumeSession('${id}')">
                            Resume Now
                        </button>
                        <button class="btn btn-small btn-secondary" onclick="dashboard.clearSession('${id}')">
                            Clear Status
                        </button>
                    </div>
                ` : ''}
            </div>
        `;
    }

    updateSession(session) {
        // Update specific session in the map
        this.sessions.set(session.id, session);
        // Re-render all sessions
        this.updateSessions(Array.from(this.sessions.values()));
    }

    resumeSession(sessionId) {
        this.sendMessage('resume', { session_id: sessionId });
        this.showToast(`Resuming session ${sessionId}...`, 'info');
    }

    clearSession(sessionId) {
        this.sendMessage('clear', { session_id: sessionId });
        this.showToast(`Cleared session ${sessionId}`, 'success');
    }

    // ===== STATS =====
    updateStats(stats) {
        const uptimeEl = document.getElementById('uptime');
        const totalResumesEl = document.getElementById('totalResumes');
        const successRateEl = document.getElementById('successRate');
        const peakHourEl = document.getElementById('peakHour');

        if (stats.uptime !== undefined) {
            const uptime = stats.uptime * 1000; // Convert to ms
            uptimeEl.textContent = this.formatUptime(uptime);
        }

        if (stats.total_resumes !== undefined) {
            totalResumesEl.textContent = stats.total_resumes;
        }

        if (stats.success_rate !== undefined) {
            successRateEl.textContent = `${Math.round(stats.success_rate * 100)}%`;
        }

        if (stats.peak_hour !== undefined) {
            peakHourEl.textContent = stats.peak_hour;
        }
    }

    // ===== ANALYTICS CHART =====
    initChart() {
        const ctx = document.getElementById('analyticsChart');

        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'Rate Limit Events',
                        data: [],
                        borderColor: '#00f5ff',
                        backgroundColor: 'rgba(0, 245, 255, 0.1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4
                    },
                    {
                        label: 'Successful Resumes',
                        data: [],
                        borderColor: '#00ff88',
                        backgroundColor: 'rgba(0, 255, 136, 0.1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        labels: {
                            color: '#a8a8b8',
                            font: { size: 12 }
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(17, 17, 24, 0.9)',
                        titleColor: '#f0f0f5',
                        bodyColor: '#a8a8b8',
                        borderColor: '#00f5ff',
                        borderWidth: 1
                    }
                },
                scales: {
                    x: {
                        ticks: { color: '#666675' },
                        grid: { color: 'rgba(255, 255, 255, 0.05)' }
                    },
                    y: {
                        ticks: { color: '#666675' },
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        beginAtZero: true
                    }
                }
            }
        });
    }

    updateChart(data) {
        if (!this.chart || !data) return;

        const labels = data.map(d => new Date(d.timestamp).toLocaleTimeString());
        const rateLimits = data.map(d => d.rate_limits || 0);
        const resumes = data.map(d => d.resumes || 0);

        this.chart.data.labels = labels;
        this.chart.data.datasets[0].data = rateLimits;
        this.chart.data.datasets[1].data = resumes;
        this.chart.update();
    }

    // ===== CONFIGURATION =====
    loadConfig() {
        const config = JSON.parse(localStorage.getItem('autoResumeConfig') || '{}');
        this.updateConfigForm(config);
    }

    updateConfigForm(config) {
        if (config.checkInterval) {
            document.getElementById('checkInterval').value = config.checkInterval;
        }
        if (config.autoResume !== undefined) {
            document.getElementById('autoResume').checked = config.autoResume;
        }
        if (config.notifySound !== undefined) {
            document.getElementById('notifySound').checked = config.notifySound;
        }
        if (config.debugMode !== undefined) {
            document.getElementById('debugMode').checked = config.debugMode;
        }
    }

    saveConfig(config) {
        localStorage.setItem('autoResumeConfig', JSON.stringify(config));
        this.sendMessage('config_update', { config });
        this.showToast('Configuration saved', 'success');
    }

    resetConfig() {
        const defaultConfig = {
            checkInterval: 60,
            autoResume: true,
            notifySound: false,
            debugMode: false
        };
        this.updateConfigForm(defaultConfig);
        this.saveConfig(defaultConfig);
    }

    // ===== EVENT HANDLERS =====
    setupEventListeners() {
        // Refresh button
        document.getElementById('refreshBtn')?.addEventListener('click', () => {
            this.requestStatus();
            this.showToast('Refreshing...', 'info');
        });

        // Time range buttons
        document.querySelectorAll('.time-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                const range = e.target.dataset.range;
                this.sendMessage('analytics', { range });
            });
        });

        // Config form
        document.getElementById('configForm')?.addEventListener('submit', (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const config = {
                checkInterval: parseInt(formData.get('checkInterval')),
                autoResume: formData.get('autoResume') === 'on',
                notifySound: formData.get('notifySound') === 'on',
                debugMode: formData.get('debugMode') === 'on'
            };
            this.saveConfig(config);
        });

        // Reset config button
        document.getElementById('resetConfigBtn')?.addEventListener('click', () => {
            this.resetConfig();
        });

        // Action buttons
        document.getElementById('startDaemonBtn')?.addEventListener('click', () => {
            this.sendMessage('daemon_start');
            this.showToast('Starting daemon...', 'info');
        });

        document.getElementById('stopDaemonBtn')?.addEventListener('click', () => {
            this.sendMessage('daemon_stop');
            this.showToast('Stopping daemon...', 'info');
        });

        document.getElementById('resetStatusBtn')?.addEventListener('click', () => {
            this.sendMessage('reset_status');
            this.showToast('Resetting status...', 'info');
        });

        document.getElementById('viewLogsBtn')?.addEventListener('click', () => {
            this.sendMessage('get_logs');
        });
    }

    // ===== RATE LIMIT HANDLING =====
    handleRateLimit(message) {
        this.showToast(`Rate limit detected! Resets at ${new Date(message.reset_time).toLocaleTimeString()}`, 'warning');
    }

    handleResumeSuccess(message) {
        this.showToast(`Session resumed successfully!`, 'success');
    }

    // ===== UI UPDATES =====
    startUpdateLoop() {
        setInterval(() => {
            // Update uptime
            const uptime = Date.now() - this.startTime;
            document.getElementById('uptime').textContent = this.formatUptime(uptime);

            // Update countdowns
            document.querySelectorAll('.session-countdown').forEach(el => {
                const resetTime = new Date(el.dataset.reset);
                const remaining = resetTime - new Date();
                if (remaining > 0) {
                    el.textContent = this.formatTimeRemaining(remaining);
                } else {
                    el.textContent = '00:00:00';
                }
            });
        }, 1000);

        // Request status every 10 seconds
        setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.requestStatus();
            }
        }, 10000);
    }

    // ===== TOAST NOTIFICATIONS =====
    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <div class="toast-title">${this.capitalizeFirst(type)}</div>
            <div class="toast-message">${message}</div>
        `;

        container.appendChild(toast);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            toast.style.animation = 'slideOutRight 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
            setTimeout(() => toast.remove(), 300);
        }, 5000);
    }

    // ===== UTILITY FUNCTIONS =====
    formatTimeRemaining(ms) {
        if (ms < 0) return '00:00:00';

        const seconds = Math.floor(ms / 1000);
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;

        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    formatUptime(ms) {
        const seconds = Math.floor(ms / 1000);
        const days = Math.floor(seconds / 86400);
        const h = Math.floor((seconds % 86400) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;

        if (days > 0) {
            return `${days}d ${h}h ${m}m`;
        }
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    capitalizeFirst(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
}

// Add slideOutRight animation to CSS dynamically
const style = document.createElement('style');
style.textContent = `
    @keyframes slideOutRight {
        from {
            opacity: 1;
            transform: translateX(0);
        }
        to {
            opacity: 0;
            transform: translateX(100%);
        }
    }
`;
document.head.appendChild(style);

// Initialize dashboard when DOM is ready
let dashboard;
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        dashboard = new AutoResumeDashboard();
    });
} else {
    dashboard = new AutoResumeDashboard();
}
