// Focus Fox Single-Page App (SPA) Core JS
import { store } from './store.js';
import { supabaseClient } from './supabase-client.js';
import { aiService } from './ai-service.js';
import { driveService } from './drive-service.js';

// Access tauri invoke safely
const { invoke } = window.__TAURI__ ? window.__TAURI__.core : { invoke: async () => ({}) };

// Cache for AI Solver responses to prevent duplicate calls
const aiCache = new Map();

// Path stack for Google Drive explorer [ { id: '...', name: '...' } ]
let drivePathStack = [];

// DOM element references
let viewContainer;
let headerTitleText;
let headerSubtitleText;
let headerBackBtn;
let themeToggleBtn;
let navSelection;
let navDashboard;
let navSettings;
let lightbox;
let lightboxImg;
let lightboxCloseBtn;

// Initialize app
async function init() {
  console.log("Initializing Focus Fox Desktop App...");
  
  // Find common DOM elements
  viewContainer = document.getElementById('view-container');
  headerTitleText = document.getElementById('header-title-text');
  headerSubtitleText = document.getElementById('header-subtitle-text');
  headerBackBtn = document.getElementById('header-back-btn');
  themeToggleBtn = document.getElementById('theme-toggle-btn');
  navSelection = document.getElementById('nav-selection');
  navDashboard = document.getElementById('nav-dashboard');
  navSettings = document.getElementById('nav-settings');
  lightbox = document.getElementById('lightbox');
  lightboxImg = document.getElementById('lightbox-img');
  lightboxCloseBtn = document.getElementById('lightbox-close-btn');

  // Set brand icon as Fox image if it exists
  const logoContainer = document.getElementById('brand-logo-container');
  if (logoContainer) {
    logoContainer.innerHTML = `<img src="/assets/logo.jpg" alt="🦊" onerror="this.outerHTML='🦊'"/>`;
  }

  // Load environment variables from Rust backend
  try {
    const envVars = await invoke('load_env');
    console.log("Environment variables loaded:", Object.keys(envVars));
    store.env = { ...store.env, ...envVars };
  } catch (err) {
    console.error("Failed to load env from Rust backend:", err);
  }

  // Init store states (theme, selection, etc.)
  store.init();

  // Bind core UI event listeners
  bindEvents();

  // Render initial view
  if (store.selectedBranch && store.selectedSemester) {
    navDashboard.style.display = 'flex';
    store.navigateTo('subjects');
  } else {
    store.navigateTo('selection');
  }
}

// Bind event listeners
function bindEvents() {
  // Navigation sidebar item clicks
  navSelection.addEventListener('click', () => {
    store.navigateTo('selection');
  });

  navDashboard.addEventListener('click', () => {
    if (store.selectedBranch && store.selectedSemester) {
      if (store.selectedSubject) {
        store.navigateTo('subject-dashboard');
      } else {
        store.navigateTo('subjects');
      }
    }
  });

  navSettings.addEventListener('click', () => {
    store.navigateTo('settings');
  });

  // Header Back Button
  headerBackBtn.addEventListener('click', () => {
    store.goBack();
  });

  // Theme Toggle Button
  themeToggleBtn.addEventListener('click', () => {
    const newTheme = store.theme === 'dark' ? 'light' : 'dark';
    store.setTheme(newTheme);
    updateThemeIcon();
  });

  // State Changed Listener
  window.addEventListener('state-changed', (e) => {
    const { view, data } = e.detail;
    updateSidebarActiveState(view);
    updateHeader(view, data);
    renderView(view, data);
  });

  // Lightbox Close
  lightboxCloseBtn.addEventListener('click', () => {
    lightbox.style.display = 'none';
  });
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) {
      lightbox.style.display = 'none';
    }
  });

  // PDF Viewer Close
  const pdfCloseBtn = document.getElementById('pdf-viewer-close-btn');
  const pdfModal = document.getElementById('pdf-viewer-modal');
  const pdfIframe = document.getElementById('pdf-viewer-iframe');

  if (pdfCloseBtn && pdfModal && pdfIframe) {
    pdfCloseBtn.addEventListener('click', () => {
      pdfModal.style.display = 'none';
      pdfIframe.src = '';
    });
    pdfModal.addEventListener('click', (e) => {
      if (e.target === pdfModal) {
        pdfModal.style.display = 'none';
        pdfIframe.src = '';
      }
    });
  }

  // Apply initial theme icon
  updateThemeIcon();
}

// Update the active state in the sidebar list
function updateSidebarActiveState(view) {
  navSelection.classList.remove('active');
  navDashboard.classList.remove('active');
  navSettings.classList.remove('active');

  if (view === 'selection') {
    navSelection.classList.add('active');
  } else if (view === 'subjects' || view === 'subject-dashboard' || view === 'question-list' || view === 'question-detail') {
    navDashboard.classList.add('active');
  } else if (view === 'settings') {
    navSettings.classList.add('active');
  }
}

