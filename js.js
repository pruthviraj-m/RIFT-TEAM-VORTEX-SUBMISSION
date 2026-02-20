const BASE_URL = 'http://localhost:5000';
let currentData = null;
let scene, camera, renderer, controls, nodes = [], edges = [];
let messageTimeout = null;

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const messageEl = document.getElementById('message');
const fileInput = document.getElementById('fileInput');
const fileInfo = document.getElementById('fileInfo');
const analyzeBtn = document.getElementById('analyzeBtn');
const downloadBtn = document.getElementById('downloadBtn');
const totalAccounts = document.getElementById('totalAccounts');
const suspiciousCount = document.getElementById('suspiciousCount');
const ringsCount = document.getElementById('ringsCount');
const processTime = document.getElementById('processTime');
const ringsTableBody = document.getElementById('ringsTableBody');
const accountsTableBody = document.getElementById('accountsTableBody');
const ringsTab = document.getElementById('ringsTab');
const accountsTab = document.getElementById('accountsTab');
const graphContainer = document.getElementById('network-graph');

window.addEventListener('load', function() {
    console.log('Page loaded, initializing...');
    checkHealth();
    initGSAP();
    
    console.log('Graph container:', graphContainer);
    console.log('Status dot:', statusDot);
});

function initGSAP() {
    if (typeof gsap === 'undefined') {
        console.error('GSAP not loaded');
        return;
    }
    
    gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);
    
    gsap.fromTo(".hero-title", 
        { y: 100, opacity: 0 },
        { y: 0, opacity: 1, duration: 1, ease: "power3.out" }
    );
    
    gsap.fromTo(".hero-subtitle", 
        { y: 50, opacity: 0 },
        { y: 0, opacity: 1, duration: 1, delay: 0.3, ease: "power3.out" }
    );
    
    gsap.fromTo(".upload-card", 
        { y: 50, opacity: 0 },
        { y: 0, opacity: 1, duration: 1, delay: 0.6, ease: "power3.out" }
    );
}

function scrollToSection(sectionId) {
    gsap.to(window, {
        duration: 1,
        scrollTo: { y: `#${sectionId}`, offsetY: 80 },
        ease: "power3.inOut"
    });
}

function toggleMenu() {
    gsap.to(".dot", {
        duration: 0.3,
        y: 5,
        stagger: 0.1,
        yoyo: true,
        repeat: 1
    });
}

async function checkHealth() {
    try {
        console.log('Checking health at:', BASE_URL + '/health');
        const response = await fetch(`${BASE_URL}/health`, {
            method: 'GET',
            mode: 'cors',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        console.log('Health check response:', response.status);
        
        if (response.ok) {
            statusDot.className = 'status-dot online';
            statusText.innerText = 'System Online · Ready';
            statusText.style.color = '#00ff88';
            showMessage('✅ Backend connected successfully', 'success');
        } else {
            throw new Error(`HTTP ${response.status}`);
        }
    } catch (error) {
        console.error('Health check failed:', error);
        statusDot.className = 'status-dot';
        statusText.innerText = 'Backend Offline - Start Flask server';
        statusText.style.color = '#ff3b3b';
        showMessage('❌ Cannot connect to backend. Make sure Flask is running on port 5000', 'error');
    }
}

fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) {
        const file = e.target.files[0];
        fileInfo.textContent = `📄 ${file.name} (${(file.size / 1024).toFixed(2)} KB)`;
        console.log('File selected:', file.name);
        
        gsap.fromTo(fileInfo, 
            { scale: 0.9, opacity: 0 },
            { scale: 1, opacity: 1, duration: 0.3, ease: "backOut" }
        );
    }
});

