// Focus Fox Single-Page App (SPA) Core JS
import { store } from './store.js';
import { supabaseClient } from './supabase-client.js';
import { aiService } from './ai-service.js';
import { driveService } from './drive-service.js';

// Access tauri invoke safely
const { invoke } = window.__TAURI__ ? window.__TAURI__.core : { invoke: async () => ({}) };

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Cache for AI Solver responses to prevent duplicate calls
const aiCache = new Map();

// Path stack for Google Drive explorer [ { id: '...', name: '...' } ]
let drivePathStack = [];

// Current sorting mode for topics tab ('syllabus' or 'importance')
let activeTopicSort = 'syllabus';

// DOM element references
let viewContainer;
let headerTitleText;
let headerSubtitleText;
let headerBackBtn;
let headerLeetcodeBtn;
let themeToggleBtn;
let navSelection;
let navDashboard;
let navSettings;
let navAlgo;
let navSyllabus;
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
  headerLeetcodeBtn = document.getElementById('header-leetcode-btn');
  themeToggleBtn = document.getElementById('theme-toggle-btn');
  navSelection = document.getElementById('nav-selection');
  navDashboard = document.getElementById('nav-dashboard');
  navSettings = document.getElementById('nav-settings');
  navAlgo = document.getElementById('nav-algo');
  navSyllabus = document.getElementById('nav-syllabus');
  lightbox = document.getElementById('lightbox');
  lightboxImg = document.getElementById('lightbox-img');
  lightboxCloseBtn = document.getElementById('lightbox-close-btn');

  // Set brand icon as Fox image if it exists
  const logoContainer = document.getElementById('brand-logo-container');
  if (logoContainer) {
    logoContainer.innerHTML = `<img src="/assets/Foxy.png" alt="🦊" onerror="this.outerHTML='🦊'"/>`;
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

  // Pre-fetch branches for header filters
  try {
    const branches = await supabaseClient.getBranches();
    store.branches = branches;
    populateHeaderFilters();
  } catch (err) {
    console.error("Failed to pre-fetch branches for header:", err);
  }

  // Bind core UI event listeners
  bindEvents();

  // Initialize sidebar stopwatch
  initStopwatch();

  // Initialize sidebar music player
  initMusicPlayer();

  // Render initial view
  if (store.selectedBranch && store.selectedSemester) {
    navDashboard.style.display = 'flex';
    if (navSyllabus) navSyllabus.style.display = 'flex';
    store.navigateTo('subjects');
  } else {
    store.navigateTo('selection');
  }
}

// Bind event listeners
function bindEvents() {
  // Sidebar Collapse Toggle
  const sidebar = document.getElementById('sidebar');
  const collapseBtn = document.getElementById('collapse-sidebar-btn');
  if (sidebar && collapseBtn) {
    collapseBtn.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      const isCollapsed = sidebar.classList.contains('collapsed');
      localStorage.setItem('focus_fox_sidebar_collapsed', isCollapsed);
    });
    
    // Auto-restore collapsed state on load
    const savedCollapsed = localStorage.getItem('focus_fox_sidebar_collapsed') === 'true';
    if (savedCollapsed) {
      sidebar.classList.add('collapsed');
    }
  }

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

  navAlgo.addEventListener('click', () => {
    store.navigateTo('algo-topics');
  });

  if (navSyllabus) {
    navSyllabus.addEventListener('click', () => {
      if (store.selectedBranch && store.selectedSemester) {
        store.navigateTo('syllabus');
      }
    });
  }

  // Header Back Button
  headerBackBtn.addEventListener('click', () => {
    store.goBack();
  });

  // View on LeetCode Header Button
  if (headerLeetcodeBtn) {
    headerLeetcodeBtn.addEventListener('click', () => {
      const q = store.algoSelectedQuestion;
      if (q && q.question_link) {
        if (window.__TAURI__) {
          invoke('plugin:opener|open_url', { url: q.question_link }).catch(err => {
            console.error("Failed to open URL via Tauri opener:", err);
            window.open(q.question_link, '_blank');
          });
        } else {
          window.open(q.question_link, '_blank');
        }
      }
    });
  }

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

  // Header Filters Event Listeners
  const headerBranchSelect = document.getElementById('header-branch-select');
  const headerSemesterSelect = document.getElementById('header-semester-select');
  if (headerBranchSelect && headerSemesterSelect) {
    headerBranchSelect.addEventListener('change', () => {
      const newBranchId = headerBranchSelect.value;
      const newBranch = store.branches.find(b => b.id === newBranchId);
      if (newBranch) {
        store.saveSelection(newBranch, store.selectedSemester);
        handleHeaderFilterChange();
      }
    });

    headerSemesterSelect.addEventListener('change', () => {
      const newSem = parseInt(headerSemesterSelect.value, 10);
      store.saveSelection(store.selectedBranch, newSem);
      handleHeaderFilterChange();
    });
  }

  // Header subject search listener
  const headerSearchInput = document.getElementById('header-subject-search');
  if (headerSearchInput) {
    headerSearchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      const grid = document.getElementById('active-subjects-grid');
      if (grid) {
        const cards = grid.querySelectorAll('.subject-card-v2');
        cards.forEach(card => {
          const title = card.querySelector('.subject-card-title').textContent.toLowerCase();
          const code = card.querySelector('.subject-card-code').textContent.toLowerCase();
          if (title.includes(query) || code.includes(query)) {
            card.style.display = 'flex';
          } else {
            card.style.display = 'none';
          }
        });
      }
    });
  }

  // Ctrl+K key shortcut to focus search
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      const searchInput = document.getElementById('header-subject-search');
      if (searchInput) {
        searchInput.focus();
      }
    }
  });

  // Apply initial theme icon
  updateThemeIcon();
}

// Update the active state in the sidebar list
function updateSidebarActiveState(view) {
  navSelection.classList.remove('active');
  navDashboard.classList.remove('active');
  navSettings.classList.remove('active');
  if (navAlgo) navAlgo.classList.remove('active');
  if (navSyllabus) navSyllabus.classList.remove('active');

  if (view === 'selection') {
    navSelection.classList.add('active');
  } else if (view === 'subjects' || view === 'subject-dashboard' || view === 'question-list' || view === 'question-detail') {
    navDashboard.classList.add('active');
  } else if (view === 'syllabus') {
    if (navSyllabus) navSyllabus.classList.add('active');
  } else if (view === 'settings') {
    navSettings.classList.add('active');
  } else if (view === 'algo-topics' || view === 'algo-questions' || view === 'algo-solution') {
    if (navAlgo) navAlgo.classList.add('active');
  }
}

