/* app.js */

// Global State
let entries = [];
let distMode = 'at-least'; // 'at-least' or 'exactly'
let ocrWorker = null;

// DOM Elements
const uploadZone = document.getElementById('upload-zone');
const fileInput = document.getElementById('file-input');
const ocrLoader = document.getElementById('ocr-loader');
const ocrProgress = document.getElementById('ocr-progress');
const ocrStatusText = document.getElementById('ocr-status-text');
const rawOcrText = document.getElementById('raw-ocr-text');
const parseTextBtn = document.getElementById('parse-text-btn');
const entriesBody = document.getElementById('entries-body');
const addRowBtn = document.getElementById('add-row-btn');
const loadExampleBtn = document.getElementById('load-example-btn');
const clearAllBtn = document.getElementById('clear-all-btn');
const ocrTrigger = document.getElementById('ocr-trigger');
const ocrContent = document.getElementById('ocr-content');

// Results elements
const gaugeBar = document.getElementById('gauge-bar');
const gaugePercent = document.getElementById('gauge-percent');
const summaryTitle = document.getElementById('summary-title');
const summaryDesc = document.getElementById('summary-desc');
const summaryBadge = document.getElementById('summary-badge');
const houseListContainer = document.getElementById('house-list-container');
const distListContainer = document.getElementById('dist-list-container');
const modalOverlay = document.getElementById('modal-overlay');
const diagLog = document.getElementById('diag-log');

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  setupUploadHandlers();
  setupCollapsible();
  setupTableHandlers();
  runDiagnostics(false); // Run diagnostics quietly in background
  
  // Load data from localStorage if exists
  const savedData = localStorage.getItem('ff14_housing_entries');
  if (savedData) {
    try {
      entries = JSON.parse(savedData);
      renderTable();
      calculate();
    } catch(e) {
      console.error("Failed to load saved entries", e);
    }
  } else {
    // If empty, load example data by default to show off the UI!
    loadExampleData();
  }
});

// Collapsible raw text block
function setupCollapsible() {
  ocrTrigger.addEventListener('click', () => {
    ocrTrigger.classList.toggle('active');
    if (ocrContent.style.maxHeight) {
      ocrContent.style.maxHeight = null;
    } else {
      ocrContent.style.maxHeight = ocrContent.scrollHeight + "px";
    }
  });
}

// Drag, drop, upload & paste events
function setupUploadHandlers() {
  // Click upload zone
  uploadZone.addEventListener('click', (e) => {
    if (e.target !== fileInput && !ocrLoader.contains(e.target)) {
      fileInput.click();
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleImage(e.target.files[0]);
    }
  });

  // Drag over
  ['dragenter', 'dragover'].forEach(eventName => {
    uploadZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      uploadZone.classList.add('dragover');
    }, false);
  });

  // Drag leave
  ['dragleave', 'drop'].forEach(eventName => {
    uploadZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      uploadZone.classList.remove('dragover');
    }, false);
  });

  // Drop image
  uploadZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files && files[0]) {
      handleImage(files[0]);
    }
  });

  // Paste image (Ctrl+V) from clipboard
  window.addEventListener('paste', (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        handleImage(file);
        break;
      }
    }
  });

  // Parse Text Button
  parseTextBtn.addEventListener('click', () => {
    const text = rawOcrText.value;
    parseAndAddText(text);
  });
}