// Update header titles and back button visibility
function updateHeader(view, data) {
  // Back button visibility
  if (store.viewHistory.length > 0 && view !== 'selection') {
    headerBackBtn.style.display = 'flex';
  } else {
    headerBackBtn.style.display = 'none';
  }

  // Header texts
  if (view === 'selection') {
    headerTitleText.textContent = "Academic Selection";
    headerSubtitleText.textContent = "Select your branch and semester to get started";
  } else if (view === 'subjects') {
    headerTitleText.textContent = store.selectedBranch ? `${store.selectedBranch.name}` : "Subjects";
    headerSubtitleText.textContent = store.selectedSemester ? `Semester ${store.selectedSemester} Subjects` : "Select subjects";
  } else if (view === 'subject-dashboard') {
    headerTitleText.textContent = store.selectedSubject ? store.selectedSubject.name : "Subject Dashboard";
    headerSubtitleText.textContent = store.selectedSubject ? `Code: ${store.selectedSubject.code}` : "Study portal";
  } else if (view === 'question-list') {
    headerTitleText.textContent = store.selectedTopic ? store.selectedTopic.name : "Questions";
    headerSubtitleText.textContent = "Topic Questions & Practice List";
  } else if (view === 'question-detail') {
    headerTitleText.textContent = "Question details";
    headerSubtitleText.textContent = store.selectedTopic ? store.selectedTopic.name : "Practice Question";
  } else if (view === 'settings') {
    headerTitleText.textContent = "Settings";
    headerSubtitleText.textContent = "App preferences and API connection status";
  }
}

// Update theme toggle icon
function updateThemeIcon() {
  const icon = document.getElementById('theme-icon');
  if (store.theme === 'dark') {
    icon.innerHTML = `<path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m11.314 11.314l.707.707M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/>`;
  } else {
    icon.innerHTML = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/>`;
  }
}

// Dispatch to individual view renderers
async function renderView(view, data) {
  // Show spinner initially
  viewContainer.innerHTML = `<div class="spinner"></div>`;

  try {
    switch (view) {
      case 'selection':
        await renderSelectionView();
        break;
      case 'subjects':
        await renderSubjectsView();
        break;
      case 'subject-dashboard':
        await renderSubjectDashboardView();
        break;
      case 'question-list':
        await renderQuestionListView();
        break;
      case 'question-detail':
        await renderQuestionDetailView();
        break;
      case 'settings':
        await renderSettingsView();
        break;
      default:
        viewContainer.innerHTML = `<div>View "${view}" not found.</div>`;
    }
  } catch (err) {
    console.error(`Error rendering view ${view}:`, err);
    viewContainer.innerHTML = `
      <div class="selection-card fade-in" style="max-width: 600px; text-align: center;">
        <h3 style="color: var(--accent); margin-bottom: 12px;">Failed to Load Data</h3>
        <p style="color: var(--subtext); margin-bottom: 24px;">${err.message || 'An unexpected error occurred while fetching information.'}</p>
        <button class="submit-btn" onclick="window.dispatchEvent(new CustomEvent('state-changed', { detail: { view: '${view}' } }))">
          Retry Connection
        </button>
      </div>
    `;
  }
}

// Open Lightbox
function openLightbox(url) {
  lightboxImg.src = url;
  lightbox.style.display = 'flex';
}

// Open PDF Viewer Modal
function openPdfViewer(fileId, fileName, fileLink) {
  const modal = document.getElementById('pdf-viewer-modal');
  const iframe = document.getElementById('pdf-viewer-iframe');
  const title = document.getElementById('pdf-viewer-file-name');
  const openBrowserBtn = document.getElementById('pdf-open-browser-btn');

  if (modal && iframe && title && openBrowserBtn) {
    title.textContent = fileName;
    iframe.src = `https://drive.google.com/file/d/${fileId}/preview`;
    
    openBrowserBtn.onclick = () => {
      window.open(fileLink, '_blank');
    };

    modal.style.display = 'flex';
  }
}

/* ==========================================================================
   VIEW RENDERERS
   ========================================================================== */

// 1. Academic Selection View
async function renderSelectionView() {
  // Show loading
  const branches = await supabaseClient.getBranches();
  
  // Save in store
  store.branches = branches;

  const savedBranchId = store.selectedBranch ? store.selectedBranch.id : '';
  const savedSem = store.selectedSemester || '';

  let branchOptions = `<option value="" disabled ${!savedBranchId ? 'selected' : ''}>-- Select Branch --</option>`;
  branches.forEach(b => {
    branchOptions += `<option value="${b.id}" ${b.id === savedBranchId ? 'selected' : ''}>${b.name}</option>`;
  });

  let semesterOptions = `<option value="" disabled ${!savedSem ? 'selected' : ''}>-- Select Semester --</option>`;
  for (let i = 1; i <= 8; i++) {
    semesterOptions += `<option value="${i}" ${i === savedSem ? 'selected' : ''}>Semester ${i}</option>`;
  }

  viewContainer.innerHTML = `
    <div class="selection-hero fade-in">
      <h1>🦊 Welcome to Focus Fox</h1>
      <p>Your ultimate engineering semester companion. Replicated for desktop.</p>
    </div>
    
    <div class="selection-card fade-in">
      <div class="form-group">
        <label for="branch-select">Engineering Branch</label>
        <select id="branch-select" class="custom-select">
          ${branchOptions}
        </select>
      </div>

      <div class="form-group">
        <label for="semester-select">Academic Semester</label>
        <select id="semester-select" class="custom-select">
          ${semesterOptions}
        </select>
      </div>

      <button id="start-btn" class="submit-btn" ${(!savedBranchId || !savedSem) ? 'disabled' : ''}>
        <span>Start Studying</span>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="5" y1="12" x2="19" y2="12"></line>
          <polyline points="12 5 19 12 12 19"></polyline>
        </svg>
      </button>
    </div>
  `;

  const branchSelect = document.getElementById('branch-select');
  const semesterSelect = document.getElementById('semester-select');
  const startBtn = document.getElementById('start-btn');

  const updateButtonState = () => {
    startBtn.disabled = !branchSelect.value || !semesterSelect.value;
  };

  branchSelect.addEventListener('change', updateButtonState);
  semesterSelect.addEventListener('change', updateButtonState);

  startBtn.addEventListener('click', () => {
    const bId = branchSelect.value;
    const branch = branches.find(b => b.id === bId);
    const sem = parseInt(semesterSelect.value, 10);
    
    store.saveSelection(branch, sem);
    navDashboard.style.display = 'flex';
    store.navigateTo('subjects');
  });
}