// Update header titles and back button visibility
function updateHeader(view, data) {
  const q = store.algoSelectedQuestion;
  // Back button visibility
  if (store.viewHistory.length > 0 && view !== 'selection') {
    headerBackBtn.style.display = 'flex';
  } else {
    headerBackBtn.style.display = 'none';
  }

  // Manage Redesigned Header Elements
  const searchContainer = document.getElementById('header-search-container');
  const notifBtn = document.getElementById('header-notification-btn');
  const profile = document.getElementById('header-profile');
  if (searchContainer) searchContainer.style.display = 'none';
  if (notifBtn) notifBtn.style.display = 'none';
  if (profile) profile.style.display = 'none';

  // Header texts
  if (view === 'selection') {
    headerTitleText.textContent = "Academic Selection";
    headerSubtitleText.textContent = "Select your branch and semester to get started";
  } else if (view === 'subjects') {
    headerTitleText.textContent = "Good Evening, Abinash 👋";
    headerSubtitleText.textContent = store.selectedBranch ? `${store.selectedBranch.name} • Semester ${store.selectedSemester}` : "Subjects";
    if (searchContainer) searchContainer.style.display = 'flex';
    if (notifBtn) notifBtn.style.display = 'flex';
    if (profile) {
      profile.style.display = 'flex';
      const fallback = profile.querySelector('.profile-avatar-fallback');
      if (fallback) fallback.textContent = 'A';
    }
  } else if (view === 'syllabus') {
    headerTitleText.textContent = "Syllabus";
    headerSubtitleText.textContent = store.selectedBranch ? `${store.selectedBranch.name} Curriculum` : "Sequential subject tracker";
  } else if (view === 'subject-dashboard') {
    headerTitleText.textContent = store.selectedSubject ? store.selectedSubject.name : "Subject Dashboard";
    headerSubtitleText.textContent = store.selectedSubject ? `Code: ${store.selectedSubject.code}` : "Study portal";
  } else if (view === 'question-list') {
    headerTitleText.textContent = store.selectedTopic ? store.selectedTopic.name : "Questions";
    headerSubtitleText.textContent = "Topic Questions & Practice List";
  } else if (view === 'question-detail') {
    headerTitleText.textContent = "Question details";
    headerSubtitleText.textContent = store.selectedTopic ? store.selectedTopic.name : "Practice Question";
  } else if (view === 'pdf-viewer') {
    headerTitleText.textContent = store.selectedFile ? store.selectedFile.name : "Document Viewer";
    headerSubtitleText.textContent = "Google Drive PDF Preview";
  } else if (view === 'settings') {
    headerTitleText.textContent = "Settings";
    headerSubtitleText.textContent = "App preferences and API connection status";
  } else if (view === 'algo-topics') {
    headerTitleText.textContent = "Algo & Code";
    headerSubtitleText.textContent = "LeetCode practice organized by topic";
  } else if (view === 'algo-questions') {
    headerTitleText.textContent = store.algoSelectedTopic || "Questions";
    headerSubtitleText.textContent = "Sorted by difficulty — Easy · Medium · Hard";
  } else if (view === 'algo-solution') {
    headerTitleText.textContent = q ? q.question_name : "Solution";
    if (q) {
      const diffClass = q.difficulty?.toLowerCase() === 'easy' ? 'badge-easy' : q.difficulty?.toLowerCase() === 'medium' ? 'badge-medium' : 'badge-hard';
      headerSubtitleText.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
          <span class="algo-diff-badge ${diffClass}" style="padding: 2px 10px; font-size: 0.72rem;">${q.difficulty}</span>
          <span class="algo-sol-topic" style="padding: 2px 10px; font-size: 0.72rem;">${q.parent_topic}</span>
        </div>
      `;
    } else {
      headerSubtitleText.textContent = "Solution walkthrough";
    }
  }

  // View on LeetCode button visibility in header
  if (headerLeetcodeBtn) {
    if (view === 'algo-solution' && q && q.question_link && q.question_link.trim() !== '') {
      headerLeetcodeBtn.style.display = 'flex';
    } else {
      headerLeetcodeBtn.style.display = 'none';
    }
  }

  // Show or hide header academic selection filters
  const headerFilters = document.getElementById('header-filters');
  if (headerFilters) {
    if (store.selectedBranch && store.selectedSemester && view !== 'selection') {
      headerFilters.style.display = 'flex';
      
      const branchSel = document.getElementById('header-branch-select');
      const semSel = document.getElementById('header-semester-select');
      if (branchSel && semSel) {
        branchSel.value = store.selectedBranch.id;
        semSel.value = store.selectedSemester;
      }
    } else {
      headerFilters.style.display = 'none';
    }
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

// Populate branch and semester values in the header dropdowns
function populateHeaderFilters() {
  const branchSel = document.getElementById('header-branch-select');
  const semSel = document.getElementById('header-semester-select');
  if (!branchSel || !semSel) return;

  // Populate branches
  let branchOptions = '';
  store.branches.forEach(b => {
    branchOptions += `<option value="${b.id}">${b.name}</option>`;
  });
  branchSel.innerHTML = branchOptions;

  // Populate semesters
  let semOptions = '';
  for (let i = 1; i <= 8; i++) {
    semOptions += `<option value="${i}">Semester ${i}</option>`;
  }
  semSel.innerHTML = semOptions;

  // Set initial values
  if (store.selectedBranch) {
    branchSel.value = store.selectedBranch.id;
  }
  if (store.selectedSemester) {
    semSel.value = store.selectedSemester;
  }
}

// Handle header filters select option change
function handleHeaderFilterChange() {
  // Clear drill-down history when academic selection is changed
  store.selectedSubject = null;
  store.selectedTopic = null;
  store.selectedQuestion = null;

  if (store.currentView === 'syllabus') {
    store.navigateTo('syllabus');
  } else {
    store.navigateTo('subjects');
  }
}

// Dispatch to individual view renderers
async function renderView(view, data) {
  // Toggle padding class for fullscreen PDF preview
  if (view === 'pdf-viewer') {
    viewContainer.classList.add('no-padding');
  } else {
    viewContainer.classList.remove('no-padding');
  }

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
      case 'syllabus':
        await renderSyllabusView();
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
      case 'pdf-viewer':
        await renderPdfView();
        break;
      case 'settings':
        await renderSettingsView();
        break;
      case 'algo-topics':
        await renderAlgoTopicsView();
        break;
      case 'algo-questions':
        await renderAlgoQuestionsView();
        break;
      case 'algo-solution':
        await renderAlgoSolutionView();
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

// Render PDF Viewer inside main content area
async function renderPdfView() {
  const file = store.selectedFile;
  if (!file) {
    store.navigateTo('subject-dashboard');
    return;
  }
  viewContainer.innerHTML = `
    <div class="pdf-iframe-container fade-in">
      <iframe src="https://drive.google.com/file/d/${file.id}/preview" frameborder="0" allow="autoplay"></iframe>
    </div>
  `;
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
  populateHeaderFilters();

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
    <div class="welcome-container fade-in">
      <!-- Left Side: Branding & Hero -->
      <div class="welcome-hero-side">
        <div class="welcome-logo-wrapper">
          <img src="/assets/Foxy.png" alt="Focus Fox Logo" class="welcome-logo" />
        </div>
        <h1 class="welcome-title">Focus Fox</h1>
        <p class="welcome-tagline">Your ultimate engineering semester companion.</p>
        <p class="welcome-description">
          Master your curriculum, track syllabus completion, explore past year exam papers, study reference notes, and solve complex algorithms with step-by-step AI solutions.
        </p>
        
        <!-- Feature highlights -->
        <div class="welcome-features">
          <div class="welcome-feature-item">
            <span class="welcome-feature-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--primary)" stroke-width="2.5">
                <line x1="8" y1="6" x2="21" y2="6"></line>
                <line x1="8" y1="12" x2="21" y2="12"></line>
                <line x1="8" y1="18" x2="21" y2="18"></line>
                <line x1="3" y1="6" x2="3.01" y2="6" stroke-linecap="round"></line>
                <line x1="3" y1="12" x2="3.01" y2="12" stroke-linecap="round"></line>
                <line x1="3" y1="18" x2="3.01" y2="18" stroke-linecap="round"></line>
              </svg>
            </span>
            <div class="welcome-feature-text">
              <strong>Sequential Syllabus Tracker</strong>
              <span>Organize subjects chronologically and track completion.</span>
            </div>
          </div>
          <div class="welcome-feature-item">
            <span class="welcome-feature-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--primary)" stroke-width="2.5">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              </svg>
            </span>
            <div class="welcome-feature-text">
              <strong>Curated PYQ & Notes Drive</strong>
              <span>Direct access to reference resources and previous papers.</span>
            </div>
          </div>
          <div class="welcome-feature-item">
            <span class="welcome-feature-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--primary)" stroke-width="2.5">
                <polygon points="12 2 2 22 22 22 12 2"></polygon>
              </svg>
            </span>
            <div class="welcome-feature-text">
              <strong>AI Powered Solver</strong>
              <span>Step-by-step explanations and solutions with Gemini AI.</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Right Side: Forms & Actions -->
      <div class="welcome-form-side">
        <!-- Google Login Container -->
        <div class="login-card">
          <h3 class="card-section-title">Get Started</h3>
          <p class="card-section-subtitle">Sign in to sync your progress automatically.</p>
          
          <button class="google-login-btn" id="google-login-btn">
            <svg viewBox="0 0 24 24" width="18" height="18" style="margin-right: 10px;">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
            </svg>
            <span>Continue with Google</span>
          </button>
          
          <div class="login-divider">
            <span>or select academic path</span>
          </div>
          
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

          <button id="start-btn" class="submit-btn" style="width: 100%; margin-top: 8px;" ${(!savedBranchId || !savedSem) ? 'disabled' : ''}>
            <span>Start Studying</span>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
          </button>
        </div>
      </div>
    </div>
  `;

  const branchSelect = document.getElementById('branch-select');
  const semesterSelect = document.getElementById('semester-select');
  const startBtn = document.getElementById('start-btn');
  const googleBtn = document.getElementById('google-login-btn');

  if (googleBtn) {
    googleBtn.addEventListener('click', () => {
      googleBtn.disabled = true;
      const originalText = googleBtn.innerHTML;
      googleBtn.innerHTML = `<div class="spinner" style="width: 16px; height: 16px; margin: 0; display: inline-block; vertical-align: middle;"></div>&nbsp;&nbsp;Connecting...`;
      
      setTimeout(() => {
        googleBtn.innerHTML = `✔️ Signed in with Google`;
        googleBtn.style.borderColor = '#2ecc71';
        googleBtn.style.color = '#2ecc71';
        
        setTimeout(() => {
          googleBtn.innerHTML = originalText;
          googleBtn.disabled = false;
          googleBtn.style.borderColor = '';
          googleBtn.style.color = '';
          alert("Successfully authenticated! (Dummy Google Sign-In Completed)");
        }, 1500);
      }, 1200);
    });
  }

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
    if (navSyllabus) navSyllabus.style.display = 'flex';
    store.navigateTo('subjects');
  });
}

