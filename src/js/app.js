// Focus Fox Single-Page App (SPA) Core JS
import { store, VIDEO_THEMES } from './store.js';
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

// Subject page time tracker — interval fires every 60s while on subject-dashboard
let subjectPageTimerInterval = null;

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
let navAbout;
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
  navAbout = document.getElementById('nav-about');
  navSyllabus = document.getElementById('nav-syllabus');
  const navNotes = document.getElementById('nav-notes');
  const navWhiteboard = document.getElementById('nav-whiteboard');
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

  // Load initial view based on coursework selection
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

  if (navAbout) {
    navAbout.addEventListener('click', () => {
      store.navigateTo('about');
    });
  }

  const navNotesEl = document.getElementById('nav-notes');
  if (navNotesEl) {
    navNotesEl.addEventListener('click', () => store.navigateTo('notes-app'));
  }

  const navWhiteboardEl = document.getElementById('nav-whiteboard');
  if (navWhiteboardEl) {
    navWhiteboardEl.addEventListener('click', () => store.navigateTo('whiteboard-app'));
  }

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
    if (newTheme === 'light' && store.videoTheme === 'jellyfish') {
      store.setVideoTheme('none');
    }
    updateThemeIcon();
  });

  // Jellyfish Theme Toggle Button
  const jellyfishToggleBtn = document.getElementById('jellyfish-toggle-btn');
  if (jellyfishToggleBtn) {
    jellyfishToggleBtn.addEventListener('click', () => {
      if (store.videoTheme === 'jellyfish') {
        store.setVideoTheme('none');
      } else {
        if (store.theme === 'light') {
          store.setTheme('dark');
          updateThemeIcon();
        }
        store.setVideoTheme('jellyfish');
      }
    });

    const syncJellyfishButtonState = () => {
      jellyfishToggleBtn.classList.toggle('has-active', store.videoTheme === 'jellyfish');
    };
    syncJellyfishButtonState();
    window.addEventListener('video-theme-changed', syncJellyfishButtonState);
  }

  // State Changed Listener
  window.addEventListener('state-changed', (e) => {
    const { view, data } = e.detail;
    updateSidebarActiveState(view);
    updateHeader(view, data);
    renderView(view, data);
  });

  // Study History Updated Listener
  window.addEventListener('study-history-updated', () => {
    if (store.currentView === 'subjects') {
      renderSubjectsView();
    }
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
  if (navAbout) navAbout.classList.remove('active');
  if (navSyllabus) navSyllabus.classList.remove('active');
  const navNotesEl = document.getElementById('nav-notes');
  const navWbEl = document.getElementById('nav-whiteboard');
  if (navNotesEl) navNotesEl.classList.remove('active');
  if (navWbEl) navWbEl.classList.remove('active');

  if (view === 'selection') {
    navSelection.classList.add('active');
  } else if (view === 'subjects' || view === 'subject-dashboard' || view === 'question-list' || view === 'question-detail') {
    navDashboard.classList.add('active');
  } else if (view === 'syllabus') {
    if (navSyllabus) navSyllabus.classList.add('active');
  } else if (view === 'settings') {
    navSettings.classList.add('active');
  } else if (view === 'about') {
    if (navAbout) navAbout.classList.add('active');
  } else if (view === 'algo-topics' || view === 'algo-questions' || view === 'algo-solution') {
    if (navAlgo) navAlgo.classList.add('active');
  } else if (view === 'notes-app') {
    if (navNotesEl) navNotesEl.classList.add('active');
  } else if (view === 'whiteboard-app') {
    if (navWbEl) navWbEl.classList.add('active');
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
    headerTitleText.textContent = store.selectedBranch ? `${store.selectedBranch.name} • Semester ${store.selectedSemester}` : "Subjects";
    headerSubtitleText.textContent = "";
    if (searchContainer) searchContainer.style.display = 'none';
    if (notifBtn) notifBtn.style.display = 'none';
    if (profile) profile.style.display = 'none';
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
  } else if (view === 'about') {
    headerTitleText.textContent = "About Focus Fox";
    headerSubtitleText.textContent = "Learn more about the application and its creators";
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
  } else if (view === 'leetcode-webview') {
    headerTitleText.textContent = q ? q.question_name : "LeetCode";
    headerSubtitleText.textContent = "In-app LeetCode Browser";
  } else if (view === 'notes-app') {
    headerTitleText.textContent = "Notes";
    headerSubtitleText.textContent = "Your personal study notes, all saved locally";
  } else if (view === 'whiteboard-app') {
    headerTitleText.textContent = "Whiteboard";
    headerSubtitleText.textContent = "Sketch, draw, and brainstorm — all saved locally";
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
  // Clear subject page timer when leaving subject-dashboard
  if (subjectPageTimerInterval) {
    clearInterval(subjectPageTimerInterval);
    subjectPageTimerInterval = null;
  }

  // Toggle padding class for fullscreen views (PDF preview, LeetCode webview)
  if (view === 'pdf-viewer' || view === 'leetcode-webview') {
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
      case 'about':
        await renderAboutView();
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
      case 'leetcode-webview':
        renderLeetcodeWebview();
        break;
      case 'notes-app':
        renderNotesView();
        break;
      case 'whiteboard-app':
        renderWhiteboardView();
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

// Helper to generate calendar heatmap HTML
function generateCalendarHeatmapHtml(selectedRange = "This Month", isMini = false) {
  // Current date/year mock anchored around June 27, 2026
  const now = new Date(2026, 5, 27);
  let year = now.getFullYear();
  let month = now.getMonth();

  if (selectedRange === "Last Month") {
    month--;
    if (month < 0) {
      month = 11;
      year--;
    }
  }

  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const monthName = monthNames[month];
  const totalDays = new Date(year, month + 1, 0).getDate();
  const firstDayIndex = new Date(year, month, 1).getDay();

  const weekdays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const headersHtml = weekdays.map(day => `<div class="calendar-weekday">${day}</div>`).join('');

  const history = JSON.parse(localStorage.getItem('focus_fox_study_history') || '{}');

  let cellsHtml = '';
  // Empty padding cells before first day
  for (let i = 0; i < firstDayIndex; i++) {
    cellsHtml += `<div class="heatmap-cell empty"></div>`;
  }

  // Month days
  for (let dayNum = 1; dayNum <= totalDays; dayNum++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    const studyMinutes = history[dateStr] || 0;

    let lvl = 0;
    if (studyMinutes === 0) lvl = 0;
    else if (studyMinutes <= 15) lvl = 1;
    else if (studyMinutes <= 30) lvl = 2;
    else if (studyMinutes <= 60) lvl = 3;
    else lvl = 4;

    const tooltip = `${monthName} ${dayNum}, ${year}: ${studyMinutes}m studied (Level ${lvl} Activity)`;

    if (isMini) {
      cellsHtml += `
        <div class="heatmap-cell ${lvl > 0 ? `level-${lvl}` : ''}" title="${tooltip}"></div>
      `;
    } else {
      cellsHtml += `
        <div class="heatmap-cell ${lvl > 0 ? `level-${lvl}` : ''}" data-day="${dayNum}" title="${tooltip}">
          <span class="day-number">${dayNum}</span>
        </div>
      `;
    }
  }

  // Pad to end of the week
  const totalSlots = firstDayIndex + totalDays;
  const paddingSlots = (7 - (totalSlots % 7)) % 7;
  for (let i = 0; i < paddingSlots; i++) {
    cellsHtml += `<div class="heatmap-cell empty"></div>`;
  }

  return {
    headersHtml,
    cellsHtml,
    monthName,
    year
  };
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
      studyTime = '0m studied';
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

  const overallProgressPercentage = totalTopicsCount > 0 ? Math.round((completedTopicsCount / totalTopicsCount) * 100) : 0;

  // Calculate dynamic total study time — read fresh from localStorage for each subject
  // (this includes time logged by the subject-page timer during this session)
  let totalMinutes = 0;
  subjectsData.forEach(subj => {
    const timeKey = `focus_fox_study_time_${subj.id}`;
    const timeStr = localStorage.getItem(timeKey) || subj.studyTime || '';
    const matchHoursMins = timeStr.match(/(\d+)\s*h\s*(\d+)\s*m/i);
    const matchHoursOnly = timeStr.match(/(\d+)\s*h/i);
    const matchMinsOnly = timeStr.match(/(\d+)\s*m/i);

    if (matchHoursMins) {
      totalMinutes += parseInt(matchHoursMins[1], 10) * 60 + parseInt(matchHoursMins[2], 10);
    } else if (matchHoursOnly) {
      totalMinutes += parseInt(matchHoursOnly[1], 10) * 60;
    } else if (matchMinsOnly) {
      totalMinutes += parseInt(matchMinsOnly[1], 10);
    }
  });
  const totalHoursText = totalMinutes > 0 ? `${(totalMinutes / 60).toFixed(1)}h` : '0h';

  // Render left column stacked stats cards
  const statsLeftColumnHtml = `
    <div class="left-stats-column">
      <!-- Subjects Enrolled -->
      <div class="dashboard-stat-card fade-in" id="enrolled-subjects-trigger" style="cursor: pointer;">
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
          <span class="stat-number-val">${totalHoursText}</span>
          <span class="stat-label-text">Study Time This Semester</span>
        </div>
      </div>
    </div>
  `;

  // Render contribution activity heatmap grid (3 rows x 36 columns for elongated detailed view)
  const heatmapLevels = [];
  const history = JSON.parse(localStorage.getItem('focus_fox_study_history') || '{}');
  const now = new Date(2026, 5, 27); // Anchor date

  for (let i = 0; i < 108; i++) {
    // Calculate date for this cell (moving from i=0 to i=107)
    // Cell 107 is today. Cell 0 is (today - 107 days)
    const cellDate = new Date(now);
    cellDate.setDate(now.getDate() - (107 - i));

    const year = cellDate.getFullYear();
    const month = String(cellDate.getMonth() + 1).padStart(2, '0');
    const day = String(cellDate.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    const studyMinutes = history[dateStr] || 0;
    let lvl = 0;
    if (studyMinutes === 0) lvl = 0;
    else if (studyMinutes <= 15) lvl = 1;
    else if (studyMinutes <= 30) lvl = 2;
    else if (studyMinutes <= 60) lvl = 3;
    else lvl = 4;

    heatmapLevels.push(lvl);
  }
  let heatmapCellsHtml = '';
  heatmapLevels.forEach(lvl => {
    heatmapCellsHtml += `<div class="heatmap-cell ${lvl > 0 ? `level-${lvl}` : ''}"></div>`;
  });

  const heatmapHtml = `
    <div class="study-activity-card fade-in" id="scratch-music-player-container" style="display: flex; flex-direction: column; justify-content: space-between; min-height: 120px; padding: 12px; gap: 8px; cursor: default; position: relative;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 0.8rem; font-weight: 700; color: var(--primary); display: flex; align-items: center; gap: 6px;">
          🎵 Focus Tunes
        </span>
        <span id="scratch-track-name" style="font-size: 0.75rem; color: var(--text); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px;">Loading track...</span>
      </div>

      <div style="display: flex; align-items: center; gap: 8px; justify-content: center; margin: 4px 0;">
        <button class="player-btn" id="scratch-prev-btn" style="width: 28px; height: 28px;" title="Previous">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="4" x2="5" y2="20" stroke="currentColor" stroke-width="2"/></svg>
        </button>
        <button class="player-btn play-btn" id="scratch-play-btn" style="width: 34px; height: 34px; background: var(--primary); display: flex; align-items: center; justify-content: center; border-radius: 50%; color: #171330; border: none; cursor: pointer;" title="Play">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" id="scratch-play-svg"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </button>
        <button class="player-btn" id="scratch-next-btn" style="width: 28px; height: 28px;" title="Next">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="4" x2="19" y2="20" stroke="currentColor" stroke-width="2"/></svg>
        </button>
      </div>

      <div style="display: flex; flex-direction: column; gap: 4px;">
        <div id="scratch-progress-bar" style="height: 5px; background: var(--bg); border-radius: 3px; position: relative; cursor: pointer; overflow: hidden;">
          <div id="scratch-progress-fill" style="height: 100%; width: 0%; background: var(--primary); border-radius: 3px; transition: width 0.1s linear;"></div>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 0.65rem; color: var(--subtext); font-weight: 500;">
          <span id="scratch-time-current">0:00</span>
          <span id="scratch-time-total">0:00</span>
        </div>
      </div>
    </div>
  `;

  // Render mini calendar card (replacing streak square card)
  const miniCalData = generateCalendarHeatmapHtml("This Month", true);
  const miniCalendarCardHtml = `
    <div class="streak-square-card fade-in" id="mini-calendar-trigger" style="justify-content: center; align-items: center; display: flex; flex-direction: column; cursor: pointer; padding: 10px 12px; gap: 4px;">
      <div class="activity-header" style="width: 100%; display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px; border: none; background: transparent; padding: 0;">
        <span class="activity-title" style="font-size: 0.75rem; font-weight: 700; color: var(--text);">Calendar</span>
        <span class="activity-subtitle" style="font-size: 0.65rem; color: var(--subtext); font-weight: 600;">${miniCalData.monthName}</span>
      </div>
      <div class="heatmap-container mini-calendar" style="width: 100%; border: none; background: transparent; padding: 0;">
        <div class="heatmap-grid" style="grid-template-columns: repeat(7, 14px); justify-content: center; gap: 4px; width: auto; margin: 0 auto;">
          ${miniCalData.headersHtml}
          ${miniCalData.cellsHtml}
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
    <!-- Top Stats Drawer Row (Floats on Right side of Subjects Screen only) -->
    <div class="subjects-dashboard-top" id="subjects-stats-drawer">
      <div class="subjects-drawer-tab" id="subjects-stats-drawer-tab">
         Stats <span id="subjects-stats-drawer-arrow">◀</span>
      </div>
      ${statsLeftColumnHtml}
      ${miniCalendarCardHtml}
    </div>

    <!-- Active Subjects Section -->
    <div class="active-subjects-section fade-in">
      <div class="active-subjects-header">
        <span class="active-subjects-title">Active Subjects</span>
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

  // Attach click to Enrolled Subjects trigger
  const enrolledTrigger = document.getElementById('enrolled-subjects-trigger');
  if (enrolledTrigger) {
    enrolledTrigger.addEventListener('click', () => openEnrolledSubjectsModal());
  }

  // Attach click to Heatmap Analytics card (for music player container, ignore calendar click)
  const heatmapTrigger = viewContainer.querySelector('#scratch-music-player-container');
  if (heatmapTrigger) {
    heatmapTrigger.addEventListener('click', (e) => {
      // Don't trigger modal if child controls are clicked
      if (e.target.closest('#scratch-play-btn') || e.target.closest('#scratch-prev-btn') || e.target.closest('#scratch-next-btn') || e.target.closest('#scratch-progress-bar')) return;
      openHeatmapAnalyticsModal(subjectsData, overallProgressPercentage);
    });
  }

  // Attach click to Right Mini Calendar trigger
  const miniCalTrigger = viewContainer.querySelector('#mini-calendar-trigger');
  if (miniCalTrigger) {
    miniCalTrigger.addEventListener('click', () => {
      openHeatmapAnalyticsModal(subjectsData, overallProgressPercentage);
    });
  }  // Attach stats drawer pull tab click toggle logic
  const statsDrawer = document.getElementById('subjects-stats-drawer');
  const statsDrawerTab = document.getElementById('subjects-stats-drawer-tab');
  const statsDrawerArrow = document.getElementById('subjects-stats-drawer-arrow');

  if (statsDrawer && statsDrawerTab) {
    let isStatsDrawerOpen = false;
    statsDrawerTab.addEventListener('click', () => {
      isStatsDrawerOpen = !isStatsDrawerOpen;
      if (isStatsDrawerOpen) {
        statsDrawer.classList.add('drawer-open');
        if (statsDrawerArrow) statsDrawerArrow.textContent = '▶';
      } else {
        statsDrawer.classList.remove('drawer-open');
        if (statsDrawerArrow) statsDrawerArrow.textContent = '◀';
      }
    });
  }

  // Initialize Scratch Music Player logic
  initScratchMusicPlayer();
}


// Global audio object for the scratch music player to ensure persistent playing across view re-renders
let scratchAudioObj = null;
let scratchPlaylist = [
  { name: "Rainy Cafe Ambient Lofi", src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" },
  { name: "Study Focus Deep Brownian Noise", src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3" },
  { name: "Chill Autumn Breeze Lofi Beats", src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3" }
];
let scratchCurrentIndex = 0;
let scratchIsPlaying = false;
let isDrawerOpen = false;

// Global persistent sliding drawer toggle helper
function initGlobalMusicPlayerDrawer() {
  const drawer = document.getElementById('global-music-player-drawer');
  const tab = document.getElementById('global-music-player-tab');
  const arrow = document.getElementById('global-music-player-arrow');

  if (!drawer || !tab) return;

  // Single listener attached globally once
  if (tab.getAttribute('data-bound') === 'true') return;
  tab.setAttribute('data-bound', 'true');

  tab.addEventListener('click', () => {
    isDrawerOpen = !isDrawerOpen;
    if (isDrawerOpen) {
      drawer.style.bottom = '0px';
      if (arrow) arrow.textContent = '▼';
    } else {
      drawer.style.bottom = '-80px';
      if (arrow) arrow.textContent = '▲';
    }
  });
}

async function initScratchMusicPlayer() {
  // Setup persistent global sliding drawer toggle once
  initGlobalMusicPlayerDrawer();

  // Initialize audio object once globally
  if (!scratchAudioObj) {
    scratchAudioObj = new Audio();
    scratchAudioObj.volume = 0.7;

    // Attempt to load music folder files via Tauri backend, fall back on lofi stream URLs
    try {
      if (window.__TAURI__) {
        const files = await invoke('list_music_files');
        if (files && files.length > 0) {
          scratchPlaylist = files.map(file => {
            const name = file.split(/[/\\]/).pop().replace(/\.[^/.]+$/, "");
            const webviewSrc = window.__TAURI__.core.convertFileSrc(file);
            return { name, src: webviewSrc };
          });
        }
      }
    } catch (err) {
      console.warn("Could not load local music files, using web lofi presets:", err);
    }

    // Load first track initially
    loadScratchTrack(0, false);
  }

  // Bind controls for Dashboard Widget Player
  const dPlayBtn = document.getElementById('scratch-play-btn');
  const dPrevBtn = document.getElementById('scratch-prev-btn');
  const dNextBtn = document.getElementById('scratch-next-btn');
  const dProgressBar = document.getElementById('scratch-progress-bar');
  const dProgressFill = document.getElementById('scratch-progress-fill');
  const dTrackName = document.getElementById('scratch-track-name');
  const dTimeCurrent = document.getElementById('scratch-time-current');
  const dTimeTotal = document.getElementById('scratch-time-total');

  // Bind controls for Collapsible Sliding bottom Drawer Player
  const wPlayBtn = document.getElementById('drawer-play-btn');
  const wPrevBtn = document.getElementById('drawer-prev-btn');
  const wNextBtn = document.getElementById('drawer-next-btn');
  const wProgressBar = document.getElementById('drawer-progress-bar');
  const wProgressFill = document.getElementById('drawer-progress-fill');
  const wTrackName = document.getElementById('drawer-track-name');
  const wTimeCurrent = document.getElementById('drawer-time-current');
  const wTimeTotal = document.getElementById('drawer-time-total');
  const wVolumeSlider = document.getElementById('drawer-volume-slider');

  function updatePlayerUI() {
    const playSvgHtml = scratchIsPlaying
      ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`
      : `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
    const drawerPlaySvgHtml = scratchIsPlaying
      ? `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`
      : `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;

    // Dashboard card components update
    if (dPlayBtn) dPlayBtn.innerHTML = playSvgHtml;
    if (dTrackName) dTrackName.textContent = scratchPlaylist[scratchCurrentIndex].name;

    // Bottom sliding drawer components update
    if (wPlayBtn) wPlayBtn.innerHTML = drawerPlaySvgHtml;
    if (wTrackName) wTrackName.textContent = scratchPlaylist[scratchCurrentIndex].name;
  }

  function loadScratchTrack(index, autoplay = true) {
    if (scratchPlaylist.length === 0) return;
    scratchCurrentIndex = index;
    scratchAudioObj.src = scratchPlaylist[scratchCurrentIndex].src;
    scratchAudioObj.load();
    updatePlayerUI();
    if (autoplay) {
      scratchAudioObj.play().then(() => {
        scratchIsPlaying = true;
        updatePlayerUI();
      }).catch(err => console.warn("Autoplay blocked/failed:", err));
    }
  }

  function toggleScratchPlay() {
    if (scratchPlaylist.length === 0) return;
    if (scratchIsPlaying) {
      scratchAudioObj.pause();
      scratchIsPlaying = false;
    } else {
      scratchAudioObj.play().then(() => {
        scratchIsPlaying = true;
      }).catch(err => console.error("Playback failed:", err));
    }
    updatePlayerUI();
  }

  function scratchNext() {
    loadScratchTrack((scratchCurrentIndex + 1) % scratchPlaylist.length, true);
  }

  function scratchPrev() {
    loadScratchTrack((scratchCurrentIndex - 1 + scratchPlaylist.length) % scratchPlaylist.length, true);
  }

  function formatTimeVal(secs) {
    if (isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  // Remove existing listeners on the global audio object to prevent duplication on view re-renders
  const newAudioObj = scratchAudioObj.cloneNode(true);
  scratchAudioObj.parentNode?.replaceChild(newAudioObj, scratchAudioObj);
  // Re-fetch clean references
  scratchAudioObj.replaceWith(scratchAudioObj.cloneNode(true));
  // Standard cloning mechanism for events refresh:
  const oldAudio = scratchAudioObj;
  scratchAudioObj = oldAudio.cloneNode(true);
  // Copy settings
  scratchAudioObj.volume = oldAudio.volume;
  scratchAudioObj.src = oldAudio.src;
  scratchAudioObj.currentTime = oldAudio.currentTime;
  if (scratchIsPlaying) {
    scratchAudioObj.play().catch(() => { });
  }

  // Set up synchronization listeners
  scratchAudioObj.addEventListener('timeupdate', () => {
    if (scratchAudioObj.duration) {
      const pct = (scratchAudioObj.currentTime / scratchAudioObj.duration) * 100;
      const formattedCurrent = formatTimeVal(scratchAudioObj.currentTime);
      const formattedTotal = formatTimeVal(scratchAudioObj.duration);

      // Synchronize dashboard widget time displays
      if (dProgressFill) dProgressFill.style.width = `${pct}%`;
      if (dTimeCurrent) dTimeCurrent.textContent = formattedCurrent;
      if (dTimeTotal) dTimeTotal.textContent = formattedTotal;

      // Synchronize bottom sliding drawer time displays
      if (wProgressFill) wProgressFill.style.width = `${pct}%`;
      if (wTimeCurrent) wTimeCurrent.textContent = formattedCurrent;
      if (wTimeTotal) wTimeTotal.textContent = formattedTotal;
    }
  });

  scratchAudioObj.addEventListener('loadedmetadata', () => {
    const formattedTotal = formatTimeVal(scratchAudioObj.duration);
    if (dTimeTotal) dTimeTotal.textContent = formattedTotal;
    if (wTimeTotal) wTimeTotal.textContent = formattedTotal;
  });

  scratchAudioObj.addEventListener('ended', () => {
    scratchNext();
  });

  // Attach controls listeners
  if (dPlayBtn) dPlayBtn.addEventListener('click', toggleScratchPlay);
  if (wPlayBtn) wPlayBtn.addEventListener('click', toggleScratchPlay);

  if (dNextBtn) dNextBtn.addEventListener('click', scratchNext);
  if (wNextBtn) wNextBtn.addEventListener('click', scratchNext);

  if (dPrevBtn) dPrevBtn.addEventListener('click', scratchPrev);
  if (wPrevBtn) wPrevBtn.addEventListener('click', scratchPrev);

  // Seek functionality on progress bar clicks
  function seekTrack(e, barElement) {
    if (!scratchAudioObj.duration || scratchPlaylist.length === 0) return;
    const rect = barElement.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    const percentage = Math.max(0, Math.min(1, clickX / width));
    scratchAudioObj.currentTime = percentage * scratchAudioObj.duration;
  }

  if (dProgressBar) dProgressBar.addEventListener('click', (e) => seekTrack(e, dProgressBar));
  if (wProgressBar) wProgressBar.addEventListener('click', (e) => seekTrack(e, wProgressBar));

  // Sync Volume control
  if (wVolumeSlider) {
    wVolumeSlider.value = scratchAudioObj.volume;
    wVolumeSlider.addEventListener('input', () => {
      scratchAudioObj.volume = wVolumeSlider.value;
    });
  }

  // Update visual state immediately
  updatePlayerUI();
}// Function to handle Add Subject Custom Modal popup
// =====================================================================
// Full-page Notes View (sidebar nav)
// =====================================================================
function renderNotesView() {
  viewContainer.innerHTML = `
    <div class="fade-in" style="display: flex; flex-direction: column; height: 100%; gap: 0;">
      <!-- Notes full-page layout -->
      <div style="display: flex; height: 100%; gap: 0; border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; box-shadow: var(--card-shadow);">
        <!-- Sidebar -->
        <div style="display: flex; flex-direction: column; width: 220px; flex-shrink: 0; border-right: 1px solid var(--border); background: var(--bg);">
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid var(--border);">
            <span style="font-size: 0.82rem; font-weight: 700; color: var(--text);">📝 Pages</span>
            <button class="tool-tile-btn" id="notes-new-page-btn">+ New</button>
          </div>
          <div class="notes-sidebar" id="notes-sidebar" style="width: 100%; flex: 1; overflow-y: auto;"></div>
        </div>
        <!-- Editor area -->
        <div style="display: flex; flex-direction: column; flex: 1; overflow: hidden; background: var(--surface);">
          <input class="notes-page-title-input" id="notes-page-title" placeholder="Page title..."
            style="padding: 14px 20px; font-size: 1rem; font-weight: 700; border-radius: 0; border-bottom: 1px solid var(--border);" />
          <textarea class="notes-textarea" id="notes-textarea" placeholder="Start writing here..."
            style="flex: 1; padding: 16px 20px; font-size: 0.88rem; line-height: 1.7;"></textarea>
        </div>
      </div>
    </div>
  `;
  initNotesTile();
}

// =====================================================================
// Full-page Whiteboard View (sidebar nav)
// =====================================================================
function renderWhiteboardView() {
  viewContainer.innerHTML = `
    <div class="fade-in" style="display: flex; flex-direction: column; height: 100%; gap: 0;">
      <div style="display: flex; flex-direction: column; height: 100%; border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; box-shadow: var(--card-shadow);">
        <!-- Whiteboard header toolbar -->
        <div class="tool-tile-header" style="padding: 10px 16px; border-radius: 0;">
          <span class="tool-tile-title" style="font-size: 0.88rem;">🎨 Whiteboard</span>
          <div class="tool-tile-header-actions">
            <div class="wb-board-nav">
              <button id="wb-prev-btn" title="Previous board">&#8249;</button>
              <span id="wb-board-label" style="min-width: 60px; text-align: center;">Board 1</span>
              <button id="wb-next-btn" title="Next board">&#8250;</button>
            </div>
            <button class="tool-tile-btn" id="wb-new-board-btn">+ Board</button>
          </div>
        </div>
        <!-- Canvas -->
        <div class="whiteboard-canvas-wrap" id="wb-canvas-wrap" style="flex: 1;">
          <canvas id="wb-canvas"></canvas>
        </div>
        <!-- Toolbar -->
        <div class="whiteboard-toolbar" style="padding: 8px 16px; gap: 10px;">
          <div class="wb-color-swatch active" style="background:#c0a6ff; width:20px; height:20px;" data-color="#c0a6ff" title="Purple"></div>
          <div class="wb-color-swatch" style="background:#60a5fa; width:20px; height:20px;" data-color="#60a5fa" title="Blue"></div>
          <div class="wb-color-swatch" style="background:#34d399; width:20px; height:20px;" data-color="#34d399" title="Green"></div>
          <div class="wb-color-swatch" style="background:#fb923c; width:20px; height:20px;" data-color="#fb923c" title="Orange"></div>
          <div class="wb-color-swatch" style="background:#f87171; width:20px; height:20px;" data-color="#f87171" title="Red"></div>
          <div class="wb-color-swatch" style="background:#facc15; width:20px; height:20px;" data-color="#facc15" title="Yellow"></div>
          <div class="wb-color-swatch" style="background:#f1f5f9; width:20px; height:20px;" data-color="#f1f5f9" title="White"></div>
          <div class="wb-color-swatch" style="background:#1e1b4b; width:20px; height:20px;" data-color="#1e1b4b" title="Dark"></div>
          <div class="wb-separator"></div>
          <span style="font-size: 0.72rem; color: var(--subtext);">Size</span>
          <input type="range" class="wb-size-slider" id="wb-size" min="1" max="30" value="3" title="Pen size" style="width: 80px;" />
          <div class="wb-separator"></div>
          <button class="wb-tool-btn" id="wb-eraser-btn" title="Eraser">⌫ Erase</button>
          <button class="wb-tool-btn" id="wb-undo-btn" title="Undo">↩ Undo</button>
          <button class="wb-tool-btn" id="wb-clear-btn" title="Clear board">🗑 Clear</button>
        </div>
      </div>
    </div>
  `;
  initWhiteboardTile();
}

// =====================================================================
// Notes Tile — multi-page notes with local storage
// =====================================================================
function initNotesTile() {
  const NOTES_KEY = 'focus_fox_notes';
  const sidebar = document.getElementById('notes-sidebar');
  const titleInput = document.getElementById('notes-page-title');
  const textarea = document.getElementById('notes-textarea');
  const newPageBtn = document.getElementById('notes-new-page-btn');

  if (!sidebar || !titleInput || !textarea || !newPageBtn) return;

  // Load or initialize
  let notesData = (() => {
    try { return JSON.parse(localStorage.getItem(NOTES_KEY)) || { pages: [], activeId: null }; }
    catch { return { pages: [], activeId: null }; }
  })();

  // Ensure at least one default page
  if (notesData.pages.length === 0) {
    const defaultId = Date.now().toString();
    notesData.pages.push({ id: defaultId, title: 'My Notes', content: '' });
    notesData.activeId = defaultId;
    save();
  }

  function save() {
    localStorage.setItem(NOTES_KEY, JSON.stringify(notesData));
  }

  function getActive() {
    return notesData.pages.find(p => p.id === notesData.activeId) || notesData.pages[0];
  }

  function renderSidebar() {
    sidebar.innerHTML = notesData.pages.map(p => `
      <div class="notes-page-item ${p.id === notesData.activeId ? 'active' : ''}" data-id="${p.id}">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${p.title || 'Untitled'}</span>
        <button class="del-page-btn" data-del="${p.id}" title="Delete page">×</button>
      </div>
    `).join('');

    // Page item click
    sidebar.querySelectorAll('.notes-page-item').forEach(item => {
      item.addEventListener('click', e => {
        if (e.target.closest('.del-page-btn')) return;
        saveCurrent();
        notesData.activeId = item.getAttribute('data-id');
        save();
        loadActive();
        renderSidebar();
      });
    });

    // Delete page click
    sidebar.querySelectorAll('.del-page-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const delId = btn.getAttribute('data-del');
        if (notesData.pages.length <= 1) return; // keep at least one
        notesData.pages = notesData.pages.filter(p => p.id !== delId);
        if (notesData.activeId === delId) {
          notesData.activeId = notesData.pages[0].id;
        }
        save();
        loadActive();
        renderSidebar();
      });
    });
  }

  function loadActive() {
    const page = getActive();
    if (!page) return;
    titleInput.value = page.title;
    textarea.value = page.content;
  }

  function saveCurrent() {
    const page = getActive();
    if (!page) return;
    page.title = titleInput.value || 'Untitled';
    page.content = textarea.value;
    save();
  }

  // Auto-save on input
  titleInput.addEventListener('input', () => {
    const page = getActive();
    if (page) { page.title = titleInput.value; save(); renderSidebar(); }
  });
  textarea.addEventListener('input', () => {
    const page = getActive();
    if (page) { page.content = textarea.value; save(); }
  });

  // New page button
  newPageBtn.addEventListener('click', () => {
    saveCurrent();
    const newId = Date.now().toString();
    notesData.pages.push({ id: newId, title: 'New Page', content: '' });
    notesData.activeId = newId;
    save();
    loadActive();
    renderSidebar();
  });

  // Initial render
  renderSidebar();
  loadActive();
}

// =====================================================================
// Whiteboard Tile — multi-board canvas drawing with undo + local save
// =====================================================================
function initWhiteboardTile() {
  const WB_KEY = 'focus_fox_whiteboards';
  const canvas = document.getElementById('wb-canvas');
  const wrap = document.getElementById('wb-canvas-wrap');
  const boardLabel = document.getElementById('wb-board-label');
  const prevBtn = document.getElementById('wb-prev-btn');
  const nextBtn = document.getElementById('wb-next-btn');
  const newBoardBtn = document.getElementById('wb-new-board-btn');
  const eraserBtn = document.getElementById('wb-eraser-btn');
  const undoBtn = document.getElementById('wb-undo-btn');
  const clearBtn = document.getElementById('wb-clear-btn');
  const sizeSlider = document.getElementById('wb-size');

  if (!canvas || !wrap) return;

  const ctx = canvas.getContext('2d');
  let boards = (() => {
    try { return JSON.parse(localStorage.getItem(WB_KEY)) || [{ name: 'Board 1', dataUrl: null }]; }
    catch { return [{ name: 'Board 1', dataUrl: null }]; }
  })();
  let currentBoardIdx = 0;
  let currentColor = '#c0a6ff';
  let penSize = 3;
  let isErasing = false;
  let isDrawing = false;
  let lastX = 0, lastY = 0;
  let undoStack = [];

  function resizeCanvas() {
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w === 0 || h === 0) return;
    // Save current drawing
    const snapshot = canvas.toDataURL();
    canvas.width = w;
    canvas.height = h;
    // Restore drawing
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0);
    img.src = snapshot;
  }

  function saveBoard() {
    if (boards[currentBoardIdx]) {
      boards[currentBoardIdx].dataUrl = canvas.toDataURL();
      localStorage.setItem(WB_KEY, JSON.stringify(boards));
    }
  }

  function loadBoard(idx) {
    currentBoardIdx = idx;
    undoStack = [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const board = boards[idx];
    if (board && board.dataUrl) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = board.dataUrl;
    }
    if (boardLabel) boardLabel.textContent = board ? board.name : `Board ${idx + 1}`;
  }

  function pushUndo() {
    undoStack.push(canvas.toDataURL());
    if (undoStack.length > 30) undoStack.shift();
  }

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if (e.touches) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  function startDraw(e) {
    e.preventDefault();
    pushUndo();
    isDrawing = true;
    const pos = getPos(e);
    lastX = pos.x; lastY = pos.y;
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
  }

  function draw(e) {
    if (!isDrawing) return;
    e.preventDefault();
    const pos = getPos(e);
    ctx.lineWidth = isErasing ? penSize * 4 : penSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = isErasing ? 'rgba(0,0,0,1)' : currentColor;
    ctx.globalCompositeOperation = isErasing ? 'destination-out' : 'source-over';
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    lastX = pos.x; lastY = pos.y;
  }

  function endDraw(e) {
    if (!isDrawing) return;
    isDrawing = false;
    ctx.globalCompositeOperation = 'source-over';
    saveBoard();
  }

  // Canvas events
  canvas.addEventListener('mousedown', startDraw);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mouseup', endDraw);
  canvas.addEventListener('mouseleave', endDraw);
  canvas.addEventListener('touchstart', startDraw, { passive: false });
  canvas.addEventListener('touchmove', draw, { passive: false });
  canvas.addEventListener('touchend', endDraw);

  // Color swatches
  document.querySelectorAll('.wb-color-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      document.querySelectorAll('.wb-color-swatch').forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
      currentColor = swatch.getAttribute('data-color');
      isErasing = false;
      if (eraserBtn) eraserBtn.classList.remove('active');
    });
  });

  // Size slider
  if (sizeSlider) sizeSlider.addEventListener('input', () => { penSize = parseInt(sizeSlider.value); });

  // Eraser
  if (eraserBtn) eraserBtn.addEventListener('click', () => {
    isErasing = !isErasing;
    eraserBtn.classList.toggle('active', isErasing);
  });

  // Undo
  if (undoBtn) undoBtn.addEventListener('click', () => {
    if (undoStack.length === 0) return;
    const prev = undoStack.pop();
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      saveBoard();
    };
    img.src = prev;
  });

  // Clear
  if (clearBtn) clearBtn.addEventListener('click', () => {
    pushUndo();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    saveBoard();
  });

  // Board navigation
  if (prevBtn) prevBtn.addEventListener('click', () => {
    saveBoard();
    const newIdx = (currentBoardIdx - 1 + boards.length) % boards.length;
    loadBoard(newIdx);
  });
  if (nextBtn) nextBtn.addEventListener('click', () => {
    saveBoard();
    const newIdx = (currentBoardIdx + 1) % boards.length;
    loadBoard(newIdx);
  });
  if (newBoardBtn) newBoardBtn.addEventListener('click', () => {
    saveBoard();
    const newName = `Board ${boards.length + 1}`;
    boards.push({ name: newName, dataUrl: null });
    localStorage.setItem(WB_KEY, JSON.stringify(boards));
    loadBoard(boards.length - 1);
  });

  // Init canvas size and load first board
  resizeCanvas();
  // Use ResizeObserver to handle container resize
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => {
      saveBoard();
      resizeCanvas();
      loadBoard(currentBoardIdx);
    });
    ro.observe(wrap);
  }
  loadBoard(0);
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

