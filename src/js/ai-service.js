// Focus Fox AI Service (Gemini API integration)
import { store } from './store.js';

export const aiService = {
  async solveQuestion(questionText) {
    const apiKey = store.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("Gemini API key is not configured.");
    }

    const model = "gemini-3.1-flash-lite-preview";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    console.log(`Calling Gemini Solver (${model})...`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Solve this engineering exam question step-by-step.

Format the answer using clean markdown:
- Use ## for sections (🧠 UNDERSTANDING, 📐 FORMULAS & STEPS, ✅ FINAL ANSWER)
- Use bullet points for steps
- Use short, clear paragraphs
- Keep it neat and exam-ready

Question:
${questionText}`
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API Error details:", errorText);
      throw new Error(`Gemini API returned code ${response.status}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "I couldn't generate a solution. Please try again.";
  }
};