// Helper to assign a color theme and SVG icon for subjects on the redesigned dashboard
function getSubjectThemeAndIcon(subj, index) {
  const name = (subj.name || '').toLowerCase();
  
  if (name.includes('intelligence') || name.includes('computational')) {
    return {
      themeClass: 'theme-purple',
      iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1 0-3.12 3 3 0 0 1 0-3.88 2.5 2.5 0 0 1 0-3.12A2.5 2.5 0 0 1 9.5 2Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 0-3.12 3 3 0 0 0 0-3.88 2.5 2.5 0 0 0 0-3.12A2.5 2.5 0 0 0 14.5 2Z"/></svg>`
    };
  } else if (name.includes('distributed') || name.includes('operating') || name.includes('system') || name.includes('dos')) {
    return {
      themeClass: 'theme-blue',
      iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`
    };
  } else if (name.includes('algorithm') || name.includes('design') || name.includes('analysis')) {
    return {
      themeClass: 'theme-orange',
      iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="22" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><rect x="2" y="12" width="6" height="6" rx="1"/><rect x="16" y="12" width="6" height="6" rx="1"/><path d="M12 8v14M5 12h14"/></svg>`
    };
  } else if (name.includes('high') || name.includes('performance') || name.includes('computing')) {
    return {
      themeClass: 'theme-green',
      iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.25-2.5 3.5-2.5 3.5s2.25-1 3.5-2.5L18 5.5 14.5 2 4.5 16.5Z"/><path d="M14 10 9 5M9 15l-4-4"/></svg>`
    };
  } else if (name.includes('image') || name.includes('processing') || name.includes('applications')) {
    return {
      themeClass: 'theme-pink',
      iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`
    };
  } else if (name.includes('economics') || name.includes('financial') || name.includes('engineering')) {
    return {
      themeClass: 'theme-yellow',
      iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`
    };
  }
  
  const fallbacks = [
    { themeClass: 'theme-purple', iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>` },
    { themeClass: 'theme-blue', iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>` },
    { themeClass: 'theme-orange', iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v13M5 12h14"/></svg>` }
  ];
  return fallbacks[index % fallbacks.length];
}

// 2. Subjects View
async function renderSubjectsView() {
  const branch = store.selectedBranch;
  const semester = store.selectedSemester;

  if (!branch || !semester) {
    store.navigateTo('selection');
    return;
  }

  // Load customizations from local storage
  const removedKey = `focus_fox_removed_subjects_${branch.id}_${semester}`;
  const addedKey = `focus_fox_added_subjects_${branch.id}_${semester}`;
  
  const removedIds = JSON.parse(localStorage.getItem(removedKey) || '[]');
  const addedSubjects = JSON.parse(localStorage.getItem(addedKey) || '[]');

  // Fetch default subjects from database
  let subjects = await supabaseClient.getSubjectsBySemester(branch.id, semester);
  if (!subjects) subjects = [];

  // Filter out removed ones
  let filteredSubjects = subjects.filter(s => !removedIds.includes(s.id));

  // Append added custom ones (deduplicated)
  const currentIds = new Set(filteredSubjects.map(s => s.id));
  addedSubjects.forEach(s => {
    if (!currentIds.has(s.id)) {
      filteredSubjects.push(s);
    }
  });

  if (filteredSubjects.length === 0 && addedSubjects.length === 0) {
    viewContainer.innerHTML = `
      <div class="selection-card fade-in" style="text-align: center; max-width: 600px;">
        <h3>No Subjects Found</h3>
        <p style="color: var(--subtext); margin-top: 12px; margin-bottom: 24px;">No academic subjects are configured for ${branch.name}, Semester ${semester} yet.</p>
        <div style="display: flex; gap: 12px; justify-content: center;">
          <button class="submit-btn" id="change-selection-btn">Change Branch/Semester</button>
          <button class="submit-btn" id="empty-add-trigger" style="background: var(--primary);">Add Subject</button>
        </div>
      </div>
    `;
    document.getElementById('change-selection-btn').addEventListener('click', () => store.navigateTo('selection'));
    document.getElementById('empty-add-trigger').addEventListener('click', () => openAddSubjectModal());
    return;
  }

  // Calculate subject completion percentages and prepare metadata
  let totalTopicsCount = 0;
  let completedTopicsCount = 0;

  const subjectsData = await Promise.all(filteredSubjects.map(async (subj, idx) => {
    const topics = await supabaseClient.getTopics(subj.id);
    const totalTopics = topics.length;
    let completedCount = 0;
    
    if (totalTopics > 0) {
      completedCount = topics.filter(t => store.isTopicCompleted(t.id)).length;
    }
    
    totalTopicsCount += totalTopics;
    completedTopicsCount += completedCount;
    const percentage = totalTopics > 0 ? Math.round((completedCount / totalTopics) * 100) : 0;
    const themeInfo = getSubjectThemeAndIcon(subj, idx);

    // Get/Set dynamic study time for UI fidelity
    const timeKey = `focus_fox_study_time_${subj.id}`;
    let studyTime = localStorage.getItem(timeKey);
    if (!studyTime) {
      studyTime = (subj.name.toLowerCase().includes('intelligence') || subj.name.toLowerCase().includes('computational')) ? '3h 20m studied' : '0m studied';
      localStorage.setItem(timeKey, studyTime);
    }

    return {
      ...subj,
      totalTopics,
      completedCount,
      percentage,
      themeClass: themeInfo.themeClass,
      iconSvg: themeInfo.iconSvg,
      studyTime
    };
  }));

  const overallProgressPercentage = totalTopicsCount > 0 ? Math.round((completedTopicsCount / totalTopicsCount) * 100) : 67;

  // Render stats cards
  const statsHtml = `
    <div class="stats-row">
      <!-- Subjects Enrolled -->
      <div class="dashboard-stat-card fade-in">
        <div class="stat-icon-wrapper purple">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
        </div>
        <div class="stat-text-info">
          <span class="stat-number-val">${subjectsData.length}</span>
          <span class="stat-label-text">Subjects Enrolled</span>
        </div>
      </div>

      <!-- Study Time -->
      <div class="dashboard-stat-card fade-in">
        <div class="stat-icon-wrapper blue">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </div>
        <div class="stat-text-info">
          <span class="stat-number-val">32h</span>
          <span class="stat-label-text">Study Time This Semester</span>
        </div>
      </div>

      <!-- Streak -->
      <div class="dashboard-stat-card fade-in">
        <div class="stat-icon-wrapper orange">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>
        </div>
        <div class="stat-text-info">
          <span class="stat-number-val">5</span>
          <span class="stat-label-text">Day Streak Keep it up!</span>
        </div>
      </div>
    </div>
  `;

  // Render contribution activity heatmap grid (3 rows x 24 columns)
  const heatmapLevels = [
    0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 1, 4, 0, 2, 0, 0, 1, 0, 0, 2, 0, 0, 1, 0,
    0, 2, 0, 0, 0, 1, 3, 0, 0, 4, 0, 0, 2, 0, 3, 0, 0, 1, 0, 0, 3, 1, 0, 0,
    1, 0, 0, 3, 0, 0, 2, 0, 4, 0, 1, 0, 0, 3, 0, 2, 0, 0, 2, 0, 1, 0, 4, 2
  ];
  let heatmapCellsHtml = '';
  heatmapLevels.forEach(lvl => {
    heatmapCellsHtml += `<div class="heatmap-cell ${lvl > 0 ? `level-${lvl}` : ''}"></div>`;
  });

  const heatmapHtml = `
    <div class="study-activity-card fade-in">
      <div class="activity-header">
        <span class="activity-title">Study Activity</span>
        <select class="activity-select">
          <option>This Month</option>
          <option>Last Month</option>
        </select>
      </div>
      <div class="heatmap-container">
        <div class="heatmap-wrapper">
          <div class="heatmap-labels">
            <span class="heatmap-row-label">M</span>
            <span class="heatmap-row-label">W</span>
            <span class="heatmap-row-label">F</span>
          </div>
          <div class="heatmap-grid">
            ${heatmapCellsHtml}
          </div>
        </div>
        <div class="heatmap-legend">
          <span>Less</span>
          <div class="legend-cells">
            <div class="heatmap-cell"></div>
            <div class="heatmap-cell level-1"></div>
            <div class="heatmap-cell level-2"></div>
            <div class="heatmap-cell level-3"></div>
            <div class="heatmap-cell level-4"></div>
          </div>
          <span>More</span>
        </div>
      </div>
    </div>
  `;

  // Render active subjects grid headers and list
  let cardsHtml = '';
  subjectsData.forEach((subj) => {
    const isStarted = subj.percentage > 0;
    const buttonLabel = isStarted ? 'Continue' : 'Start';
    const buttonClass = isStarted ? 'subject-action-btn filled' : 'subject-action-btn';

    cardsHtml += `
      <div class="subject-card-v2 fade-in ${subj.themeClass}" data-id="${subj.id}">
        <!-- Remove button that appears on hover -->
        <button class="subject-remove-btn" data-id="${subj.id}" title="Remove Subject">
          <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>

        <div class="subject-card-header">
          <div class="subject-icon-box">
            ${subj.iconSvg}
          </div>
          <button class="subject-options-btn" title="Options">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
          </button>
        </div>
        
        <div class="subject-card-body">
          <span class="subject-card-code">${subj.code}</span>
          <h3 class="subject-card-title">${subj.name}</h3>
          
          <div class="subject-card-progress">
            <div class="subject-card-progress-bar-bg">
              <div class="subject-card-progress-bar-fill" style="width: ${subj.percentage}%;"></div>
            </div>
            <div class="subject-card-progress-info">
              <span>${subj.completedCount} / ${subj.totalTopics} Topics</span>
              <span class="subject-card-progress-pct">${subj.percentage}%</span>
            </div>
          </div>
        </div>

        <div class="subject-card-footer">
          <div class="subject-study-time">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span>${subj.studyTime}</span>
          </div>
          <button class="${buttonClass}" data-id="${subj.id}">${buttonLabel}</button>
        </div>
      </div>
    `;
  });

  // Append Plus Icon Card at the end of grid
  cardsHtml += `
    <div class="add-subject-card fade-in" id="add-subject-trigger">
      <div class="add-subject-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
      </div>
      <span class="add-subject-text">Add Subject</span>
    </div>
  `;

  viewContainer.innerHTML = `
    <!-- Top Stats and Heatmap Row -->
    <div class="subjects-dashboard-top">
      <div class="stats-and-learning">
        ${statsHtml}
      </div>
      ${heatmapHtml}
    </div>

    <!-- Active Subjects Section -->
    <div class="active-subjects-section fade-in">
      <div class="active-subjects-header">
        <span class="active-subjects-title">Active Subjects</span>
        <div class="active-subjects-controls">
          <select class="active-sort-select">
            <option>Sort by: Recent</option>
            <option>Sort by: Alphabetical</option>
            <option>Sort by: Progress</option>
          </select>
          <div class="view-toggle-btns">
            <button class="view-toggle-btn active" title="Grid View">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            </button>
            <button class="view-toggle-btn" title="List View">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            </button>
          </div>
        </div>
      </div>
      <div class="subjects-grid" id="active-subjects-grid">
        ${cardsHtml}
      </div>
    </div>
  `;

  // Attach card and button click handlers to navigate to subject dashboard
  const navigateToSubject = (subjId) => {
    const subject = filteredSubjects.find(s => s.id === subjId);
    if (subject) {
      store.selectedSubject = subject;
      store.navigateTo('subject-dashboard');
    }
  };

  viewContainer.querySelectorAll('.subject-card-v2').forEach(card => {
    card.addEventListener('click', (e) => {
      // Ignore click if interactive buttons are clicked
      if (e.target.closest('.subject-options-btn') || e.target.closest('.subject-action-btn') || e.target.closest('.subject-remove-btn')) return;
      const sId = card.getAttribute('data-id');
      navigateToSubject(sId);
    });
  });

  viewContainer.querySelectorAll('.subject-action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const sId = btn.getAttribute('data-id');
      navigateToSubject(sId);
    });
  });

  // Attach click to remove button
  viewContainer.querySelectorAll('.subject-remove-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sId = btn.getAttribute('data-id');
      
      // If it is in locally added list, remove from locally added list
      let added = JSON.parse(localStorage.getItem(addedKey) || '[]');
      const isCustomSubj = added.some(s => s.id === sId);
      if (isCustomSubj) {
        added = added.filter(s => s.id !== sId);
        localStorage.setItem(addedKey, JSON.stringify(added));
      } else {
        // Otherwise add to removed list
        let removed = JSON.parse(localStorage.getItem(removedKey) || '[]');
        if (!removed.includes(sId)) {
          removed.push(sId);
          localStorage.setItem(removedKey, JSON.stringify(removed));
        }
      }
      
      renderSubjectsView();
    });
  });

  // Attach click to Add Subject trigger
  const addTrigger = document.getElementById('add-subject-trigger');
  if (addTrigger) {
    addTrigger.addEventListener('click', () => openAddSubjectModal(filteredSubjects));
  }
}

