// Focus Fox Supabase Client Service
import { store } from './store.js';

let supabaseInstance = null;

function getSupabase() {
  if (supabaseInstance) return supabaseInstance;

  const { SUPABASE_URL, SUPABASE_KEY } = store.env;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Supabase credentials are not loaded yet!");
    return null;
  }

  if (window.supabase) {
    supabaseInstance = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    return supabaseInstance;
  } else {
    console.error("Supabase CDN library is not available on window!");
    return null;
  }
}

export const supabaseClient = {
  async getBranches() {
    const client = getSupabase();
    if (!client) return [];
    const { data, error } = await client.from('branches').select('*');
    if (error) {
      console.error("Error fetching branches:", error);
      throw error;
    }
    return data;
  },

  async getYears() {
    const client = getSupabase();
    if (!client) return [];
    const { data, error } = await client.from('years').select('*');
    if (error) {
      console.error("Error fetching years:", error);
      throw error;
    }
    return data;
  },

  async getSubjectsBySemester(branchId, semester) {
    const client = getSupabase();
    if (!client) return [];
    const { data, error } = await client
      .from('branch_subjects')
      .select('subjects(id, name, code, pyq_drive_link, notes_drive_link, course_outcome_link)')
      .eq('branch_id', branchId)
      .eq('semester', semester);

    if (error) {
      console.error("Error fetching subjects:", error);
      throw error;
    }
    return (data || []).map(item => item.subjects).filter(Boolean);
  },

  async getTopics(subjectId) {
    const client = getSupabase();
    if (!client) return [];
    const { data, error } = await client
      .from('topics')
      .select('*')
      .eq('subject_id', subjectId);
    if (error) {
      console.error("Error fetching topics:", error);
      throw error;
    }
    return data;
  },

  async getTopicsWithImportance(subjectId) {
    const client = getSupabase();
    if (!client) return [];

    // 1. Fetch topics
    const topics = await this.getTopics(subjectId);
    if (!topics || topics.length === 0) return [];

    const topicIds = topics.map(t => t.id);

    // 2. Fetch question_topics for these topics
    const { data: qtList, error: qtError } = await client
      .from('question_topics')
      .select('topic_id, question_id')
      .in('topic_id', topicIds);

    if (qtError) {
      console.error("Error fetching question_topics:", qtError);
      topics.forEach(t => t.importanceScore = 0);
      return topics;
    }

    const allQuestionIds = [...new Set(qtList.map(e => e.question_id))];
    if (allQuestionIds.length === 0) {
      topics.forEach(t => t.importanceScore = 0);
      return topics;
    }

    // 3. Fetch question_pyq_map with source years for these questions
    const { data: qpmList, error: qpmError } = await client
      .from('question_pyq_map')
      .select('question_id, pyq_sources(year)')
      .in('question_id', allQuestionIds);

    if (qpmError) {
      console.error("Error fetching question_pyq_map:", qpmError);
      topics.forEach(t => t.importanceScore = 0);
      return topics;
    }

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
    const client = getSupabase();
    if (!client) return [];
    const { data, error } = await client
      .from('topic_resources')
      .select('*')
      .eq('topic_id', topicId);
    if (error) {
      console.error("Error fetching topic resources:", error);
      throw error;
    }
    return data;
  },

  async getQuestionsByTopic(topicId) {
    const client = getSupabase();
    if (!client) return [];

    const { data, error } = await client
      .from('question_topics')
      .select('questions(id, question_text, difficulty)')
      .eq('topic_id', topicId);

    if (error) {
      console.error("Error fetching questions by topic:", error);
      throw error;
    }

    return (data || []).map(item => item.questions).filter(Boolean);
  },

  async getPyqSourcesForQuestion(questionId) {
    const client = getSupabase();
    if (!client) return [];
    const { data, error } = await client
      .from('question_pyq_map')
      .select('pyq_sources(id, year, exam_type, season, question_number)')
      .eq('question_id', questionId);

    if (error) {
      console.error("Error fetching pyq sources:", error);
      throw error;
    }
    return (data || []).map(item => item.pyq_sources).filter(Boolean);
  },

  async getImagesForQuestion(questionId) {
    const client = getSupabase();
    if (!client) return [];
    const { data, error } = await client
      .from('images')
      .select('*')
      .eq('question_id', questionId)
      .order('order_index', { ascending: true });

    if (error) {
      console.error("Error fetching images for question:", error);
      throw error;
    }
    return data;
  }
};