// 2. Subjects View
async function renderSubjectsView() {
  const branch = store.selectedBranch;
  const semester = store.selectedSemester;

  if (!branch || !semester) {
    store.navigateTo('selection');
    return;
  }

  const subjects = await supabaseClient.getSubjectsBySemester(branch.id, semester);

  if (subjects.length === 0) {
    viewContainer.innerHTML = `
      <div class="selection-card fade-in" style="text-align: center; max-width: 600px;">
        <h3>No Subjects Found</h3>
        <p style="color: var(--subtext); margin-top: 12px; margin-bottom: 24px;">No academic subjects are configured for ${branch.name}, Semester ${semester} yet.</p>
        <button class="submit-btn" id="change-selection-btn">Change Branch/Semester</button>
      </div>
    `;
    document.getElementById('change-selection-btn').addEventListener('click', () => store.navigateTo('selection'));
    return;
  }

  // Calculate completion percentage for each subject
  // In a real app we'd fetch all topics for all subjects to count. Let's do that dynamically!
  const subjectCardsHtml = await Promise.all(subjects.map(async (subj) => {
    // Fetch topics for this subject
    const topics = await supabaseClient.getTopics(subj.id);
    const totalTopics = topics.length;
    let completedCount = 0;
    
    if (totalTopics > 0) {
      completedCount = topics.filter(t => store.isTopicCompleted(t.id)).length;
    }
    
    const percentage = totalTopics > 0 ? Math.round((completedCount / totalTopics) * 100) : 0;

    return `
      <div class="subject-card fade-in" data-id="${subj.id}">
        <span class="subject-code">${subj.code}</span>
        <h3 class="subject-title">${subj.name}</h3>
        
        <div class="subject-progress-container">
          <div class="subject-progress-text">
            <span>Progress</span>
            <span>${percentage}% (${completedCount}/${totalTopics} Topics)</span>
          </div>
          <div class="subject-progress-bar-bg">
            <div class="subject-progress-bar-fill" style="width: ${percentage}%"></div>
          </div>
        </div>
      </div>
    `;
  }));

  viewContainer.innerHTML = `
    <div class="subjects-header fade-in">
      <h2>Active Courses</h2>
    </div>
    <div class="subjects-grid">
      ${subjectCardsHtml.join('')}
    </div>
  `;

  // Attach card click handlers
  document.querySelectorAll('.subject-card').forEach(card => {
    card.addEventListener('click', () => {
      const sId = card.getAttribute('data-id');
      const subject = subjects.find(s => s.id === sId);
      store.selectedSubject = subject;
      store.navigateTo('subject-dashboard');
    });
  });
}

// 3. Subject Dashboard View (with Tabs)
async function renderSubjectDashboardView() {
  const subject = store.selectedSubject;
  if (!subject) {
    store.navigateTo('subjects');
    return;
  }

  // Initial tab render
  viewContainer.innerHTML = `
    <div class="dashboard-tabs fade-in">
      <button class="dashboard-tab active" data-tab="topics">Topics & Syllabus</button>
      <button class="dashboard-tab" data-tab="pyqs">PYQ Drive</button>
      <button class="dashboard-tab" data-tab="notes">Notes Drive</button>
      <button class="dashboard-tab" data-tab="handout">Course Handout</button>
      <button class="dashboard-tab" data-tab="progress">Your Progress</button>
    </div>

    <div id="tab-content-container" class="fade-in" style="flex-grow: 1; display: flex; flex-direction: column;">
      <!-- Tab content will be rendered here dynamically -->
    </div>
  `;

  // Attach tab switching events
  const tabs = document.querySelectorAll('.dashboard-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const tabName = tab.getAttribute('data-tab');
      switchTab(tabName);
    });
  });

  // Load first tab (Topics)
  switchTab('topics');
}

// Switch between dashboard tabs
async function switchTab(tabName) {
  const container = document.getElementById('tab-content-container');
  container.innerHTML = `<div class="spinner"></div>`;

  try {
    switch (tabName) {
      case 'topics':
        await renderTopicsTab(container);
        break;
      case 'pyqs':
        await renderDriveTab(container, store.selectedSubject.pyq_drive_link, 'Previous Year Papers');
        break;
      case 'notes':
        await renderDriveTab(container, store.selectedSubject.notes_drive_link, 'Lectures & Study Notes');
        break;
      case 'handout':
        await renderHandoutTab(container);
        break;
      case 'progress':
        await renderProgressTab(container);
        break;
    }
  } catch (err) {
    console.error(`Error loading tab ${tabName}:`, err);
    container.innerHTML = `
      <div class="drive-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
        <p>Could not load folder contents. Make sure the Drive link is valid and Drive API is configured.</p>
        <p style="font-size: 0.8rem; opacity: 0.7; margin-top: 8px;">${err.message || ''}</p>
      </div>
    `;
  }
}