// Function to handle Add Subject Custom Modal popup
async function openAddSubjectModal(filteredSubjects = []) {
  const modal = document.getElementById('add-subject-modal');
  const closeBtn = document.getElementById('add-subject-close-btn');
  const branchSelect = document.getElementById('add-subj-branch');
  const semSelect = document.getElementById('add-subj-sem');
  const subjectSelect = document.getElementById('add-subj-subject');
  const submitBtn = document.getElementById('add-subj-submit-btn');

  if (!modal || !branchSelect || !semSelect || !subjectSelect || !submitBtn) return;

  // Show modal
  modal.style.display = 'flex';

  // Populate branches dropdown
  let branchOptions = '';
  store.branches.forEach(b => {
    branchOptions += `<option value="${b.id}" ${b.id === store.selectedBranch.id ? 'selected' : ''}>${b.name}</option>`;
  });
  branchSelect.innerHTML = branchOptions;

  // Set default semester
  semSelect.value = store.selectedSemester;

  const updateModalSubjects = async () => {
    subjectSelect.innerHTML = `<option value="" disabled selected>Loading subjects...</option>`;
    try {
      const bId = branchSelect.value;
      const sem = parseInt(semSelect.value, 10);
      const allSubjs = await supabaseClient.getSubjectsBySemester(bId, sem);
      
      // Filter out subjects already shown on the dashboard
      const currentShowIds = new Set(filteredSubjects.map(s => s.id));
      const availableSubjs = allSubjs.filter(s => !currentShowIds.has(s.id));
      
      if (availableSubjs.length === 0) {
        subjectSelect.innerHTML = `<option value="" disabled selected>-- No new subjects available --</option>`;
        submitBtn.disabled = true;
      } else {
        let options = `<option value="" disabled selected>-- Select Subject --</option>`;
        availableSubjs.forEach(s => {
          options += `<option value="${s.id}">${s.code} - ${s.name}</option>`;
        });
        subjectSelect.innerHTML = options;
        submitBtn.disabled = false;
      }
    } catch (err) {
      console.error("Failed to load subjects in modal:", err);
      subjectSelect.innerHTML = `<option value="" disabled selected>Error loading subjects</option>`;
    }
  };

  // Bind change events
  branchSelect.onchange = updateModalSubjects;
  semSelect.onchange = updateModalSubjects;

  // Initial populate of subjects
  await updateModalSubjects();

  // Close handlers
  const closeModal = () => {
    modal.style.display = 'none';
  };
  
  closeBtn.onclick = closeModal;
  modal.onclick = (e) => {
    if (e.target === modal) closeModal();
  };

  // Submit handler
  submitBtn.onclick = async () => {
    const selectedSubjId = subjectSelect.value;
    if (!selectedSubjId) return;

    try {
      const bId = branchSelect.value;
      const sem = parseInt(semSelect.value, 10);
      const allSubjs = await supabaseClient.getSubjectsBySemester(bId, sem);
      const chosenSubj = allSubjs.find(s => s.id === selectedSubjId);

      if (chosenSubj) {
        const removedKey = `focus_fox_removed_subjects_${store.selectedBranch.id}_${store.selectedSemester}`;
        const addedKey = `focus_fox_added_subjects_${store.selectedBranch.id}_${store.selectedSemester}`;

        // If the chosen subject was previously removed in this sem dashboard, remove it from removed list
        let removed = JSON.parse(localStorage.getItem(removedKey) || '[]');
        if (removed.includes(chosenSubj.id)) {
          removed = removed.filter(id => id !== chosenSubj.id);
          localStorage.setItem(removedKey, JSON.stringify(removed));
        } else {
          // Otherwise save to added custom list for this sem dashboard
          let added = JSON.parse(localStorage.getItem(addedKey) || '[]');
          if (!added.some(s => s.id === chosenSubj.id)) {
            added.push(chosenSubj);
            localStorage.setItem(addedKey, JSON.stringify(added));
          }
        }

        closeModal();
        renderSubjectsView();
      }
    } catch (err) {
      console.error("Failed to add subject:", err);
      alert("An error occurred while adding the subject.");
    }
  };
}