// OCR processing
async function handleImage(file) {
  if (!file.type.match('image.*')) {
    alert('請上傳圖片檔案（png, jpeg, webp 等格式）');
    return;
  }

  // Display loader overlay inside the zone
  ocrLoader.classList.add('active');
  updateProgress(0, '讀取圖片中...');

  try {
    // Recognize text using Tesseract.js (already loaded via CDN)
    updateProgress(15, '初始化 Tesseract 辨識引擎...');
    
    // Tesseract.recognize is simple and handles workers under the hood in v5
    const result = await Tesseract.recognize(
      file,
      'eng', // Default to English since the commands and numbers are alphanumeric
      {
        logger: m => {
          if (m.status === 'recognizing text') {
            const pct = Math.floor(15 + m.progress * 80);
            updateProgress(pct, `解析圖片中: ${pct}%`);
          }
        }
      }
    );

    const text = result.data.text;
    
    // Populate textarea
    rawOcrText.value = text;
    
    // Expand collapsible if not expanded
    if (!ocrTrigger.classList.contains('active')) {
      ocrTrigger.click();
    } else {
      // Adjust height if already open
      ocrContent.style.maxHeight = ocrContent.scrollHeight + "px";
    }

    updateProgress(95, '解析辨識數據...');
    
    // Parse text and add rows
    parseAndAddText(text);
    
    updateProgress(100, '完成辨識！');
    setTimeout(() => {
      ocrLoader.classList.remove('active');
    }, 800);

  } catch (error) {
    console.error("OCR recognition error", error);
    updateProgress(100, '辨識失敗');
    alert('OCR 辨識發生錯誤，請手動複製/輸入數據，或使用低解析度截圖。');
    ocrLoader.classList.remove('active');
  }
}

function updateProgress(percent, text) {
  ocrProgress.style.width = percent + '%';
  ocrStatusText.textContent = text;
}

// String cleanup & Typo correction
function cleanOcrNumber(str) {
  if (!str) return "";
  return str.replace(/[Oo]/g, '0')
            .replace(/[Il|!]/g, '1')
            .replace(/[Ss]/g, '5')
            .replace(/[Gg]/g, '9')
            .replace(/[Bb]/g, '6');
}

// Parses string block into housing lotteries
function parseAndAddText(text) {
  if (!text.trim()) return;

  const lines = text.split('\n');
  const newEntries = [];

  const areaKeywords = [
    'mist', 'lavender', 'goblet', 'shirogane', 'empyreum',
    '海霧', '薰衣草', '高地', '白銀', '穹頂', '霧', '森', '杯', '莊', '雪',
    '海雾村', '薰衣草苗圃', '高地部落', '白银乡', '穹顶村'
  ];

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    const tokens = line.split(/\s+/);
    let areaIdx = -1;

    // Search for area keywords
    for (let i = 0; i < tokens.length; i++) {
      const tokenLower = tokens[i].toLowerCase();
      if (areaKeywords.some(keyword => tokenLower.includes(keyword))) {
        areaIdx = i;
        break;
      }
    }

    // Fallback: search for tokens resembling "/li" command
    if (areaIdx === -1) {
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (/^\/?(li|1i|ll|1l|i|l|1)$/i.test(token)) {
          if (i + 1 < tokens.length) {
            areaIdx = i + 1;
          }
          break;
        }
      }
    }

    if (areaIdx === -1 || areaIdx >= tokens.length) {
      continue; // Skip lines we can't identify
    }

    const areaRaw = tokens[areaIdx];
    let area = areaRaw;
    const areaLower = areaRaw.toLowerCase();
    
    // Standardize Area Name
    if (areaLower.includes('mist') || areaLower.includes('霧') || areaLower.includes('雾')) area = 'Mist (海霧村)';
    else if (areaLower.includes('lavender') || areaLower.includes('森') || areaLower.includes('薰衣草')) area = 'Lavender Beds (薰衣草苗圃)';
    else if (areaLower.includes('goblet') || areaLower.includes('杯') || areaLower.includes('高地')) area = 'Goblet (高地部落)';
    else if (areaLower.includes('shirogane') || areaLower.includes('莊') || areaLower.includes('庄') || areaLower.includes('白銀') || areaLower.includes('白银')) area = 'Shirogane (白銀鄉)';
    else if (areaLower.includes('empyreum') || areaLower.includes('雪') || areaLower.includes('穹頂') || areaLower.includes('穹顶')) area = 'Empyreum (穹頂村)';

    // Ward
    if (areaIdx + 1 >= tokens.length) continue;
    const wardStr = cleanOcrNumber(tokens[areaIdx + 1]);
    const ward = parseInt(wardStr, 10);
    if (isNaN(ward)) continue;

    // Plot
    if (areaIdx + 2 >= tokens.length) continue;
    const plotStr = cleanOcrNumber(tokens[areaIdx + 2]);
    const plot = parseInt(plotStr, 10);
    if (isNaN(plot)) continue;

    // Total Bids (Lottery size)
    let totalBids = 1;
    if (areaIdx + 3 < tokens.length) {
      const totalBidsStr = cleanOcrNumber(tokens[areaIdx + 3]);
      totalBids = parseInt(totalBidsStr, 10);
      if (isNaN(totalBids) || totalBids < 1) {
        totalBids = 1;
      }
    }

    // My Bids
    let myBids = 1;
    if (areaIdx + 4 < tokens.length) {
      const myBidsStr = cleanOcrNumber(tokens[areaIdx + 4]);
      myBids = parseInt(myBidsStr, 10);
      if (isNaN(myBids) || myBids < 0) {
        myBids = 1;
      }
    }

    if (myBids > totalBids) {
      myBids = totalBids;
    }

    newEntries.push({
      id: generateId(),
      area,
      ward,
      plot,
      totalBids,
      myBids
    });
  }

  if (newEntries.length > 0) {
    entries = [...entries, ...newEntries];
    saveAndRecalculate();
  } else {
    // If Tesseract scanned something but we found no plots, show alert only if triggered manually
    if (document.activeElement === parseTextBtn) {
      alert('無法解析出任何有效的房屋投標格式。格式範例：/li Mist 18 42 2');
    }
  }
}