// Function to handle Enrolled Subjects Customizer popup
async function openEnrolledSubjectsModal() {
  const modal = document.getElementById('enrolled-subjects-modal');
  const closeBtn = document.getElementById('enrolled-close-btn');
  const listContainer = document.getElementById('enrolled-subjects-list-container');
  const quickSelect = document.getElementById('quick-enroll-select');
  const quickBtn = document.getElementById('quick-enroll-btn');

  if (!modal || !closeBtn || !listContainer || !quickSelect || !quickBtn) return;

  // Show modal
  modal.style.display = 'flex';

  const branch = store.selectedBranch;
  const semester = store.selectedSemester;
  const removedKey = `focus_fox_removed_subjects_${branch.id}_${semester}`;
  const addedKey = `focus_fox_added_subjects_${branch.id}_${semester}`;

  const refreshList = async () => {
    // Get current lists from localStorage
    const removedIds = JSON.parse(localStorage.getItem(removedKey) || '[]');
    const addedSubjects = JSON.parse(localStorage.getItem(addedKey) || '[]');

    // Get database subjects
    let subjects = await supabaseClient.getSubjectsBySemester(branch.id, semester);
    if (!subjects) subjects = [];

    // Filter out removed ones
    let enrolled = subjects.filter(s => !removedIds.includes(s.id));
    // Append custom added ones
    const currentIds = new Set(enrolled.map(s => s.id));
    addedSubjects.forEach(s => {
      if (!currentIds.has(s.id)) {
        enrolled.push(s);
      }
    });

    // 1. Render currently enrolled subjects list
    if (enrolled.length === 0) {
      listContainer.innerHTML = `<p style="color: var(--subtext); font-size: 0.85rem; text-align: center; margin: 20px 0;">No subjects enrolled.</p>`;
    } else {
      let listHtml = '';
      enrolled.forEach(subj => {
        listHtml += `
          <div class="modal-subject-row" style="display: flex; justify-content: space-between; align-items: center; background: var(--bg); border: 1px solid var(--border); padding: 8px 12px; border-radius: var(--radius-md);">
            <div class="modal-subject-info">
              <span class="modal-subject-code" style="font-size: 0.75rem; color: var(--primary); font-weight: 700; display: block;">${subj.code}</span>
              <span class="modal-subject-title" style="font-size: 0.85rem; color: var(--text); font-weight: 500;">${subj.name}</span>
            </div>
            <button class="modal-subject-remove-btn" data-id="${subj.id}" title="Remove Subject" style="background: none; border: none; color: #ef4444; cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center; transition: var(--transition-fast);">
              <svg viewBox="0 0 24 24" style="width: 16px; height: 16px; stroke: currentColor; stroke-width: 2.5; fill: none;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
        `;
      });
      listContainer.innerHTML = listHtml;

      // Attach subtract event listeners
      listContainer.querySelectorAll('.modal-subject-remove-btn').forEach(btn => {
        btn.onclick = () => {
          const sId = btn.getAttribute('data-id');

          let added = JSON.parse(localStorage.getItem(addedKey) || '[]');
          const isCustomSubj = added.some(s => s.id === sId);
          if (isCustomSubj) {
            added = added.filter(s => s.id !== sId);
            localStorage.setItem(addedKey, JSON.stringify(added));
          } else {
            let removed = JSON.parse(localStorage.getItem(removedKey) || '[]');
            if (!removed.includes(sId)) {
              removed.push(sId);
              localStorage.setItem(removedKey, JSON.stringify(removed));
            }
          }

          // Refresh the modal content and the dashboard view
          refreshList();
          renderSubjectsView();
        };
      });
    }

    // 2. Populate quick enroll select with available subjects from current branch/semester
    const currentEnrolledIds = new Set(enrolled.map(s => s.id));
    const availableToEnroll = subjects.filter(s => !currentEnrolledIds.has(s.id));

    if (availableToEnroll.length === 0) {
      quickSelect.innerHTML = `<option value="" disabled selected>All semester subjects enrolled</option>`;
      quickBtn.disabled = true;
    } else {
      let options = `<option value="" disabled selected>-- Select to enroll --</option>`;
      availableToEnroll.forEach(s => {
        options += `<option value="${s.id}">${s.code} - ${s.name}</option>`;
      });
      quickSelect.innerHTML = options;
      quickBtn.disabled = false;
    }
  };

  // Initial list refresh
  await refreshList();

  // Quick enroll submit
  quickBtn.onclick = () => {
    const selectedId = quickSelect.value;
    if (!selectedId) return;

    // Remove from local removed list if it was a default subject
    let removed = JSON.parse(localStorage.getItem(removedKey) || '[]');
    if (removed.includes(selectedId)) {
      removed = removed.filter(id => id !== selectedId);
      localStorage.setItem(removedKey, JSON.stringify(removed));
    }

    refreshList();
    renderSubjectsView();
  };

  // Close handlers
  const closeModal = () => {
    modal.style.display = 'none';
  };

  closeBtn.onclick = closeModal;
  modal.onclick = (e) => {
    if (e.target === modal) closeModal();
  };
}