// Topics Tab rendering
async function renderTopicsTab(container) {
  const topics = await supabaseClient.getTopicsWithImportance(store.selectedSubject.id);

  if (topics.length === 0) {
    container.innerHTML = `
      <div class="drive-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <p>No topics configured for this subject yet.</p>
      </div>
    `;
    return;
  }

  // Sort topics by importance score descending (exam oriented)
  topics.sort((a, b) => (b.importanceScore || 0) - (a.importanceScore || 0));

  // Determine max score to normalize
  const maxScore = Math.max(...topics.map(t => t.importanceScore || 0), 1);

  let topicsHtml = '';
  topics.forEach((topic) => {
    const isCompleted = store.isTopicCompleted(topic.id);
    const score = topic.importanceScore || 0;
    
    // Normalize rating to bar width
    const percentage = Math.min(100, Math.round((score / maxScore) * 100));
    
    // Severity tags
    let urgencyClass = 'low';
    let urgencyText = 'Low Importance';
    if (score >= 12) {
      urgencyClass = 'high';
      urgencyText = 'High Importance';
    } else if (score >= 5) {
      urgencyClass = 'medium';
      urgencyText = 'Medium Importance';
    }

    topicsHtml += `
      <div class="topic-card" id="topic-${topic.id}" data-id="${topic.id}">
        <div class="topic-header">
          <div class="topic-header-main">
            <div class="topic-checkbox ${isCompleted ? 'completed' : ''}" data-topic-id="${topic.id}">
              <svg viewBox="0 0 24 24">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
            <div class="topic-title-area">
              <span class="topic-title">${topic.name}</span>
              <div class="importance-bar-container">
                <span>${urgencyText} (${score.toFixed(0)} pts)</span>
                <div class="importance-bar">
                  <div class="importance-fill ${urgencyClass}" style="width: ${percentage}%"></div>
                </div>
              </div>
            </div>
          </div>
          <div class="topic-actions">
            <svg class="topic-chevron" viewBox="0 0 24 24">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </div>
        </div>
        
        <div class="topic-body">
          <div class="topic-content-wrapper">
            <div class="topic-summary">
              ${topic.summary || '<em>No summary notes configured for this topic. Click practice questions to learn step-by-step.</em>'}
            </div>
            
            <div class="topic-resources-section" id="resources-${topic.id}">
              <div class="spinner" style="margin: 10px auto;"></div>
            </div>

            <button class="topic-start-btn" data-topic-id="${topic.id}">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
              <span>Practice Topic Questions</span>
            </button>
          </div>
        </div>
      </div>
    `;
  });

  container.innerHTML = `<div class="topics-list">${topicsHtml}</div>`;

  // Bind accordion click handlers
  document.querySelectorAll('.topic-header').forEach(header => {
    // Exclude checkbox from card header toggle
    header.addEventListener('click', (e) => {
      if (e.target.closest('.topic-checkbox')) return;
      
      const card = header.closest('.topic-card');
      const isOpen = card.classList.contains('open');
      
      // Close others
      document.querySelectorAll('.topic-card').forEach(c => c.classList.remove('open'));
      
      if (!isOpen) {
        card.classList.add('open');
        const topicId = card.getAttribute('data-id');
        loadTopicResources(topicId);
      }
    });
  });

  // Bind checkbox toggle click handlers
  document.querySelectorAll('.topic-checkbox').forEach(box => {
    box.addEventListener('click', () => {
      const topicId = box.getAttribute('data-topic-id');
      store.toggleTopicCompletion(topicId);
      box.classList.toggle('completed');
    });
  });

  // Practice Topic button click handlers
  document.querySelectorAll('.topic-start-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const topicId = btn.getAttribute('data-topic-id');
      const topic = topics.find(t => t.id === topicId);
      store.selectedTopic = topic;
      store.navigateTo('question-list');
    });
  });
}

// Load resources for accordion dynamically
async function loadTopicResources(topicId) {
  const resContainer = document.getElementById(`resources-${topicId}`);
  if (!resContainer || resContainer.getAttribute('data-loaded') === 'true') return;

  try {
    const resources = await supabaseClient.getTopicResources(topicId);
    resContainer.setAttribute('data-loaded', 'true');

    if (resources.length === 0) {
      resContainer.innerHTML = ''; // Hide resources container if empty
      return;
    }

    let itemsHtml = '';
    resources.forEach(res => {
      // Determine Icon based on resource type
      let icon = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
      
      itemsHtml += `
        <a href="${res.url}" target="_blank" class="resource-link-card">
          <div class="resource-info">
            <span class="resource-icon">${icon}</span>
            <span>${res.title || 'Study Resource'}</span>
          </div>
          <span class="resource-arrow">&rarr;</span>
        </a>
      `;
    });

    resContainer.innerHTML = `
      <span class="topic-resources-title">Quick Study Links</span>
      <div class="topic-resources-grid">${itemsHtml}</div>
    `;
  } catch (err) {
    console.error("Failed to load topic resources:", err);
    resContainer.innerHTML = `<span style="font-size: 0.8rem; color: var(--accent);">Failed to load resources.</span>`;
  }
}