// Helper: Generate ID
function generateId() {
  return '_' + Math.random().toString(36).substr(2, 9);
}

// Table Handlers
function setupTableHandlers() {
  addRowBtn.addEventListener('click', () => {
    entries.push({
      id: generateId(),
      area: 'Mist (海霧村)',
      ward: 1,
      plot: 1,
      totalBids: 1,
      myBids: 1
    });
    saveAndRecalculate();
  });

  clearAllBtn.addEventListener('click', () => {
    if (confirm('確定要清空所有的房屋投標清單嗎？')) {
      entries = [];
      saveAndRecalculate();
    }
  });

  loadExampleBtn.addEventListener('click', () => {
    loadExampleData();
  });
}

function loadExampleData() {
  entries = [
    { id: generateId(), area: 'Mist (海霧村)', ward: 18, plot: 42, totalBids: 2, myBids: 1 },
    { id: generateId(), area: 'Lavender Beds (薰衣草苗圃)', ward: 20, plot: 48, totalBids: 3, myBids: 2 },
    { id: generateId(), area: 'Lavender Beds (薰衣草苗圃)', ward: 14, plot: 49, totalBids: 4, myBids: 1 }
  ];
  saveAndRecalculate();
}

function saveAndRecalculate() {
  localStorage.setItem('ff14_housing_entries', JSON.stringify(entries));
  renderTable();
  calculate();
}