async function analyzeFile() {
    if (!fileInput.files[0]) {
        showMessage('Please select a CSV file first', 'error');
        return;
    }

    const startTime = Date.now();
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    showMessage('🔄 Analyzing transactions...', 'loading');
    analyzeBtn.disabled = true;
    analyzeBtn.style.opacity = '0.5';

    try {
        console.log('Sending file to:', BASE_URL + '/upload');
        console.log('File size:', fileInput.files[0].size, 'bytes');
        
        const response = await fetch(`${BASE_URL}/upload`, {
            method: 'POST',
            mode: 'cors',
            body: formData
        });

        console.log('Upload response status:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Server error:', errorText);
            throw new Error(`Server error: ${response.status}`);
        }

        const data = await response.json();
        console.log('Backend response data:', data);

        if (!data) {
            throw new Error('No data received from server');
        }

        currentData = data;
        
        const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log('Processing time:', processingTime, 'seconds');
        
        updateStats(data, processingTime);
        renderRingsTable(data);
        renderAccountsTable(data);
        renderRepeatTable(data);
        
        document.getElementById('results').style.display = 'block';
        document.getElementById('graph').style.display = 'block';
        
        setTimeout(() => {
            console.log('Initializing graph...');
            initGraph(data);
        }, 500);
        
        downloadBtn.style.display = 'block';
        
        const suspiciousCount = data.summary?.suspicious_accounts_flagged || 0;
        showMessage(`✅ Analysis complete! Found ${suspiciousCount} suspicious accounts`, 'success');
        
        setTimeout(() => scrollToSection('graph'), 1000);
        
    } catch (error) {
        console.error('Analysis error:', error);
        showMessage('❌ ' + error.message, 'error');
    } finally {
        analyzeBtn.disabled = false;
        analyzeBtn.style.opacity = '1';
    }
}

function updateStats(data, processingTime) {
    const summary = data.summary || {};
    
    totalAccounts.textContent = summary.total_accounts_analyzed || 0;
    suspiciousCount.textContent = summary.suspicious_accounts_flagged || 0;
    ringsCount.textContent = summary.fraud_rings_detected || 0;
    processTime.textContent = processingTime;

    gsap.fromTo(".stat-card", 
        { y: 50, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.8, stagger: 0.1, ease: "power3.out" }
    );
}

function renderRingsTable(data) {
    const rings = data.fraud_rings || [];
    
    if (rings.length === 0) {
        ringsTableBody.innerHTML = '<tr><td colspan="5" class="no-data">No fraud rings detected</td></tr>';
        return;
    }

    let html = '';
    rings.forEach(ring => {
        const members = ring.member_accounts || [];
        const riskClass = ring.risk_score > 80 ? 'score-high' : ring.risk_score > 50 ? 'score-medium' : 'score-low';
        
        html += `
            <tr>
                <td><span class="ring-badge">${ring.ring_id || 'Unknown'}</span></td>
                <td>${ring.pattern_type || 'unknown'}</td>
                <td>${ring.member_count || members.length}</td>
                <td class="${riskClass}">${(ring.risk_score || 0).toFixed(1)}</td>
                <td>${members.slice(0, 3).join(', ')}${members.length > 3 ? '...' : ''}</td>
            </tr>
        `;
    });
    
    ringsTableBody.innerHTML = html;
    console.log('Rings table rendered with', rings.length, 'rings');
}

function renderAccountsTable(data) {
    const accounts = data.suspicious_accounts || [];
    
    if (accounts.length === 0) {
        accountsTableBody.innerHTML = '<tr><td colspan="4" class="no-data">No suspicious accounts detected</td></tr>';
        return;
    }

    let html = '';
    accounts.forEach(acc => {
        const scoreClass = acc.suspicion_score > 80 ? 'score-high' : acc.suspicion_score > 50 ? 'score-medium' : 'score-low';
        
        html += `
            <tr>
                <td><strong>${acc.account_id}</strong></td>
                <td class="${scoreClass}">${acc.suspicion_score}</td>
                <td>${(acc.detected_patterns || []).join(', ')}</td>
                <td>${acc.ring_id || 'None'}</td>
            </tr>
        `;
    });
    
    accountsTableBody.innerHTML = html;
    console.log('Accounts table rendered with', accounts.length, 'accounts');
}