// Google Drive Explorer rendering (PYQs / Notes)
async function renderDriveTab(container, folderLink, tabTitle) {
  if (!folderLink) {
    container.innerHTML = `
      <div class="drive-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <p>No Google Drive link is configured for this category.</p>
      </div>
    `;
    return;
  }

  // Parse Folder ID from link
  let folderId = folderLink;
  const match = folderLink.match(/\/folders\/([a-zA-Z0-9-_]+)/) || folderLink.match(/id=([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    folderId = match[1];
  }

  // Initialize Drive Breadcrumb Path Stack
  drivePathStack = [{ id: folderId, name: tabTitle }];

  // Initial fetch of drive files
  await renderDriveFolderContents(container, folderId);
}

// Render folder files
async function renderDriveFolderContents(container, folderId) {
  container.innerHTML = `<div class="spinner"></div>`;

  const files = await driveService.fetchFolderContents(folderId);

  // Render Breadcrumb Paths
  let breadcrumbHtml = '';
  drivePathStack.forEach((path, idx) => {
    const isLast = idx === drivePathStack.length - 1;
    breadcrumbHtml += `
      <span class="drive-path-item" data-id="${path.id}" data-idx="${idx}">${path.name}</span>
      ${!isLast ? '<span style="opacity: 0.5;">/</span>' : ''}
    `;
  });

  let filesGridHtml = '';
  
  if (files.length === 0) {
    filesGridHtml = `
      <div class="drive-empty" style="grid-column: 1 / -1;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <p>This folder is empty or couldn't be loaded.</p>
      </div>
    `;
  } else {
    // Sort directories first, then files
    files.sort((a, b) => {
      const isDirA = a.mimeType === 'application/vnd.google-apps.folder';
      const isDirB = b.mimeType === 'application/vnd.google-apps.folder';
      if (isDirA && !isDirB) return -1;
      if (!isDirA && isDirB) return 1;
      return a.name.localeCompare(b.name);
    });

    files.forEach(file => {
      const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
      
      let icon = '';
      if (isFolder) {
        icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
      } else if (file.mimeType.includes('pdf')) {
        icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`;
      } else {
        icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`;
      }

      filesGridHtml += `
        <div class="drive-item-card" data-id="${file.id}" data-name="${file.name}" data-folder="${isFolder}" data-link="${file.webViewLink || '#'}">
          <div class="drive-item-icon">${icon}</div>
          <span class="drive-item-name" title="${file.name}">${file.name}</span>
        </div>
      `;
    }
  );
  }

  container.innerHTML = `
    <div class="drive-header">
      <div class="drive-path">${breadcrumbHtml}</div>
    </div>
    <div class="drive-items-grid">
      ${filesGridHtml}
    </div>
  `;

  // Attach breadcrumb navigation clicks
  container.querySelectorAll('.drive-path-item').forEach(item => {
    item.addEventListener('click', async () => {
      const idx = parseInt(item.getAttribute('data-idx'), 10);
      if (idx === drivePathStack.length - 1) return; // Ignore clicking current directory
      
      // Trim path stack to selected level
      drivePathStack = drivePathStack.slice(0, idx + 1);
      const clickedId = item.getAttribute('data-id');
      await renderDriveFolderContents(container, clickedId);
    });
  });

  // Attach card folder click / file open actions
  container.querySelectorAll('.drive-item-card').forEach(card => {
    card.addEventListener('click', async () => {
      const isFolder = card.getAttribute('data-folder') === 'true';
      const fileId = card.getAttribute('data-id');
      const fileName = card.getAttribute('data-name');
      const fileLink = card.getAttribute('data-link');

      if (isFolder) {
        drivePathStack.push({ id: fileId, name: fileName });
        await renderDriveFolderContents(container, fileId);
      } else {
        openPdfViewer(fileId, fileName, fileLink);
      }
    });
  });
}

// Handout Tab rendering
async function renderHandoutTab(container) {
  const handoutLink = store.selectedSubject.course_outcome_link;
  if (!handoutLink) {
    container.innerHTML = `
      <div class="drive-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <p>No Course Handout or Outcome document is linked for this subject.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="selection-card" style="margin-top: 20px; max-width: 600px; text-align: center;">
      <div style="font-size: 3rem; color: var(--primary); margin-bottom: 12px;">📑</div>
      <h3>Course Handout & Syllabus</h3>
      <p style="color: var(--subtext); margin-top: 10px; margin-bottom: 24px;">
        View the syllabus structure, subject topics weightage, and learning outcomes in your browser.
      </p>
      <a href="${handoutLink}" target="_blank" class="submit-btn" style="text-decoration: none;">
        <span>Open Handout Document</span>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      </a>
    </div>
  `;
}

// Progress Tab rendering
async function renderProgressTab(container) {
  const topics = await supabaseClient.getTopics(store.selectedSubject.id);
  const totalTopics = topics.length;

  if (totalTopics === 0) {
    container.innerHTML = `
      <div class="drive-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <p>Syllabus tracker not available (No topics found).</p>
      </div>
    `;
    return;
  }

  const completed = topics.filter(t => store.isTopicCompleted(t.id));
  const completedCount = completed.length;
  const percentage = Math.round((completedCount / totalTopics) * 100);

  // Checklist HTML
  let checklistHtml = '';
  topics.forEach(t => {
    const isDone = store.isTopicCompleted(t.id);
    checklistHtml += `
      <div class="progress-check-item">
        <div class="topic-checkbox ${isDone ? 'completed' : ''}" data-topic-id="${t.id}">
          <svg viewBox="0 0 24 24">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        <span style="font-weight: 500; text-decoration: ${isDone ? 'line-through' : 'none'}; opacity: ${isDone ? 0.6 : 1};">${t.name}</span>
      </div>
    `;
  });

  container.innerHTML = `
    <div class="progress-summary-cards">
      <div class="stat-card">
        <span class="stat-val">${percentage}%</span>
        <span class="stat-lbl">Overall Completion</span>
      </div>
      <div class="stat-card">
        <span class="stat-val">${completedCount} / ${totalTopics}</span>
        <span class="stat-lbl">Topics Completed</span>
      </div>
      <div class="stat-card">
        <span class="stat-val">${store.solvedQuestions.length}</span>
        <span class="stat-lbl">Total Solved Questions</span>
      </div>
    </div>

    <div style="margin-top: 10px;">
      <h3 class="progress-checklist-title">Syllabus Completion Checklist</h3>
      <div class="progress-checklist">
        ${checklistHtml}
      </div>
    </div>
  `;

  // Attach toggling callbacks
  container.querySelectorAll('.topic-checkbox').forEach(box => {
    box.addEventListener('click', () => {
      const tId = box.getAttribute('data-topic-id');
      store.toggleTopicCompletion(tId);
      
      // Reload tab to update stats and states instantly
      renderProgressTab(container);
    });
  });
}

// 4. Questions List View
async function renderQuestionListView() {
  const topic = store.selectedTopic;
  if (!topic) {
    store.navigateTo('subject-dashboard');
    return;
  }

  const questions = await supabaseClient.getQuestionsByTopic(topic.id);

  if (questions.length === 0) {
    viewContainer.innerHTML = `
      <div class="selection-card" style="text-align: center; max-width: 600px;">
        <h3>No Questions</h3>
        <p style="color: var(--subtext); margin-top: 12px; margin-bottom: 24px;">No exam questions have been indexed for topic "${topic.name}" yet.</p>
        <button class="submit-btn" id="qlist-back">Return to Subject Dashboard</button>
      </div>
    `;
    document.getElementById('qlist-back').addEventListener('click', () => store.navigateTo('subject-dashboard'));
    return;
  }

  // Pre-load PYQ mappings for all questions in parallel to speed up rendering metadata badges
  await Promise.all(questions.map(async (q) => {
    try {
      q.pyqSources = await supabaseClient.getPyqSourcesForQuestion(q.id);
    } catch {
      q.pyqSources = [];
    }
  }));

  // Render search panel structure
  viewContainer.innerHTML = `
    <div class="search-filter-row fade-in">
      <div class="search-container">
        <input type="text" id="q-search" class="search-input" placeholder="Search question text..." />
        <svg class="search-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      </div>
      <div class="filter-pills">
        <button class="filter-pill active" data-filter="all">All Difficulty</button>
        <button class="filter-pill" data-filter="easy">Easy</button>
        <button class="filter-pill" data-filter="medium">Medium</button>
        <button class="filter-pill" data-filter="hard">Hard</button>
      </div>
      <div class="filter-pills">
        <button class="filter-pill active" data-status="all">All Solved</button>
        <button class="filter-pill" data-status="unsolved">Unsolved</button>
        <button class="filter-pill" data-status="solved">Solved</button>
      </div>
    </div>

    <div class="questions-list" id="q-list-container">
      <!-- Injected by filterQuestions() -->
    </div>
  `;

  // Attach search and filter events
  const searchInput = document.getElementById('q-search');
  const diffFilters = document.querySelectorAll('[data-filter]');
  const statusFilters = document.querySelectorAll('[data-status]');

  let activeDiff = 'all';
  let activeStatus = 'all';

  const filterQuestions = () => {
    const query = searchInput.value.toLowerCase().trim();
    
    const filtered = questions.filter(q => {
      const matchesSearch = q.question_text.toLowerCase().includes(query);
      const matchesDiff = activeDiff === 'all' || q.difficulty.toLowerCase() === activeDiff;
      
      const isSolved = store.isQuestionSolved(q.id);
      const matchesStatus = activeStatus === 'all' || 
                            (activeStatus === 'solved' && isSolved) || 
                            (activeStatus === 'unsolved' && !isSolved);
      
      return matchesSearch && matchesDiff && matchesStatus;
    });

    const listContainer = document.getElementById('q-list-container');
    if (filtered.length === 0) {
      listContainer.innerHTML = `
        <div class="drive-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <p>No questions match your current search/filters.</p>
        </div>
      `;
      return;
    }

    let itemsHtml = '';
    filtered.forEach(q => {
      const isSolved = store.isQuestionSolved(q.id);
      
      // PYQ Tags HTML
      let pyqTags = '';
      if (q.pyqSources && q.pyqSources.length > 0) {
        q.pyqSources.forEach(src => {
          pyqTags += `<span class="tag-badge pyq-tag">${src.year} ${src.exam_type} Q${src.question_number}</span>`;
        });
      }

      itemsHtml += `
        <div class="question-row-card fade-in" data-id="${q.id}">
          <div class="question-info-main">
            <div class="question-solved-btn topic-checkbox ${isSolved ? 'completed' : ''}" data-id="${q.id}">
              <svg viewBox="0 0 24 24">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
            <div>
              <span class="question-text-preview">${q.question_text}</span>
              <div class="question-meta-tags">
                <span class="tag-badge difficulty-${q.difficulty.toLowerCase()}">${q.difficulty}</span>
                ${pyqTags}
              </div>
            </div>
          </div>
          <span style="font-size: 1.25rem; opacity: 0.5;">&rarr;</span>
        </div>
      `;
    });

    listContainer.innerHTML = itemsHtml;

    // Attach checkbox toggle
    listContainer.querySelectorAll('.question-solved-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // Avoid opening question detail
        const qId = btn.getAttribute('data-id');
        store.toggleQuestionSolved(qId);
        btn.classList.toggle('completed');
      });
    });

    // Attach click to open detail
    listContainer.querySelectorAll('.question-row-card').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.question-solved-btn')) return;
        const qId = row.getAttribute('data-id');
        const q = questions.find(item => item.id === qId);
        store.selectedQuestion = q;
        store.navigateTo('question-detail');
      });
    });
  };

  // Bind key and button presses
  searchInput.addEventListener('input', filterQuestions);

  diffFilters.forEach(btn => {
    btn.addEventListener('click', () => {
      diffFilters.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeDiff = btn.getAttribute('data-filter');
      filterQuestions();
    });
  });

  statusFilters.forEach(btn => {
    btn.addEventListener('click', () => {
      statusFilters.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeStatus = btn.getAttribute('data-status');
      filterQuestions();
    });
  });

  // Initial Filter
  filterQuestions();
}