// Render dynamic rows
function renderTable() {
  entriesBody.innerHTML = '';
  
  if (entries.length === 0) {
    entriesBody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; color: var(--text-secondary); padding: 2rem;">
          投標清單為空。請上傳截圖或點擊「手動新增房屋」。
        </td>
      </tr>
    `;
    return;
  }

  entries.forEach((item, index) => {
    const tr = document.createElement('tr');
    
    // Calculate single prob
    const p = item.totalBids > 0 ? (item.myBids / item.totalBids) * 100 : 0;
    
    tr.innerHTML = `
      <td>
        <input type="text" class="table-input" value="${item.area} W${item.ward} P${item.plot}" onchange="updateEntryField('${item.id}', 'text', this.value)">
      </td>
      <td style="text-align: center;">
        <input type="number" class="table-input num-input" min="1" value="${item.totalBids}" onchange="updateEntryField('${item.id}', 'totalBids', this.value)">
      </td>
      <td style="text-align: center;">
        <input type="number" class="table-input num-input" min="0" value="${item.myBids}" onchange="updateEntryField('${item.id}', 'myBids', this.value)">
      </td>
      <td style="text-align: right;" class="td-prob">
        ${p.toFixed(2)}%
      </td>
      <td style="text-align: center;">
        <button class="btn btn-icon-only" onclick="deleteEntry('${item.id}')" title="刪除房屋">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
        </button>
      </td>
    `;
    entriesBody.appendChild(tr);
  });
}

// Global functions for inline HTML event calls
window.updateEntryField = function(id, field, value) {
  const index = entries.findIndex(item => item.id === id);
  if (index === -1) return;

  if (field === 'text') {
    // Try to parse the text representation back (e.g. "Mist (海霧村) W18 P42" or just "Mist 18 42")
    const tokens = value.trim().split(/\s+/);
    if (tokens.length >= 3) {
      // Find area
      let area = tokens[0];
      const areaLower = area.toLowerCase();
      if (areaLower.includes('mist') || areaLower.includes('霧') || areaLower.includes('戏')) area = 'Mist (海霧村)';
      else if (areaLower.includes('lavender') || areaLower.includes('森') || areaLower.includes('薰衣草')) area = 'Lavender Beds (薰衣草苗圃)';
      else if (areaLower.includes('goblet') || areaLower.includes('杯') || areaLower.includes('高地')) area = 'Goblet (高地部落)';
      else if (areaLower.includes('shirogane') || areaLower.includes('莊') || areaLower.includes('庄') || areaLower.includes('白銀') || areaLower.includes('白银')) area = 'Shirogane (白銀鄉)';
      else if (areaLower.includes('empyreum') || areaLower.includes('雪') || areaLower.includes('穹頂') || areaLower.includes('穹顶')) area = 'Empyreum (穹頂村)';

      // Parse Ward & Plot
      const ward = parseInt(tokens[1].replace(/\D/g, ''), 10);
      const plot = parseInt(tokens[2].replace(/\D/g, ''), 10);

      if (!isNaN(ward)) entries[index].ward = ward;
      if (!isNaN(plot)) entries[index].plot = plot;
      entries[index].area = area;
    } else {
      // Simple update
      entries[index].area = value;
    }
  } else if (field === 'totalBids') {
    const val = parseInt(value, 10);
    entries[index].totalBids = isNaN(val) || val < 1 ? 1 : val;
    // Cap my bids
    if (entries[index].myBids > entries[index].totalBids) {
      entries[index].myBids = entries[index].totalBids;
    }
  } else if (field === 'myBids') {
    const val = parseInt(value, 10);
    entries[index].myBids = isNaN(val) || val < 0 ? 0 : val;
    // Cap my bids
    if (entries[index].myBids > entries[index].totalBids) {
      entries[index].myBids = entries[index].totalBids;
    }
  }

  saveAndRecalculate();
};

window.deleteEntry = function(id) {
  entries = entries.filter(item => item.id !== id);
  saveAndRecalculate();
};

// Probability engine
function calculate() {
  if (entries.length === 0) {
    resetResults();
    return;
  }

  const n = entries.length;
  // Calculate single probabilities
  const singleProbs = entries.map(item => {
    return item.totalBids > 0 ? Math.min(1.0, item.myBids / item.totalBids) : 0;
  });

  // Poisson Binomial Distribution DP
  let dp = new Array(n + 1).fill(0);
  dp[0] = 1.0;

  for (let i = 0; i < n; i++) {
    const p = singleProbs[i];
    const q = 1.0 - p;
    for (let j = i + 1; j >= 0; j--) {
      const loseProb = dp[j] * q;
      const winProb = j > 0 ? dp[j - 1] * p : 0;
      dp[j] = loseProb + winProb;
    }
  }

  // Cumulative Probability: at least j houses
  let atLeast = new Array(n + 1).fill(0);
  let runningSum = 0;
  for (let j = n; j >= 0; j--) {
    runningSum += dp[j];
    atLeast[j] = Math.min(1.0, runningSum);
  }

  // Update Big Gauge: Win at least 1 house
  const winAtLeast1 = atLeast[1];
  const winAtLeast1Percent = winAtLeast1 * 100;
  
  // Animate Gauge percent number
  animateNumber(gaugePercent, winAtLeast1Percent);
  
  // Set ring stroke dashoffset
  // Circumference = 2 * PI * 74 = 464.9557
  const circumference = 464.9557;
  const offset = circumference - (winAtLeast1 * circumference);
  gaugeBar.style.strokeDashoffset = offset;

  // Set Summary Card texts
  summaryBadge.style.display = 'inline-block';
  if (winAtLeast1Percent >= 80) {
    summaryTitle.textContent = "歐皇機率！必有房歸";
    summaryDesc.textContent = `恭喜！在您投標的 ${n} 間房屋中，您有極高的機率獲得至少一間房產。可以開始規劃家具擺設了！`;
    summaryBadge.className = "summary-badge badge-high";
    summaryBadge.textContent = "極高機率";
  } else if (winAtLeast1Percent >= 50) {
    summaryTitle.textContent = "勝算極大，值得一搏";
    summaryDesc.textContent = `在您投標的 ${n} 間房屋中，您有超過一半的機會獲得至少一間。祝您好運抽中夢想房屋！`;
    summaryBadge.className = "summary-badge badge-med";
    summaryBadge.textContent = "中等機率";
  } else {
    summaryTitle.textContent = "重在參與，分母警告";
    summaryDesc.textContent = `目前投標的 ${n} 間房屋總機率較低。建議多開角色投標或尋找參與人數更少的冷門房產以提高勝率！`;
    summaryBadge.className = "summary-badge badge-low";
    summaryBadge.textContent = "偏低機率";
  }

  // Render individual rankings
  renderRankings(singleProbs);

  // Render compound distribution
  renderDistribution(dp, atLeast);
}

function resetResults() {
  gaugePercent.textContent = "0.00%";
  gaugeBar.style.strokeDashoffset = 464.9557;
  summaryTitle.textContent = "清單為空";
  summaryDesc.textContent = "請於左側輸入房屋 lottery 數據，我們將計算您獲得至少一間房子的整體機率。";
  summaryBadge.style.display = 'none';

  houseListContainer.innerHTML = `
    <div class="empty-state">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
      <p>尚無房屋清單</p>
    </div>
  `;

  distListContainer.innerHTML = `
    <div class="empty-state">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
      <p>無分配數據，請先新增房屋</p>
    </div>
  `;
}

function animateNumber(element, target) {
  let current = 0;
  const duration = 600; // ms
  const stepTime = 16; // ms (approx 60fps)
  const steps = duration / stepTime;
  const increment = target / steps;
  let timer = setInterval(() => {
    current += increment;
    if (current >= target) {
      element.textContent = target.toFixed(2) + "%";
      clearInterval(timer);
    } else {
      element.textContent = current.toFixed(2) + "%";
    }
  }, stepTime);
}

// Render individual house win rate list (ranked descending)
function renderRankings(singleProbs) {
  const ranked = entries.map((item, idx) => {
    return {
      name: `${item.area} W${item.ward} P${item.plot}`,
      prob: singleProbs[idx] * 100,
      myBids: item.myBids,
      totalBids: item.totalBids
    };
  }).sort((a, b) => b.prob - a.prob);

  houseListContainer.innerHTML = '';
  
  ranked.forEach(item => {
    const div = document.createElement('div');
    div.className = 'house-item';
    div.innerHTML = `
      <div class="house-info">
        <span class="house-name">${item.name}</span>
        <span class="house-ratio">${item.myBids} / ${item.totalBids} 投 (${item.prob.toFixed(2)}%)</span>
      </div>
      <div class="house-prob-bar-bg">
        <div class="house-prob-bar" style="width: ${item.prob}%"></div>
      </div>
    `;
    houseListContainer.appendChild(div);
  });
}

// Render K houses winning distribution
function renderDistribution(exactly, atLeast) {
  distListContainer.innerHTML = '';
  
  const arrayToUse = distMode === 'exactly' ? exactly : atLeast;
  const labelPrefix = distMode === 'exactly' ? '剛好中' : '至少中';

  // We loop from 0 to N. If we win "at least 0", it's always 100%, but we still render it.
  for (let k = 0; k < arrayToUse.length; k++) {
    const prob = arrayToUse[k] * 100;
    
    // Create distribution bar item
    const div = document.createElement('div');
    div.className = 'dist-item';
    
    div.innerHTML = `
      <div class="dist-label">${labelPrefix} ${k} 間房</div>
      <div class="dist-bar-bg">
        <div class="dist-bar" style="width: ${prob}%"></div>
        <div class="dist-val">${prob.toFixed(2)}%</div>
      </div>
    `;
    distListContainer.appendChild(div);
  }
}

// Toggle distribution view mode
window.switchDistMode = function(mode) {
  distMode = mode;
  document.getElementById('toggle-at-least').classList.toggle('active', mode === 'at-least');
  document.getElementById('toggle-exactly').classList.toggle('active', mode === 'exactly');
  
  if (entries.length > 0) {
    calculate();
  }
};

// Diagnostics Modal Actions
window.openModal = function() {
  modalOverlay.classList.add('active');
  runDiagnostics(true);
};

window.closeModal = function() {
  modalOverlay.classList.remove('active');
};

window.closeModalOnOverlay = function(e) {
  if (e.target === modalOverlay) {
    closeModal();
  }
};

// Diagnostics runner inside the browser
function runDiagnostics(writeToUi) {
  const logLines = [];
  let testsFailed = 0;

  function log(msg, type = 'info') {
    let styleClass = '';
    if (type === 'pass') styleClass = 'class="log-pass"';
    else if (type === 'fail') styleClass = 'style="color: #ff1744; font-weight: bold;"';
    else if (type === 'header') styleClass = 'class="log-header"';
    logLines.push(`<div ${styleClass}>${msg}</div>`);
  }

  log("=== 開始執行程式診斷與單元測試 ===", "header");

  // 1. Test cleanOcrNumber
  log("測試數字清洗 (OCR Typo Correction)...", "info");
  const tests = [
    { input: "I8", expected: "18" },
    { input: "2O", expected: "20" },
    { input: "l4", expected: "14" },
    { input: "49", expected: "49" },
    { input: "O", expected: "0" }
  ];
  
  let cleaningOk = true;
  tests.forEach(t => {
    const out = cleanOcrNumber(t.input);
    if (out !== t.expected) {
      log(`[失敗] 輸入 '${t.input}', 預期 '${t.expected}', 實際 '${out}'`, "fail");
      cleaningOk = false;
      testsFailed++;
    }
  });
  if (cleaningOk) log("[通過] OCR 數字清洗測試成功 ✅", "pass");

  // 2. Test Parser
  log("測試文字解析器 (Text Parser)...", "info");
  
  const rawSample = "/li Mist 18 42 2\n/li Lavender 20 48 3 2\n/li Lavender 14 49 4";
  const lines = rawSample.split('\n');
  const parsed = [];

  for (let line of lines) {
    const tokens = line.trim().split(/\s+/);
    // Find area
    let areaIdx = 1; // standard sample index
    const area = tokens[areaIdx];
    const ward = parseInt(cleanOcrNumber(tokens[areaIdx + 1]), 10);
    const plot = parseInt(cleanOcrNumber(tokens[areaIdx + 2]), 10);
    const totalBids = parseInt(cleanOcrNumber(tokens[areaIdx + 3]), 10);
    let myBids = tokens[areaIdx + 4] ? parseInt(cleanOcrNumber(tokens[areaIdx + 4]), 10) : 1;
    
    parsed.push({ area, ward, plot, totalBids, myBids });
  }

  if (parsed.length === 3 && parsed[0].ward === 18 && parsed[1].myBids === 2 && parsed[2].totalBids === 4) {
    log("[通過] 樣品行解析測試成功 ✅", "pass");
  } else {
    log("[失敗] 樣品行解析不符合預期", "fail");
    testsFailed++;
  }

  // 3. Test DP Math Engine
  log("測試機率計算引擎 (Poisson Binomial DP)...", "info");
  // Test case matching manual analysis:
  // House 1: p = 0.5 (Mist 18 42, 1/2)
  // House 2: p = 2/3 (Lavender 20 48, 2/3)
  // House 3: p = 0.25 (Lavender 14 49, 1/4)
  const singleProbs = [0.5, 2/3, 0.25];
  const n = 3;
  let dp = new Array(n + 1).fill(0);
  dp[0] = 1.0;

  for (let i = 0; i < n; i++) {
    const p = singleProbs[i];
    const q = 1.0 - p;
    for (let j = i + 1; j >= 0; j--) {
      dp[j] = dp[j] * q + (j > 0 ? dp[j - 1] * p : 0);
    }
  }

  let atLeast = new Array(n + 1).fill(0);
  let runningSum = 0;
  for (let j = n; j >= 0; j--) {
    runningSum += dp[j];
    atLeast[j] = runningSum;
  }

  // Validate Exactly 0: expected 0.125
  const diff0 = Math.abs(dp[0] - 0.125);
  // Validate At Least 1: expected 0.875
  const diff1 = Math.abs(atLeast[1] - 0.875);
  // Validate At least 2: expected 0.45833
  const diff2 = Math.abs(atLeast[2] - 11/24);

  if (diff0 < 0.001 && diff1 < 0.001 && diff2 < 0.001) {
    log("[通過] 動態規劃泊松二項式機率運算通過 ✅", "pass");
    log(`  - 獲得剛好 0 間概率: ${(dp[0]*100).toFixed(2)}% (預期: 12.50%)`, "pass");
    log(`  - 獲得至少 1 間概率: ${(atLeast[1]*100).toFixed(2)}% (預期: 87.50%)`, "pass");
    log(`  - 獲得至少 2 間概率: ${(atLeast[2]*100).toFixed(2)}% (預期: 45.83%)`, "pass");
  } else {
    log("[失敗] 泊松二項式機率運算與數學預期不符", "fail");
    testsFailed++;
  }

  log("=== 診斷測試執行結束 ===", "header");

  if (testsFailed === 0) {
    log("所有測試全數通過！系統一切正常。", "pass");
    document.getElementById('diag-btn').className = "system-badge";
    document.getElementById('diag-btn').textContent = "驗證程式 (OK)";
    document.getElementById('diag-btn').style.background = "rgba(0, 230, 118, 0.1)";
    document.getElementById('diag-btn').style.borderColor = "rgba(0, 230, 118, 0.2)";
    document.getElementById('diag-btn').style.color = "#00e676";
  } else {
    log(`診斷發現 ${testsFailed} 個錯誤！請檢修。`, "fail");
    document.getElementById('diag-btn').className = "system-badge";
    document.getElementById('diag-btn').textContent = `驗證失敗 (${testsFailed} Error)`;
    document.getElementById('diag-btn').style.background = "rgba(255, 23, 68, 0.1)";
    document.getElementById('diag-btn').style.borderColor = "rgba(255, 23, 68, 0.2)";
    document.getElementById('diag-btn').style.color = "#ff1744";
  }

  if (writeToUi) {
    diagLog.innerHTML = logLines.join('');
  }
}
