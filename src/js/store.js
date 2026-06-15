// Focus Fox State Store

export const store = {
  env: {
    SUPABASE_URL: '',
    SUPABASE_KEY: '',
    GEMINI_API_KEY: '',
    DRIVE_API_KEY: ''
  },
  branches: [],
  selectedBranch: null,
  selectedSemester: null,
  selectedSubject: null,
  selectedTopic: null,
  selectedQuestion: null,
  currentView: 'selection',
  viewHistory: [],
  completedTopics: [],
  solvedQuestions: [],
  theme: 'light',
  jellyfishMode: false,

  init() {
    // Load theme
    const savedTheme = localStorage.getItem('focus_fox_theme');
    if (savedTheme) {
      this.theme = savedTheme;
    } else {
      this.theme = 'light';
    }
    this.applyTheme();

    // Load progress
    this.completedTopics = JSON.parse(localStorage.getItem('focus_fox_completed_topics') || '[]');
    this.solvedQuestions = JSON.parse(localStorage.getItem('focus_fox_solved_questions') || '[]');

    // Load saved branch & semester selection
    const savedBranch = localStorage.getItem('focus_fox_selected_branch');
    const savedSemester = localStorage.getItem('focus_fox_selected_semester');
    if (savedBranch) {
      this.selectedBranch = JSON.parse(savedBranch);
    }
    if (savedSemester) {
      this.selectedSemester = parseInt(savedSemester, 10);
    }

    const savedJellyfish = localStorage.getItem('focus_fox_jellyfish');
    if (savedJellyfish) {
      this.jellyfishMode = savedJellyfish === 'true';
    }
    this.applyJellyfish();
  },

  setTheme(newTheme) {
    this.theme = newTheme;
    localStorage.setItem('focus_fox_theme', newTheme);
    this.applyTheme();
    this.applyJellyfish();
  },

  setJellyfishMode(enabled) {
    this.jellyfishMode = enabled;
    localStorage.setItem('focus_fox_jellyfish', enabled);
    this.applyJellyfish();
  },

  applyJellyfish() {
    let videoBg = document.getElementById('jellyfish-video-bg');
    if (this.jellyfishMode && this.theme === 'dark') {
      if (!videoBg) {
        videoBg = document.createElement('video');
        videoBg.id = 'jellyfish-video-bg';
        videoBg.src = 'https://ik.imagekit.io/tm5te9cjl/focus%20fox%20background/10480-224857514_medium.mp4';
        videoBg.autoplay = true;
        videoBg.loop = true;
        videoBg.muted = true;
        videoBg.className = 'jellyfish-video-bg';
        document.body.appendChild(videoBg);
      }
      videoBg.style.display = 'block';
      document.body.classList.add('jellyfish-active');
    } else {
      if (videoBg) {
        videoBg.style.display = 'none';
      }
      document.body.classList.remove('jellyfish-active');
    }
  },

  applyTheme() {
    document.documentElement.setAttribute('data-theme', this.theme);
  },

  saveSelection(branch, semester) {
    this.selectedBranch = branch;
    this.selectedSemester = semester;
    localStorage.setItem('focus_fox_selected_branch', JSON.stringify(branch));
    localStorage.setItem('focus_fox_selected_semester', semester);
  },

  clearSelection() {
    this.selectedBranch = null;
    this.selectedSemester = null;
    localStorage.removeItem('focus_fox_selected_branch');
    localStorage.removeItem('focus_fox_selected_semester');
  },

  toggleTopicCompletion(topicId) {
    const idx = this.completedTopics.indexOf(topicId);
    if (idx === -1) {
      this.completedTopics.push(topicId);
    } else {
      this.completedTopics.splice(idx, 1);
    }
    localStorage.setItem('focus_fox_completed_topics', JSON.stringify(this.completedTopics));
  },

  isTopicCompleted(topicId) {
    return this.completedTopics.includes(topicId);
  },

  toggleQuestionSolved(questionId) {
    const idx = this.solvedQuestions.indexOf(questionId);
    if (idx === -1) {
      this.solvedQuestions.push(questionId);
    } else {
      this.solvedQuestions.splice(idx, 1);
    }
    localStorage.setItem('focus_fox_solved_questions', JSON.stringify(this.solvedQuestions));
  },

  isQuestionSolved(questionId) {
    return this.solvedQuestions.includes(questionId);
  },

  navigateTo(view, data = {}) {
    if (this.currentView !== view) {
      this.viewHistory.push({ view: this.currentView, data: { ...this.selectedTopic, ...this.selectedSubject } });
      this.currentView = view;
    }
    if (view === 'selection') {
      this.selectedSubject = null;
      this.selectedTopic = null;
      this.selectedQuestion = null;
    }
    // Dispatch global event for state change
    window.dispatchEvent(new CustomEvent('state-changed', { detail: { view, data } }));
  },

  goBack() {
    if (this.viewHistory.length > 0) {
      const prev = this.viewHistory.pop();
      this.currentView = prev.view;
      window.dispatchEvent(new CustomEvent('state-changed', { detail: { view: prev.view, data: prev.data } }));
      return true;
    }
    return false;
  }
};