function renderRepeatTable(data) {
    const rings = data.fraud_rings || [];
    const accounts = data.suspicious_accounts || [];
    
    if (rings.length === 0 || accounts.length === 0) {
        document.getElementById('repeatTableBody').innerHTML = '<tr><td colspan="5" class="no-data">No repeat offenders detected</td></tr>';
        return;
    }

    const accountRings = new Map();
    
    rings.forEach(ring => {
        const ringId = ring.ring_id;
        const patternType = ring.pattern_type;
        const riskScore = ring.risk_score;
        
        (ring.member_accounts || []).forEach(account => {
            if (!accountRings.has(account)) {
                accountRings.set(account, {
                    rings: [],
                    patterns: [],
                    scores: []
                });
            }
            
            const accountData = accountRings.get(account);
            if (!accountData.rings.includes(ringId)) {
                accountData.rings.push(ringId);
                accountData.patterns.push(patternType);
                accountData.scores.push(riskScore);
            }
        });
    });

    const repeatOffenders = [];
    accountRings.forEach((data, account) => {
        if (data.rings.length > 1) {
            const avgScore = data.scores.reduce((a, b) => a + b, 0) / data.scores.length;
            
            repeatOffenders.push({
                account_id: account,
                ring_count: data.rings.length,
                ring_ids: data.rings.join(', '),
                patterns: [...new Set(data.patterns)].join(', '),
                avg_risk_score: avgScore.toFixed(1)
            });
        }
    });

    repeatOffenders.sort((a, b) => b.ring_count - a.ring_count);

    if (repeatOffenders.length === 0) {
        document.getElementById('repeatTableBody').innerHTML = '<tr><td colspan="5" class="no-data">No repeat offenders detected</td></tr>';
        return;
    }

    let html = '';
    repeatOffenders.forEach(offender => {
        const scoreClass = offender.avg_risk_score > 80 ? 'score-high' : 
                          offender.avg_risk_score > 50 ? 'score-medium' : 'score-low';
        
        html += `
            <tr>
                <td><strong>${offender.account_id}</strong></td>
                <td><span class="ring-badge">${offender.ring_count}</span></td>
                <td>${offender.ring_ids}</td>
                <td>${offender.patterns}</td>
                <td class="${scoreClass}">${offender.avg_risk_score}</td>
            </tr>
        `;
    });
    
    document.getElementById('repeatTableBody').innerHTML = html;
    console.log('Repeat offenders table rendered with', repeatOffenders.length, 'accounts');
}

function switchTab(tab, event) {
    if (!event) return;
    
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');

    document.getElementById('ringsTab').classList.add('hidden');
    document.getElementById('accountsTab').classList.add('hidden');
    document.getElementById('repeatTab').classList.add('hidden');

    if (tab === 'rings') {
        document.getElementById('ringsTab').classList.remove('hidden');
    } else if (tab === 'accounts') {
        document.getElementById('accountsTab').classList.remove('hidden');
    } else if (tab === 'repeat') {
        document.getElementById('repeatTab').classList.remove('hidden');
    }
}