// 5. Question Detail & AI Solve
async function renderQuestionDetailView() {
  const question = store.selectedQuestion;
  if (!question) {
    store.navigateTo('question-list');
    return;
  }

  // Fetch images
  const images = await supabaseClient.getImagesForQuestion(question.id);

  // Render question card
  let imagesHtml = '';
  if (images.length > 0) {
    let gridItems = '';
    images.forEach(img => {
      gridItems += `
        <div class="gallery-img-wrapper" data-url="${img.image_url}">
          <img src="${img.image_url}" alt="Question Figure" />
        </div>
      `;
    });

    imagesHtml = `
      <div class="question-gallery">
        <span class="gallery-title">Figures & Diagrams</span>
        <div class="gallery-grid">
          ${gridItems}
        </div>
      </div>
    `;
  }

  // Draw metadata badges
  let pyqBadges = '';
  if (question.pyqSources && question.pyqSources.length > 0) {
    question.pyqSources.forEach(src => {
      pyqBadges += `<span class="tag-badge pyq-tag">${src.year} ${src.exam_type} (Season: ${src.season}) Question No: ${src.question_number}</span>`;
    });
  }

  const isSolved = store.isQuestionSolved(question.id);

  viewContainer.innerHTML = `
    <div class="question-detail-layout">
      <!-- Left side: Question detail -->
      <div class="question-content-panel fade-in">
        <div class="question-detail-title-section">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;">
            <span class="tag-badge difficulty-${question.difficulty.toLowerCase()}">${question.difficulty}</span>
            <div class="question-solved-btn topic-checkbox ${isSolved ? 'completed' : ''}" id="detail-solve-checkbox" title="Mark Question Solved">
              <svg viewBox="0 0 24 24">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
          </div>
          <p class="question-detail-text">${question.question_text}</p>
        </div>

        ${imagesHtml}

        <div style="display:flex; flex-direction:column; gap:8px;">
          <span style="font-size:0.75rem; font-weight:700; color:var(--subtext); text-transform:uppercase;">Appeared in Exams</span>
          <div class="question-meta-tags">${pyqBadges || '<span style="font-size:0.85rem; opacity:0.6;">No past year paper matches registered.</span>'}</div>
        </div>
      </div>

      <!-- Right side: AI Solver -->
      <div class="ai-solver-panel fade-in">
        <div class="ai-blueprint-bg"></div>
        <div class="ai-solver-header">
          <div class="ai-solver-header-title">
            <span>🦊 AI Solver</span>
          </div>
          <button class="ai-solve-btn" id="ai-solve-trigger">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="12 2 2 22 22 22 12 2"/></svg>
            <span>Solve with Gemini</span>
          </button>
        </div>
        
        <div class="ai-solver-body" id="ai-response-area">
          <div class="ai-solver-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
            <p>Need exam solutions?<br/>Click <strong>Solve with Gemini</strong> to generate a structured engineering solution.</p>
          </div>
        </div>
      </div>
    </div>
  `;

  // Attach solved checkbox callback
  const solveCheckbox = document.getElementById('detail-solve-checkbox');
  solveCheckbox.addEventListener('click', () => {
    store.toggleQuestionSolved(question.id);
    solveCheckbox.classList.toggle('completed');
  });

  // Attach gallery lightbox zoom callback
  document.querySelectorAll('.gallery-img-wrapper').forEach(wrapper => {
    wrapper.addEventListener('click', () => {
      const url = wrapper.getAttribute('data-url');
      openLightbox(url);
    });
  });

  // Attach AI Solver click
  const aiTrigger = document.getElementById('ai-solve-trigger');
  const responseArea = document.getElementById('ai-response-area');

  const executeAiSolve = async () => {
    responseArea.innerHTML = `
      <div class="ai-solver-loading">
        <div class="spinner"></div>
        <p style="color: var(--primary); font-weight:600; text-align:center;">Gemini is solving this question...<br/><span style="font-weight:400; font-size:0.85rem; color:var(--subtext);">Formulating steps, calculations & final answer</span></p>
      </div>
    `;
    aiTrigger.disabled = true;

    try {
      let solution;
      if (aiCache.has(question.id)) {
        solution = aiCache.get(question.id);
      } else {
        solution = await aiService.solveQuestion(question.question_text);
        aiCache.set(question.id, solution);
      }
      
      // Render markdown using Marked
      const htmlContent = window.marked.parse(solution);
      responseArea.innerHTML = `<div class="ai-solver-content">${htmlContent}</div>`;
    } catch (err) {
      console.error(err);
      responseArea.innerHTML = `
        <div class="drive-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
          <p>Could not generate step-by-step solutions.</p>
          <p style="font-size:0.8rem; color:var(--accent); margin-top:8px;">${err.message || 'API connection failed.'}</p>
        </div>
      `;
    } finally {
      aiTrigger.disabled = false;
    }
  };

  aiTrigger.addEventListener('click', executeAiSolve);

  // If already solved, auto-trigger load from cache to make UX feel premium
  if (aiCache.has(question.id)) {
    executeAiSolve();
  }
}

