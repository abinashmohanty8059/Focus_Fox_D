// Focus Fox Supabase Client Service (via Rust Proxy to bypass CORS/Origin blocks)
import { store } from './store.js';

// Access tauri invoke safely
const { invoke } = window.__TAURI__ ? window.__TAURI__.core : { invoke: async () => ({}) };

async function supabaseFetch(endpoint) {
  const { SUPABASE_URL, SUPABASE_KEY } = store.env;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("Supabase credentials are not loaded yet!");
  }

  try {
    return await invoke('supabase_request', {
      url: SUPABASE_URL,
      key: SUPABASE_KEY,
      endpoint: endpoint
    });
  } catch (err) {
    console.error(`Supabase Proxy API Error on ${endpoint}:`, err);
    throw new Error(err);
  }
}

export const supabaseClient = {
  async getBranches() {
    return await supabaseFetch('branches?select=*');
  },

  async getYears() {
    return await supabaseFetch('years?select=*');
  },

  async getSubjectsBySemester(branchId, semester) {
    const data = await supabaseFetch(`branch_subjects?select=subjects(id,name,code,pyq_drive_link,notes_drive_link,course_outcome_link)&branch_id=eq.${branchId}&semester=eq.${semester}`);
    return (data || []).map(item => item.subjects).filter(Boolean);
  },

  async getTopics(subjectId) {
    return await supabaseFetch(`topics?select=*&subject_id=eq.${subjectId}`);
  },

  async getTopicsWithImportance(subjectId) {
    // 1. Fetch topics
    const topics = await this.getTopics(subjectId);
    if (!topics || topics.length === 0) return [];

    const topicIds = topics.map(t => t.id);

    // 2. Fetch question_topics for these topics
    const qtList = await supabaseFetch(`question_topics?select=topic_id,question_id&topic_id=in.(${topicIds.join(',')})`);
    
    const allQuestionIds = [...new Set(qtList.map(e => e.question_id))];
    if (allQuestionIds.length === 0) {
      topics.forEach(t => t.importanceScore = 0);
      return topics;
    }

    // 3. Fetch question_pyq_map with source years for these questions
    const qpmList = await supabaseFetch(`question_pyq_map?select=question_id,pyq_sources(year)&question_id=in.(${allQuestionIds.join(',')})`);

    // 4. Calculate scores for each topic
    for (const topic of topics) {
      const topicQuestionIds = new Set(
        qtList
          .filter(qt => qt.topic_id === topic.id)
          .map(qt => qt.question_id)
      );

      const relatedPyqs = qpmList.filter(qpm => topicQuestionIds.has(qpm.question_id));

      const totalQuestions = topicQuestionIds.size;
      const totalPyqs = relatedPyqs.length;

      const uniqueYearsSet = new Set();
      relatedPyqs.forEach(qpm => {
        const source = qpm.pyq_sources;
        if (source) {
          if (Array.isArray(source)) {
            if (source.length > 0 && source[0].year) uniqueYearsSet.add(source[0].year);
          } else if (source.year) {
            uniqueYearsSet.add(source.year);
          }
        }
      });
      const uniqueYears = uniqueYearsSet.size;

      // Formula: score = (questions * 2) + (unique_years * 3) + (total_pyqs)
      const score = (totalQuestions * 2.0) + (uniqueYears * 3.0) + totalPyqs;
      topic.importanceScore = score;
    }

    return topics;
  },

  async getTopicResources(topicId) {
    return await supabaseFetch(`topic_resources?select=*&topic_id=eq.${topicId}`);
  },

  async getQuestionsByTopic(topicId) {
    const data = await supabaseFetch(`question_topics?select=questions(id,question_text,difficulty)&topic_id=eq.${topicId}`);
    return (data || []).map(item => item.questions).filter(Boolean);
  },

  async getPyqSourcesForQuestion(questionId) {
    const data = await supabaseFetch(`question_pyq_map?select=pyq_sources(id,year,exam_type,season,question_number)&question_id=eq.${questionId}`);
    return (data || []).map(item => item.pyq_sources).filter(Boolean);
  },

  async getImagesForQuestion(questionId) {
    return await supabaseFetch(`images?select=*&question_id=eq.${questionId}&order=order_index.asc`);
  },

  // Algo & Code — fetch distinct parent_topic values from leetcode table
  async getLeetcodeTopics() {
    const data = await supabaseFetch('leetcode?select=parent_topic&order=priority_order.asc');
    // Deduplicate parent topics while preserving order
    const seen = new Set();
    const unique = [];
    for (const row of (data || [])) {
      if (!seen.has(row.parent_topic)) {
        seen.add(row.parent_topic);
        unique.push(row.parent_topic);
      }
    }
    return unique;
  },

  // Algo & Code — fetch all questions for a given parent_topic ordered by priority_order
  async getLeetcodeByTopic(topic) {
    return await supabaseFetch(`leetcode?select=*&parent_topic=eq.${encodeURIComponent(topic)}&order=priority_order.asc`);
  },

  // Algo & Code — fetch all solutions for a given question ID
  async getLeetcodeSolutions(questionId) {
    return await supabaseFetch(`leet_solution?select=*&question_id=eq.${questionId}&order=created_at.asc`);
  }
};