// Function to handle Heatmap Analytics popup
function openHeatmapAnalyticsModal(subjectsData = [], overallProgressPercentage = 86) {
  const modal = document.getElementById('heatmap-analytics-modal');
  const closeBtn = document.getElementById('heatmap-close-btn');

  if (!modal || !closeBtn) return;

  // Show modal
  modal.style.display = 'flex';

  // Calculate total study time from subjects
  let totalMinutes = 0;
  if (Array.isArray(subjectsData) && subjectsData.length > 0) {
    subjectsData.forEach(subj => {
      const timeStr = subj.studyTime || '';
      const matchHoursMins = timeStr.match(/(\d+)\s*h\s*(\d+)\s*m/i);
      const matchHoursOnly = timeStr.match(/(\d+)\s*h/i);
      const matchMinsOnly = timeStr.match(/(\d+)\s*m/i);

      if (matchHoursMins) {
        totalMinutes += parseInt(matchHoursMins[1], 10) * 60 + parseInt(matchHoursMins[2], 10);
      } else if (matchHoursOnly) {
        totalMinutes += parseInt(matchHoursOnly[1], 10) * 60;
      } else if (matchMinsOnly) {
        totalMinutes += parseInt(matchMinsOnly[1], 10);
      }
    });
  }

  const totalHoursVal = (totalMinutes / 60).toFixed(1);
  const consistencyIndex = overallProgressPercentage !== undefined ? overallProgressPercentage : 0;

  // Calculate longest study streak dynamically from history
  let streakDays = 0;
  try {
    const historyObj = JSON.parse(localStorage.getItem('focus_fox_study_history') || '{}');
    const activeDates = Object.keys(historyObj)
      .filter(dateStr => historyObj[dateStr] > 0)
      .map(dateStr => {
        const parts = dateStr.split('-');
        if (parts.length === 3) {
          return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        }
        return new Date(dateStr);
      })
      .filter(d => !isNaN(d.getTime()))
      .sort((a, b) => a - b);

    let maxStreak = 0;
    let currentStreak = 0;
    let lastDate = null;

    activeDates.forEach(date => {
      date.setHours(0, 0, 0, 0);
      if (lastDate === null) {
        currentStreak = 1;
      } else {
        const diffTime = date.getTime() - lastDate.getTime();
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays === 1) {
          currentStreak++;
        } else if (diffDays > 1) {
          if (currentStreak > maxStreak) {
            maxStreak = currentStreak;
          }
          currentStreak = 1;
        }
      }
      lastDate = date;
    });

    if (currentStreak > maxStreak) {
      maxStreak = currentStreak;
    }
    streakDays = maxStreak;
  } catch (err) {
    console.error('Error calculating streak:', err);
    streakDays = 0;
  }

  // Update modal stat displays
  const hoursEl = modal.querySelector('.analytics-grid > div:nth-child(1) .stat-number-val');
  if (hoursEl) hoursEl.textContent = `${totalHoursVal} Hours`;

  const consistencyEl = modal.querySelector('.analytics-grid > div:nth-child(2) .stat-number-val');
  if (consistencyEl) consistencyEl.textContent = `${consistencyIndex}%`;

  const streakEl = modal.querySelector('.analytics-grid > div:nth-child(3) .stat-number-val');
  if (streakEl) streakEl.textContent = `${streakDays} Days`;

  // Weekly trend distribution
  const trendContainer = modal.querySelector('.modal-body > div:last-child > div');
  if (trendContainer) {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const ratios = [0.15, 0.1, 0.2, 0.05, 0.15, 0.25, 0.1];
    trendContainer.innerHTML = days.map((day, idx) => {
      const mins = Math.round(totalMinutes * ratios[idx]);
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      const timeDisplay = h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`;
      return `<span>${day.slice(0, 3)}: ${timeDisplay}</span>`;
    }).join('');
  }

  // Ensure calendar container exists in modal-body
  let calendarContainer = document.getElementById('modal-calendar-container');
  if (!calendarContainer) {
    const modalBody = modal.querySelector('.modal-body');
    if (modalBody) {
      calendarContainer = document.createElement('div');
      calendarContainer.id = 'modal-calendar-container';
      calendarContainer.style.background = 'var(--bg)';
      calendarContainer.style.border = '1px solid var(--border)';
      calendarContainer.style.borderRadius = 'var(--radius-md)';
      calendarContainer.style.padding = '16px';
      calendarContainer.style.display = 'flex';
      calendarContainer.style.flexDirection = 'column';
      calendarContainer.style.gap = '12px';

      // Insert right after the top analytics-grid
      const analyticsGrid = modalBody.querySelector('.analytics-grid');
      if (analyticsGrid && analyticsGrid.nextSibling) {
        modalBody.insertBefore(calendarContainer, analyticsGrid.nextSibling);
      } else {
        modalBody.appendChild(calendarContainer);
      }
    }
  }

  const renderModalCalendar = (range = "This Month") => {
    if (!calendarContainer) return;
    const data = generateCalendarHeatmapHtml(range, false); // false = large calendar with day numbers

    calendarContainer.innerHTML = `
      <div class="activity-header" style="margin-bottom: 0; display: flex; justify-content: space-between; align-items: center; border: none; background: transparent; padding: 0;">
        <div style="display: flex; flex-direction: column;">
          <span class="activity-title" style="font-size: 0.95rem; font-weight: 700; color: var(--text);">Study Activity Heatmap</span>
          <span class="activity-subtitle" style="font-size: 0.78rem; color: var(--subtext); margin-top: 2px;">${data.monthName} ${data.year}</span>
        </div>
        <select class="activity-select" id="modal-activity-select" style="padding: 4px 8px; font-size: 0.78rem;">
          <option ${range === 'This Month' ? 'selected' : ''}>This Month</option>
          <option ${range === 'Last Month' ? 'selected' : ''}>Last Month</option>
        </select>
      </div>
      
      <div class="heatmap-container modal-calendar" style="border: none; background: transparent; padding: 0;">
        <div class="heatmap-wrapper">
          <div class="heatmap-grid modal-calendar-grid">
            ${data.headersHtml}
            ${data.cellsHtml}
          </div>
        </div>
        <div class="heatmap-legend" style="margin-top: 6px;">
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
    `;

    // Listen to dropdown changes inside the modal
    const modalSelect = document.getElementById('modal-activity-select');
    if (modalSelect) {
      modalSelect.onchange = (e) => {
        renderModalCalendar(e.target.value);
      };
    }
  };

  // Initial render
  renderModalCalendar("This Month");

  // Close handlers
  const closeModal = () => {
    modal.style.display = 'none';
  };

  closeBtn.onclick = closeModal;
  modal.onclick = (e) => {
    if (e.target === modal) closeModal();
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

  // Start subject page time tracker — logs 1 min every 60s while on this page
  if (subjectPageTimerInterval) clearInterval(subjectPageTimerInterval);
  subjectPageTimerInterval = setInterval(() => {
    if (store.selectedSubject) {
      const timeKey = `focus_fox_study_time_${store.selectedSubject.id}`;
      let current = localStorage.getItem(timeKey) || '0m studied';
      let mins = 0;
      const mhm = current.match(/(\d+)\s*h\s*(\d+)\s*m/i);
      const mho = current.match(/(\d+)\s*h/i);
      const mmo = current.match(/(\d+)\s*m/i);
      if (mhm) mins = parseInt(mhm[1]) * 60 + parseInt(mhm[2]);
      else if (mho) mins = parseInt(mho[1]) * 60;
      else if (mmo) mins = parseInt(mmo[1]);
      mins += 1;
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      const newStr = h > 0 ? `${h}h ${m}m studied` : `${m}m studied`;
      localStorage.setItem(timeKey, newStr);
      // Also log to global study history
      store.logStudyMinutes(1);
    }
  }, 60000);
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

  // Set up container structure once
  container.innerHTML = `
    <div class="topics-controls">
      <div class="sort-label">Sort Topics:</div>
      <div class="sort-group">
        <button class="sort-btn" id="btn-sort-syllabus">
          Syllabus Order
        </button>
        <button class="sort-btn" id="btn-sort-importance">
          Importance Order
        </button>
      </div>
    </div>
    <div class="topics-list"></div>
  `;

  const topicsListContainer = container.querySelector('.topics-list');
  const btnSyllabus = container.querySelector('#btn-sort-syllabus');
  const btnImportance = container.querySelector('#btn-sort-importance');

  function renderList() {
    // Update active class on sort buttons
    if (activeTopicSort === 'syllabus') {
      if (btnSyllabus) btnSyllabus.classList.add('active');
      if (btnImportance) btnImportance.classList.remove('active');
    } else {
      if (btnSyllabus) btnSyllabus.classList.remove('active');
      if (btnImportance) btnImportance.classList.add('active');
    }

    const activeTopics = activeTopicSort === 'importance' ? importanceOrder : syllabusOrder;

    let topicsHtml = '';
    activeTopics.forEach((topic) => {
      const isCompleted = store.isTopicCompleted(topic.id);
      const score = topic.importanceScore || 0;
      const percentage = Math.min(100, Math.max(0, Math.round(score)));

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
                    <div class="importance-fill" data-percentage="${percentage}"></div>
                  </div>
                </div>
              </div>
            </div>
            <div class="topic-actions">
              <div class="importance-percentage-badge">${percentage}%</div>
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

    topicsListContainer.innerHTML = topicsHtml;

    // Set importance bar widths programmatically
    topicsListContainer.querySelectorAll('.importance-fill').forEach(fill => {
      const pct = fill.getAttribute('data-percentage');
      fill.style.width = pct + '%';
    });

    // Bind accordion click handlers
    topicsListContainer.querySelectorAll('.topic-header').forEach(header => {
      header.addEventListener('click', (e) => {
        if (e.target.closest('.topic-checkbox')) return;

        const card = header.closest('.topic-card');
        const isOpen = card.classList.contains('open');

        // Close others
        topicsListContainer.querySelectorAll('.topic-card').forEach(c => c.classList.remove('open'));

        if (!isOpen) {
          card.classList.add('open');
          const topicId = card.getAttribute('data-id');
          loadTopicResources(topicId);
        }
      });
    });

    // Bind checkbox toggle click handlers
    topicsListContainer.querySelectorAll('.topic-checkbox').forEach(box => {
      box.addEventListener('click', () => {
        const topicId = box.getAttribute('data-topic-id');
        store.toggleTopicCompletion(topicId);
        box.classList.toggle('completed');
      });
    });

    // Practice Topic button click handlers
    topicsListContainer.querySelectorAll('.topic-start-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const topicId = btn.getAttribute('data-topic-id');
        const topic = topics.find(t => t.id === topicId);
        store.selectedTopic = topic;
        store.navigateTo('question-list');
      });
    });
  }

  // Bind sort controls click handlers
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

  // Initial render
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
    'Array': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="7" y1="5" x2="7" y2="19"/><line x1="12" y1="5" x2="12" y2="19"/><line x1="17" y1="5" x2="17" y2="19"/></svg>`,
    'String': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h10M4 17h6"/></svg>`,
    'Linked List': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="12" r="3"/><circle cx="19" cy="12" r="3"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`,
    'Tree': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v6M5 8h14M8 8v2a4 4 0 0 0 8 0V8"/><circle cx="5" cy="17" r="3"/><circle cx="12" cy="17" r="3"/><circle cx="19" cy="17" r="3"/></svg>`,
    'Graph': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="12" cy="19" r="2"/><line x1="7" y1="5" x2="17" y2="5"/><line x1="5.7" y1="7" x2="11" y2="17"/><line x1="18.3" y1="7" x2="13" y2="17"/></svg>`,
    'Dynamic Programming': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/></svg>`,
    'Recursion': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><polyline points="3 3 3 8 8 8"/></svg>`,
    'Searching': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    'Sorting': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="8" y2="18"/></svg>`,
    'Stack': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,
    'Queue': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
    'Hash Map': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>`,
    'Binary Search': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`,
    'Two Pointers': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 8 22 12 18 16"/><polyline points="6 8 2 12 6 16"/><line x1="2" y1="12" x2="22" y2="12"/></svg>`,
    'Sliding Window': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="10" height="10" rx="1"/><line x1="16" y1="7" x2="22" y2="7"/><line x1="16" y1="12" x2="22" y2="12"/><line x1="16" y1="17" x2="22" y2="17"/></svg>`,
    'Backtracking': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>`,
    'Greedy': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`,
    'Heap': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 19h20L12 2z"/><line x1="12" y1="8" x2="12" y2="14"/></svg>`,
    'Trie': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="4" r="2"/><circle cx="5" cy="14" r="2"/><circle cx="12" cy="14" r="2"/><circle cx="19" cy="14" r="2"/><line x1="12" y1="6" x2="5" y2="12"/><line x1="12" y1="6" x2="12" y2="12"/><line x1="12" y1="6" x2="19" y2="12"/></svg>`,
    'Math': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`
  };
  const defaultIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;

  const topicsData = await Promise.all(topics.map(async (topic) => {
    const questions = await supabaseClient.getLeetcodeByTopic(topic);
    const totalCount = questions.length;
    const solvedCount = questions.filter(q => store.isQuestionSolved(q.id)).length;
    return {
      name: topic,
      totalCount,
      solvedCount
    };
  }));

  const totalSolved = topicsData.reduce((acc, t) => acc + t.solvedCount, 0);
  const totalQuestions = topicsData.reduce((acc, t) => acc + t.totalCount, 0);

  // Filter topics with solved questions > 0
  const activeSolvedTopics = topicsData.filter(t => t.solvedCount > 0);

  // Color palette for chart segments
  const colors = ['#f59e0b', '#10b981', '#3b82f6', '#ec4899', '#8b5cf6', '#ef4444', '#06b6d4', '#a855f7'];

  // --- RING CHART CONFIG ---
  const svgSize = 340;
  const center = svgSize / 2;   // 170
  const radius = 120;
  const strokeW = 36;
  const circumference = 2 * Math.PI * radius; // ~753.98
  const gapSize = 38; // large gap so round caps never overlap

  // Helper: adjust a hex color brightness (positive = lighter, negative = darker)
  function shiftColor(hex, amt) {
    let c = parseInt(hex.replace('#', ''), 16);
    let r = Math.min(255, Math.max(0, (c >> 16) + amt));
    let g = Math.min(255, Math.max(0, ((c >> 8) & 0xFF) + amt));
    let b = Math.min(255, Math.max(0, (c & 0xFF) + amt));
    return `rgb(${r},${g},${b})`;
  }

  let chartDefsHtml = '';
  let chartCirclesHtml = '';

  // Background track ring
  chartCirclesHtml += `<circle class="ring-track" cx="${center}" cy="${center}" r="${radius}" />`;

  if (totalSolved === 0) {
    chartCirclesHtml += `<circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="var(--border)" stroke-width="${strokeW}" opacity="0.3" />`;
  } else {
    const numSegments = activeSolvedTopics.length;
    const totalGapSpace = numSegments > 1 ? numSegments * gapSize : 0;
    const usableCircumference = circumference - totalGapSpace;

    let currentOffset = 0;
    activeSolvedTopics.forEach((t, i) => {
      const percentage = t.solvedCount / totalSolved;
      const segmentLength = percentage * usableCircumference;
      const baseColor = colors[i % colors.length];
      const highlight = shiftColor(baseColor, 60);
      const shadow = shiftColor(baseColor, -40);

      // Glow filter per segment
      chartDefsHtml += `
        <filter id="ring-glow-${i}" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur"/>
          <feMerge>
            <feMergeNode in="blur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      `;

      // Shadow layer (darker, slightly thicker, offset outward) — 3D depth
      chartCirclesHtml += `
        <circle cx="${center}" cy="${center}" r="${radius}"
                fill="none" stroke="${shadow}" stroke-width="${strokeW + 4}"
                stroke-linecap="round"
                stroke-dasharray="${segmentLength} ${circumference}"
                stroke-dashoffset="${-currentOffset}"
                transform="rotate(-90 ${center} ${center})"
                opacity="0.45"
                style="pointer-events:none;" />
      `;

      // Main segment
      chartCirclesHtml += `
        <circle class="ring-segment"
                cx="${center}" cy="${center}" r="${radius}"
                stroke="${baseColor}"
                stroke-dasharray="${segmentLength} ${circumference}"
                stroke-dashoffset="${-currentOffset}"
                transform="rotate(-90 ${center} ${center})"
                filter="url(#ring-glow-${i})"
                data-topic="${t.name}"
                data-solved="${t.solvedCount}" />
      `;

      // Highlight layer (lighter, thinner, offset inward) — 3D shine
      chartCirclesHtml += `
        <circle cx="${center}" cy="${center}" r="${radius - 6}"
                fill="none" stroke="${highlight}" stroke-width="8"
                stroke-linecap="round"
                stroke-dasharray="${segmentLength} ${circumference}"
                stroke-dashoffset="${-currentOffset}"
                transform="rotate(-90 ${center} ${center})"
                opacity="0.35"
                style="pointer-events:none;" />
      `;

      currentOffset += segmentLength + gapSize;
    });
  }

  const chartSegmentsHtml = `<defs>${chartDefsHtml}</defs>${chartCirclesHtml}`;


  const cardsHtml = topicsData.map((topic) => {
    const icon = topicIcons[topic.name] || defaultIcon;
    return `
      <div class="algo-topic-card fade-in" data-topic="${topic.name}">
        <div class="algo-topic-icon">${icon}</div>
        <div class="algo-topic-details" style="display: flex; flex-direction: column; gap: 4px; flex-grow: 1;">
          <div class="algo-topic-name">${topic.name}</div>
          <div class="algo-topic-solved" style="font-size: 0.82rem; color: var(--subtext); font-weight: 600;">Solved: ${topic.solvedCount}/${topic.totalCount}</div>
        </div>
        <div class="algo-topic-arrow">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </div>
      </div>
    `;
  }).join('');

  viewContainer.innerHTML = `
    <!-- Tooltip for ring chart -->
    <div id="ring-chart-tooltip"></div>

    <!-- Header outside grid so columns start at the exact same vertical level -->
    <div class="algo-topics-header fade-in" style="margin-bottom: 12px;">
      <h2 style="margin: 0;">Choose a Topic</h2>
    </div>

    <div class="algo-dashboard-layout" style="display: grid; grid-template-columns: 1.25fr 0.75fr; gap: 32px; align-items: start; width: 100%;">
      <!-- Left Side: Topics Grid (aligned with first row) -->
      <div class="algo-topics-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px;">
        ${cardsHtml}
      </div>

      <!-- Right Side: Analytics and Companies Stack -->
      <div style="display: flex; flex-direction: column; gap: 24px; position: sticky; top: 20px; z-index: 5;">
        <!-- Container 1: Progress Analytics -->
        <div class="algo-analytics-panel fade-in" style="background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 28px; box-shadow: var(--card-shadow); display: flex; flex-direction: column; align-items: center; gap: 24px;">
           <h3 style="font-size: 1.1rem; font-weight: 700; color: var(--text); align-self: flex-start; margin: 0;">Progress Analytics</h3>
           
           <!-- Big modern liquid doughnut chart -->
           <div class="ring-chart-wrapper">
             <!-- Animated glow pulse -->
             <div class="ring-glow-pulse"></div>
             <!-- Liquid shimmer overlay -->
             <div class="ring-liquid-shimmer"></div>
             <!-- SVG Ring -->
             <svg class="ring-chart-svg" viewBox="0 0 ${svgSize} ${svgSize}" style="position: relative; z-index: 1;">
               ${chartSegmentsHtml}
             </svg>
             <!-- Center label -->
             <div class="ring-center-label">
               <span class="ring-center-count">${totalSolved}</span>
               <span class="ring-center-subtitle">Solved</span>
             </div>
           </div>
        </div>

        <!-- Container 2: Target Companies -->
        <div class="algo-companies-panel fade-in" style="background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 24px 28px; box-shadow: var(--card-shadow);">
           <h4 style="font-size: 0.78rem; font-weight: 700; color: var(--subtext); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.8px;">Target Companies</h4>
           <div style="display: flex; flex-wrap: wrap; gap: 8px;">
             <span class="company-badge" style="background: var(--bg); border: 1px solid var(--border); padding: 6px 12px; border-radius: 30px; font-size: 0.75rem; font-weight: 600; color: var(--text); display: flex; align-items: center; gap: 6px;"><span style="color: #4285F4; font-weight: 800;">G</span> Google</span>
             <span class="company-badge" style="background: var(--bg); border: 1px solid var(--border); padding: 6px 12px; border-radius: 30px; font-size: 0.75rem; font-weight: 600; color: var(--text); display: flex; align-items: center; gap: 6px;"><span style="color: #F25022; font-weight: 800;">M</span> Microsoft</span>
             <span class="company-badge" style="background: var(--bg); border: 1px solid var(--border); padding: 6px 12px; border-radius: 30px; font-size: 0.75rem; font-weight: 600; color: var(--text); display: flex; align-items: center; gap: 6px;"><span style="color: #FF9900; font-weight: 800;">a</span> Amazon</span>
             <span class="company-badge" style="background: var(--bg); border: 1px solid var(--border); padding: 6px 12px; border-radius: 30px; font-size: 0.75rem; font-weight: 600; color: var(--text); display: flex; align-items: center; gap: 6px;"><span style="color: #0668E1; font-weight: 800;">∞</span> Meta</span>
             <span class="company-badge" style="background: var(--bg); border: 1px solid var(--border); padding: 6px 12px; border-radius: 30px; font-size: 0.75rem; font-weight: 600; color: var(--text); display: flex; align-items: center; gap: 6px;"><span style="color: #E50914; font-weight: 800;">N</span> Netflix</span>
           </div>
        </div>
      </div>
    </div>
  `;

  // Attach hover events to ring chart segments
  const segments = viewContainer.querySelectorAll('.ring-segment');
  const tooltip = document.getElementById('ring-chart-tooltip');

  segments.forEach(seg => {
    seg.addEventListener('mouseenter', (e) => {
      // Scale up stroke on hover handled by CSS, but add brightness
      seg.style.strokeWidth = '44';
      seg.style.filter = `drop-shadow(0 6px 24px rgba(0,0,0,0.4)) brightness(1.2)`;

      const topicName = seg.getAttribute('data-topic');
      const solvedCount = seg.getAttribute('data-solved');

      if (tooltip) {
        tooltip.innerHTML = `${topicName} <span style="margin: 0 6px; color: var(--primary);">→</span> ${solvedCount} Solved`;
        tooltip.style.display = 'block';
        tooltip.style.opacity = '1';
      }
    });

    seg.addEventListener('mousemove', (e) => {
      if (tooltip) {
        const rect = viewContainer.getBoundingClientRect();
        tooltip.style.left = `${e.clientX - rect.left + 18}px`;
        tooltip.style.top = `${e.clientY - rect.top - 18}px`;
      }
    });

    seg.addEventListener('mouseleave', () => {
      seg.style.strokeWidth = '';
      seg.style.filter = '';
      if (tooltip) {
        tooltip.style.display = 'none';
        tooltip.style.opacity = '0';
      }
    });
  });

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
  const easy = questions.filter(q => q.difficulty?.toLowerCase() === 'easy');
  const medium = questions.filter(q => q.difficulty?.toLowerCase() === 'medium');
  const hard = questions.filter(q => q.difficulty?.toLowerCase() === 'hard');

  function renderCol(qs, label, cls) {
    if (qs.length === 0) {
      return `<div class="algo-col-empty"><span class="algo-diff-badge ${cls}">${label}</span><p>No ${label} questions yet</p></div>`;
    }
    const rows = qs.map((q, i) => {
      const isSolved = store.isQuestionSolved(q.id);
      return `
        <div class="algo-question-row" data-id="${q.id}" style="display: flex; align-items: center; gap: 12px; padding: 12px 20px;">
          <input type="checkbox" class="algo-q-checkbox" data-id="${q.id}" ${isSolved ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer; accent-color: var(--primary);" />
          <span class="algo-q-num" style="margin-left: 4px;">${i + 1}</span>
          <span class="algo-q-name" style="${isSolved ? 'text-decoration: line-through; opacity: 0.6;' : ''}">${q.question_name}</span>
          <svg class="algo-q-arrow" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </div>
      `;
    }).join('');
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
    row.addEventListener('click', (e) => {
      if (e.target.classList.contains('algo-q-checkbox')) return;
      const qId = row.getAttribute('data-id');
      const q = questions.find(x => x.id === qId);
      showAlgoQuestionPopup(q);
    });

    const checkbox = row.querySelector('.algo-q-checkbox');
    if (checkbox) {
      checkbox.addEventListener('click', (e) => {
        e.stopPropagation();
      });
      checkbox.addEventListener('change', () => {
        const qId = checkbox.getAttribute('data-id');
        store.toggleQuestionSolved(qId);

        const qNameSpan = row.querySelector('.algo-q-name');
        if (qNameSpan) {
          if (checkbox.checked) {
            qNameSpan.style.textDecoration = 'line-through';
            qNameSpan.style.opacity = '0.6';
          } else {
            qNameSpan.style.textDecoration = 'none';
            qNameSpan.style.opacity = '1';
          }
        }
      });
    }
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

  // View Question — open LeetCode in in-app webview
  document.getElementById('algo-btn-view-q').addEventListener('click', () => {
    if (hasLink) {
      store.algoSelectedQuestion = q;
      store.leetcodeUrl = q.question_link;
      overlay.remove();
      store.navigateTo('leetcode-webview');
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

  // Render main layout skeleton with collapsible question panel and resizer
  viewContainer.innerHTML = `
    <div class="sol-layout-with-panel" id="sol-layout-container">
      <!-- Collapsible Question Panel (hidden by default) -->
      <div class="sol-question-panel" id="sol-question-panel">
        <div class="sol-question-panel-header" style="justify-content: flex-end;">
          <button class="sol-panel-open-lc-btn" id="sol-panel-open-lc" title="Open on LeetCode">
            Open on LeetCode ↗
          </button>
          <button class="sol-panel-close-btn" id="sol-panel-close" title="Close question panel" style="margin-left: 12px;">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="sol-question-panel-body lc-question-content" id="sol-panel-body">
          <div class="fox-loader" style="height:40vh;">
            <div class="fox-loader-icon">
              <img src="/assets/Foxy.png" alt="🦊" onerror="this.outerHTML='🦊'" />
            </div>
            <div class="fox-loader-dots"><span></span><span></span><span></span></div>
            <span class="fox-loader-text">Loading question...</span>
          </div>
        </div>
      </div>

      <!-- Resizer Handle -->
      <div class="sol-panel-resizer" id="sol-panel-resizer"></div>

      <!-- Solution content area -->
      <div class="sol-content-area" id="sol-content-area">
        <!-- Toggle tab to open question panel -->
        <button class="sol-panel-toggle" id="sol-panel-toggle" title="Show question">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
          Question
        </button>

        <div class="algo-solution-content-area" id="algo-sol-content-area" style="flex:1; display:flex; flex-direction:column; position:relative; min-width: 0; min-height: 0; overflow:hidden;">
          <div class="ai-solver-loading" style="padding: 40px; text-align: center;">
            <div class="spinner"></div>
            <p style="color:var(--primary);font-weight:600;margin-top:16px;">Checking for solutions...</p>
          </div>
        </div>
      </div>
    </div>
  `;

  // Wire up the question panel toggle & resizer
  const questionPanel = document.getElementById('sol-question-panel');
  const panelToggle = document.getElementById('sol-panel-toggle');
  const panelClose = document.getElementById('sol-panel-close');
  const panelBody = document.getElementById('sol-panel-body');
  const openLcBtn = document.getElementById('sol-panel-open-lc');
  const resizer = document.getElementById('sol-panel-resizer');
  const layoutContainer = document.getElementById('sol-layout-container');

  let panelContentLoaded = false;
  let isResizing = false;

  openLcBtn?.addEventListener('click', () => {
    if (q.question_link) {
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

  // Resizing Logic
  resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    layoutContainer.classList.add('is-resizing');
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const containerRect = layoutContainer.getBoundingClientRect();
    let newWidth = e.clientX - containerRect.left;
    // Constrain width
    if (newWidth < 300) newWidth = 300;
    if (newWidth > containerRect.width - 300) newWidth = containerRect.width - 300;
    questionPanel.style.width = newWidth + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      layoutContainer.classList.remove('is-resizing');
    }
  });

  panelToggle?.addEventListener('click', () => {
    questionPanel.classList.add('open');
    questionPanel.style.width = '48%'; // Reset to default when opening
    panelToggle.style.display = 'none';
    resizer.classList.add('active');

    // Lazy-load question content on first open
    if (!panelContentLoaded && q.question_link) {
      panelContentLoaded = true;
      const slugMatch = q.question_link.match(/problems\/([^/?#]+)/);
      const titleSlug = slugMatch ? slugMatch[1] : '';
      if (titleSlug) {
        invoke('fetch_leetcode_question', { titleSlug }).then(data => {
          if (data && data.content) {
            panelBody.innerHTML = `
              <div style="margin-bottom:16px;">
                <h2 style="font-size:1.2rem; font-weight:800; color:var(--text); margin:0 0 8px 0;">
                  ${data.questionFrontendId ? data.questionFrontendId + '. ' : ''}${data.title}
                </h2>
                <div style="display:flex; gap:6px; flex-wrap:wrap;">
                  <span class="algo-diff-badge ${diffClass}" style="padding:2px 10px; font-size:0.72rem;">${data.difficulty}</span>
                  ${(data.topicTags || []).map(t => `<span style="background:var(--bg);border:1px solid var(--border);padding:2px 8px;border-radius:16px;font-size:0.68rem;font-weight:600;color:var(--subtext);">${t.name}</span>`).join('')}
                </div>
              </div>
              <div style="font-size:0.88rem; line-height:1.75; color:var(--text);">
                ${data.content}
              </div>
            `;
          } else {
            panelBody.innerHTML = `<p style="color:var(--subtext);text-align:center;padding:40px 0;">Could not load question content.</p>`;
          }
        }).catch(() => {
          panelBody.innerHTML = `<p style="color:var(--subtext);text-align:center;padding:40px 0;">Failed to fetch question. Check your connection.</p>`;
        });
      }
    }
  });

  panelClose?.addEventListener('click', () => {
    questionPanel.classList.remove('open');
    questionPanel.style.width = ''; // Clear inline width from resizer
    panelToggle.style.display = '';
    resizer.classList.remove('active');
  });

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
        <div class="custom-solution-container" style="display:flex; flex-direction:column; flex:1; min-height:0; scrollbar-width:thin; scrollbar-color:rgba(var(--primary-rgb), 0.2) transparent;">
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
              <div class="custom-sol-theme-buttons">
                <button class="custom-sol-theme-btn theme-btn-one-dark ${selectedTheme === 'one-dark' ? 'active' : ''}" data-theme="one-dark" title="One Dark"></button>
                <button class="custom-sol-theme-btn theme-btn-monokai ${selectedTheme === 'monokai' ? 'active' : ''}" data-theme="monokai" title="Monokai"></button>
                <button class="custom-sol-theme-btn theme-btn-dracula ${selectedTheme === 'dracula' ? 'active' : ''}" data-theme="dracula" title="Dracula"></button>
                <button class="custom-sol-theme-btn theme-btn-nord ${selectedTheme === 'nord' ? 'active' : ''}" data-theme="nord" title="Nord"></button>
                <button class="custom-sol-theme-btn theme-btn-cyberpunk ${selectedTheme === 'cyberpunk' ? 'active' : ''}" data-theme="cyberpunk" title="Cyberpunk"></button>
                <button class="custom-sol-theme-btn theme-btn-solarized-dark ${selectedTheme === 'solarized-dark' ? 'active' : ''}" data-theme="solarized-dark" title="Solarized Dark"></button>
                <button class="custom-sol-theme-btn theme-btn-winter-blue ${selectedTheme === 'winter-blue' ? 'active' : ''}" data-theme="winter-blue" title="Winter Blue"></button>
                <button class="custom-sol-theme-btn theme-btn-github-light ${selectedTheme === 'github-light' ? 'active' : ''}" data-theme="github-light" title="GitHub Light"></button>
              </div>
              <select class="custom-sol-theme-dropdown" id="custom-sol-theme-dropdown">
                <option value="one-dark" ${selectedTheme === 'one-dark' ? 'selected' : ''}>One Dark</option>
                <option value="monokai" ${selectedTheme === 'monokai' ? 'selected' : ''}>Monokai</option>
                <option value="dracula" ${selectedTheme === 'dracula' ? 'selected' : ''}>Dracula</option>
                <option value="nord" ${selectedTheme === 'nord' ? 'selected' : ''}>Nord</option>
                <option value="cyberpunk" ${selectedTheme === 'cyberpunk' ? 'selected' : ''}>Cyberpunk</option>
                <option value="solarized-dark" ${selectedTheme === 'solarized-dark' ? 'selected' : ''}>Solarized Dark</option>
                <option value="winter-blue" ${selectedTheme === 'winter-blue' ? 'selected' : ''}>Winter Blue</option>
                <option value="github-light" ${selectedTheme === 'github-light' ? 'selected' : ''}>GitHub Light</option>
              </select>
            </div>

            <div class="custom-sol-actions">
              <button class="custom-sol-toggle-comments" id="algo-toggle-comments">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:4px;"></svg>
                <span class="toggle-text">Hide Comments</span>
              </button>
            </div>
          </div>
          <div class="custom-sol-body" style="padding:20px;">
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

          // Sync dropdown
          const dropdown = document.getElementById('custom-sol-theme-dropdown');
          if (dropdown) dropdown.value = selectedTheme;

          document.getElementById('custom-sol-code-wrapper').setAttribute('data-code-theme', selectedTheme);
        });
      });

      // Theme dropdown change listener
      const themeDropdown = document.getElementById('custom-sol-theme-dropdown');
      if (themeDropdown) {
        themeDropdown.addEventListener('change', (e) => {
          selectedTheme = e.target.value;

          // Sync buttons
          contentArea.querySelectorAll('.custom-sol-theme-btn').forEach(b => {
            if (b.getAttribute('data-theme') === selectedTheme) {
              b.classList.add('active');
            } else {
              b.classList.remove('active');
            }
          });

          document.getElementById('custom-sol-code-wrapper').setAttribute('data-code-theme', selectedTheme);
        });
      }

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

// 6d. In-App LeetCode Question Reader (native render via GraphQL)
async function renderLeetcodeWebview() {
  const url = store.leetcodeUrl;
  const q = store.algoSelectedQuestion;

  if (!url) {
    viewContainer.innerHTML = `
      <div class="selection-card fade-in" style="text-align:center; max-width:500px;">
        <h3>No URL Provided</h3>
        <p style="color:var(--subtext);margin-top:12px;">Could not load the LeetCode question. Please go back and try again.</p>
      </div>
    `;
    return;
  }

  // Extract title-slug from URL (e.g. "missing-number" from ".../problems/missing-number/")
  const slugMatch = url.match(/problems\/([^/?#]+)/);
  const titleSlug = slugMatch ? slugMatch[1] : '';

  if (!titleSlug) {
    viewContainer.innerHTML = `
      <div class="selection-card fade-in" style="text-align:center; max-width:500px;">
        <h3>Invalid URL</h3>
        <p style="color:var(--subtext);margin-top:12px;">Could not extract problem slug from: ${url}</p>
      </div>
    `;
    return;
  }

  // Show cute fox loading state
  viewContainer.innerHTML = `
    <div class="fox-loader">
      <div class="fox-loader-icon">
        <img src="/assets/Foxy.png" alt="🦊" onerror="this.outerHTML='🦊'" />
      </div>
      <div class="fox-loader-dots">
        <span></span><span></span><span></span>
      </div>
      <span class="fox-loader-text">Fetching question...</span>
    </div>
  `;

  try {
    // Fetch question content via Rust backend (bypasses CORS)
    const data = await invoke('fetch_leetcode_question', { titleSlug });

    if (!data || !data.content) {
      throw new Error('No content returned from LeetCode API');
    }

    const diffLower = (data.difficulty || '').toLowerCase();
    const diffClass = diffLower === 'easy' ? 'badge-easy'
      : diffLower === 'medium' ? 'badge-medium'
        : diffLower === 'hard' ? 'badge-hard'
          : 'badge-easy';

    const topicTagsHtml = (data.topicTags || []).map(t =>
      `<span style="background:var(--bg); border:1px solid var(--border); padding:3px 10px; border-radius:20px; font-size:0.72rem; font-weight:600; color:var(--subtext);">${t.name}</span>`
    ).join('');

    const hintsHtml = (data.hints && data.hints.length > 0) ? `
      <details class="lc-hints-section" style="margin-top:24px; border:1px solid var(--border); border-radius:var(--radius-md); overflow:hidden;">
        <summary style="padding:14px 20px; cursor:pointer; font-weight:700; font-size:0.9rem; color:var(--text); background:var(--bg); user-select:none; display:flex; align-items:center; gap:8px;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          Hints (${data.hints.length})
        </summary>
        <div style="padding:16px 20px; display:flex; flex-direction:column; gap:12px;">
          ${data.hints.map((h, i) => `
            <div style="padding:12px 16px; background:var(--bg); border-radius:var(--radius-sm); font-size:0.85rem; color:var(--text); line-height:1.6;">
              <span style="font-weight:700; color:var(--primary); margin-right:6px;">Hint ${i + 1}:</span>
              ${h}
            </div>
          `).join('')}
        </div>
      </details>
    ` : '';

    viewContainer.innerHTML = `
      <div class="lc-reader-scroll">
        <div class="lc-reader-container fade-in" style="max-width:820px; margin:0 auto; padding:32px 24px 60px;">
          <!-- Header bar -->
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:28px; flex-wrap:wrap; gap:12px;">
            <button id="lc-back-btn" style="display:flex; align-items:center; gap:6px; background:none; border:1px solid var(--border); border-radius:var(--radius-sm); padding:8px 16px; color:var(--text); cursor:pointer; font-size:0.84rem; font-weight:600; font-family:var(--font-sans); transition:var(--transition-fast);">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
              Back
            </button>
            <button id="lc-open-external" style="display:flex; align-items:center; gap:6px; background:var(--primary); border:none; border-radius:var(--radius-sm); padding:8px 16px; color:#fff; cursor:pointer; font-size:0.84rem; font-weight:600; font-family:var(--font-sans); transition:var(--transition-fast);">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              Open on LeetCode
            </button>
          </div>

          <!-- Title + metadata -->
          <div style="margin-bottom:24px;">
            <h1 style="font-size:1.6rem; font-weight:800; color:var(--text); margin:0 0 12px 0; line-height:1.3;">
              ${data.questionFrontendId ? data.questionFrontendId + '. ' : ''}${data.title}
            </h1>
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <span class="algo-diff-badge ${diffClass}" style="padding:3px 12px; font-size:0.76rem;">${data.difficulty}</span>
              ${topicTagsHtml}
            </div>
          </div>

          <!-- Question content (LeetCode HTML) -->
          <div class="lc-question-content" style="font-size:0.92rem; line-height:1.8; color:var(--text);">
            ${data.content}
          </div>

          ${hintsHtml}
        </div>
      </div>
    `;

    // Back button
    document.getElementById('lc-back-btn')?.addEventListener('click', () => {
      store.goBack();
    });

    // Open in external browser
    document.getElementById('lc-open-external')?.addEventListener('click', () => {
      if (window.__TAURI__) {
        invoke('plugin:opener|open_url', { url }).catch(err => {
          console.error("Failed to open URL via Tauri opener:", err);
          window.open(url, '_blank');
        });
      } else {
        window.open(url, '_blank');
      }
    });

  } catch (err) {
    console.error('Failed to fetch LeetCode question:', err);
    viewContainer.innerHTML = `
      <div class="selection-card fade-in" style="text-align:center; max-width:600px;">
        <h3 style="color:var(--accent); margin-bottom:12px;">Failed to Load Question</h3>
        <p style="color:var(--subtext); margin-bottom:16px;">${err.message || err}</p>
        <p style="color:var(--subtext); font-size:0.85rem; margin-bottom:20px;">Try opening it directly on LeetCode instead:</p>
        <button id="lc-fallback-open" style="background:var(--primary); border:none; border-radius:var(--radius-sm); padding:10px 20px; color:#fff; cursor:pointer; font-size:0.88rem; font-weight:600; font-family:var(--font-sans);">
          Open on LeetCode ↗
        </button>
        <br><br>
        <button id="lc-fallback-back" style="background:none; border:1px solid var(--border); border-radius:var(--radius-sm); padding:8px 16px; color:var(--text); cursor:pointer; font-size:0.84rem; font-weight:600; font-family:var(--font-sans);">
          Go Back
        </button>
      </div>
    `;
    document.getElementById('lc-fallback-open')?.addEventListener('click', () => {
      if (window.__TAURI__) {
        invoke('plugin:opener|open_url', { url }).catch(() => window.open(url, '_blank'));
      } else {
        window.open(url, '_blank');
      }
    });
    document.getElementById('lc-fallback-back')?.addEventListener('click', () => store.goBack());
  }
}

// 7. Settings View
async function renderSettingsView() {
  const isSupabaseConfigured = store.env.SUPABASE_URL && store.env.SUPABASE_KEY;
  const isGeminiConfigured = !!store.env.GEMINI_API_KEY;
  const isDriveConfigured = !!store.env.DRIVE_API_KEY;

  viewContainer.innerHTML = `
    <div class="settings-section fade-in">
      
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
        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-title">Jellyfish Ambient Background</span>
            <span class="setting-desc">Toggle the deep sea ambient glow video background. Best enjoyed in Dark Mode.</span>
          </div>
          <label class="switch">
            <input type="checkbox" id="jellyfish-switch" ${store.videoTheme === 'jellyfish' ? 'checked' : ''} />
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
    if (newTheme === 'light' && store.videoTheme === 'jellyfish') {
      store.setVideoTheme('none');
      const jfSwitch = document.getElementById('jellyfish-switch');
      if (jfSwitch) jfSwitch.checked = false;
    }
    updateThemeIcon();
  });

  // Attach jellyfish switch event
  const jellyfishSwitch = document.getElementById('jellyfish-switch');
  if (jellyfishSwitch) {
    jellyfishSwitch.addEventListener('change', () => {
      if (jellyfishSwitch.checked) {
        if (store.theme === 'light') {
          store.setTheme('dark');
          if (themeSwitch) themeSwitch.checked = true;
          updateThemeIcon();
        }
        store.setVideoTheme('jellyfish');
      } else {
        store.setVideoTheme('none');
      }
    });
  }



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
        if (stopwatchSeconds % 60 === 0) {
          store.logStudyMinutes(1);
        }
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

// Render About View
async function renderAboutView() {
  viewContainer.innerHTML = `
    <div class="about-section fade-in">
      <div class="about-header-card">
        <div class="about-logo-title">
          <span class="about-title-main">FOCUS</span>
          <span class="about-title-sub">FOX</span>
        </div>
        <div class="about-logo-container">
          <img src="assets/Foxy.png" alt="Focus Fox Icon" onerror="this.src='assets/logo.jpg'" />
        </div>
      </div>
      
      <p class="about-description">
        Focus Fox is your ultimate engineering companion designed to help you prepare for core engineering exams. Keep track of previous year questions, practice DSA patterns, collaborate on doubt feeds, and leverage customized utilities all in one place to streamline your learning journey.
      </p>
      
      <h2 class="about-section-heading">FOUNDERS/ DEVELOPERS</h2>
      
      <div class="developers-container">
        <!-- Abinash Mohanty -->
        <div class="developer-card">
          <div class="developer-info-row">
            <div class="developer-avatar">
              <img src="assets/nick.jpg" alt="Abinash Mohanty" onerror="this.src='assets/logo.jpg'" />
            </div>
            <div class="developer-details">
              <span class="developer-name">Abinash Mohanty</span>
              <span class="developer-role">@Royace</span>
            </div>
          </div>
          <div class="developer-socials-row">
            <a class="social-button" id="dev2-linkedin" href="#">
              <svg viewBox="0 0 24 24"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6zM2 9h4v12H2z"/><circle cx="4" cy="4" r="2"/></svg>
              LinkedIn
            </a>
            <a class="social-button" id="dev2-github" href="#">
              <svg viewBox="0 0 24 24"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
              GitHub
            </a>
            <a class="social-button" id="dev2-instagram" href="#">
              <svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37zM17.5 6.5h.01"/></svg>
              Instagram
            </a>
          </div>
        </div>

        <!-- Yogisha Rani -->
        <div class="developer-card">
          <div class="developer-info-row">
            <div class="developer-avatar">
              <img src="assets/judy.jpg" alt="Yogisha Rani" onerror="this.src='assets/logo.jpg'" />
            </div>
            <div class="developer-details">
              <span class="developer-name">Yogisha Rani</span>
              <span class="developer-role">@Random</span>
            </div>
          </div>
          <div class="developer-socials-row">
            <a class="social-button" id="dev1-linkedin" href="#">
              <svg viewBox="0 0 24 24"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6zM2 9h4v12H2z"/><circle cx="4" cy="4" r="2"/></svg>
              LinkedIn
            </a>
            <a class="social-button" id="dev1-github" href="#">
              <svg viewBox="0 0 24 24"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
              GitHub
            </a>
            <a class="social-button" id="dev1-instagram" href="#">
              <svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37zM17.5 6.5h.01"/></svg>
              Instagram
            </a>
          </div>
        </div>
      </div>

      <div class="about-footer">
        <span class="about-version">Focus Fox Desktop v1.0.0</span>
        <span class="about-copyright">&copy; 2026 Focus Fox. All rights reserved.</span>
      </div>
    </div>
  `;

  // Attach event listeners to links
  const setupDevLink = (id, url) => {
    document.getElementById(id)?.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.__TAURI__) {
        invoke('plugin:opener|open_url', { url }).catch(err => {
          console.error("Failed to open URL via Tauri opener:", err);
          window.open(url, '_blank');
        });
      } else {
        window.open(url, '_blank');
      }
    });
  };

  setupDevLink('dev1-linkedin', 'https://www.linkedin.com/in/yogisha-rani-1382a7381/');
  setupDevLink('dev1-github', 'https://github.com/LostRunes');
  setupDevLink('dev1-instagram', 'https://www.instagram.com/lostpresence_2/#');

  setupDevLink('dev2-linkedin', 'https://www.linkedin.com/in/abinash-mohanty-/');
  setupDevLink('dev2-github', 'https://github.com/abinashmohanty8059');
  setupDevLink('dev2-instagram', 'https://www.instagram.com/_.royace._/');
}

// Start the Application
window.addEventListener('DOMContentLoaded', () => {
  init();
});