function downloadJSON() {
    if (currentData) {
        const dataStr = JSON.stringify(currentData, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `fraud_detection_${new Date().toISOString().slice(0,19).replace(/:/g, '-')}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showMessage('JSON report downloaded', 'success');
    }
}

function showMessage(text, type) {
    if (messageTimeout) clearTimeout(messageTimeout);

    messageEl.innerHTML = '';
    messageEl.className = 'message';
    
    if (type === 'loading') {
        messageEl.innerHTML = '<span class="loading-spinner"></span>' + text;
    } else {
        messageEl.textContent = text;
    }
    
    messageEl.classList.add('show', type);
    
    if (type !== 'loading') {
        messageTimeout = setTimeout(() => {
            messageEl.classList.remove('show');
        }, 5000);
    }
}

function initGraph(data) {
    if (!graphContainer) {
        console.error('Graph container not found');
        return;
    }
    
    console.log('Starting graph initialization...');
    console.log('Container dimensions:', graphContainer.clientWidth, 'x', graphContainer.clientHeight);
    
    while (graphContainer.firstChild) {
        graphContainer.removeChild(graphContainer.firstChild);
    }

    const suspiciousAccounts = data.suspicious_accounts || [];
    const fraudRings = data.fraud_rings || [];
    
    console.log('Suspicious accounts for graph:', suspiciousAccounts.length);
    console.log('Fraud rings for graph:', fraudRings.length);
    
    const allAccounts = new Set();
    
    suspiciousAccounts.forEach(acc => {
        if (acc.account_id) allAccounts.add(acc.account_id);
    });
    
    fraudRings.forEach(ring => {
        (ring.member_accounts || []).forEach(acc => allAccounts.add(acc));
    });
    
    if (allAccounts.size === 0 && data.summary && data.summary.total_accounts_analyzed > 0) {
        for (let i = 1; i <= Math.min(10, data.summary.total_accounts_analyzed); i++) {
            allAccounts.add(`ACC_${i.toString().padStart(3, '0')}`);
        }
    }
    
    console.log('Total unique accounts for graph:', allAccounts.size);
    
    if (allAccounts.size === 0) {
        graphContainer.innerHTML = '<div style="display: flex; justify-content: center; align-items: center; height: 100%; color: #888; font-size: 18px;">📊 No graph data available. Upload a CSV file with transactions.</div>';
        return;
    }

    try {
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0a0a0a);
        
        const starsGeometry = new THREE.BufferGeometry();
        const starsCount = 2000;
        const starPositions = new Float32Array(starsCount * 3);
        
        for (let i = 0; i < starsCount * 3; i += 3) {
            starPositions[i] = (Math.random() - 0.5) * 2000;
            starPositions[i+1] = (Math.random() - 0.5) * 2000;
            starPositions[i+2] = (Math.random() - 0.5) * 2000;
        }
        
        starsGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
        const starsMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 0.5 });
        const stars = new THREE.Points(starsGeometry, starsMaterial);
        scene.add(stars);

        const width = graphContainer.clientWidth || 800;
        const height = graphContainer.clientHeight || 500;
        
        const camera = new THREE.PerspectiveCamera(45, width / height, 1, 2000);
        camera.position.set(400, 200, 400);
        camera.lookAt(0, 0, 0);

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setSize(width, height);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setClearColor(0x0a0a0a);
        graphContainer.appendChild(renderer.domElement);

        const controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 1.0;
        controls.enableZoom = true;
        controls.maxPolarAngle = Math.PI / 2;

        const ambientLight = new THREE.AmbientLight(0x404060);
        scene.add(ambientLight);

        const light1 = new THREE.PointLight(0xffffff, 1);
        light1.position.set(300, 300, 300);
        scene.add(light1);

        const light2 = new THREE.PointLight(0xff3b3b, 0.5);
        light2.position.set(-300, -100, -300);
        scene.add(light2);

        const light3 = new THREE.PointLight(0x4466ff, 0.3);
        light3.position.set(0, 500, 0);
        scene.add(light3);

        const accounts = Array.from(allAccounts);
        const nodePositions = new Map();
        const radius = Math.min(250, accounts.length * 15);
        
        const suspiciousSet = new Set();
        suspiciousAccounts.forEach(acc => {
            if (acc.account_id) suspiciousSet.add(acc.account_id);
        });
        
        const ringMap = new Map();
        fraudRings.forEach(ring => {
            (ring.member_accounts || []).forEach(acc => {
                ringMap.set(acc, ring);
            });
        });

        function createLabelTexture(text, color) {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            const fontSize = 24;
            ctx.font = `bold ${fontSize}px 'Inter', Arial, sans-serif`;
            const textWidth = ctx.measureText(text).width;
            
            canvas.width = textWidth + 20;
            canvas.height = fontSize + 20;
            
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            ctx.shadowColor = color;
            ctx.shadowBlur = 10;
            ctx.font = `bold ${fontSize}px 'Inter', Arial, sans-serif`;
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, canvas.width / 2, canvas.height / 2);
            
            const texture = new THREE.CanvasTexture(canvas);
            return texture;
        }

        accounts.forEach((account, index) => {
            const phi = Math.acos(2 * (index / accounts.length) - 1);
            const theta = Math.PI * (1 + Math.sqrt(5)) * index;
            
            const x = radius * Math.sin(phi) * Math.cos(theta);
            const y = radius * Math.sin(phi) * Math.sin(theta) * 0.5;
            const z = radius * Math.cos(phi);
            
            nodePositions.set(account, new THREE.Vector3(x, y, z));

            const isSuspicious = suspiciousSet.has(account);
            const inRing = ringMap.has(account);
            
            let color = 0x666666;
            let emissive = 0x000000;
            let labelColor = '#ffffff';
            
            if (isSuspicious) {
                color = 0xff3b3b;
                emissive = 0x330000;
                labelColor = '#ff6b6b';
            } else if (inRing) {
                color = 0xffaa00;
                emissive = 0x331100;
                labelColor = '#ffaa00';
            }

            const geometry = new THREE.SphereGeometry(10, 32, 32);
            const material = new THREE.MeshPhongMaterial({
                color: color,
                emissive: emissive,
                shininess: 30,
                emissiveIntensity: 0.5
            });

            const node = new THREE.Mesh(geometry, material);
            node.position.set(x, y, z);
            node.userData = { account: account };
            scene.add(node);
            
            const glowGeometry = new THREE.SphereGeometry(14, 32, 32);
            const glowMaterial = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                opacity: 0.15
            });
            const glow = new THREE.Mesh(glowGeometry, glowMaterial);
            node.add(glow);

            const labelTexture = createLabelTexture(account, labelColor);
            const labelMaterial = new THREE.SpriteMaterial({ 
                map: labelTexture,
                depthTest: false,
                depthWrite: false,
                transparent: true
            });
            const label = new THREE.Sprite(labelMaterial);
            label.scale.set(50, 25, 1);
            label.position.set(x, y + 20, z);
            scene.add(label);
            
            nodes.push({ node, label, originalY: y });
        });

        fraudRings.forEach(ring => {
            const members = ring.member_accounts || [];
            for (let i = 0; i < members.length; i++) {
                for (let j = i + 1; j < members.length; j++) {
                    const pos1 = nodePositions.get(members[i]);
                    const pos2 = nodePositions.get(members[j]);
                    
                    if (pos1 && pos2) {
                        const points = [];
                        const midPoint = new THREE.Vector3().addVectors(pos1, pos2).multiplyScalar(0.5);
                        midPoint.y += 30;
                        
                        points.push(pos1);
                        points.push(midPoint);
                        points.push(pos2);
                        
                        const curve = new THREE.CatmullRomCurve3(points);
                        const curvePoints = curve.getPoints(20);
                        
                        const geometry = new THREE.BufferGeometry().setFromPoints(curvePoints);
                        const material = new THREE.LineBasicMaterial({
                            color: 0xff3b3b,
                            transparent: true,
                            opacity: 0.2
                        });
                        const line = new THREE.Line(geometry, material);
                        scene.add(line);
                        edges.push(line);
                    }
                }
            }
        });

        const gridHelper = new THREE.GridHelper(600, 20, 0xff3b3b, 0x333333);
        gridHelper.position.y = -150;
        scene.add(gridHelper);

        function animate() {
            requestAnimationFrame(animate);

            nodes.forEach((item, i) => {
                if (item.node && item.label) {
                    const time = Date.now() * 0.002;
                    const offset = i * 0.5;
                    
                    const floatY = Math.sin(time + offset) * 5;
                    item.node.position.y = item.originalY + floatY;
                    item.label.position.y = item.originalY + 20 + floatY;
                    
                    item.label.quaternion.copy(camera.quaternion);
                }
            });

            controls.update();
            renderer.render(scene, camera);
        }

        animate();
        
        window.currentScene = scene;
        window.currentCamera = camera;
        window.currentRenderer = renderer;
        window.currentControls = controls;
        
        console.log('✅ Graph initialized successfully with', nodes.length, 'nodes and labels');
        showMessage(`✅ Graph rendered with ${nodes.length} labeled nodes`, 'success');
        
    } catch (error) {
        console.error('Three.js error:', error);
        graphContainer.innerHTML = `<div style="display: flex; justify-content: center; align-items: center; height: 100%; color: #ff3b3b;">❌ Error rendering graph: ${error.message}</div>`;
    }
}

window.addEventListener('resize', () => {
    if (camera && renderer && graphContainer) {
        camera.aspect = graphContainer.clientWidth / graphContainer.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(graphContainer.clientWidth, graphContainer.clientHeight);
    }
});

setInterval(checkHealth, 30000);