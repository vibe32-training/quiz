import { generateQuiz } from "../lib/generate.js";
import { createHandler } from "../lib/http.js";
import { validateRequest } from "../lib/quiz.js";

export default createHandler(validateRequest, async (input) => {
  const { sourceText, ...meta } = input;
  return { ...meta, questions: await generateQuiz(input) };
});
