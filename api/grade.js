import { gradeAnswers } from "../lib/generate.js";
import { createHandler } from "../lib/http.js";
import { validateGradeRequest } from "../lib/quiz.js";

export default createHandler(validateGradeRequest, async (items) => ({
  results: await gradeAnswers(items)
}));
