// Focus Fox State Store

const VIDEO_THEMES = {
  jellyfish: 'https://ik.imagekit.io/tm5te9cjl/focus%20fox%20background/10480-224857514_medium.mp4?v=2'
};

export { VIDEO_THEMES };

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
  videoTheme: 'none', // 'none', 'jellyfish', 'anime', 'abstract'

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

    // Load video theme
    const savedVideoTheme = localStorage.getItem('focus_fox_video_theme');
    if (savedVideoTheme && (savedVideoTheme in VIDEO_THEMES || savedVideoTheme === 'none')) {
      this.videoTheme = savedVideoTheme;
    }
    this.applyVideoTheme();
  },

  setTheme(newTheme) {
    this.theme = newTheme;
    localStorage.setItem('focus_fox_theme', newTheme);
    this.applyTheme();
    this.applyVideoTheme();
  },

  setVideoTheme(themeName) {
    // If same theme is tapped again, turn it off
    if (this.videoTheme === themeName) {
      this.videoTheme = 'none';
    } else {
      this.videoTheme = themeName;
    }
    localStorage.setItem('focus_fox_video_theme', this.videoTheme);
    this.applyVideoTheme();
    // Notify UI to update toggles
    window.dispatchEvent(new CustomEvent('video-theme-changed', { detail: { videoTheme: this.videoTheme } }));
  },

  applyVideoTheme() {
    let videoBg = document.getElementById('video-theme-bg');
    let loader = document.getElementById('video-theme-loader');

    if (this.videoTheme !== 'none' && VIDEO_THEMES[this.videoTheme]) {
      const videoUrl = VIDEO_THEMES[this.videoTheme];
      const displayName = this.videoTheme.charAt(0).toUpperCase() + this.videoTheme.slice(1);

      // Create or show loader
      if (!loader) {
        loader = document.createElement('div');
        loader.id = 'video-theme-loader';
        loader.className = 'video-theme-loader';
        loader.innerHTML = `
          <div class="vt-loader-content">
            <div class="vt-spinner"></div>
            <div class="vt-loader-text">Loading ${displayName} Theme</div>
            <div class="vt-loader-subtext">Fetching ambient video background...</div>
          </div>
        `;
        document.body.appendChild(loader);
      } else {
        const textEl = loader.querySelector('.vt-loader-text');
        if (textEl) textEl.textContent = `Loading ${displayName} Theme`;
        loader.classList.remove('fade-out');
      }

      if (!videoBg) {
        videoBg = document.createElement('video');
        videoBg.id = 'video-theme-bg';
        videoBg.autoplay = true;
        videoBg.loop = true;
        videoBg.muted = true;
        videoBg.playsInline = true;
        videoBg.className = 'video-theme-bg';
        document.body.appendChild(videoBg);
      }

      let srcChanged = false;
      if (videoBg.getAttribute('data-theme-name') !== this.videoTheme) {
        videoBg.src = videoUrl;
        videoBg.setAttribute('data-theme-name', this.videoTheme);
        videoBg.load();
        srcChanged = true;
      }

      const showVideo = () => {
        document.body.classList.add('video-theme-active');
        if (loader) {
          loader.classList.add('fade-out');
        }
      };

      if (srcChanged) {
        videoBg.onplaying = showVideo;
        videoBg.oncanplay = showVideo;
        videoBg.play().catch((err) => {
          console.warn("Autoplay prevented, showing interface", err);
          showVideo();
        });
      } else {
        showVideo();
        videoBg.play().catch(() => {});
      }
      videoBg.style.display = 'block';
    } else {
      if (videoBg) {
        videoBg.style.display = 'none';
        videoBg.pause();
      }
      document.body.classList.remove('video-theme-active');
      if (loader) {
        loader.classList.add('fade-out');
      }
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