// 2b. Syllabus View
async function renderSyllabusView() {
  const branch = store.selectedBranch;
  if (!branch) {
    store.navigateTo('selection');
    return;
  }

  // Fetch all subjects across all semesters for this branch
  const allSubjects = await supabaseClient.getAllSubjectsForBranch(branch.id);

  if (allSubjects.length === 0) {
    viewContainer.innerHTML = `
      <div class="selection-card fade-in" style="text-align: center; max-width: 600px;">
        <h3>No Syllabus Found</h3>
        <p style="color: var(--subtext); margin-top: 12px; margin-bottom: 24px;">No academic subjects are configured for ${branch.name} yet.</p>
        <button class="submit-btn" id="change-selection-btn">Change Branch/Semester</button>
      </div>
    `;
    document.getElementById('change-selection-btn').addEventListener('click', () => store.navigateTo('selection'));
    return;
  }

  // Group subjects by semester
  const subjectsBySem = {};
  allSubjects.forEach(subj => {
    const sem = subj.semester || 1;
    if (!subjectsBySem[sem]) {
      subjectsBySem[sem] = [];
    }
    subjectsBySem[sem].push(subj);
  });

  const semestersPresent = Object.keys(subjectsBySem).map(Number).sort((a, b) => a - b);

  // Generate filter buttons
  let filterButtonsHtml = `<button class="syllabus-filter-btn active" data-semester="all">All Semesters</button>`;
  semestersPresent.forEach(sem => {
    filterButtonsHtml += `<button class="syllabus-filter-btn" data-semester="${sem}">Sem ${sem}</button>`;
  });

  // Render sections
  const sectionsHtml = await Promise.all(semestersPresent.map(async (sem) => {
    const semSubjects = subjectsBySem[sem];
    
    // Fetch progress percentages in parallel
    const subjectCardsHtml = await Promise.all(semSubjects.map(async (subj) => {
      const topics = await supabaseClient.getTopics(subj.id);
      const totalTopics = topics.length;
      let completedCount = 0;
      
      if (totalTopics > 0) {
        completedCount = topics.filter(t => store.isTopicCompleted(t.id)).length;
      }
      
      const percentage = totalTopics > 0 ? Math.round((completedCount / totalTopics) * 100) : 0;

      return `
        <div class="syllabus-row-card fade-in" data-id="${subj.id}">
          <div class="syllabus-row-info">
            <span class="syllabus-row-code">${subj.code}</span>
            <span class="syllabus-row-title">${subj.name}</span>
          </div>
          
          <div class="syllabus-row-progress-container">
            <div class="syllabus-row-progress-bar-bg">
              <div class="syllabus-row-progress-bar-fill" data-percentage="${percentage}"></div>
            </div>
            <div class="syllabus-row-progress-text">
              <span>${percentage}% (${completedCount}/${totalTopics} Topics)</span>
            </div>
          </div>
          
          <span class="syllabus-row-arrow">&rarr;</span>
        </div>
      `;
    }));

    return `
      <div class="semester-section" data-semester="${sem}" style="margin-bottom: 40px;">
        <h2 class="semester-section-title">Semester ${sem}</h2>
        <div class="syllabus-list">
          ${subjectCardsHtml.join('')}
        </div>
      </div>
    `;
  }));

  viewContainer.innerHTML = `
    <div class="syllabus-view-container">
      <div class="syllabus-filters fade-in" style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 28px;">
        ${filterButtonsHtml}
      </div>
      <div class="syllabus-content" id="syllabus-content-area">
        ${sectionsHtml.join('')}
      </div>
    </div>
  `;

  // Set progress bar widths programmatically to comply with CSP on inline styles
  viewContainer.querySelectorAll('.syllabus-row-progress-bar-fill').forEach(fill => {
    const pct = fill.getAttribute('data-percentage');
    fill.style.width = pct + '%';
  });

  // Attach card click handlers to navigate to the subject dashboard
  viewContainer.querySelectorAll('.syllabus-row-card').forEach(card => {
    card.addEventListener('click', () => {
      const sId = card.getAttribute('data-id');
      const subject = allSubjects.find(s => s.id === sId);
      store.selectedSubject = subject;
      store.navigateTo('subject-dashboard');
    });
  });

  // Attach filter button click handlers
  const filterBtns = viewContainer.querySelectorAll('.syllabus-filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const targetSem = btn.getAttribute('data-semester');
      
      const sections = viewContainer.querySelectorAll('.semester-section');
      sections.forEach(sec => {
        if (targetSem === 'all' || sec.getAttribute('data-semester') === targetSem) {
          sec.style.display = 'block';
        } else {
          sec.style.display = 'none';
        }
      });
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

  // Create copies for Syllabus Order (as fetched) and Importance Order (sorted by score descending)
  const syllabusOrder = [...topics];
  const importanceOrder = [...topics].sort((a, b) => (b.importanceScore || 0) - (a.importanceScore || 0));

  function renderList() {
    const activeTopics = activeTopicSort === 'importance' ? importanceOrder : syllabusOrder;

    let topicsHtml = '';
    activeTopics.forEach((topic) => {
      const isCompleted = store.isTopicCompleted(topic.id);
      const score = topic.importanceScore || 0;
      
      // Calculate dynamic HSL color based on score (0 to 100)
      // Clamped score to 0-100 range
      const percentage = Math.min(100, Math.max(0, Math.round(score)));
      const hue = Math.round((1 - (percentage / 100)) * 60);
      const barColor = `hsl(${hue}, 90%, 50%)`;
      
      // Severity tags based on percentage
      let urgencyText = 'Low Importance';
      if (percentage >= 75) {
        urgencyText = 'High Importance';
      } else if (percentage >= 40) {
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
                <div class="importance-row">
                  <span class="importance-urgency-text">${urgencyText}</span>
                  <div class="importance-bar">
                    <div class="importance-fill" data-percentage="${percentage}" data-color="${barColor}"></div>
                  </div>
                </div>
              </div>
            </div>
            <div class="topic-actions">
              <div class="importance-percentage-badge" data-color="${barColor}">${percentage}%</div>
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
                <span>Practice Topic PYQ</span>
              </button>
            </div>
          </div>
        </div>
      `;
    });

    const controlsHtml = `
      <div class="topics-controls">
        <div class="sort-label">Sort Topics:</div>
        <div class="sort-group">
          <button class="sort-btn ${activeTopicSort === 'syllabus' ? 'active' : ''}" id="btn-sort-syllabus">
            Syllabus Order
          </button>
          <button class="sort-btn ${activeTopicSort === 'importance' ? 'active' : ''}" id="btn-sort-importance">
            Importance Order
          </button>
        </div>
      </div>
    `;

    container.innerHTML = `
      ${controlsHtml}
      <div class="topics-list">${topicsHtml}</div>
    `;

    // Set importance bar widths and colors programmatically to comply with CSP on inline styles
    container.querySelectorAll('.importance-fill').forEach(fill => {
      const pct = fill.getAttribute('data-percentage');
      const color = fill.getAttribute('data-color');
      fill.style.width = pct + '%';
      fill.style.backgroundColor = color;
    });

    container.querySelectorAll('.importance-percentage-badge').forEach(badge => {
      badge.style.color = badge.getAttribute('data-color');
    });

    // Bind accordion click handlers
    container.querySelectorAll('.topic-header').forEach(header => {
      header.addEventListener('click', (e) => {
        if (e.target.closest('.topic-checkbox')) return;
        
        const card = header.closest('.topic-card');
        const isOpen = card.classList.contains('open');
        
        // Close others
        container.querySelectorAll('.topic-card').forEach(c => c.classList.remove('open'));
        
        if (!isOpen) {
          card.classList.add('open');
          const topicId = card.getAttribute('data-id');
          loadTopicResources(topicId);
        }
      });
    });

    // Bind checkbox toggle click handlers
    container.querySelectorAll('.topic-checkbox').forEach(box => {
      box.addEventListener('click', () => {
        const topicId = box.getAttribute('data-topic-id');
        store.toggleTopicCompletion(topicId);
        box.classList.toggle('completed');
      });
    });

    // Practice Topic button click handlers
    container.querySelectorAll('.topic-start-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const topicId = btn.getAttribute('data-topic-id');
        const topic = topics.find(t => t.id === topicId);
        store.selectedTopic = topic;
        store.navigateTo('question-list');
      });
    });

    // Bind sort controls click handlers
    const btnSyllabus = container.querySelector('#btn-sort-syllabus');
    const btnImportance = container.querySelector('#btn-sort-importance');

    if (btnSyllabus && btnImportance) {
      btnSyllabus.addEventListener('click', () => {
        if (activeTopicSort !== 'syllabus') {
          activeTopicSort = 'syllabus';
          renderList();
        }
      });

      btnImportance.addEventListener('click', () => {
        if (activeTopicSort !== 'importance') {
          activeTopicSort = 'importance';
          renderList();
        }
      });
    }
  }

  // Initial render of the topics list
  renderList();
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
        store.selectedFile = { id: fileId, name: fileName, link: fileLink };
        store.navigateTo('pdf-viewer');
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
      <div style="margin-bottom: 16px; display: inline-flex; align-items: center; justify-content: center; background: rgba(var(--primary-rgb), 0.1); width: 64px; height: 64px; border-radius: 50%; color: var(--primary);">
        <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="16" y1="13" x2="8" y2="13"></line>
          <line x1="16" y1="17" x2="8" y2="17"></line>
          <polyline points="10 9 9 9 8 9"></polyline>
        </svg>
      </div>
      <h3>Course Handout & Syllabus</h3>
      <p style="color: var(--subtext); margin-top: 10px; margin-bottom: 24px;">
        View the syllabus structure, subject topics weightage, and learning outcomes in your browser.
      </p>
      <button class="submit-btn" id="open-handout-btn" style="width: 100%;">
        <span>Open Handout Document</span>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      </button>
    </div>
  `;

  document.getElementById('open-handout-btn').addEventListener('click', () => {
    if (handoutLink.includes('drive.google.com')) {
      const match = handoutLink.match(/\/file\/d\/([a-zA-Z0-9-_]+)/) || handoutLink.match(/id=([a-zA-Z0-9-_]+)/);
      if (match && match[1]) {
        store.selectedFile = { id: match[1], name: "Course Handout", link: handoutLink };
        store.navigateTo('pdf-viewer');
        return;
      }
    }
    window.open(handoutLink, '_blank');
  });
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

  // Extract unique years from all questions
  const years = [];
  questions.forEach(q => {
    if (q.pyqSources) {
      q.pyqSources.forEach(src => {
        if (src.year && !years.includes(src.year)) {
          years.push(src.year);
        }
      });
    }
  });
  years.sort((a, b) => b - a);

  // Render search panel structure with All button and 3 dropdowns
  viewContainer.innerHTML = `
    <div class="search-filter-row fade-in" style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 20px;">
      <div class="search-container" style="flex-grow: 1; min-width: 200px;">
        <input type="text" id="q-search" class="search-input" placeholder="Search question text..." />
        <svg class="search-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      </div>
      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
        <button class="filter-btn-all active" id="btn-filter-all">All</button>
        
        <select class="filter-select" id="filter-type">
          <option value="all">Type</option>
          <option value="midsem">Mid Sem</option>
          <option value="endsem">End Sem</option>
        </select>

        <select class="filter-select" id="filter-diff">
          <option value="all">Difficulty</option>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>

        <select class="filter-select" id="filter-year">
          <option value="all">Year</option>
          <option value="asc">Sort: Ascending</option>
          <option value="desc">Sort: Descending</option>
          ${years.map(yr => `<option value="${yr}">${yr}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="questions-list" id="q-list-container">
      <!-- Injected by filterQuestions() -->
    </div>
  `;

  // Attach search and filter events
  const searchInput = document.getElementById('q-search');
  const btnFilterAll = document.getElementById('btn-filter-all');
  const filterType = document.getElementById('filter-type');
  const filterDiff = document.getElementById('filter-diff');
  const filterYear = document.getElementById('filter-year');

  let activeType = 'all';
  let activeDiff = 'all';
  let activeYearValue = 'all'; // 'all', 'asc', 'desc', or year string

  const filterQuestions = () => {
    const query = searchInput.value.toLowerCase().trim();
    
    // Update "All" button active state based on whether any filter is active
    const isFiltered = query !== '' || activeType !== 'all' || activeDiff !== 'all' || activeYearValue !== 'all';
    if (isFiltered) {
      btnFilterAll.classList.remove('active');
    } else {
      btnFilterAll.classList.add('active');
    }

    // 1. Filter questions
    let filtered = questions.filter(q => {
      const matchesSearch = q.question_text.toLowerCase().includes(query);
      const matchesDiff = activeDiff === 'all' || q.difficulty.toLowerCase() === activeDiff;
      
      let matchesType = true;
      if (activeType !== 'all') {
        matchesType = q.pyqSources && q.pyqSources.some(src => 
          src.exam_type && src.exam_type.toLowerCase().replace(/[\s-_]/g, '').includes(activeType)
        );
      }

      let matchesYear = true;
      if (activeYearValue !== 'all' && activeYearValue !== 'asc' && activeYearValue !== 'desc') {
        matchesYear = q.pyqSources && q.pyqSources.some(src => 
          src.year && src.year.toString() === activeYearValue
        );
      }
      
      return matchesSearch && matchesDiff && matchesType && matchesYear;
    });

    // 2. Sort questions if Sort option is selected
    if (activeYearValue === 'asc' || activeYearValue === 'desc') {
      filtered.sort((a, b) => {
        const yearsA = (a.pyqSources || []).map(s => s.year).filter(Boolean);
        const yearsB = (b.pyqSources || []).map(s => s.year).filter(Boolean);
        const valA = yearsA.length > 0 ? (activeYearValue === 'asc' ? Math.min(...yearsA) : Math.max(...yearsA)) : (activeYearValue === 'asc' ? 9999 : 0);
        const valB = yearsB.length > 0 ? (activeYearValue === 'asc' ? Math.min(...yearsB) : Math.max(...yearsB)) : (activeYearValue === 'asc' ? 9999 : 0);
        return activeYearValue === 'asc' ? valA - valB : valB - valA;
      });
    }

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
      // PYQ Tags HTML
      let pyqTags = '';
      if (q.pyqSources && q.pyqSources.length > 0) {
        q.pyqSources.forEach(src => {
          const qNum = src.question_number.toLowerCase().startsWith('q') ? src.question_number : 'Q' + src.question_number;
          pyqTags += `<span class="tag-badge pyq-tag">${src.year} ${src.exam_type} ${qNum}</span>`;
        });
      }

      itemsHtml += `
        <div class="question-row-card fade-in" data-id="${q.id}" style="padding: 18px 24px;">
          <div class="question-info-main">
            <div>
              <span class="question-text-preview" style="font-size: 1.05rem; font-weight: 500; color: var(--text);">${q.question_text}</span>
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

    // Attach click to open detail
    listContainer.querySelectorAll('.question-row-card').forEach(row => {
      row.addEventListener('click', () => {
        const qId = row.getAttribute('data-id');
        const q = questions.find(item => item.id === qId);
        store.selectedQuestion = q;
        store.navigateTo('question-detail');
      });
    });
  };

  // Listeners
  searchInput.addEventListener('input', filterQuestions);

  btnFilterAll.addEventListener('click', () => {
    searchInput.value = '';
    activeType = 'all';
    activeDiff = 'all';
    activeYearValue = 'all';
    filterType.value = 'all';
    filterDiff.value = 'all';
    filterYear.value = 'all';
    filterQuestions();
  });

  filterType.addEventListener('change', (e) => {
    activeType = e.target.value;
    filterQuestions();
  });

  filterDiff.addEventListener('change', (e) => {
    activeDiff = e.target.value;
    filterQuestions();
  });

  filterYear.addEventListener('change', (e) => {
    activeYearValue = e.target.value;
    filterQuestions();
  });

  // Initial render of questions
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
            <span style="display: inline-flex; align-items: center; gap: 8px;">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" style="color: var(--primary);">
                <polygon points="12 2 2 22 22 22 12 2"></polygon>
              </svg>
              AI Solver
            </span>
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

/* ==========================================================================
   ALGO & CODE VIEWS
   ========================================================================== */

// 6a. Algo Topics (Parent Topic blocks)
async function renderAlgoTopicsView() {
  const topics = await supabaseClient.getLeetcodeTopics();

  if (topics.length === 0) {
    viewContainer.innerHTML = `
      <div class="selection-card fade-in" style="text-align:center; max-width:600px;">
        <div style="color:var(--primary); margin-bottom:16px;">
          <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
        </div>
        <h3>No Topics Yet</h3>
        <p style="color:var(--subtext);margin-top:12px;">No LeetCode questions have been added to the database yet. Add some from Supabase to get started!</p>
      </div>
    `;
    return;
  }

  // SVG icon map for well-known topics
  const topicIcons = {
    'Array':              `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="7" y1="5" x2="7" y2="19"/><line x1="12" y1="5" x2="12" y2="19"/><line x1="17" y1="5" x2="17" y2="19"/></svg>`,
    'String':             `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h10M4 17h6"/></svg>`,
    'Linked List':        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="12" r="3"/><circle cx="19" cy="12" r="3"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`,
    'Tree':               `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v6M5 8h14M8 8v2a4 4 0 0 0 8 0V8"/><circle cx="5" cy="17" r="3"/><circle cx="12" cy="17" r="3"/><circle cx="19" cy="17" r="3"/></svg>`,
    'Graph':              `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="12" cy="19" r="2"/><line x1="7" y1="5" x2="17" y2="5"/><line x1="5.7" y1="7" x2="11" y2="17"/><line x1="18.3" y1="7" x2="13" y2="17"/></svg>`,
    'Dynamic Programming':`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/></svg>`,
    'Recursion':          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><polyline points="3 3 3 8 8 8"/></svg>`,
    'Searching':          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    'Sorting':            `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="8" y2="18"/></svg>`,
    'Stack':              `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,
    'Queue':              `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
    'Hash Map':           `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>`,
    'Binary Search':      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`,
    'Two Pointers':       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 8 22 12 18 16"/><polyline points="6 8 2 12 6 16"/><line x1="2" y1="12" x2="22" y2="12"/></svg>`,
    'Sliding Window':     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="10" height="10" rx="1"/><line x1="16" y1="7" x2="22" y2="7"/><line x1="16" y1="12" x2="22" y2="12"/><line x1="16" y1="17" x2="22" y2="17"/></svg>`,
    'Backtracking':       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>`,
    'Greedy':             `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`,
    'Heap':               `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 19h20L12 2z"/><line x1="12" y1="8" x2="12" y2="14"/></svg>`,
    'Trie':               `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="4" r="2"/><circle cx="5" cy="14" r="2"/><circle cx="12" cy="14" r="2"/><circle cx="19" cy="14" r="2"/><line x1="12" y1="6" x2="5" y2="12"/><line x1="12" y1="6" x2="12" y2="12"/><line x1="12" y1="6" x2="19" y2="12"/></svg>`,
    'Math':               `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`
  };
  const defaultIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;

  const cardsHtml = topics.map((topic) => {
    const icon = topicIcons[topic] || defaultIcon;
    return `
      <div class="algo-topic-card fade-in" data-topic="${topic}">
        <div class="algo-topic-icon">${icon}</div>
        <div class="algo-topic-name">${topic}</div>
        <div class="algo-topic-arrow">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </div>
      </div>
    `;
  }).join('');

  viewContainer.innerHTML = `
    <div class="algo-topics-header fade-in">
      <h2>Choose a Topic</h2>
      <p>Select a data structure or algorithm to practice LeetCode questions</p>
    </div>
    <div class="algo-topics-grid">${cardsHtml}</div>
  `;

  document.querySelectorAll('.algo-topic-card').forEach(card => {
    card.addEventListener('click', () => {
      store.algoSelectedTopic = card.getAttribute('data-topic');
      store.navigateTo('algo-questions');
    });
  });
}

// 6b. Algo Questions View (3-column Easy | Medium | Hard)
async function renderAlgoQuestionsView() {
  const topic = store.algoSelectedTopic;
  if (!topic) { store.navigateTo('algo-topics'); return; }

  const questions = await supabaseClient.getLeetcodeByTopic(topic);

  // Case-insensitive filter — Supabase stores 'Easy'/'Medium'/'Hard'
  const easy   = questions.filter(q => q.difficulty?.toLowerCase() === 'easy');
  const medium = questions.filter(q => q.difficulty?.toLowerCase() === 'medium');
  const hard   = questions.filter(q => q.difficulty?.toLowerCase() === 'hard');

  function renderCol(qs, label, cls) {
    if (qs.length === 0) {
      return `<div class="algo-col-empty"><span class="algo-diff-badge ${cls}">${label}</span><p>No ${label} questions yet</p></div>`;
    }
    const rows = qs.map((q, i) => `
      <div class="algo-question-row" data-id="${q.id}">
        <span class="algo-q-num">${i + 1}</span>
        <span class="algo-q-name">${q.question_name}</span>
        <svg class="algo-q-arrow" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>
    `).join('');
    return `
      <div class="algo-diff-header">
        <span class="algo-diff-badge ${cls}">${label}</span>
        <span class="algo-diff-count">${qs.length} question${qs.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="algo-question-list">${rows}</div>
    `;
  }

  viewContainer.innerHTML = `
    <div class="algo-questions-layout fade-in">
      <div class="algo-col algo-col-easy">${renderCol(easy, 'Easy', 'badge-easy')}</div>
      <div class="algo-col algo-col-medium">${renderCol(medium, 'Medium', 'badge-medium')}</div>
      <div class="algo-col algo-col-hard">${renderCol(hard, 'Hard', 'badge-hard')}</div>
    </div>
  `;

  // Attach click — show popup
  document.querySelectorAll('.algo-question-row').forEach(row => {
    row.addEventListener('click', () => {
      const qId = row.getAttribute('data-id');
      const q = questions.find(x => x.id === qId);
      showAlgoQuestionPopup(q);
    });
  });
}

// Popup for question action choice
function showAlgoQuestionPopup(q) {
  // Remove any existing popup
  document.getElementById('algo-popup-overlay')?.remove();

  const diffClass = q.difficulty?.toLowerCase() === 'easy' ? 'badge-easy' : q.difficulty?.toLowerCase() === 'medium' ? 'badge-medium' : 'badge-hard';
  const hasLink = q.question_link && q.question_link.trim() !== '';

  const overlay = document.createElement('div');
  overlay.id = 'algo-popup-overlay';
  overlay.className = 'algo-popup-overlay';
  overlay.innerHTML = `
    <div class="algo-popup" id="algo-popup-box">
      <button class="algo-popup-close" id="algo-popup-close">&times;</button>
      <div class="algo-popup-badge-row">
        <span class="algo-diff-badge ${diffClass}">${q.difficulty}</span>
        <span class="algo-popup-topic">${q.parent_topic}</span>
      </div>
      <h2 class="algo-popup-title">${q.question_name}</h2>
      <p class="algo-popup-subtitle">Priority #${q.priority_order} &mdash; What would you like to do?</p>
      <div class="algo-popup-actions">
        <button class="algo-popup-btn algo-btn-question" id="algo-btn-view-q" ${!hasLink ? 'disabled title="No link added yet"' : ''}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
          <span>View Question</span>
        </button>
        <button class="algo-popup-btn algo-btn-solution" id="algo-btn-view-sol">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5">
            <polygon points="12 2 2 22 22 22 12 2"/>
          </svg>
          <span>View Solution</span>
        </button>
      </div>
      ${!hasLink ? `<p class="algo-popup-no-link" style="display: flex; align-items: center; justify-content: center; gap: 6px;"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align: middle; flex-shrink: 0;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> No LeetCode link added yet — add it from Supabase first.</p>` : ''}
    </div>
  `;

  document.body.appendChild(overlay);

  // Close on backdrop click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.getElementById('algo-popup-close').addEventListener('click', () => overlay.remove());

  // View Question — open LeetCode link
  document.getElementById('algo-btn-view-q').addEventListener('click', () => {
    if (hasLink) {
      if (window.__TAURI__) {
        invoke('plugin:opener|open_url', { url: q.question_link }).catch(err => {
          console.error("Failed to open URL via Tauri opener:", err);
          window.open(q.question_link, '_blank');
        });
      } else {
        window.open(q.question_link, '_blank');
      }
    }
  });

  // View Solution — navigate to solution view
  document.getElementById('algo-btn-view-sol').addEventListener('click', () => {
    store.algoSelectedQuestion = q;
    overlay.remove();
    store.navigateTo('algo-solution');
  });
}

// 6c. Algo Solution View (AI-powered solution via Gemini or Custom DB Solutions)
async function renderAlgoSolutionView() {
  const q = store.algoSelectedQuestion;
  if (!q) { store.navigateTo('algo-questions'); return; }

  const diffClass = q.difficulty?.toLowerCase() === 'easy' ? 'badge-easy' : q.difficulty?.toLowerCase() === 'medium' ? 'badge-medium' : 'badge-hard';

  // Render main layout skeleton
  viewContainer.innerHTML = `
    <div class="algo-solution-layout fade-in">
      <div class="algo-solution-content-area" id="algo-sol-content-area" style="flex:1; display:flex; flex-direction:column; position:relative;">
        <div class="ai-solver-loading" style="padding: 40px; text-align: center;">
          <div class="spinner"></div>
          <p style="color:var(--primary);font-weight:600;margin-top:16px;">Checking for solutions...</p>
        </div>
      </div>
    </div>
  `;

  const contentArea = document.getElementById('algo-sol-content-area');

  try {
    // Fetch custom solutions from database
    const dbSolutions = await supabaseClient.getLeetcodeSolutions(q.id);

    if (dbSolutions && dbSolutions.length > 0) {
      // We have custom solutions! Group by language (C++ first, then Java, then C)
      const langOrder = ['C++', 'Java', 'C'];
      const languages = [...new Set(dbSolutions.map(s => s.language))].sort((a, b) => {
        let idxA = langOrder.indexOf(a);
        let idxB = langOrder.indexOf(b);
        if (idxA === -1) idxA = 99;
        if (idxB === -1) idxB = 99;
        return idxA - idxB;
      });
      let activeLang = languages[0];
      let activeSubIndex = 0;
      let hideComments = true;
      let selectedTheme = store.theme === 'dark' ? 'cyberpunk' : 'github-light';

      // Render static container once
      contentArea.innerHTML = `
        <div class="custom-solution-container" style="display:flex; flex-direction:column; flex:1;">
          <div class="custom-sol-header-bar">
            <div class="custom-sol-tabs" id="custom-sol-lang-tabs">
              ${languages.map(lang => `
                <button class="custom-sol-tab ${lang === activeLang ? 'active' : ''}" data-lang="${lang}">
                  ${lang}
                </button>
              `).join('')}
            </div>
            
            <div class="custom-sol-theme-selector">
              <span style="font-size:0.75rem; font-weight:600; color:var(--subtext); margin-right:4px;">Theme:</span>
              <button class="custom-sol-theme-btn theme-btn-one-dark ${selectedTheme === 'one-dark' ? 'active' : ''}" data-theme="one-dark" title="One Dark"></button>
              <button class="custom-sol-theme-btn theme-btn-monokai ${selectedTheme === 'monokai' ? 'active' : ''}" data-theme="monokai" title="Monokai"></button>
              <button class="custom-sol-theme-btn theme-btn-dracula ${selectedTheme === 'dracula' ? 'active' : ''}" data-theme="dracula" title="Dracula"></button>
              <button class="custom-sol-theme-btn theme-btn-nord ${selectedTheme === 'nord' ? 'active' : ''}" data-theme="nord" title="Nord"></button>
              <button class="custom-sol-theme-btn theme-btn-cyberpunk ${selectedTheme === 'cyberpunk' ? 'active' : ''}" data-theme="cyberpunk" title="Cyberpunk"></button>
              <button class="custom-sol-theme-btn theme-btn-solarized-dark ${selectedTheme === 'solarized-dark' ? 'active' : ''}" data-theme="solarized-dark" title="Solarized Dark"></button>
              <button class="custom-sol-theme-btn theme-btn-winter-blue ${selectedTheme === 'winter-blue' ? 'active' : ''}" data-theme="winter-blue" title="Winter Blue"></button>
              <button class="custom-sol-theme-btn theme-btn-github-light ${selectedTheme === 'github-light' ? 'active' : ''}" data-theme="github-light" title="GitHub Light"></button>
            </div>

            <div class="custom-sol-actions">
              <button class="custom-sol-toggle-comments" id="algo-toggle-comments">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:4px;"></svg>
                <span class="toggle-text">Hide Comments</span>
              </button>
            </div>
          </div>
          <div class="custom-sol-body">
            <div class="custom-sol-title-row" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
              <h3 class="custom-sol-heading" id="custom-sol-title" style="margin-bottom: 0;"></h3>
              <div class="custom-sol-sub-tabs" id="custom-sol-sub-tabs"></div>
            </div>
            <div class="custom-sol-complexity-row" id="custom-sol-complexity-row" style="display: none; gap: 12px; margin-bottom: 16px; align-items: center; flex-wrap: wrap;"></div>
            <div class="custom-sol-code-wrapper" id="custom-sol-code-wrapper" data-code-theme="${selectedTheme}">
              <pre><code id="custom-sol-code-block" style="white-space: pre-wrap; word-break: break-all;"></code></pre>
            </div>
          </div>
        </div>
      `;

      const titleEl = document.getElementById('custom-sol-title');
      const subTabsContainer = document.getElementById('custom-sol-sub-tabs');
      const codeBlockEl = document.getElementById('custom-sol-code-block');
      const codeWrapperEl = document.getElementById('custom-sol-code-wrapper');
      const toggleBtn = document.getElementById('algo-toggle-comments');
      const toggleText = toggleBtn.querySelector('.toggle-text');
      const toggleIcon = toggleBtn.querySelector('svg');

      function updateCodeDisplay() {
        // Get solutions for the active language
        const langSolutions = dbSolutions.filter(s => s.language === activeLang);
        
        // Safety check if activeSubIndex is out of range
        if (activeSubIndex >= langSolutions.length) {
          activeSubIndex = 0;
        }

        const activeSol = langSolutions[activeSubIndex];
        
        // Update Heading
        titleEl.textContent = activeSol.heading;

        // Render complexities if they are not null/empty
        const complexityRow = document.getElementById('custom-sol-complexity-row');
        if (complexityRow) {
          let complexityHtml = '';
          if (activeSol.time_complexity && activeSol.time_complexity.trim() !== '') {
            complexityHtml += `
              <span class="algo-sol-complexity-badge">
                Time: <strong>${escapeHtml(activeSol.time_complexity)}</strong>
              </span>
            `;
          }
          if (activeSol.space_complexity && activeSol.space_complexity.trim() !== '') {
            complexityHtml += `
              <span class="algo-sol-complexity-badge">
                Space: <strong>${escapeHtml(activeSol.space_complexity)}</strong>
              </span>
            `;
          }
          complexityRow.innerHTML = complexityHtml;
          complexityRow.style.display = complexityHtml ? 'flex' : 'none';
        }

        // Render sub-tabs (Alternative Solutions)
        if (langSolutions.length > 0) {
          subTabsContainer.innerHTML = langSolutions.map((sol, index) => `
            <button class="custom-sol-sub-tab ${index === activeSubIndex ? 'active' : ''}" data-sub-index="${index}">
              Sol ${index + 1}
            </button>
          `).join('');
          
          // Wire up sub-tab click events
          subTabsContainer.querySelectorAll('.custom-sol-sub-tab').forEach(btn => {
            btn.addEventListener('click', (e) => {
              activeSubIndex = parseInt(e.currentTarget.getAttribute('data-sub-index'), 10);
              updateCodeDisplay();
            });
          });
        } else {
          subTabsContainer.innerHTML = '';
        }

        // Process comments
        let rawCode = activeSol.solution;
        if (hideComments) {
          rawCode = rawCode.replace(/\/\*[\s\S]*?\*\/|(?<!:)\/\/.*$/gm, '').replace(/^\s*[\r\n]/gm, '');
        }

        // Apply highlighting
        codeBlockEl.innerHTML = highlightCode(rawCode);

        // Update active language tab buttons styling
        contentArea.querySelectorAll('#custom-sol-lang-tabs .custom-sol-tab').forEach(btn => {
          if (btn.getAttribute('data-lang') === activeLang) {
            btn.classList.add('active');
          } else {
            btn.classList.remove('active');
          }
        });

        // Update Toggle comments button text and icon
        if (hideComments) {
          toggleText.textContent = 'Show Comments';
          toggleIcon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
        } else {
          toggleText.textContent = 'Hide Comments';
          toggleIcon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
        }
      }

      function highlightCode(code) {
        let escaped = escapeHtml(code);
        const tokenRegex = /(\/\*[\s\S]*?\*\/|(?<!:)\/\/.*$)|(".*?"|'.*?')|(\b(class|public|private|protected|struct|int|double|float|char|void|int\*|return|if|for|while|new|import|package|include|std|vector|unordered_map|HashMap|Map|Integer|NULL|free|malloc|sizeof)\b)/gm;
        return escaped.replace(tokenRegex, (match, comment, string, keyword) => {
          if (comment) return `<span class="code-comment">${comment}</span>`;
          if (string) return `<span class="code-string">${string}</span>`;
          if (keyword) return `<span class="code-keyword">${keyword}</span>`;
          return match;
        });
      }

      // Language Tab click listeners
      contentArea.querySelectorAll('#custom-sol-lang-tabs .custom-sol-tab').forEach(button => {
        button.addEventListener('click', (e) => {
          activeLang = e.currentTarget.getAttribute('data-lang');
          activeSubIndex = 0; // Reset sub index to first solution of the selected language
          updateCodeDisplay();
        });
      });

      // Toggle comments click listener
      toggleBtn.addEventListener('click', () => {
        hideComments = !hideComments;
        updateCodeDisplay();
      });

      // Theme selector button click listeners
      contentArea.querySelectorAll('.custom-sol-theme-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          selectedTheme = e.currentTarget.getAttribute('data-theme');
          
          // Update theme active classes
          contentArea.querySelectorAll('.custom-sol-theme-btn').forEach(b => {
            if (b === e.currentTarget) {
              b.classList.add('active');
            } else {
              b.classList.remove('active');
            }
          });
          
          // Update data-code-theme attribute
          codeWrapperEl.setAttribute('data-code-theme', selectedTheme);
        });
      });

      // Initial Render
      updateCodeDisplay();
    } else {
      // Fallback: AI Solver panel if no custom database solution is found
      contentArea.innerHTML = `
        <div class="ai-solver-panel fade-in" style="flex:1;">
          <div class="ai-blueprint-bg"></div>
          <div class="ai-solver-header">
            <div class="ai-solver-header-title">
              <span style="display: inline-flex; align-items: center; gap: 8px;">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" style="color: var(--primary);">
                  <polygon points="12 2 2 22 22 22 12 2"></polygon>
                </svg>
                AI Solution
              </span>
            </div>
            <button class="ai-solve-btn" id="algo-solve-trigger">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="12 2 2 22 22 22 12 2"/></svg>
              <span>Generate Solution</span>
            </button>
          </div>
          <div class="ai-solver-body" id="algo-ai-response">
            <div class="ai-solver-placeholder">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
              <p>Click <strong>Generate Solution</strong> to get a step-by-step AI walkthrough for this LeetCode problem.</p>
            </div>
          </div>
        </div>
      `;

      const trigger = document.getElementById('algo-solve-trigger');
      const responseArea = document.getElementById('algo-ai-response');

      trigger.addEventListener('click', async () => {
        trigger.disabled = true;
        responseArea.innerHTML = `
          <div class="ai-solver-loading">
            <div class="spinner"></div>
            <p style="color:var(--primary);font-weight:600;text-align:center;">Generating solution for "${q.question_name}"...<br/><span style="font-weight:400;font-size:0.85rem;color:var(--subtext);">Analyzing time complexity, approach &amp; code</span></p>
          </div>
        `;
        try {
          const cacheKey = 'algo_' + q.id;
          let solution;
          if (aiCache.has(cacheKey)) {
            solution = aiCache.get(cacheKey);
          } else {
            solution = await aiService.solveQuestion(`LeetCode Problem: ${q.question_name}\n\nProvide a detailed solution including:\n1. Problem understanding\n2. Optimal approach/algorithm\n3. Step-by-step explanation\n4. Code solution (preferably Python and/or JavaScript)\n5. Time and space complexity analysis`);
            aiCache.set(cacheKey, solution);
          }
          const htmlContent = window.marked.parse(solution);
          responseArea.innerHTML = `<div class="ai-solver-content">${htmlContent}</div>`;
        } catch (err) {
          responseArea.innerHTML = `
            <div class="drive-empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
              <p>Could not generate solution. Check your Gemini API key in Settings.</p>
              <p style="font-size:0.8rem;color:var(--accent);margin-top:8px;">${err.message || ''}</p>
            </div>
          `;
        } finally {
          trigger.disabled = false;
        }
      });
    }
  } catch (error) {
    console.error("Error loading solution view:", error);
    contentArea.innerHTML = `
      <div class="drive-empty">
        <p>Error loading solutions from Supabase.</p>
        <p style="font-size:0.8rem;color:var(--accent);">${error.message || ''}</p>
      </div>
    `;
  }
}

// 7. Settings View
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

// Mini Music Player Logic
async function initMusicPlayer() {
  const audio = new Audio();
  let playlist = [];
  let currentTrackIndex = 0;
  let isPlaying = false;

  const playBtn = document.getElementById('player-play-btn');
  const prevBtn = document.getElementById('player-prev-btn');
  const nextBtn = document.getElementById('player-next-btn');
  const progressBar = document.getElementById('player-progress-bar');
  const progressFill = document.getElementById('player-progress-fill');
  const timeText = document.getElementById('player-time');
  const volumeSlider = document.getElementById('player-volume-slider');

  // Fallback playlist with high quality lofi ambient URLs
  const fallbackPlaylist = [
    'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
    'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3'
  ];

  // Load songs from the 'music' folder via Rust backend
  try {
    const files = await invoke('list_music_files');
    if (files && files.length > 0) {
      console.log(`Loaded ${files.length} songs from the music folder.`);
      playlist = files;
    } else {
      console.log("Music folder is empty. Using default ambient fallback songs.");
      playlist = fallbackPlaylist;
    }
  } catch (err) {
    console.error("Failed to load music files, using fallbacks:", err);
    playlist = fallbackPlaylist;
  }

  // Load track helper
  function loadTrack(index) {
    if (playlist.length === 0) return;
    
    currentTrackIndex = index;
    const trackPath = playlist[currentTrackIndex];
    
    // Convert local system file path to WebView loadable URL if it's not a remote URL
    let src = trackPath;
    if (window.__TAURI__ && !trackPath.startsWith('http')) {
      src = window.__TAURI__.core.convertFileSrc(trackPath);
    }
    
    audio.src = src;
    audio.load();
    progressFill.style.width = '0%';
    timeText.textContent = `0:00 / 0:00`;
  }

  // Play/Pause helper
  function togglePlay() {
    if (playlist.length === 0) return;
    
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(err => console.error("Audio playback error:", err));
    }
  }

  // Update play button icon
  function updatePlayButtonUI() {
    if (!playBtn) return;
    if (isPlaying) {
      playBtn.innerHTML = `<svg viewBox="0 0 24 24" id="play-icon"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
      playBtn.title = "Pause";
    } else {
      playBtn.innerHTML = `<svg viewBox="0 0 24 24" id="play-icon"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
      playBtn.title = "Play";
    }
  }

  // Format seconds to M:SS
  function formatTime(secs) {
    if (isNaN(secs)) return '0:00';
    const minutes = Math.floor(secs / 60);
    const seconds = Math.floor(secs % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  }

  // Next Track
  function nextTrack() {
    let nextIndex = (currentTrackIndex + 1) % playlist.length;
    loadTrack(nextIndex);
    if (isPlaying) {
      audio.play().catch(e => console.error(e));
    }
  }

  // Previous Track
  function prevTrack() {
    let prevIndex = (currentTrackIndex - 1 + playlist.length) % playlist.length;
    loadTrack(prevIndex);
    if (isPlaying) {
      audio.play().catch(e => console.error(e));
    }
  }

  // Bind controls
  if (playBtn) playBtn.addEventListener('click', togglePlay);
  if (prevBtn) prevBtn.addEventListener('click', prevTrack);
  if (nextBtn) nextBtn.addEventListener('click', nextTrack);

  // Audio Event Listeners
  audio.addEventListener('play', () => {
    isPlaying = true;
    updatePlayButtonUI();
  });

  audio.addEventListener('pause', () => {
    isPlaying = false;
    updatePlayButtonUI();
  });

  audio.addEventListener('timeupdate', () => {
    if (audio.duration) {
      const pct = (audio.currentTime / audio.duration) * 100;
      progressFill.style.width = `${pct}%`;
      timeText.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
    }
  });

  audio.addEventListener('loadedmetadata', () => {
    timeText.textContent = `0:00 / ${formatTime(audio.duration)}`;
  });

  audio.addEventListener('ended', () => {
    nextTrack();
  });

  // Click on progress bar to seek
  if (progressBar) {
    progressBar.addEventListener('click', (e) => {
      if (!audio.duration || playlist.length === 0) return;
      const rect = progressBar.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const width = rect.width;
      const percentage = Math.max(0, Math.min(1, clickX / width));
      audio.currentTime = percentage * audio.duration;
    });
  }

  // Volume slider control
  if (volumeSlider) {
    volumeSlider.addEventListener('input', () => {
      audio.volume = volumeSlider.value;
    });
    audio.volume = volumeSlider.value;
  }

  // Initial load
  loadTrack(0);
}

// Mini Stopwatch Logic
function initStopwatch() {
  let stopwatchInterval = null;
  let stopwatchSeconds = 0;
  let isStopwatchRunning = false;

  const display = document.getElementById('stopwatch-display');
  const playBtn = document.getElementById('stopwatch-play-btn');
  const resetBtn = document.getElementById('stopwatch-reset-btn');

  function updateStopwatchUI() {
    if (!display) return;
    const hrs = Math.floor(stopwatchSeconds / 3600);
    const mins = Math.floor((stopwatchSeconds % 3600) / 60);
    const secs = stopwatchSeconds % 60;
    
    const displayMins = mins < 10 ? `0${mins}` : mins;
    const displaySecs = secs < 10 ? `0${secs}` : secs;
    
    display.textContent = hrs > 0 ? `${hrs}:${displayMins}:${displaySecs}` : `${displayMins}:${displaySecs}`;
  }

  function toggleStopwatch() {
    if (isStopwatchRunning) {
      // Pause
      clearInterval(stopwatchInterval);
      isStopwatchRunning = false;
      if (playBtn) {
        playBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
        playBtn.title = "Start Stopwatch";
      }
    } else {
      // Start
      stopwatchInterval = setInterval(() => {
        stopwatchSeconds++;
        updateStopwatchUI();
      }, 1000);
      isStopwatchRunning = true;
      if (playBtn) {
        playBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
        playBtn.title = "Pause Stopwatch";
      }
    }
  }

  function resetStopwatch() {
    clearInterval(stopwatchInterval);
    isStopwatchRunning = false;
    stopwatchSeconds = 0;
    updateStopwatchUI();
    if (playBtn) {
      playBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
      playBtn.title = "Start Stopwatch";
    }
  }

  if (playBtn) playBtn.addEventListener('click', toggleStopwatch);
  if (resetBtn) resetBtn.addEventListener('click', resetStopwatch);

  // Initialize display
  updateStopwatchUI();
}

// Start the Application
window.addEventListener('DOMContentLoaded', () => {
  init();
});