// 6. Settings View
async function renderSettingsView() {
  const isSupabaseConfigured = store.env.SUPABASE_URL && store.env.SUPABASE_KEY;
  const isGeminiConfigured = !!store.env.GEMINI_API_KEY;
  const isDriveConfigured = !!store.env.DRIVE_API_KEY;

  viewContainer.innerHTML = `
    <div class="settings-section fade-in">
      
      <!-- Theme group -->
      <div class="settings-group">
        <span class="settings-group-title">Display Preferences</span>
        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-title">Dark Mode Theme</span>
            <span class="setting-desc">Toggle between light and dark themes. Designed for late-night study sessions.</span>
          </div>
          <label class="switch">
            <input type="checkbox" id="theme-switch" ${store.theme === 'dark' ? 'checked' : ''} />
            <span class="slider"></span>
          </label>
        </div>
      </div>

      <!-- Connection status -->
      <div class="settings-group">
        <span class="settings-group-title">API Connections & Credentials</span>
        
        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-title">Supabase Database API</span>
            <span class="setting-desc">Fetches subjects, topics, importance, and question tables.</span>
          </div>
          <div class="status-pill ${isSupabaseConfigured ? 'connected' : 'disconnected'}">
            <span class="status-dot"></span>
            <span>${isSupabaseConfigured ? 'Connected' : 'Offline'}</span>
          </div>
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-title">Gemini AI Engine</span>
            <span class="setting-desc">Provides step-by-step engineering explanations and calculations.</span>
          </div>
          <div class="status-pill ${isGeminiConfigured ? 'connected' : 'disconnected'}">
            <span class="status-dot"></span>
            <span>${isGeminiConfigured ? 'Configured' : 'Missing API Key'}</span>
          </div>
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-title">Google Drive Sync</span>
            <span class="setting-desc">Renders folders of lecture notes and past papers.</span>
          </div>
          <div class="status-pill ${isDriveConfigured ? 'connected' : 'disconnected'}">
            <span class="status-dot"></span>
            <span>${isDriveConfigured ? 'Connected' : 'Missing API Key'}</span>
          </div>
        </div>
      </div>

      <!-- App Metadata -->
      <div class="settings-group">
        <span class="settings-group-title">Academic Details</span>
        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-title">Selected Coursework</span>
            <span class="setting-desc" id="settings-academic-info">Loading selection...</span>
          </div>
          <button class="back-btn" style="border-radius: var(--radius-md); width:auto; padding: 0 12px; height: 36px; display:flex;" id="reset-selection-btn">
            Change
          </button>
        </div>
      </div>

      <div class="settings-group" style="opacity: 0.6; font-size: 0.8rem; text-align: center; border-top: 1px solid var(--border); padding-top: 24px;">
        <span>Focus Fox Desktop v1.0.0 &bull; Built with Tauri 2.x & Rust</span>
      </div>

    </div>
  `;

  // Attach theme switch event
  const themeSwitch = document.getElementById('theme-switch');
  themeSwitch.addEventListener('change', () => {
    const newTheme = themeSwitch.checked ? 'dark' : 'light';
    store.setTheme(newTheme);
    updateThemeIcon();
  });

  // Load academic selection description
  const acadInfo = document.getElementById('settings-academic-info');
  if (store.selectedBranch && store.selectedSemester) {
    acadInfo.textContent = `${store.selectedBranch.name} &bull; Semester ${store.selectedSemester}`;
  } else {
    acadInfo.innerHTML = `<em>No academic course has been selected yet.</em>`;
  }

  // Reset academic selection click handler
  document.getElementById('reset-selection-btn').addEventListener('click', () => {
    store.clearSelection();
    navDashboard.style.display = 'none';
    store.navigateTo('selection');
  });
}

// Start the Application
window.addEventListener('DOMContentLoaded', () => {
  init();
});
